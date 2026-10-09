import { closeSync, globSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Pattern } from '../config/types.ts';
import { matchesAny, stripBase, underBase } from './util.ts';

export interface Tag {
  name: string;
  attrs: Record<string, string>;
  index: number;
}

export interface BuiltPage {
  file: string;
  rel: string;
  path: string;
  html: string;
}

// Latin-1 names, in code point order from U+00A0.
const LATIN1 = [
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg',
  'macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14',
  'frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave',
  'Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde',
  'Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute',
  'acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute',
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave',
  'uacute ucirc uuml yacute thorn yuml',
]
  .join(' ')
  .split(' ');

const ENTITIES: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCodePoint(0xa0 + i)])),
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  OElig: 'Œ',
  oelig: 'œ',
  Scaron: 'Š',
  scaron: 'š',
  Yuml: 'Ÿ',
  fnof: 'ƒ',
  circ: 'ˆ',
  tilde: '˜',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200c',
  zwj: '\u200d',
  lrm: '\u200e',
  rlm: '\u200f',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  dagger: '†',
  Dagger: '‡',
  bull: '•',
  hellip: '…',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  euro: '€',
  trade: '™',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  minus: '−',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  hearts: '♥',
};

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]*);/gi, (entity, code: string) => {
    if (code[0] !== '#') {
      const name = Object.hasOwn(ENTITIES, code) ? code : code.toLowerCase();
      return (Object.hasOwn(ENTITIES, name) && ENTITIES[name]) || entity;
    }
    const point =
      code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });

const blankOut = (match: string) => match.replace(/[^\n]/g, ' ');

export const stripComments = (html: string) =>
  html.replace(/(<(script|style)\b[^>]*>[\s\S]*?<\/\2\s*>)|<!--[\s\S]*?-->/gi, (match, block) =>
    block ? match : blankOut(match),
  );

export const stripNonMarkup = (html: string) =>
  stripComments(html).replace(
    /(<(script|style|template)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
    (_, open: string, _name, body: string, close: string) => open + blankOut(body) + close,
  );

// Attributes are separated by whitespace, or by nothing after a quoted value (minifiers emit a="x"b="y").
const TAG =
  /<([a-zA-Z][\w:-]*)((?:(?:\s+|(?<=["']))[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const parseAttrs = (source: string) => {
  const attrs: Record<string, string> = {};
  for (const [, name = '', double, single, bare] of source.matchAll(ATTR)) {
    const key = name.toLowerCase();
    if (!Object.hasOwn(attrs, key)) attrs[key] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attrs;
};

interface Parsed {
  stripped: string;
  tags: Tag[];
}

const PARSE_CACHE_SIZE = 32;
const parseCache = new Map<string, Parsed>();

const parse = (html: string): Parsed => {
  const cached = parseCache.get(html);
  if (cached) return cached;
  const stripped = stripNonMarkup(html);
  const parsed = {
    stripped,
    tags: [...stripped.matchAll(TAG)].map((match) => ({
      name: (match[1] ?? '').toLowerCase(),
      attrs: parseAttrs(match[2] ?? ''),
      index: match.index,
    })),
  };
  if (parseCache.size >= PARSE_CACHE_SIZE) parseCache.delete(parseCache.keys().next().value ?? '');
  parseCache.set(html, parsed);
  return parsed;
};

export const tags = (html: string, ...names: string[]): Tag[] => {
  const all = parse(html).tags;
  if (!names.length) return [...all];
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return all.filter(({ name }) => wanted.has(name));
};

export const textOf = (html: string, name: string, within?: string) => {
  let { stripped } = parse(html);
  let offset = 0;
  if (within) {
    const scope = new RegExp(`<${within}\\b[^>]*>([\\s\\S]*?)</${within}\\s*>`, 'id').exec(
      stripped,
    );
    const bodyAt = stripped.search(/<body\b/i);
    const [from, to] = scope?.indices?.[1] ?? [0, bodyAt < 0 ? stripped.length : bodyAt];
    stripped = stripped.slice(from, to);
    offset = from;
  }
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, 'id').exec(stripped);
  const [start, end] = match?.indices?.[1] ?? [];
  if (start === undefined || end === undefined) return undefined;
  return decodeEntities(html.slice(offset + start, offset + end).replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
};

export const meta = (html: string, key: string) => {
  const wanted = key.toLowerCase();
  return tags(html, 'meta').find(({ attrs }) =>
    [attrs.name, attrs.property].some((value) => value?.toLowerCase() === wanted),
  )?.attrs.content;
};

export const relTokens = (tag: Tag) =>
  (tag.attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);

export const linksWithRel = (html: string, rel: string) =>
  tags(html, 'link').filter((tag) => relTokens(tag).includes(rel));

const pagePath = (rel: string) => `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;

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

const decodeHtml = (buffer: Buffer): string => {
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

export type PageReader = (exclude?: Pattern[]) => BuiltPage[];

export const createPageReader = (dist: string): PageReader => {
  let rels: string[] | undefined;
  const contents = new Map<string, string>();
  const read = (file: string) => {
    let html = contents.get(file);
    if (html === undefined) {
      html = decodeHtml(readFileSync(file));
      contents.set(file, html);
    }
    return html;
  };
  return (exclude = []) => {
    rels ??= globSync('**/*.html', { cwd: dist })
      .map((rel) => rel.split(sep).join('/'))
      .sort();
    return rels
      .filter((rel) => !matchesAny(exclude, rel))
      .map((rel) => {
        const file = join(dist, rel);
        return {
          file,
          rel,
          path: pagePath(rel),
          get html() {
            return read(file);
          },
        };
      });
  };
};

// A URL runs to the next whitespace, so commas inside it (/w_400,h_300/a.jpg) are kept.
export const srcsetUrls = (srcset = '') => {
  const urls: string[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset.charAt(i))) i += 1;
    const start = i;
    while (i < srcset.length && !/\s/.test(srcset.charAt(i))) i += 1;
    let url = srcset.slice(start, i);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      for (; i < srcset.length; i += 1) {
        const char = srcset.charAt(i);
        if (char === '(') depth += 1;
        else if (char === ')') depth -= 1;
        else if (char === ',' && depth <= 0) break;
      }
    }
    if (url) urls.push(url);
  }
  return urls;
};

const ROBOTS_META = new Set(['robots', 'googlebot']);

export const isNoindex = (html: string) =>
  tags(html, 'meta').some(
    ({ attrs }) =>
      ROBOTS_META.has((attrs.name ?? '').toLowerCase()) &&
      /\b(noindex|none)\b/i.test(attrs.content ?? ''),
  );

export const isFile = (path: string) =>
  statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export const localFile = (dist: string, pathname: string) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = join(dist, decoded);
  const root = base === dist;
  if (!root && !base.startsWith(dist + sep)) return null;
  return [base, join(base, 'index.html'), ...(root ? [] : [`${base}.html`])].find(isFile) ?? null;
};

export const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

export const resolveHref = (href: string, pagePath: string, siteUrl = '') => {
  const trimmed = href.trim();
  if (!trimmed || /^(#|data:|javascript:|mailto:|tel:|blob:)/i.test(trimmed)) return null;
  const base = 'http://vidimus.invalid';
  let url: URL;
  try {
    url = new URL(trimmed, base + pagePath);
  } catch {
    return null;
  }
  const site = originOf(siteUrl);
  const internal = url.origin === base || (site !== '' && url.origin === site);
  return {
    url,
    href: trimmed,
    internal,
    absolute: /^[a-z][a-z\d+.-]*:|^\/\//i.test(trimmed),
    path: internal && underBase(url.pathname, siteUrl) ? stripBase(url.pathname, siteUrl) : null,
  };
};
