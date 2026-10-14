import { type BuiltPage, localFile } from '../core/html.ts';
import { pathnameOf, readSitemaps } from '../core/sitemap.ts';
import type { Finding } from '../core/types.ts';
import { stripBase } from '../core/util.ts';
import type { Robots } from './seo-robots.ts';

const MAX_URLS = 50_000;
const MAX_BYTES = 52_428_800;

export interface SitemapContext {
  dist: string;
  siteUrl: string;
  siteOrigin: string;
  robots: Robots | undefined;
  robotsFile: string;
  byFile: Map<string, BuiltPage>;
  canonicalized: Set<BuiltPage>;
  noindex: Set<BuiltPage>;
  indexable: BuiltPage[];
}

const parseUrl = (loc: string) => (URL.canParse(loc) ? new URL(loc) : null);

export const sitemapFindings = (ctx: SitemapContext): Finding[] => {
  const {
    dist,
    siteUrl,
    siteOrigin,
    robots,
    robotsFile,
    byFile,
    canonicalized,
    noindex,
    indexable,
  } = ctx;
  const sameOrigin = (url: URL) => !siteOrigin || url.origin === siteOrigin;
  const builtFile = (url: URL) => localFile(dist, stripBase(url.pathname, siteUrl));
  const fromRobots = (robots?.sitemaps ?? [])
    .map((url) => pathnameOf(url, siteUrl))
    .filter((path): path is string => path !== null);
  const sitemaps = readSitemaps(dist, siteUrl, fromRobots);
  const listed = new Set<string>();
  const found: Finding[] = [];

  const checkTarget = (loc: string, from: string) => {
    const url = parseUrl(loc);
    if (!url || !sameOrigin(url)) {
      if (url) {
        found.push({
          message: `sitemap target outside ${siteOrigin}`,
          where: [loc],
          file: from,
          fix: `Point the reference at ${siteOrigin}, or fix siteUrl if the origin is wrong.`,
        });
      }
      return;
    }
    if (builtFile(url)) return;
    found.push({
      message: 'sitemap target is missing from the build',
      where: [loc],
      file: from,
      fix: 'Generate the referenced sitemap in the build output, or remove the reference.',
    });
  };

  for (const loc of robots?.sitemaps ?? []) checkTarget(loc, robotsFile);
  for (const { file, urls, children, bytes } of sitemaps) {
    if (urls.length > MAX_URLS || bytes > MAX_BYTES) {
      found.push({
        message: 'sitemap exceeds the protocol limits (50,000 URLs, 50 MB uncompressed)',
        details: [`${urls.length} URLs, ${bytes} bytes`],
        file,
        fix: 'Split the sitemap into several files and reference them from a sitemap index.',
      });
    }
    for (const loc of children) checkTarget(loc, file);
    for (const loc of urls) {
      const url = parseUrl(loc);
      if (!url) {
        found.push({
          message: 'sitemap URL is not absolute',
          where: [loc],
          file,
          fix: 'Make every sitemap <loc> an absolute URL, e.g. by setting the site URL in the sitemap generator.',
        });
        continue;
      }
      if (!sameOrigin(url)) {
        found.push({
          message: `sitemap URL outside ${siteOrigin}`,
          where: [loc],
          file,
          fix: `Configure the sitemap generator to emit ${siteOrigin} URLs, or fix siteUrl if the origin is wrong.`,
        });
        continue;
      }
      const built = builtFile(url);
      if (!built) {
        found.push({
          message: 'sitemap lists a URL that is not a built page',
          where: [url.pathname],
          file,
          fix: 'Remove stale URLs from the sitemap, or regenerate it from the current build.',
        });
        continue;
      }
      listed.add(built);
      const page = byFile.get(built);
      if (page && canonicalized.has(page)) {
        found.push({
          message: 'non-canonical page in the sitemap',
          severity: 'warn',
          where: [page.path],
          file,
          fix: 'List only canonical URLs in the sitemap: remove pages whose canonical link points at another page.',
        });
      }
      if (page && noindex.has(page)) {
        found.push({
          message: 'noindex page in the sitemap',
          where: [page.path],
          file,
          fix: "Remove noindex pages from the sitemap generator's output, or drop the noindex if the page should be indexed.",
        });
      }
    }
  }

  if (!sitemaps.length) {
    found.push({
      message: 'no sitemap.xml',
      severity: 'warn',
      fix: 'Generate a sitemap.xml in the build output and reference it from robots.txt, or turn seo.sitemap off.',
    });
    return found;
  }
  for (const { path, file } of indexable) {
    if (listed.has(file)) continue;
    found.push({
      message: 'indexable page missing from the sitemap',
      severity: 'warn',
      where: [path],
      fix: 'Include the page in the sitemap, add a robots noindex meta tag if it should not be indexed, or add it to seo.exclude.',
    });
  }
  return found;
};
