import { closeSync, openSync, readSync } from 'node:fs';

const BOMS: [number[], string][] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xff, 0xfe], 'utf-16le'],
  [[0xfe, 0xff], 'utf-16be'],
];

const detectCharset = (head: Buffer): string => {
  const bom = BOMS.find(([bytes]) => bytes.every((byte, i) => head[i] === byte));
  if (bom) return bom[1];
  const text = head.subarray(0, 1024).toString('latin1');
  const found =
    /<meta\s[^>]*charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(text) ??
    /<meta\s[^>]*http-equiv\s*=\s*["']?content-type[^>]*charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(
      text,
    );
  return found?.[1]?.toLowerCase() ?? 'utf-8';
};

export const decodeHtml = (buffer: Buffer): string => {
  const label = detectCharset(buffer);
  if (label === 'utf-8' || label === 'utf8') return buffer.toString('utf8');
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
};

export const fileCharset = (file: string): string => {
  const head = Buffer.alloc(1024);
  const fd = openSync(file, 'r');
  try {
    const label = detectCharset(head.subarray(0, readSync(fd, head, 0, 1024, 0)));
    new TextDecoder(label);
    return label;
  } catch {
    return 'utf-8';
  } finally {
    closeSync(fd);
  }
};
