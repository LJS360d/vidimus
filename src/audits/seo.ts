import { join } from 'node:path';
import {
  type BuiltPage,
  isNoindex,
  localFile,
  meta,
  originOf,
  resolveHref,
  tags,
  textOf,
} from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { basePathOf, matchesAny } from '../core/util.ts';
import {
  canonicalFindings,
  canonicalOf,
  h1Findings,
  hreflangOf,
  isRedirect,
  jsonLdFindings,
  langFindings,
  lengthFindings,
  type Pointer,
  type SiteInfo,
} from './seo-page.ts';
import { readRobots, robotsDirectives, robotsFindings } from './seo-robots.ts';
import { sitemapFindings } from './seo-sitemap.ts';
import { fetchHeaders, groupFindings, push } from './util.ts';

const NOINDEX_DIRECTIVES = new Set(['noindex', 'none']);

const pointerTarget = (
  target: BuiltPage,
  kind: Pointer['kind'],
  redirects: Set<BuiltPage>,
  noindex: Set<BuiltPage>,
  canonicalized: Set<BuiltPage>,
) => {
  if (redirects.has(target)) return 'a redirect';
  if (noindex.has(target)) return 'a noindex page';
  if (kind === 'canonical' && canonicalized.has(target)) return 'a page with a different canonical';
  return null;
};

const pointerFix = (kind: Pointer['kind']) =>
  kind === 'canonical'
    ? 'Point the canonical at the final, indexable, self-canonical page.'
    : 'Point the hreflang href at the final, indexable page, or remove the alternate link.';

export const seo: Audit = {
  name: 'seo',
  description:
    'titles, descriptions, canonical, hreflang, noindex, sitemap, robots.txt and orphan pages',
  requires: 'dist',
  async run({ config, renderedPages, dist, log, headersFor }) {
    const options = config.seo;
    const base = basePathOf(config.siteUrl);
    const site: SiteInfo = { dist, siteUrl: config.siteUrl, siteOrigin: originOf(config.siteUrl) };
    const built = await renderedPages(config.exclude);
    const pages = built.filter((page) => !matchesAny(options.exclude, page.path));
    if (!pages.length) return { status: 'skipped', summary: 'no pages to check' };

    const grouped = groupFindings();
    const emit = ({ where, ...finding }: Finding) => {
      const key = `${finding.severity ?? 'error'}\0${finding.message}`;
      const opts = { key, appendDetails: true };
      if (!where?.length) grouped.add(finding, null, opts);
      for (const path of where ?? []) grouped.add(finding, path, opts);
    };
    const emitAll = (findings: Finding[]) => findings.forEach(emit);

    const byFile = new Map(pages.map((page) => [page.file, page]));
    const byPath = new Map(pages.map((page) => [page.path, page.file]));
    const headers = await fetchHeaders(pages, headersFor);
    const noindex = new Set<BuiltPage>();
    const redirects = new Set<BuiltPage>();
    const canonicalized = new Set<BuiltPage>();
    const pointers: Pointer[] = [];
    const alternates = new Map<string, Set<string>>();
    const titles = new Map<string, string[]>();
    const descriptions = new Map<string, string[]>();
    const anchors = new Map<BuiltPage, ReturnType<typeof tags>>();

    for (const page of pages) {
      const { html, path } = page;
      if (options.orphans) anchors.set(page, tags(html, 'a'));
      if (isRedirect(html)) {
        redirects.add(page);
        continue;
      }
      const title = textOf(html, 'title', 'head') ?? '';
      const description = (meta(html, 'description') ?? '').trim();
      emitAll([
        ...langFindings(html, path),
        ...lengthFindings(path, 'title', title, options.titleLength, 'titleLength'),
        ...lengthFindings(
          path,
          'meta description',
          description,
          options.descriptionLength,
          'descriptionLength',
        ),
      ]);

      const headerNoindex = robotsDirectives(headers.get(path)?.['x-robots-tag'] ?? '').some(
        (directive) => NOINDEX_DIRECTIVES.has(directive),
      );
      if (headerNoindex || isNoindex(html)) {
        noindex.add(page);
        if (!matchesAny(options.allowNoindex, path)) {
          emit({
            message: 'noindex in the production build',
            where: [path],
            fix: headerNoindex
              ? 'Remove the X-Robots-Tag noindex header, or add the path to seo.allowNoindex if it is intentional.'
              : 'Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.',
          });
        }
        continue;
      }

      emitAll(jsonLdFindings(html, path));

      const canonical = canonicalOf(page, site);
      if (canonical.file && canonical.file !== page.file) {
        canonicalized.add(page);
        pointers.push({ page, kind: 'canonical', file: canonical.file, href: canonical.href });
      } else {
        if (title) push(titles, title, path);
        if (description) push(descriptions, description, path);
      }
      if (options.canonical) emitAll(canonicalFindings(path, site, canonical));

      const hreflang = hreflangOf(page, site);
      emitAll(hreflang.findings);
      pointers.push(...hreflang.pointers);
      alternates.set(page.file, hreflang.targets);

      if (options.h1) emitAll(h1Findings(html, path));
    }

    for (const { page, kind, file, href } of pointers) {
      const target = byFile.get(file);
      const bad = target && pointerTarget(target, kind, redirects, noindex, canonicalized);
      if (!bad) continue;
      emit({
        message: `${kind} points to ${bad}`,
        where: [page.path],
        details: [`${page.path}: ${href}`],
        fix: pointerFix(kind),
      });
    }

    for (const [file, targets] of alternates) {
      const from = byFile.get(file);
      for (const target of targets) {
        const back = alternates.get(target);
        const to = byFile.get(target);
        if (!from || !to || target === file || !back || back.has(file)) continue;
        emit({
          message: 'hreflang not reciprocated',
          where: [from.path],
          details: [`${from.path} → ${to.path}`],
          fix: 'Add a matching <link rel="alternate" hreflang> back to the linking page on each target page.',
        });
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
        emit({
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
    const robots = base ? undefined : readRobots(robotsFile);
    if (options.robots) {
      if (base) {
        log(
          `robots.txt check skipped: the site is served under ${base}/, robots.txt belongs at the origin root`,
        );
      } else emitAll(robotsFindings(robots, indexable, robotsFile));
    }

    if (options.sitemap) {
      emitAll(
        sitemapFindings({
          ...site,
          robots,
          robotsFile,
          byFile,
          canonicalized,
          noindex,
          indexable,
        }),
      );
    }

    if (options.orphans) {
      const linked = new Set<string>();
      for (const page of built) {
        for (const { attrs } of anchors.get(page) ?? tags(page.html, 'a')) {
          const target = attrs.href ? resolveHref(attrs.href, page.path, config.siteUrl) : null;
          const file = target?.path ? localFile(dist, target.path) : null;
          if (file && file !== page.file) linked.add(file);
        }
      }
      for (const page of indexable) {
        if (page.path === '/' || linked.has(page.file)) continue;
        emit({
          message: 'orphan page: no other page links to it',
          where: [page.path],
          severity: 'warn',
          fix: 'Link to the page from navigation or another page, add it to seo.exclude if it is intentionally unlinked, or turn seo.orphans off.',
        });
      }
    }

    const findings = grouped.values().map((finding) => ({
      ...finding,
      ...(finding.where && { where: finding.where.sort() }),
    }));
    return {
      summary: `${pages.length} pages, ${findings.length ? `${findings.length} problem(s)` : 'no problems'}`,
      findings,
    };
  },
};
