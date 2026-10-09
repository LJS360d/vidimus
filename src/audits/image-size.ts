import { readFileSync } from 'node:fs';

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

const exifRotated = (buffer: Buffer, start: number, end: number) => {
  const tiff = start + 6;
  if (end - tiff < 8 || ascii(buffer, start, start + 6) !== 'Exif\0\0') return false;
  const little = ascii(buffer, tiff, tiff + 2) === 'II';
  if (!little && ascii(buffer, tiff, tiff + 2) !== 'MM') return false;
  const u16 = (at: number) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const ifd = tiff + (little ? buffer.readUInt32LE(tiff + 4) : buffer.readUInt32BE(tiff + 4));
  if (ifd + 2 > end) return false;
  const count = u16(ifd);
  for (let entry = ifd + 2, i = 0; i < count && entry + 12 <= end; i++, entry += 12) {
    if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8;
  }
  return false;
};

const jpeg = (buffer: Buffer) => {
  let offset = 2;
  let rotated = false;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (SOF.has(marker)) {
      const width = buffer.readUInt16BE(offset + 7);
      const height = buffer.readUInt16BE(offset + 5);
      return rotated ? sized(height, width, 'jpeg') : sized(width, height, 'jpeg');
    }
    if (marker === 0xe1 && !rotated) {
      rotated = exifRotated(
        buffer,
        offset + 4,
        Math.min(buffer.length, offset + 2 + buffer.readUInt16BE(offset + 2)),
      );
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

const byte = (buffer: Buffer, at: number) => buffer[at] ?? 0;

const boxes = (buffer: Buffer, start: number, end: number) => {
  const found: { type: string; body: number; end: number }[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buffer.readUInt32BE(at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(buffer.readBigUInt64BE(at + 8));
      head = 16;
    } else if (size === 0) size = end - at;
    if (size < head || at + size > end) break;
    found.push({ type: ascii(buffer, at + 4, at + 8), body: at + head, end: at + size });
    at += size;
  }
  return found;
};

const avifBrand = (buffer: Buffer) => {
  const isAvif = (brand: string) => brand === 'avif' || brand === 'avis';
  if (isAvif(ascii(buffer, 8, 12))) return true;
  const end = Math.min(buffer.length, buffer.readUInt32BE(0));
  for (let at = 16; at + 4 <= end; at += 4) if (isAvif(ascii(buffer, at, at + 4))) return true;
  return false;
};

const primaryIspe = (buffer: Buffer) => {
  const meta = boxes(buffer, 0, buffer.length).find((box) => box.type === 'meta');
  if (!meta || meta.body + 4 > meta.end) return undefined;
  const children = boxes(buffer, meta.body + 4, meta.end);
  const pitm = children.find((box) => box.type === 'pitm');
  const iprp = children.find((box) => box.type === 'iprp');
  if (!pitm || !iprp || pitm.body + 6 > pitm.end) return undefined;
  const wide = byte(buffer, pitm.body) > 0;
  if (wide && pitm.body + 8 > pitm.end) return undefined;
  const primary = wide ? buffer.readUInt32BE(pitm.body + 4) : buffer.readUInt16BE(pitm.body + 4);
  const props = boxes(buffer, iprp.body, iprp.end);
  const ipco = props.find((box) => box.type === 'ipco');
  const ipma = props.find((box) => box.type === 'ipma');
  if (!ipco || !ipma || ipma.body + 8 > ipma.end) return undefined;
  const version = byte(buffer, ipma.body);
  const wideFlags = (byte(buffer, ipma.body + 3) & 1) === 1;
  const count = buffer.readUInt32BE(ipma.body + 4);
  const properties = boxes(buffer, ipco.body, ipco.end);
  let at = ipma.body + 8;
  for (let entry = 0; entry < count; entry++) {
    const idSize = version >= 1 ? 4 : 2;
    if (at + idSize + 1 > ipma.end) return undefined;
    const id = version >= 1 ? buffer.readUInt32BE(at) : buffer.readUInt16BE(at);
    const associations = byte(buffer, at + idSize);
    const step = wideFlags ? 2 : 1;
    at += idSize + 1;
    if (at + associations * step > ipma.end) return undefined;
    for (let index = 0; index < associations; index++, at += step) {
      if (id !== primary) continue;
      const slot = wideFlags ? buffer.readUInt16BE(at) & 0x7fff : byte(buffer, at) & 0x7f;
      const property = properties[slot - 1];
      if (property?.type === 'ispe' && property.body + 12 <= property.end) return property.body;
    }
  }
  return undefined;
};

const avif = (buffer: Buffer) => {
  let at: number | undefined;
  try {
    at = primaryIspe(buffer);
  } catch {
    at = undefined;
  }
  if (at === undefined) {
    const first = buffer.indexOf('ispe', 0, 'latin1');
    if (first < 0 || first + 16 > buffer.length) return undefined;
    at = first + 4;
  }
  return sized(buffer.readUInt32BE(at + 4), buffer.readUInt32BE(at + 8), 'avif');
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

export const imageSizeOf = (file: string) => {
  try {
    return imageSize(readFileSync(file));
  } catch {
    return undefined;
  }
};

export const imageSize = (buffer: Buffer): ImageSize | undefined => {
  if (buffer.length < 4) return undefined;
  if (buffer.readUInt32BE(0) === 0x89504e47) return png(buffer);
  if (ascii(buffer, 0, 4) === 'GIF8') return gif(buffer);
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpeg(buffer);
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return webp(buffer);
  if (buffer.length >= 16 && ascii(buffer, 4, 8) === 'ftyp' && avifBrand(buffer)) {
    return avif(buffer);
  }
  return svg(buffer);
};
