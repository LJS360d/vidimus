import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeEntities, localFile } from './html.ts';
import { stripBase } from './util.ts';

const SITEMAPS = ['sitemap.xml', 'sitemap-index.xml', 'sitemap_index.xml'];

export const pathnameOf = (url: string, siteUrl: string) => {
  try {
    return stripBase(new URL(url).pathname, siteUrl);
  } catch {
    return null;
  }
};

const locs = (xml: string, parent: string) =>
  [...xml.matchAll(new RegExp(`<${parent}\\b[^>]*>([\\s\\S]*?)</${parent}\\s*>`, 'gi'))]
    .map(([, body = '']) => /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(body)?.[1])
    .filter((loc): loc is string => loc !== undefined)
    .map((loc) => decodeEntities(loc.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim()));

interface Sitemap {
  file: string;
  urls: string[];
  children: string[];
  bytes: number;
}

// Follows sitemap indexes to the child sitemaps that exist in the build.
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
    const buffer = file.endsWith('.gz') ? gunzipSync(raw) : raw;
    const xml = buffer.toString('utf8');
    const children = locs(xml, 'sitemap');
    for (const loc of children) {
      const path = pathnameOf(loc, siteUrl);
      const child = path ? localFile(dist, path) : null;
      if (child) queue.push(child);
    }
    sitemaps.push({ file, urls: locs(xml, 'url'), children, bytes: buffer.length });
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
