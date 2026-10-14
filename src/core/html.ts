import { globSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Pattern } from '../config/types.ts';
import { decodeHtml, fileCharset } from './charset.ts';
import { decodeEntities } from './entities.ts';
import { matchesAny, stripBase, underBase } from './util.ts';

export { decodeEntities, fileCharset };

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

const PARSE_CACHE_BYTES = 128 * 1024 * 1024;
const parseCache = new Map<string, Parsed>();
let parseCacheBytes = 0;

const scan = (stripped: string, wanted?: Set<string>) => {
  const found: Tag[] = [];
  for (const match of stripped.matchAll(TAG)) {
    const name = (match[1] ?? '').toLowerCase();
    if (wanted && !wanted.has(name)) continue;
    found.push({ name, attrs: parseAttrs(match[2] ?? ''), index: match.index });
  }
  return found;
};

const parse = (html: string): Parsed => {
  const cached = parseCache.get(html);
  if (cached) {
    parseCache.delete(html);
    parseCache.set(html, cached);
    return cached;
  }
  const stripped = stripNonMarkup(html);
  const parsed = { stripped, tags: scan(stripped) };
  parseCacheBytes += html.length * 2;
  parseCache.set(html, parsed);
  for (const key of parseCache.keys()) {
    if (parseCacheBytes <= PARSE_CACHE_BYTES || key === html) break;
    parseCache.delete(key);
    parseCacheBytes -= key.length * 2;
  }
  return parsed;
};

export const tags = (html: string, ...names: string[]): Tag[] => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  if (!names.length) return [...parse(html).tags];
  const cached = parseCache.get(html);
  if (cached) return cached.tags.filter(({ name }) => wanted.has(name));
  return scan(stripNonMarkup(html), wanted);
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

const localFileMemo = new Map<string, string | null>();

export type PageReader = (exclude?: Pattern[]) => BuiltPage[];

export const createPageReader = (dist: string): PageReader => {
  localFileMemo.clear();
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

export const localFile = (dist: string, pathname: string, exact = false) => {
  const key = `${dist}\0${pathname}\0${exact}`;
  const hit = localFileMemo.get(key);
  if (hit !== undefined) return hit;
  const found = resolveLocalFile(dist, pathname, exact);
  localFileMemo.set(key, found);
  return found;
};

const resolveLocalFile = (dist: string, pathname: string, exact: boolean) => {
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
  if (exact) return isFile(base) ? base : null;
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
