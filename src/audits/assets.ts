import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isFile,
  isNoindex,
  linksWithRel,
  localFile,
  meta,
  originOf,
  resolveHref,
} from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { isPlainObject, matchesAny } from '../core/util.ts';
import { imageSizeOf as measure } from './image-size.ts';
import { siteFileFindings } from './site-files.ts';

interface Group {
  finding: Finding;
  where: Set<string>;
}

const largestDeclared = (sizes: unknown) =>
  typeof sizes !== 'string'
    ? 0
    : Math.max(
        0,
        ...sizes
          .toLowerCase()
          .split(/\s+/)
          .map((size) => {
            if (size === 'any') return Number.POSITIVE_INFINITY;
            const [width = 0, height = 0] = size.split('x').map(Number);
            return Math.min(width, height) || 0;
          }),
      );

const ICON_EXAMPLE = '{"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}';

const SOCIAL_FIXES: Record<string, (origin: string) => string> = {
  'og:title': () => 'Add <meta property="og:title" content="<page title>"> to the <head>.',
  'og:image': (origin) =>
    `Add <meta property="og:image" content="${origin}/og.png"> pointing at a 1200x630 image.`,
  'twitter:card': () =>
    'Add <meta name="twitter:card" content="summary_large_image"> to the <head>.',
};

const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

export const assets: Audit = {
  name: 'assets',
  description:
    'favicon, web manifest, Open Graph image, 404 page, and ads.txt, change-password and app links when the site needs them',
  requires: 'dist',
  async run({ config, renderedPages, dist, log }) {
    const options = config.assets;
    const pages = (await renderedPages(config.exclude)).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (pages.length === 0) return { status: 'skipped', summary: 'no built pages' };

    const groups = new Map<string, Group>();
    const report = (finding: Finding, where?: string) => {
      const key = `${finding.severity ?? 'error'} ${finding.message}`;
      const group = groups.get(key) ?? { finding, where: new Set<string>() };
      if (where) group.where.add(where);
      groups.set(key, group);
    };

    if (options.favicon) {
      let declared = false;
      let appleTouch = isFile(join(dist, 'apple-touch-icon.png'));
      for (const page of pages) {
        const icons = linksWithRel(page.html, 'icon');
        const touch = linksWithRel(page.html, 'apple-touch-icon');
        declared ||= icons.length > 0;
        appleTouch ||= touch.length > 0;
        for (const { attrs } of [...icons, ...touch]) {
          const resolved = resolveHref(attrs.href ?? '', page.path, config.siteUrl);
          if (!resolved?.path || localFile(dist, resolved.path)) continue;
          report(
            {
              message: `icon ${resolved.path} not found`,
              fix: `Add ${resolved.path} to the build or fix the href of the <link rel="${attrs.rel}"> that points to it.`,
            },
            page.path,
          );
        }
      }
      if (!declared && !isFile(join(dist, 'favicon.ico'))) {
        report({
          message: 'no favicon: add <link rel="icon"> or /favicon.ico',
          fix: 'Add <link rel="icon" href="/favicon.svg"> to every page or put a favicon.ico in the build root.',
        });
      }
      if (!appleTouch) {
        report({
          message: 'no <link rel="apple-touch-icon"> on any page',
          severity: 'warn',
          fix: 'Add a 180x180 PNG and <link rel="apple-touch-icon" href="/apple-touch-icon.png">.',
        });
      }
    }

    if (options.manifest) {
      const manifests = new Map<string, Set<string>>();
      let linked = false;
      for (const page of pages) {
        for (const { attrs } of linksWithRel(page.html, 'manifest')) {
          linked = true;
          const resolved = resolveHref(attrs.href ?? '', page.path, config.siteUrl);
          if (!resolved?.path) continue;
          manifests.set(resolved.path, (manifests.get(resolved.path) ?? new Set()).add(page.path));
        }
      }
      if (!linked) {
        report({
          message: 'no <link rel="manifest"> on any page',
          severity: 'warn',
          fix: 'Add a site.webmanifest with name and icons to the build and <link rel="manifest" href="/site.webmanifest"> to every page, or set assets.manifest to false.',
        });
      }
      for (const [path, linkedFrom] of manifests) {
        const problem = (message: string, fix: string, file?: string, severity?: 'warn') => {
          for (const where of linkedFrom) report({ message, fix, file, severity }, where);
        };
        const file = localFile(dist, path);
        if (!file) {
          problem(
            `manifest ${path} not found`,
            `Add ${path} to the build or fix the href of <link rel="manifest">.`,
          );
          continue;
        }
        const manifest = readJson(file);
        if (!isPlainObject(manifest)) {
          problem(
            `manifest ${path} is not valid JSON`,
            `Fix the JSON syntax in ${path} (check it with jq or JSON.parse).`,
            file,
          );
          continue;
        }
        if (!manifest.name && !manifest.short_name) {
          problem(
            `manifest ${path} has no name or short_name`,
            `Add "name": "<site name>" (and optionally "short_name") to ${path}.`,
            file,
          );
        }
        const icons = Array.isArray(manifest.icons) ? manifest.icons.filter(isPlainObject) : [];
        if (icons.length === 0) {
          problem(
            `manifest ${path} has no icons`,
            `Add an "icons" array to ${path}, e.g. [${ICON_EXAMPLE}].`,
            file,
          );
          continue;
        }
        let largest = 0;
        for (const icon of icons) {
          const src = typeof icon.src === 'string' ? icon.src : '';
          const resolved = resolveHref(src, path, config.siteUrl);
          const iconFile = resolved?.path ? localFile(dist, resolved.path) : null;
          if (resolved?.path && !iconFile) {
            problem(
              `manifest icon ${resolved.path} not found`,
              `Add ${resolved.path} to the build or fix its "src" in ${path}.`,
              file,
            );
            continue;
          }
          const measured = iconFile ? measure(iconFile) : undefined;
          largest = Math.max(
            largest,
            largestDeclared(icon.sizes),
            measured ? Math.min(measured.width, measured.height) : 0,
          );
        }
        if (largest < 512)
          problem(
            `manifest ${path} has no icon of at least 512x512`,
            `Add a 512x512 PNG to "icons" in ${path}, e.g. ${ICON_EXAMPLE}.`,
            file,
            'warn',
          );
      }
    }

    if (options.openGraph) {
      const { width: minWidth, height: minHeight } = options.ogImage;
      const siteOrigin = originOf(config.siteUrl);
      const exampleOrigin = siteOrigin || 'https://example.com';
      for (const page of pages) {
        if (isNoindex(page.html)) continue;
        for (const property of ['og:title', 'og:image', 'twitter:card']) {
          if (!meta(page.html, property)?.trim()) {
            report(
              {
                message: `missing <meta ${property.startsWith('og:') ? 'property' : 'name'}="${property}">`,
                severity: 'warn',
                fix: SOCIAL_FIXES[property]?.(exampleOrigin),
              },
              page.path,
            );
          }
        }

        const image = meta(page.html, 'og:image')?.trim();
        const resolved = image ? resolveHref(image, page.path, config.siteUrl) : null;
        if (image && resolved && !resolved.absolute) {
          report(
            {
              message: `og:image "${image}" is not an absolute URL`,
              fix: `Use an absolute URL, e.g. <meta property="og:image" content="${exampleOrigin}${resolved.url.pathname}">.`,
            },
            page.path,
          );
        }
        if (resolved?.path) {
          const file = localFile(dist, resolved.path);
          if (!file) {
            report(
              {
                message: `og:image ${resolved.path} not found`,
                fix: `Add ${resolved.path} to the build or point og:image at an existing image.`,
              },
              page.path,
            );
          } else {
            const size = measure(file);
            if (size && (size.width < minWidth || size.height < minHeight)) {
              report(
                {
                  message: `og:image ${resolved.path} is ${size.width}x${size.height}, smaller than ${minWidth}x${minHeight}`,
                  file,
                  severity: 'warn',
                  fix: `Replace it with an image of at least ${minWidth}x${minHeight} (1200x630 is the common Open Graph size).`,
                },
                page.path,
              );
            }
          }
        }

        const url = meta(page.html, 'og:url')?.trim();
        const urlOrigin = url ? originOf(url) : '';
        if (url && siteOrigin && urlOrigin !== siteOrigin) {
          report(
            {
              message: `og:url origin ${urlOrigin || url} differs from siteUrl ${siteOrigin}`,
              fix: `Set og:url to the page's URL on ${siteOrigin}, or update siteUrl if the site moved.`,
            },
            page.path,
          );
        }
      }
    }

    if (
      options.notFound &&
      !isFile(join(dist, '404.html')) &&
      !isFile(join(dist, '404', 'index.html'))
    ) {
      report({
        message: 'no 404 page (404.html or 404/index.html)',
        severity: 'warn',
        fix: 'Add a 404.html to the build (most hosts serve it for missing pages).',
      });
    }

    for (const { finding, where } of siteFileFindings(pages, dist, config.siteUrl, options, log)) {
      if (!where.length) report(finding);
      for (const path of where) report(finding, path);
    }

    const findings = [...groups.values()].map(({ finding, where }) => ({
      ...finding,
      ...(where.size ? { where: [...where] } : {}),
    }));
    return {
      summary: findings.length
        ? `${findings.length} problem(s) across ${pages.length} page(s)`
        : `${pages.length} page(s), all assets in place`,
      findings,
    };
  },
};
