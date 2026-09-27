import { globSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { VidimusConfig } from '../config/types.ts';
import { UsageError } from './errors.ts';
import { localFile, originOf, type PageReader } from './html.ts';
import type { Browser } from './peer-types.ts';
import { pathnameOf, readSitemaps } from './sitemap.ts';
import { firstFew, matchesAny, navigate } from './util.ts';

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

const crawl = async (
  browser: Browser,
  origin: string,
  seeds: string[],
  config: VidimusConfig,
  keep: (route: string) => boolean,
) => {
  const found = new Set(seeds);
  const queue = [...found];
  let added = 0;
  const page = await browser.newPage();
  try {
    for (const route of queue) {
      try {
        await navigate(page, `${origin}${route}`, config.routes);
      } catch {
        continue;
      }
      const hrefs = await page.$$eval('a[href]', (links) =>
        links.map((link) => (link as HTMLAnchorElement).href),
      );
      for (const href of hrefs) {
        const next = routeOf(href, origin);
        if (!next || found.has(next) || !keep(next)) continue;
        if (added >= config.routes.limit) return [...found];
        found.add(next);
        queue.push(next);
        added += 1;
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  return [...found];
};

// Routes with no file in dist; routes that resolve to a file are already built pages.
export const resolveRoutes = async (
  config: VidimusConfig,
  dist: string,
  pages: PageReader,
  origin: string,
  browser: () => Promise<Browser>,
) => {
  const { paths, discover } = config.routes;
  const keep = (route: string) => !matchesAny(config.exclude, route.slice(1));
  let routes = [...paths, ...(discover === 'sitemap' ? fromSitemap(config, dist) : [])];
  if (discover === 'crawl') {
    const seeds = [...pages(config.exclude).map(({ path }) => path), ...routes];
    const shared = await browser();
    try {
      routes = await crawl(shared, origin, seeds, config, keep);
    } finally {
      await shared.close();
    }
  }
  const fileless = [...new Set(routes)].filter((route) => keep(route) && !localFile(dist, route));
  if (fileless.length && !config.origin && !config.server.fallback) {
    throw new UsageError(
      `routes ${firstFew(fileless)} have no file in ${config.distDir}; set server.fallback ` +
        `(e.g. 'index.html') so the built-in server answers them, or drop them from routes`,
    );
  }
  return fileless;
};

export const clientRenderedHint = (config: VidimusConfig, dist: string, pages: PageReader) => {
  const { paths, discover } = config.routes;
  if (paths.length || discover !== 'off') return undefined;
  const html = pages(config.exclude).filter(({ rel }) => rel !== '404.html');
  if (html.length !== 1) return undefined;
  const largest = Math.max(
    0,
    ...globSync('**/*.js', { cwd: dist }).map((rel) => statSync(join(dist, rel)).size),
  );
  if (largest < SPA_BUNDLE_BYTES) return undefined;
  return (
    `${config.distDir} has one HTML page and a ${Math.round(largest / 1000)} kB script: ` +
    'looks like a client-rendered app; set routes.paths or routes.discover to audit its routes'
  );
};
