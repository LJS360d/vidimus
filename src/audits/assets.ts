import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
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

const OG_WARN_BYTES = 1024 * 1024;
const OG_ERROR_BYTES = 8 * 1024 * 1024;
const OG_UNSUPPORTED = new Set(['svg', 'avif']);

interface Group {
  finding: Finding;
  where: Set<string>;
}

const DISPLAY_MODES = new Set(['fullscreen', 'standalone', 'minimal-ui', 'browser']);

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
        const scopeValue = typeof manifest.scope === 'string' ? manifest.scope : '.';
        const scope = resolveHref(scopeValue, path, config.siteUrl)?.path;
        const startValue = typeof manifest.start_url === 'string' ? manifest.start_url : '';
        if (!startValue) {
          problem(
            `manifest ${path} has no start_url`,
            `Add "start_url": "/" to ${path}.`,
            file,
            'warn',
          );
        } else {
          const start = resolveHref(startValue, path, config.siteUrl)?.path;
          const root = scope?.endsWith('/') ? scope : `${scope}/`;
          if (!scope || !start || (start !== root.slice(0, -1) && !start.startsWith(root))) {
            problem(
              `manifest ${path} start_url ${startValue} is outside scope ${scopeValue}`,
              `Set "start_url" inside "scope" in ${path}, or widen "scope".`,
              file,
            );
          } else if (!localFile(dist, start)) {
            problem(
              `manifest start_url ${start} not found`,
              `Add ${start} to the build or fix "start_url" in ${path}.`,
              file,
            );
          }
        }
        if (manifest.display !== undefined && !DISPLAY_MODES.has(String(manifest.display))) {
          problem(
            `manifest ${path} display "${manifest.display}" is not valid`,
            `Set "display" in ${path} to one of ${[...DISPLAY_MODES].join(', ')}.`,
            file,
          );
        }
        if (
          !icons.some((icon) =>
            String(icon.purpose ?? '')
              .split(/\s+/)
              .includes('maskable'),
          )
        ) {
          problem(
            `manifest ${path} has no maskable icon`,
            `Add a 512x512 icon with "purpose": "maskable" to "icons" in ${path}.`,
            file,
            'warn',
          );
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
          if (measured && typeof icon.sizes === 'string') {
            const actual = `${measured.width}x${measured.height}`;
            const declared = icon.sizes.toLowerCase().split(/\s+/);
            if (!declared.includes(actual) && !declared.includes('any'))
              problem(
                `manifest icon ${resolved?.path} declares ${icon.sizes} but is ${actual}`,
                `Set "sizes" to "${actual}" for this icon in ${path}.`,
                file,
                'warn',
              );
          }
          largest = Math.max(
            largest,
            measured ? Math.min(measured.width, measured.height) : largestDeclared(icon.sizes),
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
            const format = size?.type ?? extname(file).slice(1).toLowerCase();
            if (OG_UNSUPPORTED.has(format)) {
              report(
                {
                  message: `og:image ${resolved.path} is ${format.toUpperCase()}, which social crawlers do not accept`,
                  file,
                  fix: 'Export the image as PNG or JPEG and point og:image at it.',
                },
                page.path,
              );
            }
            const bytes = statSync(file).size;
            if (bytes > OG_WARN_BYTES) {
              const mb = (bytes / OG_WARN_BYTES).toFixed(1);
              report(
                {
                  message: `og:image ${resolved.path} is ${mb} MB, over the ${bytes > OG_ERROR_BYTES ? 8 : 1} MB limit`,
                  file,
                  severity: bytes > OG_ERROR_BYTES ? 'error' : 'warn',
                  fix: 'Compress the image below 1 MB; crawlers such as Facebook reject files over 8 MB.',
                },
                page.path,
              );
            }
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

        if (image && !meta(page.html, 'og:image:alt')?.trim()) {
          report(
            {
              message: 'missing <meta property="og:image:alt"> for og:image',
              severity: 'warn',
              fix: 'Add <meta property="og:image:alt" content="..."> describing the image for screen readers.',
            },
            page.path,
          );
        }
        const ogFile = resolved?.path ? localFile(dist, resolved.path) : null;
        const ogSize = ogFile ? measure(ogFile) : undefined;
        for (const [key, actual] of [
          ['width', ogSize?.width],
          ['height', ogSize?.height],
        ] as const) {
          const declared = meta(page.html, `og:image:${key}`)?.trim();
          if (declared && actual && Number(declared) !== actual) {
            report(
              {
                message: `og:image:${key} is ${declared} but ${resolved?.path} is ${actual}`,
                severity: 'warn',
                fix: `Set <meta property="og:image:${key}" content="${actual}"> to the real image ${key}.`,
              },
              page.path,
            );
          }
        }

        const twitterImage = meta(page.html, 'twitter:image')?.trim();
        const twitterResolved = twitterImage
          ? resolveHref(twitterImage, page.path, config.siteUrl)
          : null;
        if (twitterResolved?.path) {
          const file = localFile(dist, twitterResolved.path);
          const format = file ? (measure(file)?.type ?? extname(file).slice(1).toLowerCase()) : '';
          if (!file) {
            report(
              {
                message: `twitter:image ${twitterResolved.path} not found`,
                fix: `Add ${twitterResolved.path} to the build, or remove twitter:image so it falls back to og:image.`,
              },
              page.path,
            );
          } else if (OG_UNSUPPORTED.has(format)) {
            report(
              {
                message: `twitter:image ${twitterResolved.path} is ${format.toUpperCase()}, which social crawlers do not accept`,
                file,
                fix: 'Export the image as PNG or JPEG and point twitter:image at it.',
              },
              page.path,
            );
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
