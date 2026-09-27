import { globSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { VidimusConfig } from '../config/types.ts';
import { UsageError } from './errors.ts';
import { localFile, originOf, type PageReader } from './html.ts';
import type { Renderer } from './render.ts';
import { pathnameOf, readSitemaps } from './sitemap.ts';
import { fallbackFor, firstFew, matchesAny } from './util.ts';

const SPA_BUNDLE_BYTES = 100_000;

const isPagePath = (path: string) => ['', '.html'].includes(extname(path));

// A same-origin link under the base path, as a path relative to that base.
const routeOf = (href: string, origin: string) => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const audited = new URL(origin);
  if (url.origin !== audited.origin) return null;
  const base = audited.pathname.replace(/\/$/, '');
  if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  const route = url.pathname.slice(base.length) || '/';
  return isPagePath(route) ? route : null;
};

const fromSitemap = (config: VidimusConfig, dist: string) => {
  const siteOrigin = originOf(config.siteUrl);
  return readSitemaps(dist, config.siteUrl)
    .flatMap(({ urls }) => urls)
    .filter((url) => !siteOrigin || originOf(url) === siteOrigin)
    .map((url) => pathnameOf(url, config.siteUrl))
    .filter((path): path is string => path !== null);
};

// Breadth first, one level of routes rendered at a time.
const crawl = async (
  renderer: Renderer,
  origin: string,
  seeds: string[],
  config: VidimusConfig,
  keep: (route: string) => boolean,
) => {
  const found = new Set(seeds);
  let level = [...found];
  let added = 0;
  while (level.length) {
    const rendered = await Promise.all(
      level.map((route) => renderer.render(`${origin}${route}`).catch(() => undefined)),
    );
    level = [];
    for (const href of rendered.flatMap((page) => page?.anchors ?? [])) {
      const next = routeOf(href, origin);
      if (!next || found.has(next) || !keep(next)) continue;
      if (added >= config.routes.limit) return [...found];
      found.add(next);
      level.push(next);
      added += 1;
    }
  }
  return [...found];
};

// Routes with no file in dist; routes that resolve to a file are already built pages.
export const resolveRoutes = async (
  config: VidimusConfig,
  dist: string,
  pages: PageReader,
  origin: string,
  renderer: Renderer,
) => {
  const { paths, discover } = config.routes;
  const keep = (route: string) => !matchesAny(config.exclude, route.slice(1));
  let routes = [...paths, ...(discover === 'sitemap' ? fromSitemap(config, dist) : [])];
  if (discover === 'crawl') {
    const seeds = [...pages(config.exclude).map(({ path }) => path), ...routes];
    routes = await crawl(renderer, origin, seeds, config, keep);
  }
  const fileless = [...new Set(routes)].filter((route) => keep(route) && !localFile(dist, route));
  const unanswered = fileless.filter((route) => !fallbackFor(config.server.fallback, route));
  if (unanswered.length && !config.origin) {
    throw new UsageError(
      `routes ${firstFew(unanswered)} have no file in ${config.distDir}; set server.fallback ` +
        `(e.g. 'index.html') so the built-in server answers them, or drop them from routes`,
    );
  }
  return fileless;
};

// The size of the largest script when the build is one HTML page next to a big bundle.
export const clientRenderedBundle = (config: VidimusConfig, dist: string, pages: PageReader) => {
  const html = pages(config.exclude).filter(({ rel }) => rel !== '404.html');
  if (html.length !== 1) return 0;
  const largest = Math.max(
    0,
    ...globSync('**/*.js', { cwd: dist }).map((rel) => statSync(join(dist, rel)).size),
  );
  return largest >= SPA_BUNDLE_BYTES ? largest : 0;
};

export const clientRenderedHint = (config: VidimusConfig, bundle: number) => {
  const { paths, discover } = config.routes;
  if (!bundle || paths.length || discover !== 'off') return undefined;
  return (
    `${config.distDir} has one HTML page and a ${Math.round(bundle / 1000)} kB script: ` +
    'looks like a client-rendered app; set routes.paths or routes.discover to audit its routes'
  );
};
