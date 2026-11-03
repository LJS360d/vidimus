import { closeSync, openSync, readSync, statSync } from 'node:fs';

const BOMS: [number[], string][] = [
  [[0xef, 0xbb, 0xbf], 'utf-8'],
  [[0xff, 0xfe], 'utf-16le'],
  [[0xfe, 0xff], 'utf-16be'],
];

const knownLabel = (label: string) => {
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return undefined;
  }
};

const META_ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const CONTENT_CHARSET = /charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;"']+))/i;

// WHATWG §13.2.3.2 prescan: walk the <meta> tags of the first 1024 bytes, skipping comments;
// take a `charset` attribute, or the charset in `content` when `http-equiv` is content-type.
// An unknown label is skipped, and UTF-16 labels mean UTF-8.
const prescan = (text: string) => {
  const source = text.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (const [, attrText = ''] of source.matchAll(/<meta[\s/]([^>]*)>?/gi)) {
    const attrs = new Map<string, string>();
    for (const [, name = '', ...values] of attrText.matchAll(META_ATTR)) {
      const key = name.toLowerCase();
      if (!attrs.has(key)) attrs.set(key, values.find((v) => v !== undefined) ?? '');
    }
    const content = CONTENT_CHARSET.exec(attrs.get('content') ?? '');
    const label = attrs.has('charset')
      ? attrs.get('charset')
      : attrs.get('http-equiv')?.trim().toLowerCase() === 'content-type'
        ? content?.slice(1).find((v) => v !== undefined)
        : undefined;
    const encoding = label === undefined ? undefined : knownLabel(label.trim());
    if (encoding) return encoding.startsWith('utf-16') ? 'utf-8' : encoding;
  }
  return 'utf-8';
};

const detectCharset = (head: Buffer): string => {
  const bom = BOMS.find(([bytes]) => bytes.every((byte, i) => head[i] === byte));
  if (bom) return bom[1];
  return prescan(head.subarray(0, 1024).toString('latin1'));
};

const UTF8 = new TextDecoder('utf-8');

export const decodeHtml = (buffer: Buffer): string => {
  const label = detectCharset(buffer);
  // TextDecoder drops a UTF-8 BOM, as it does the UTF-16 ones.
  if (label === 'utf-8' || label === 'utf8') return UTF8.decode(buffer);
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
};

// Keyed on size and mtime, so the served charset follows a rebuilt file without reading every
// HTML response's first kilobyte again.
const charsetCache = new Map<string, { key: string; label: string }>();

export const fileCharset = (file: string): string => {
  let key = '';
  try {
    const { size, mtimeMs } = statSync(file);
    key = `${size}:${mtimeMs}`;
  } catch {
    return 'utf-8';
  }
  const cached = charsetCache.get(file);
  if (cached?.key === key) return cached.label;
  const head = Buffer.alloc(1024);
  let label = 'utf-8';
  try {
    const fd = openSync(file, 'r');
    try {
      label = detectCharset(head.subarray(0, readSync(fd, head, 0, 1024, 0)));
    } finally {
      closeSync(fd);
    }
  } catch {
    label = 'utf-8';
  }
  charsetCache.set(file, { key, label });
  return label;
};
