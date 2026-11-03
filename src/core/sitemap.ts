import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { localFile, originOf } from './html.ts';
import { stripBase } from './util.ts';

const SITEMAPS = ['sitemap.xml', 'sitemap-index.xml', 'sitemap_index.xml'];

export const pathnameOf = (url: string, siteUrl: string) => {
  try {
    const parsed = new URL(url);
    const siteOrigin = originOf(siteUrl);
    if (siteOrigin && parsed.origin !== siteOrigin) return null;
    return stripBase(parsed.pathname, siteUrl);
  } catch {
    return null;
  }
};

const UNESCAPED_AMPERSAND = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/;

const W3C_DATETIME =
  /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?)?)?$/;

const blocks = (xml: string, parent: string) =>
  [...xml.matchAll(new RegExp(`<${parent}\\b[^>]*>([\\s\\S]*?)</${parent}\\s*>`, 'gi'))].map(
    ([, body = '']) => body,
  );

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// XML 1.0 §4.6/§4.1: only the five predefined entities, and numeric references are plain code
// points (no windows-1252 remap as in HTML). Anything else is left as written.
const decodeXml = (text: string) =>
  text.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (match, hex, dec, name) => {
    if (name) return XML_ENTITIES[name] ?? match;
    const point = Number.parseInt(hex ?? dec, hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)
      ? String.fromCodePoint(point)
      : match;
  });

const locs = (xml: string, parent: string) =>
  blocks(xml, parent)
    .map((body) => /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(body)?.[1])
    .filter((loc): loc is string => loc !== undefined)
    .map((loc) => {
      const cdata = /^\s*<!\[CDATA\[/.test(loc);
      const raw = loc.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
      return {
        value: cdata ? raw : decodeXml(raw),
        raw,
        escaped: cdata || !UNESCAPED_AMPERSAND.test(raw),
      };
    });

const badLastmods = (xml: string) =>
  ['sitemap', 'url']
    .flatMap((parent) => blocks(xml, parent))
    .map((body) => /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod\s*>/i.exec(body)?.[1]?.trim())
    .filter((value): value is string => value !== undefined && !W3C_DATETIME.test(value));

interface Sitemap {
  file: string;
  urls: string[];
  children: string[];
  bytes: number;
  corrupt?: boolean;
  unescaped: string[];
  badLastmods: string[];
}

export const readSitemaps = (dist: string, siteUrl: string, extraPaths: string[] = []) => {
  const roots = [...SITEMAPS.map((name) => `/${name}`), ...extraPaths]
    .map((path) => localFile(dist, path))
    .filter((file): file is string => file !== null);
  const visited = new Set<string>();
  const sitemaps: Sitemap[] = [];
  const queue = [...new Set(roots)];
  for (const file of queue) {
    if (visited.has(file)) continue;
    visited.add(file);
    const raw = readFileSync(file);
    let buffer: Buffer;
    try {
      buffer = file.endsWith('.gz') ? gunzipSync(raw) : raw;
    } catch {
      sitemaps.push({
        file,
        urls: [],
        children: [],
        bytes: 0,
        corrupt: true,
        unescaped: [],
        badLastmods: [],
      });
      continue;
    }
    const xml = buffer.toString('utf8');
    const childLocs = locs(xml, 'sitemap');
    const urlLocs = locs(xml, 'url');
    const children = childLocs.map((loc) => loc.value);
    for (const loc of children) {
      const path = pathnameOf(loc, siteUrl);
      const child = path ? localFile(dist, path) : null;
      if (child) queue.push(child);
    }
    sitemaps.push({
      file,
      urls: urlLocs.map((loc) => loc.value),
      children,
      bytes: buffer.length,
      unescaped: [...childLocs, ...urlLocs].filter((loc) => !loc.escaped).map((loc) => loc.raw),
      badLastmods: badLastmods(xml),
    });
  }
  return sitemaps;
};

export const robotsSitemapPaths = (dist: string, siteUrl: string) => {
  const file = localFile(dist, '/robots.txt');
  if (!file) return [];
  return [...readFileSync(file, 'utf8').matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)]
    .map(([, url = '']) => pathnameOf(url, siteUrl))
    .filter((path): path is string => path !== null);
};
