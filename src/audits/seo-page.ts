import type { VidimusConfig } from '../config/types.ts';
import { type BuiltPage, linksWithRel, localFile, resolveHref, tags } from '../core/html.ts';
import type { Finding } from '../core/types.ts';
import { stripBase } from '../core/util.ts';

type Options = VidimusConfig['seo'];

export interface SiteInfo {
  dist: string;
  siteUrl: string;
  siteOrigin: string;
}

export interface Pointer {
  page: BuiltPage;
  kind: 'canonical' | 'hreflang';
  file: string;
  href: string;
}

const LANG_CODE = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/;
const LANG_HINT = 'Use a language code such as "en" or "pt-BR" (ISO 639-1, optional region)';

const outside = (length: number, { min, max }: { min: number; max: number }) =>
  length < min || length > max;

const issue = (path: string, finding: Finding): Finding => ({ ...finding, where: [path] });

const warning = (path: string, finding: Finding): Finding => ({
  ...finding,
  severity: 'warn',
  where: [path],
});

export const isRedirect = (html: string) =>
  tags(html, 'meta').some(
    ({ attrs }) =>
      (attrs['http-equiv'] ?? '').toLowerCase() === 'refresh' &&
      (/^\s*\d+(\.\d+)?\s*[;,]\s*\S/.test(attrs.content ?? '') ||
        /(^|[;,\s])url\s*=/i.test(attrs.content ?? '')),
  );

export const langFindings = (html: string, path: string): Finding[] => {
  const lang = tags(html, 'html')[0]?.attrs.lang?.trim();
  if (!lang) {
    return [
      issue(path, {
        message: 'missing <html lang>',
        fix: 'Add a lang attribute to <html>, e.g. <html lang="en">.',
      }),
    ];
  }
  if (LANG_CODE.test(lang.toLowerCase())) return [];
  return [issue(path, { message: `invalid <html lang> "${lang}"`, fix: `${LANG_HINT}.` })];
};

export const lengthFindings = (
  path: string,
  label: 'title' | 'meta description',
  value: string,
  range: Options['titleLength'],
  setting: 'titleLength' | 'descriptionLength',
): Finding[] => {
  const { min, max } = range;
  if (!value) {
    return [
      issue(
        path,
        label === 'title'
          ? {
              message: 'missing <title>',
              fix: 'Add a unique, descriptive <title> element inside <head>.',
            }
          : {
              message: 'missing meta description',
              fix: 'Add <meta name="description" content="…"> to <head> summarising the page.',
            },
      ),
    ];
  }
  if (!outside(value.length, range)) return [];
  const target = label === 'title' ? '<title>' : 'meta description content';
  return [
    warning(path, {
      message: `${label} outside ${min}-${max} characters`,
      details: [`${path}: ${value.length}`],
      fix: `Rewrite the ${target} to ${min}-${max} characters, or adjust seo.${setting}.`,
    }),
  ];
};

export const jsonLdFindings = (html: string, path: string): Finding[] =>
  tags(html, 'script').flatMap((script): Finding[] => {
    if ((script.attrs.type ?? '').trim().toLowerCase() !== 'application/ld+json') return [];
    const start = html.indexOf('>', script.index) + 1;
    const end = html.indexOf('</script', start);
    try {
      JSON.parse(html.slice(start, end < 0 ? html.length : end));
      return [];
    } catch (error) {
      return [
        issue(path, {
          message: `invalid JSON-LD: ${(error as Error).message}`,
          fix: 'Fix the JSON-LD block so it parses: remove trailing commas, escape control characters and drop HTML comments.',
        }),
      ];
    }
  });

export const h1Findings = (html: string, path: string): Finding[] => {
  const count = tags(html, 'h1').length;
  if (!count) {
    return [
      warning(path, {
        message: 'no <h1>',
        fix: 'Add one <h1> heading describing the page, or turn seo.h1 off.',
      }),
    ];
  }
  if (count === 1) return [];
  return [
    warning(path, {
      message: 'more than one <h1>',
      fix: 'Keep a single <h1> per page and demote the others to <h2> or lower.',
    }),
  ];
};

export const canonicalOf = (page: BuiltPage, site: SiteInfo) => {
  const links = linksWithRel(page.html, 'canonical');
  const href = links[0]?.attrs.href ?? '';
  const target = links.length === 1 ? resolveHref(href, page.path, site.siteUrl) : null;
  const file =
    target?.absolute && target.url.origin === site.siteOrigin
      ? localFile(site.dist, stripBase(target.url.pathname, site.siteUrl))
      : null;
  return { count: links.length, href, target, file };
};

export const canonicalFindings = (
  path: string,
  site: SiteInfo,
  { count, href, target, file }: ReturnType<typeof canonicalOf>,
): Finding[] => {
  const detail = [`${path}: ${href}`];
  const { siteOrigin } = site;
  const found: Finding[] = [];
  if (!count) {
    found.push(
      warning(path, {
        message: 'no canonical link',
        fix: 'Add <link rel="canonical" href="…"> with the absolute URL of the page to <head>.',
      }),
    );
  }
  if (count > 1) {
    found.push(
      issue(path, {
        message: 'more than one canonical link',
        fix: 'Keep a single <link rel="canonical"> in <head> and remove the others.',
      }),
    );
  }
  if (count === 1 && !target?.absolute) {
    found.push(
      issue(path, {
        message: 'canonical URL is not absolute',
        details: detail,
        fix: 'Use an absolute URL in the canonical href, e.g. https://example.com/page/, built from siteUrl.',
      }),
    );
  } else if (target && siteOrigin && target.url.origin !== siteOrigin) {
    found.push(
      issue(path, {
        message: `canonical points outside ${siteOrigin}`,
        details: detail,
        fix: `Point the canonical href at ${siteOrigin}, or fix siteUrl if the site's origin is wrong.`,
      }),
    );
  } else if (target && siteOrigin && !file) {
    found.push(
      issue(path, {
        message: 'canonical is not a built page',
        details: detail,
        fix: 'Point the canonical href at a page that exists in the build, usually the page itself.',
      }),
    );
  }
  return found;
};

export const hreflangOf = (page: BuiltPage, site: SiteInfo) => {
  const { path } = page;
  const seen = new Set<string>();
  const targets = new Set<string>();
  const pointers: Pointer[] = [];
  const found: Finding[] = [];
  for (const link of linksWithRel(page.html, 'alternate')) {
    const lang = link.attrs.hreflang?.trim().toLowerCase();
    if (!lang) continue;
    if (seen.has(lang)) {
      found.push(
        issue(path, {
          message: `duplicate hreflang "${lang}"`,
          fix: `Keep one <link rel="alternate" hreflang="${lang}"> per page and remove the duplicates.`,
        }),
      );
    }
    seen.add(lang);
    if (lang !== 'x-default' && !LANG_CODE.test(lang)) {
      found.push(
        issue(path, {
          message: `invalid hreflang code "${lang}"`,
          fix: `${LANG_HINT}, or "x-default".`,
        }),
      );
    }
    const href = link.attrs.href ?? '';
    const target = resolveHref(href, path, site.siteUrl);
    if (!target?.absolute) {
      found.push(
        issue(path, {
          message: 'hreflang URL is not absolute',
          details: [`${path}: ${href}`],
          fix: 'Use an absolute URL in every <link rel="alternate" hreflang> href, e.g. https://example.com/it/.',
        }),
      );
      continue;
    }
    if (!target.internal || !target.path) continue;
    const file = localFile(site.dist, target.path);
    if (!file) {
      found.push(
        issue(path, {
          message: 'hreflang target is not a built page',
          details: [`${path}: ${href}`],
          fix: 'Point the hreflang href at a page that exists in the build, or remove the alternate link.',
        }),
      );
      continue;
    }
    targets.add(file);
    if (file !== page.file) pointers.push({ page, kind: 'hreflang', file, href });
  }
  if (seen.size && !targets.has(page.file)) {
    found.push(
      issue(path, {
        message: 'hreflang missing self-reference',
        fix: 'Add a <link rel="alternate" hreflang> pointing at the page itself to its own hreflang set.',
      }),
    );
  }
  if (seen.size && !seen.has('x-default')) {
    found.push(
      warning(path, {
        message: 'hreflang set has no x-default',
        fix: 'Add <link rel="alternate" hreflang="x-default" href="…"> pointing at the fallback page.',
      }),
    );
  }
  return { findings: found, targets, pointers };
};
