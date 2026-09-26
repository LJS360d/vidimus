import { globSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Pattern } from '../config/types.ts';
import { matchesAny, stripBase } from './util.ts';

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

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const point =
      code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });

const blankOut = (match: string) => match.replace(/[^\n]/g, ' ');

export const stripNonMarkup = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, blankOut)
    .replace(
      /(<(script|style|template)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi,
      (_, open: string, _name, body: string, close: string) => open + blankOut(body) + close,
    );

const TAG =
  /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const parseAttrs = (source: string) => {
  const attrs: Record<string, string> = {};
  for (const [, name = '', double, single, bare] of source.matchAll(ATTR)) {
    const key = name.toLowerCase();
    if (!(key in attrs)) attrs[key] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attrs;
};

export const tags = (html: string, ...names: string[]): Tag[] => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const found: Tag[] = [];
  for (const match of stripNonMarkup(html).matchAll(TAG)) {
    const name = (match[1] ?? '').toLowerCase();
    if (wanted.size && !wanted.has(name)) continue;
    found.push({ name, attrs: parseAttrs(match[2] ?? ''), index: match.index });
  }
  return found;
};

export const textOf = (html: string, name: string) => {
  const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, 'id').exec(
    stripNonMarkup(html),
  );
  const [start, end] = match?.indices?.[1] ?? [];
  if (start === undefined || end === undefined) return undefined;
  return decodeEntities(html.slice(start, end).replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
};

export const meta = (html: string, key: string) => {
  const wanted = key.toLowerCase();
  return tags(html, 'meta').find(
    ({ attrs }) => (attrs.name ?? attrs.property ?? '').toLowerCase() === wanted,
  )?.attrs.content;
};

export const relTokens = (tag: Tag) =>
  (tag.attrs.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);

export const linksWithRel = (html: string, rel: string) =>
  tags(html, 'link').filter((tag) => relTokens(tag).includes(rel));

const pagePath = (rel: string) => `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;

export const readPages = (dist: string, exclude: Pattern[] = []): BuiltPage[] =>
  globSync('**/*.html', { cwd: dist })
    .map((rel) => rel.split(sep).join('/'))
    .filter((rel) => !matchesAny(exclude, rel))
    .sort()
    .map((rel) => {
      const file = join(dist, rel);
      return { file, rel, path: pagePath(rel), html: readFileSync(file, 'utf8') };
    });

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export const localFile = (dist: string, pathname: string) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const base = join(dist, decoded);
  if (base !== dist && !base.startsWith(dist + sep)) return null;
  return [base, join(base, 'index.html'), `${base}.html`].find(isFile) ?? null;
};

const originOf = (url: string) => {
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
    path: internal ? stripBase(url.pathname, siteUrl) : null,
  };
};
