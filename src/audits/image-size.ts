type ImageType = 'png' | 'gif' | 'jpeg' | 'webp' | 'avif' | 'svg';

export interface ImageSize {
  width: number;
  height: number;
  type: ImageType;
}

const ascii = (buffer: Buffer, start: number, end: number) =>
  buffer.subarray(start, end).toString('latin1');

const sized = (width: number, height: number, type: ImageType): ImageSize | undefined =>
  width > 0 && height > 0 ? { width, height, type } : undefined;

const png = (buffer: Buffer) =>
  buffer.length >= 24 && ascii(buffer, 12, 16) === 'IHDR'
    ? sized(buffer.readUInt32BE(16), buffer.readUInt32BE(20), 'png')
    : undefined;

const gif = (buffer: Buffer) =>
  buffer.length >= 10 ? sized(buffer.readUInt16LE(6), buffer.readUInt16LE(8), 'gif') : undefined;

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpeg = (buffer: Buffer) => {
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (SOF.has(marker)) {
      return sized(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5), 'jpeg');
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return undefined;
};

const uint24 = (buffer: Buffer, offset: number) =>
  (buffer[offset] ?? 0) | ((buffer[offset + 1] ?? 0) << 8) | ((buffer[offset + 2] ?? 0) << 16);

const webp = (buffer: Buffer) => {
  const chunk = ascii(buffer, 12, 16);
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    return sized(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff, 'webp');
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'webp');
  }
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return sized(uint24(buffer, 24) + 1, uint24(buffer, 27) + 1, 'webp');
  }
  return undefined;
};

const avif = (buffer: Buffer) => {
  const at = buffer.indexOf('ispe', 0, 'latin1');
  if (at < 0 || at + 16 > buffer.length) return undefined;
  return sized(buffer.readUInt32BE(at + 8), buffer.readUInt32BE(at + 12), 'avif');
};

const svgLength = (value: string | undefined) => {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/);
  return match ? Number(match[1]) : undefined;
};

const svgAttr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];

const svg = (buffer: Buffer) => {
  const tag = buffer
    .subarray(0, 4096)
    .toString('utf8')
    .match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return undefined;
  const width = svgLength(svgAttr(tag, 'width'));
  const height = svgLength(svgAttr(tag, 'height'));
  if (width && height) return sized(width, height, 'svg');
  const box = svgAttr(tag, 'viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length !== 4) return undefined;
  const [, , boxWidth = 0, boxHeight = 0] = box;
  return sized(boxWidth, boxHeight, 'svg');
};

export const imageSize = (buffer: Buffer): ImageSize | undefined => {
  if (buffer.length < 4) return undefined;
  if (buffer.readUInt32BE(0) === 0x89504e47) return png(buffer);
  if (ascii(buffer, 0, 4) === 'GIF8') return gif(buffer);
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpeg(buffer);
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return webp(buffer);
  if (ascii(buffer, 4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(buffer, 8, 12))) {
    return avif(buffer);
  }
  return svg(buffer);
};
