import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BuiltPage,
  decodeEntities,
  isNoindex,
  linksWithRel,
  localFile,
  meta,
  originOf,
  resolveHref,
  tags,
  textOf,
} from '../core/html.ts';
import type { Audit, Finding, Severity } from '../core/types.ts';
import { matchesAny, stripBase } from '../core/util.ts';

const SITEMAPS = ['sitemap.xml', 'sitemap-index.xml', 'sitemap_index.xml'];

const pathnameOf = (url: string, siteUrl: string) => {
  try {
    return stripBase(new URL(url).pathname, siteUrl);
  } catch {
    return null;
  }
};

const isRedirect = (html: string) =>
  tags(html, 'meta').some(
    ({ attrs }) =>
      (attrs['http-equiv'] ?? '').toLowerCase() === 'refresh' &&
      /(^|[;,\s])url\s*=/i.test(attrs.content ?? ''),
  );

const locs = (xml: string, parent: string) =>
  [...xml.matchAll(new RegExp(`<${parent}\\b[^>]*>([\\s\\S]*?)</${parent}\\s*>`, 'gi'))]
    .map(([, body = '']) => /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(body)?.[1])
    .filter((loc): loc is string => loc !== undefined)
    .map((loc) => decodeEntities(loc.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim()));

const robotsRules = (text: string) => {
  const sitemaps: string[] = [];
  let blocksAll = false;
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
    } else {
      inRules = true;
      if (key === 'disallow' && value === '/' && agents.includes('*')) blocksAll = true;
    }
  }
  return { sitemaps, blocksAll };
};

const outside = (length: number, { min, max }: { min: number; max: number }) =>
  length < min || length > max;

export const seo: Audit = {
  name: 'seo',
  description:
    'titles, descriptions, canonical, hreflang, noindex, sitemap, robots.txt and orphan pages',
  requires: 'dist',
  async run({ config, builtPages, dist }) {
    const options = config.seo;
    const siteOrigin = originOf(config.siteUrl);
    const built = builtPages(config.exclude);
    const pages = built.filter((page) => !matchesAny(options.exclude, page.path));
    if (!pages.length) return { status: 'skipped', summary: 'no pages to check' };

    const grouped = new Map<string, Finding>();
    const report = (
      message: string,
      fix: string,
      where: string | null,
      severity?: Severity,
      detail?: string,
      file?: string,
    ) => {
      const key = `${severity ?? 'error'}\0${message}`;
      const finding = grouped.get(key) ?? { message, fix, where: [], details: [] };
      if (severity) finding.severity = severity;
      if (file) finding.file = file;
      if (where && !finding.where?.includes(where)) finding.where?.push(where);
      if (detail) finding.details?.push(detail);
      grouped.set(key, finding);
    };

    const byFile = new Map(pages.map((page) => [page.file, page]));
    const byPath = new Map(pages.map((page) => [page.path, page.file]));
    const noindex = new Set<BuiltPage>();
    const redirects = new Set<BuiltPage>();
    const canonicalized = new Set<BuiltPage>();
    const alternates = new Map<string, Set<string>>();
    const titles = new Map<string, string[]>();
    const descriptions = new Map<string, string[]>();
    const sameOrigin = (url: URL) => !siteOrigin || url.origin === siteOrigin;

    for (const page of pages) {
      const { html, path } = page;
      if (isRedirect(html)) {
        redirects.add(page);
        continue;
      }
      if (!tags(html, 'html')[0]?.attrs.lang?.trim())
        report(
          'missing <html lang>',
          'Add a lang attribute to <html>, e.g. <html lang="en">.',
          path,
        );

      const title = textOf(html, 'title') ?? '';
      if (!title)
        report('missing <title>', 'Add a unique, descriptive <title> element inside <head>.', path);
      else if (outside(title.length, options.titleLength)) {
        const { min, max } = options.titleLength;
        report(
          `title outside ${min}-${max} characters`,
          `Rewrite the <title> to ${min}-${max} characters, or adjust seo.titleLength.`,
          path,
          'warn',
          `${path}: ${title.length}`,
        );
      }

      const description = (meta(html, 'description') ?? '').trim();
      if (!description)
        report(
          'missing meta description',
          'Add <meta name="description" content="…"> to <head> summarising the page.',
          path,
        );
      else if (outside(description.length, options.descriptionLength)) {
        const { min, max } = options.descriptionLength;
        const detail = `${path}: ${description.length}`;
        report(
          `meta description outside ${min}-${max} characters`,
          `Rewrite the meta description content to ${min}-${max} characters, or adjust seo.descriptionLength.`,
          path,
          'warn',
          detail,
        );
      }

      if (isNoindex(html)) {
        noindex.add(page);
        if (!matchesAny(options.allowNoindex, path))
          report(
            'noindex in the production build',
            'Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.',
            path,
          );
        continue;
      }

      const canonicals = linksWithRel(html, 'canonical');
      const canonicalTarget =
        canonicals.length === 1
          ? resolveHref(canonicals[0]?.attrs.href ?? '', path, config.siteUrl)
          : null;
      const canonicalFile =
        canonicalTarget?.absolute && canonicalTarget.url.origin === siteOrigin
          ? localFile(dist, stripBase(canonicalTarget.url.pathname, config.siteUrl))
          : null;
      if (canonicalFile && canonicalFile !== page.file) canonicalized.add(page);
      else {
        if (title) titles.set(title, [...(titles.get(title) ?? []), path]);
        if (description)
          descriptions.set(description, [...(descriptions.get(description) ?? []), path]);
      }

      if (options.canonical) {
        if (!canonicals.length)
          report(
            'no canonical link',
            'Add <link rel="canonical" href="…"> with the absolute URL of the page to <head>.',
            path,
            'warn',
          );
        if (canonicals.length > 1)
          report(
            'more than one canonical link',
            'Keep a single <link rel="canonical"> in <head> and remove the others.',
            path,
          );
        const href = canonicals[0]?.attrs.href ?? '';
        const target = canonicalTarget;
        if (canonicals.length === 1 && !target?.absolute) {
          report(
            'canonical URL is not absolute',
            'Use an absolute URL in the canonical href, e.g. https://example.com/page/, built from siteUrl.',
            path,
            undefined,
            `${path}: ${href}`,
          );
        } else if (target && siteOrigin && target.url.origin !== siteOrigin) {
          report(
            `canonical points outside ${siteOrigin}`,
            `Point the canonical href at ${siteOrigin}, or fix siteUrl if the site's origin is wrong.`,
            path,
            undefined,
            `${path}: ${href}`,
          );
        } else if (target && siteOrigin && !canonicalFile) {
          report(
            'canonical is not a built page',
            'Point the canonical href at a page that exists in the build, usually the page itself.',
            path,
            undefined,
            `${path}: ${href}`,
          );
        }
      }

      const seen = new Set<string>();
      const targets = new Set<string>();
      for (const link of linksWithRel(html, 'alternate')) {
        const lang = link.attrs.hreflang?.trim().toLowerCase();
        if (!lang) continue;
        if (seen.has(lang))
          report(
            `duplicate hreflang "${lang}"`,
            `Keep one <link rel="alternate" hreflang="${lang}"> per page and remove the duplicates.`,
            path,
          );
        seen.add(lang);
        const href = link.attrs.href ?? '';
        const target = resolveHref(href, path, config.siteUrl);
        if (!target?.absolute) {
          report(
            'hreflang URL is not absolute',
            'Use an absolute URL in every <link rel="alternate" hreflang> href, e.g. https://example.com/it/.',
            path,
            undefined,
            `${path}: ${href}`,
          );
          continue;
        }
        if (!target.internal || !target.path) continue;
        const file = localFile(dist, target.path);
        if (!file)
          report(
            'hreflang target is not a built page',
            'Point the hreflang href at a page that exists in the build, or remove the alternate link.',
            path,
            undefined,
            `${path}: ${href}`,
          );
        else targets.add(file);
      }
      alternates.set(page.file, targets);

      if (options.h1) {
        const h1s = tags(html, 'h1').length;
        if (!h1s)
          report(
            'no <h1>',
            'Add one <h1> heading describing the page, or turn seo.h1 off.',
            path,
            'warn',
          );
        if (h1s > 1)
          report(
            'more than one <h1>',
            'Keep a single <h1> per page and demote the others to <h2> or lower.',
            path,
            'warn',
          );
      }
    }

    for (const [file, targets] of alternates) {
      const from = byFile.get(file);
      for (const target of targets) {
        const back = alternates.get(target);
        const to = byFile.get(target);
        if (!from || !to || target === file || !back || back.has(file)) continue;
        report(
          'hreflang not reciprocated',
          'Add a matching <link rel="alternate" hreflang> back to the linking page on each target page.',
          from.path,
          undefined,
          `${from.path} → ${to.path}`,
        );
      }
    }

    const areAlternates = (paths: string[]) => {
      const [first, ...rest] = paths.map((path) => byPath.get(path) ?? '');
      const linked = alternates.get(first ?? '');
      return !!linked && rest.every((file) => linked.has(file));
    };

    for (const [label, values] of [
      ['title', titles],
      ['meta description', descriptions],
    ] as const) {
      for (const [value, where] of values) {
        if (where.length < 2 || areAlternates(where)) continue;
        grouped.set(`dup\0${label}\0${value}`, {
          message: `duplicate ${label} "${value}"`,
          where,
          severity: 'warn',
          fix: `Give each page a unique ${label}, or link translations with reciprocal hreflang alternates.`,
        });
      }
    }

    const indexable = pages.filter(
      (page) => !noindex.has(page) && !redirects.has(page) && !canonicalized.has(page),
    );
    const robotsFile = join(dist, 'robots.txt');
    const robots = existsSync(robotsFile)
      ? robotsRules(readFileSync(robotsFile, 'utf8'))
      : undefined;

    if (options.robots) {
      if (!robots)
        report(
          'no robots.txt',
          'Add a robots.txt to the build output with a User-agent and Sitemap line, or turn seo.robots off.',
          null,
          'warn',
        );
      else {
        if (robots.blocksAll) {
          report(
            'robots.txt disallows everything for User-agent: *',
            'Remove "Disallow: /" from the User-agent: * group in robots.txt so crawlers can index the site.',
            null,
            undefined,
            undefined,
            robotsFile,
          );
        }
        if (!robots.sitemaps.length)
          report(
            'robots.txt has no Sitemap line',
            'Add a line like "Sitemap: https://example.com/sitemap.xml" to robots.txt.',
            null,
            'warn',
            undefined,
            robotsFile,
          );
      }
    }

    if (options.sitemap) {
      const fromRobots = (robots?.sitemaps ?? [])
        .map((url) => pathnameOf(url, config.siteUrl))
        .filter((path): path is string => path !== null);
      const roots = [...SITEMAPS.map((name) => `/${name}`), ...fromRobots]
        .map((path) => localFile(dist, path))
        .filter((file): file is string => file !== null);
      const visited = new Set<string>();
      const listed = new Set<string>();
      const queue = [...new Set(roots)];
      for (const sitemapFile of queue) {
        if (visited.has(sitemapFile)) continue;
        visited.add(sitemapFile);
        const xml = readFileSync(sitemapFile, 'utf8');
        for (const loc of locs(xml, 'sitemap')) {
          const path = pathnameOf(loc, config.siteUrl);
          const child = path ? localFile(dist, path) : null;
          if (child) queue.push(child);
        }
        for (const loc of locs(xml, 'url')) {
          let url: URL;
          try {
            url = new URL(loc);
          } catch {
            report(
              'sitemap URL is not absolute',
              'Make every sitemap <loc> an absolute URL, e.g. by setting the site URL in the sitemap generator.',
              loc,
              undefined,
              undefined,
              sitemapFile,
            );
            continue;
          }
          if (!sameOrigin(url)) {
            report(
              `sitemap URL outside ${siteOrigin}`,
              `Configure the sitemap generator to emit ${siteOrigin} URLs, or fix siteUrl if the origin is wrong.`,
              loc,
              undefined,
              undefined,
              sitemapFile,
            );
            continue;
          }
          const file = localFile(dist, stripBase(url.pathname, config.siteUrl));
          if (!file) {
            report(
              'sitemap lists a URL that is not a built page',
              'Remove stale URLs from the sitemap, or regenerate it from the current build.',
              url.pathname,
              undefined,
              undefined,
              sitemapFile,
            );
            continue;
          }
          listed.add(file);
          const page = byFile.get(file);
          if (page && canonicalized.has(page)) {
            report(
              'non-canonical page in the sitemap',
              'List only canonical URLs in the sitemap: remove pages whose canonical link points at another page.',
              page.path,
              'warn',
              undefined,
              sitemapFile,
            );
          }
          if (page && noindex.has(page)) {
            report(
              'noindex page in the sitemap',
              "Remove noindex pages from the sitemap generator's output, or drop the noindex if the page should be indexed.",
              page.path,
              undefined,
              undefined,
              sitemapFile,
            );
          }
        }
      }
      if (!visited.size)
        report(
          'no sitemap.xml',
          'Generate a sitemap.xml in the build output and reference it from robots.txt, or turn seo.sitemap off.',
          null,
          'warn',
        );
      else {
        for (const page of indexable) {
          if (!listed.has(page.file))
            report(
              'indexable page missing from the sitemap',
              'Include the page in the sitemap, add a robots noindex meta tag if it should not be indexed, or add it to seo.exclude.',
              page.path,
              'warn',
            );
        }
      }
    }

    if (options.orphans) {
      const linked = new Set<string>();
      for (const page of built) {
        for (const { attrs } of tags(page.html, 'a')) {
          const target = attrs.href ? resolveHref(attrs.href, page.path, config.siteUrl) : null;
          const file = target?.path ? localFile(dist, target.path) : null;
          if (file && file !== page.file) linked.add(file);
        }
      }
      for (const page of indexable) {
        if (page.path !== '/' && !linked.has(page.file)) {
          report(
            'orphan page: no other page links to it',
            'Link to the page from navigation or another page, add it to seo.exclude if it is intentionally unlinked, or turn seo.orphans off.',
            page.path,
            'warn',
          );
        }
      }
    }

    const findings = [...grouped.values()].map(({ where, details, ...rest }) => ({
      ...rest,
      ...(where?.length ? { where: where.sort() } : {}),
      ...(details?.length ? { details } : {}),
    }));

    return {
      summary: `${pages.length} pages, ${findings.length ? `${findings.length} problem(s)` : 'no problems'}`,
      findings,
    };
  },
};
