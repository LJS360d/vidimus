import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BuiltPage,
  isNoindex,
  linksWithRel,
  localFile,
  meta,
  originOf,
  resolveHref,
  tags,
  textOf,
} from '../core/html.ts';
import { pathnameOf, readSitemaps } from '../core/sitemap.ts';
import type { Audit, Finding, Severity } from '../core/types.ts';
import { basePathOf, inParallel, matchesAny, stripBase } from '../core/util.ts';
import { fetchHeaders, type HeaderMap, headersFor, loadHeaderRules } from './security.ts';

const isRedirect = (html: string) =>
  tags(html, 'meta').some(
    ({ attrs }) =>
      (attrs['http-equiv'] ?? '').toLowerCase() === 'refresh' &&
      (/^\s*\d+(\.\d+)?\s*[;,]\s*\S/.test(attrs.content ?? '') ||
        /(^|[;,\s])url\s*=/i.test(attrs.content ?? '')),
  );

const FULL_BLOCKS = new Set(['/', '/*', '/*$']);

const robotsRules = (text: string) => {
  const sitemaps: string[] = [];
  const blocked = new Set<string>();
  const groups = new Map<string, { allow: boolean; path: string }[]>();
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
      if (key === 'disallow' && FULL_BLOCKS.has(value))
        for (const agent of agents) blocked.add(agent);
      if ((key === 'allow' || key === 'disallow') && value)
        for (const agent of agents) {
          const name = agent.toLowerCase();
          groups.set(name, [...(groups.get(name) ?? []), { allow: key === 'allow', path: value }]);
        }
    }
  }
  return { sitemaps, blocked: [...blocked], groups };
};

const isDisallowed = (groups: Map<string, { allow: boolean; path: string }[]>, path: string) => {
  let best: { allow: boolean; length: number } | undefined;
  for (const rule of groups.get('*') ?? groups.get('googlebot') ?? []) {
    const source = rule.path
      .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\$$/, '$$');
    if (!new RegExp(`^${source}`).test(path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow))
      best = { allow: rule.allow, length };
  }
  return best !== undefined && !best.allow;
};

const LANG_CODE = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/;

const outside = (length: number, { min, max }: { min: number; max: number }) =>
  length < min || length > max;

export const seo: Audit = {
  name: 'seo',
  description:
    'titles, descriptions, canonical, hreflang, noindex, sitemap, robots.txt and orphan pages',
  requires: 'dist',
  async run({ config, renderedPages, dist, log }) {
    const options = config.seo;
    const base = basePathOf(config.siteUrl);
    const siteOrigin = originOf(config.siteUrl);
    const built = await renderedPages(config.exclude);
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
    const loaded = loadHeaderRules(config.root, dist, config.security.file);
    const origin = config.origin.replace(/\/$/, '');
    const headers = new Map<string, HeaderMap>();
    if (origin)
      await inParallel(8, pages, async (page) => {
        try {
          headers.set(page.path, await fetchHeaders(origin + page.path));
        } catch {}
      });
    else for (const page of pages) headers.set(page.path, headersFor(loaded.rules, page.path));
    const redirects = new Set<BuiltPage>();
    const canonicalized = new Set<BuiltPage>();
    const pointers: { page: BuiltPage; kind: string; file: string; href: string }[] = [];
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
      const htmlLang = tags(html, 'html')[0]?.attrs.lang?.trim();
      if (!htmlLang)
        report(
          'missing <html lang>',
          'Add a lang attribute to <html>, e.g. <html lang="en">.',
          path,
        );
      else if (!LANG_CODE.test(htmlLang.toLowerCase()))
        report(
          `invalid <html lang> "${htmlLang}"`,
          'Use a language code such as "en" or "pt-BR" (ISO 639-1, optional region).',
          path,
        );

      const title = textOf(html, 'title', 'head') ?? '';
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

      const headerNoindex = /noindex/i.test(headers.get(path)?.['x-robots-tag'] ?? '');
      if (headerNoindex || isNoindex(html)) {
        noindex.add(page);
        if (!matchesAny(options.allowNoindex, path))
          report(
            'noindex in the production build',
            headerNoindex
              ? 'Remove the X-Robots-Tag noindex header, or add the path to seo.allowNoindex if it is intentional.'
              : 'Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.',
            path,
          );
        continue;
      }

      for (const script of tags(html, 'script')) {
        if ((script.attrs.type ?? '').trim().toLowerCase() !== 'application/ld+json') continue;
        const start = html.indexOf('>', script.index) + 1;
        const end = html.indexOf('</script', start);
        try {
          JSON.parse(html.slice(start, end < 0 ? html.length : end));
        } catch (error) {
          report(
            `invalid JSON-LD: ${(error as Error).message}`,
            'Fix the JSON-LD block so it parses: remove trailing commas, escape control characters and drop HTML comments.',
            path,
          );
        }
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
      if (canonicalFile && canonicalFile !== page.file) {
        canonicalized.add(page);
        pointers.push({
          page,
          kind: 'canonical',
          file: canonicalFile,
          href: canonicals[0]?.attrs.href ?? '',
        });
      } else {
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
        if (lang !== 'x-default' && !LANG_CODE.test(lang))
          report(
            `invalid hreflang code "${lang}"`,
            'Use a language code such as "en" or "pt-BR" (ISO 639-1, optional region), or "x-default".',
            path,
          );
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
        else {
          targets.add(file);
          if (file !== page.file) pointers.push({ page, kind: 'hreflang', file, href });
        }
      }
      alternates.set(page.file, targets);
      if (seen.size && !targets.has(page.file))
        report(
          'hreflang missing self-reference',
          'Add a <link rel="alternate" hreflang> pointing at the page itself to its own hreflang set.',
          path,
        );
      if (seen.size && !seen.has('x-default'))
        report(
          'hreflang set has no x-default',
          'Add <link rel="alternate" hreflang="x-default" href="…"> pointing at the fallback page.',
          path,
          'warn',
        );

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

    for (const { page, kind, file, href } of pointers) {
      const target = byFile.get(file);
      if (!target) continue;
      const bad = redirects.has(target)
        ? 'a redirect'
        : noindex.has(target)
          ? 'a noindex page'
          : kind === 'canonical' && canonicalized.has(target)
            ? 'a page with a different canonical'
            : null;
      if (bad)
        report(
          `${kind} points to ${bad}`,
          kind === 'canonical'
            ? 'Point the canonical at the final, indexable, self-canonical page.'
            : 'Point the hreflang href at the final, indexable page, or remove the alternate link.',
          page.path,
          undefined,
          `${page.path}: ${href}`,
        );
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
    const robots =
      !base && existsSync(robotsFile) ? robotsRules(readFileSync(robotsFile, 'utf8')) : undefined;
    if (options.robots && base)
      log(
        `robots.txt check skipped: the site is served under ${base}/, robots.txt belongs at the origin root`,
      );

    if (options.robots && !base) {
      if (!robots)
        report(
          'no robots.txt',
          'Add a robots.txt to the build output with a User-agent and Sitemap line, or turn seo.robots off.',
          null,
          'warn',
        );
      else {
        for (const agent of robots.blocked) {
          report(
            `robots.txt disallows everything for User-agent: ${agent}`,
            `Remove the full "Disallow" rule (/ or /*) from the User-agent: ${agent} group in robots.txt so crawlers can index the site.`,
            null,
            agent === '*' ? undefined : 'warn',
            undefined,
            robotsFile,
          );
        }
        for (const page of indexable)
          if (isDisallowed(robots.groups, page.path))
            report(
              'indexable page disallowed by robots.txt',
              'Remove the matching Disallow rule from robots.txt, or add robots noindex and drop the page from the sitemap if it should stay out of search.',
              page.path,
              'warn',
              undefined,
              robotsFile,
            );
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
      const sitemaps = readSitemaps(dist, config.siteUrl, fromRobots);
      const listed = new Set<string>();
      const checkTarget = (loc: string, from: string) => {
        let url: URL;
        try {
          url = new URL(loc);
        } catch {
          return;
        }
        const missing =
          sameOrigin(url) && !localFile(dist, stripBase(url.pathname, config.siteUrl));
        if (sameOrigin(url) && !missing) return;
        report(
          missing
            ? 'sitemap target is missing from the build'
            : `sitemap target outside ${siteOrigin}`,
          missing
            ? 'Generate the referenced sitemap in the build output, or remove the reference.'
            : `Point the reference at ${siteOrigin}, or fix siteUrl if the origin is wrong.`,
          loc,
          undefined,
          undefined,
          from,
        );
      };
      for (const loc of robots?.sitemaps ?? []) checkTarget(loc, robotsFile);
      for (const { file: sitemapFile, urls, children, bytes } of sitemaps) {
        if (urls.length > 50_000 || bytes > 52_428_800) {
          report(
            'sitemap exceeds the protocol limits (50,000 URLs, 50 MB uncompressed)',
            'Split the sitemap into several files and reference them from a sitemap index.',
            null,
            undefined,
            `${urls.length} URLs, ${bytes} bytes`,
            sitemapFile,
          );
        }
        for (const loc of children) checkTarget(loc, sitemapFile);
        for (const loc of urls) {
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
      if (!sitemaps.length)
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
