import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { linksWithRel, localFile, meta, readPages, resolveHref } from '../core/html.ts';
import type { Audit, Finding } from '../core/types.ts';
import { isPlainObject, matchesAny } from '../core/util.ts';
import { imageSize } from './image-size.ts';

interface Group {
  finding: Finding;
  where: Set<string>;
}

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

const measure = (file: string) => {
  try {
    return imageSize(readFileSync(file));
  } catch {
    return undefined;
  }
};

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

const readJson = (file: string) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

export const assets: Audit = {
  name: 'assets',
  description: 'favicon, web manifest, Open Graph image and 404 page',
  requires: 'dist',
  async run({ config, dist }) {
    const options = config.assets;
    const pages = readPages(dist, config.exclude).filter(
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
          report({ message: `icon ${resolved.path} not found` }, page.path);
        }
      }
      if (!declared && !isFile(join(dist, 'favicon.ico'))) {
        report({ message: 'no favicon: add <link rel="icon"> or /favicon.ico' });
      }
      if (!appleTouch) {
        report({ message: 'no <link rel="apple-touch-icon"> on any page', severity: 'warn' });
      }
    }

    if (options.manifest) {
      const manifests = new Map<string, Set<string>>();
      for (const page of pages) {
        for (const { attrs } of linksWithRel(page.html, 'manifest')) {
          const resolved = resolveHref(attrs.href ?? '', page.path, config.siteUrl);
          if (!resolved?.path) continue;
          manifests.set(resolved.path, (manifests.get(resolved.path) ?? new Set()).add(page.path));
        }
      }
      for (const [path, linkedFrom] of manifests) {
        const problem = (message: string, file?: string, severity?: 'warn') => {
          for (const where of linkedFrom) report({ message, file, severity }, where);
        };
        const file = localFile(dist, path);
        if (!file) {
          problem(`manifest ${path} not found`);
          continue;
        }
        const manifest = readJson(file);
        if (!isPlainObject(manifest)) {
          problem(`manifest ${path} is not valid JSON`, file);
          continue;
        }
        if (!manifest.name && !manifest.short_name) {
          problem(`manifest ${path} has no name or short_name`, file);
        }
        const icons = Array.isArray(manifest.icons) ? manifest.icons.filter(isPlainObject) : [];
        if (icons.length === 0) {
          problem(`manifest ${path} has no icons`, file);
          continue;
        }
        let largest = 0;
        for (const icon of icons) {
          const src = typeof icon.src === 'string' ? icon.src : '';
          const resolved = resolveHref(src, path, config.siteUrl);
          const iconFile = resolved?.path ? localFile(dist, resolved.path) : null;
          if (resolved?.path && !iconFile) {
            problem(`manifest icon ${resolved.path} not found`, file);
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
          problem(`manifest ${path} has no icon of at least 512x512`, file, 'warn');
      }
    }

    if (options.openGraph) {
      const { width: minWidth, height: minHeight } = options.ogImage;
      const siteOrigin = originOf(config.siteUrl);
      for (const page of pages) {
        if (/\bnoindex\b/i.test(meta(page.html, 'robots') ?? '')) continue;
        for (const property of ['og:title', 'og:image', 'twitter:card']) {
          if (!meta(page.html, property)?.trim()) {
            report(
              { message: `missing <meta property="${property}">`, severity: 'warn' },
              page.path,
            );
          }
        }

        const image = meta(page.html, 'og:image')?.trim();
        const resolved = image ? resolveHref(image, page.path, config.siteUrl) : null;
        if (image && resolved && !resolved.absolute) {
          report({ message: `og:image "${image}" is not an absolute URL` }, page.path);
        }
        if (resolved?.path) {
          const file = localFile(dist, resolved.path);
          if (!file) {
            report({ message: `og:image ${resolved.path} not found` }, page.path);
          } else {
            const size = measure(file);
            if (size && (size.width < minWidth || size.height < minHeight)) {
              report(
                {
                  message: `og:image ${resolved.path} is ${size.width}x${size.height}, smaller than ${minWidth}x${minHeight}`,
                  file,
                  severity: 'warn',
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
            { message: `og:url origin ${urlOrigin || url} differs from siteUrl ${siteOrigin}` },
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
      report({ message: 'no 404 page (404.html or 404/index.html)', severity: 'warn' });
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
