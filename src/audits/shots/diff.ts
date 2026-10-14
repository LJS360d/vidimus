// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const diffPngsInPage = async (
  beforeSrc: string,
  afterSrc: string,
  tolerance: number,
  antialiasing: boolean,
) => {
  const decode = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = src;
    });
  const [before, after] = await Promise.all([decode(beforeSrc), decode(afterSrc)]);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const pixels = (img: HTMLImageElement) => {
    const ctx = new OffscreenCanvas(width, height).getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const a = pixels(before);
  const b = pixels(after);
  const a32 = new Uint32Array(a.buffer);
  const b32 = new Uint32Array(b.buffer);

  const grey = (data: Uint8ClampedArray, i: number) =>
    0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
  const hasManySiblings = (data32: Uint32Array, x: number, y: number) => {
    let same = x === 0 || x === width - 1 || y === 0 || y === height - 1 ? 1 : 0;
    for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, height - 1); ny++) {
      for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, width - 1); nx++) {
        if ((nx !== x || ny !== y) && data32[ny * width + nx] === data32[y * width + x]) same += 1;
      }
    }
    return same > 2;
  };
  const isAntialiased = (
    data: Uint8ClampedArray,
    data32: Uint32Array,
    otherData32: Uint32Array,
    x: number,
    y: number,
  ) => {
    let same = x === 0 || x === width - 1 || y === 0 || y === height - 1 ? 1 : 0;
    let min = 0;
    let max = 0;
    let darkest = [x, y];
    let brightest = [x, y];
    const centre = grey(data, (y * width + x) * 4);
    for (let ny = Math.max(y - 1, 0); ny <= Math.min(y + 1, height - 1); ny++) {
      for (let nx = Math.max(x - 1, 0); nx <= Math.min(x + 1, width - 1); nx++) {
        if (nx === x && ny === y) continue;
        const delta = grey(data, (ny * width + nx) * 4) - centre;
        if (delta === 0) {
          same += 1;
          if (same > 2) return false;
        } else if (delta < min) {
          min = delta;
          darkest = [nx, ny];
        } else if (delta > max) {
          max = delta;
          brightest = [nx, ny];
        }
      }
    }
    if (min === 0 || max === 0) return false;
    const [dx = 0, dy = 0] = darkest;
    const [bx = 0, by = 0] = brightest;
    return (
      (hasManySiblings(data32, dx, dy) && hasManySiblings(otherData32, dx, dy)) ||
      (hasManySiblings(data32, bx, by) && hasManySiblings(otherData32, bx, by))
    );
  };

  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const image = ctx.createImageData(width, height);
  const d = image.data;
  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < d.length; i += 4) {
    const identical = a32[i >> 2] === b32[i >> 2];
    const delta = identical
      ? 0
      : Math.max(
          Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
          Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
          Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
          Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0)),
        );
    const pixel = i >> 2;
    if (
      delta > tolerance &&
      !(
        antialiasing &&
        (isAntialiased(a, a32, b32, pixel % width, Math.floor(pixel / width)) ||
          isAntialiased(b, b32, a32, pixel % width, Math.floor(pixel / width)))
      )
    ) {
      changed += 1;
      const px = pixel % width;
      const py = Math.floor(pixel / width);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      d.set([255, 0, 0, 255], i);
    } else {
      const fadedGrey = 255 - (255 - ((b[i] ?? 0) + (b[i + 1] ?? 0) + (b[i + 2] ?? 0)) / 3) * 0.2;
      d.set([fadedGrey, fadedGrey, fadedGrey, 255], i);
    }
  }
  ctx.putImageData(image, 0, 0);

  const blob = await out.convertToBlob({ type: 'image/png' });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return {
    changed,
    total: width * height,
    before: [before.width, before.height],
    after: [after.width, after.height],
    region: changed ? [minX, minY, maxX, maxY] : undefined,
    diffBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
  };
};
/* node:coverage enable */
