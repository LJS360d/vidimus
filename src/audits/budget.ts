import { existsSync, readFileSync, statSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import {
  type BuiltPage,
  linksWithRel,
  localFile,
  resolveHref,
  srcsetUrls,
  stripNonMarkup,
  tags,
} from '../core/html.ts';
import type { Audit, Finding, PageSource } from '../core/types.ts';
import { matchesAny, regex, stripBase } from '../core/util.ts';
import { imageSizeOf } from './image-size.ts';

type Kind = 'html' | 'css' | 'js' | 'page';

interface Asset {
  url: string;
  file: string;
  size: number;
}

interface Group {
  finding: Finding;
  where: Set<string>;
}

const LEGACY = /\.(png|jpe?g|gif)$/i;
const TEXTUAL = /\.(svg|json|wasm|xml|txt|webmanifest)$/i;
const MODERN = /^image\/(avif|webp)$/i;
const MODERN_FILE = /\.(avif|webp)(\?|#|$)/i;

const BUDGET_FIXES: Record<Kind, string> = {
  html: 'Move inline scripts, styles and SVG sprites into cached files or paginate long content, or raise budget.html.',
  css: 'Remove unused CSS (e.g. with PurgeCSS), split per-page styles out of the largest files above, or raise budget.css.',
  js: 'Split or lazy-load the largest scripts listed above, drop unused dependencies, or raise budget.js.',
  page: 'Shrink the largest files listed above (images first), lazy-load below-the-fold media, or raise budget.page.',
};

const formatBytes = (bytes: number) =>
  bytes < 1000
    ? `${bytes} B`
    : bytes < 1_000_000
      ? `${Math.round(bytes / 1000)} kB`
      : `${Number((bytes / 1_000_000).toFixed(1))} MB`;

const memo = <T>(compute: (file: string) => T) => {
  const cache = new Map<string, T>();
  return (file: string) => {
    if (!cache.has(file)) cache.set(file, compute(file));
    return cache.get(file) as T;
  };
};

const pictures = (html: string) =>
  [...stripNonMarkup(html).matchAll(/<picture\b[\s\S]*?<\/picture\s*>/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    modern: tags(match[0], 'source').some(
      ({ attrs }) =>
        MODERN.test(attrs.type ?? '') ||
        srcsetUrls(attrs.srcset).some((url) => MODERN_FILE.test(url)),
    ),
  }));

const topFiles = (assets: Asset[]) =>
  [...assets]
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map(({ url, size }) => `${formatBytes(size)} ${url}`);

const OTHER_REQUESTS = ['font', 'media', 'fetch', 'xhr', 'other'];

const sum = (assets: Asset[]) => assets.reduce((total, { size }) => total + size, 0);

export const budget: Audit = {
  name: 'budget',
  description: 'page weight, image size and format, image dimensions',
  requires: 'dist',
  async run({ config, renderedPages, dist, origin }) {
    const options = config.budget;
    const pages = (await renderedPages(config.exclude)).filter(
      (page) => !matchesAny(options.exclude, page.path),
    );
    if (pages.length === 0) return { status: 'skipped', summary: 'no built pages' };

    const raw = memo((file) => statSync(file).size);
    const codec = { gzip: gzipSync, brotli: brotliCompressSync, none: undefined }[
      options.compression
    ];
    const gzipped = memo((file) => {
      const sibling = ['.br', '.gz'].find((ext) => existsSync(file + ext));
      if (sibling) return raw(file + sibling);
      return codec ? codec(readFileSync(file)).length : raw(file);
    });
    const sized = (file: string) => (TEXTUAL.test(file) ? gzipped(file) : raw(file));
    const dimensionsOf = memo(imageSizeOf);
    const groups = new Map<string, Group>();
    const report = (key: string, finding: Finding, where: string) => {
      const group = groups.get(key) ?? { finding, where: new Set<string>() };
      group.where.add(where);
      groups.set(key, group);
    };

    const local = <T>(ref: string, page: BuiltPage, measure: (file: string) => T) => {
      const resolved = resolveHref(ref, page.path, config.siteUrl);
      if (!resolved?.path) return undefined;
      const file = localFile(dist, resolved.path);
      return file ? { url: resolved.path, file, size: measure(file) } : undefined;
    };

    const distinct = (assets: (Asset | undefined)[]) => [
      ...new Map(assets.filter((asset) => asset !== undefined).map((a) => [a.file, a])).values(),
    ];

    const served = (href: string, measure: (file: string) => number) => {
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return undefined;
      }
      if (url.origin !== new URL(origin).origin) return undefined;
      const path = stripBase(url.pathname, config.siteUrl);
      const file = localFile(dist, url.pathname) ?? localFile(dist, path);
      return file ? { url: path, file, size: measure(file) } : undefined;
    };

    const requested = (page: PageSource, types: string[], measure: (file: string) => number) =>
      distinct(
        (page.requests ?? [])
          .filter(({ type }) => types.includes(type))
          .map(({ url }) => served(url, measure)),
      );

    let heaviest = { path: '', size: 0 };

    for (const page of pages) {
      const { html } = page;
      const route = Object.entries(options.routes).find(([pattern]) =>
        regex(pattern).test(page.path),
      );
      const limits = { ...options, ...route?.[1] };
      const htmlAsset = { url: page.path, file: page.file, size: gzipped(page.file) };
      // A rendered page measures what the browser loaded, lazy chunks and fonts included.
      const network = page.requests !== undefined;
      const css = network
        ? requested(page, ['stylesheet'], gzipped)
        : distinct(
            linksWithRel(html, 'stylesheet').map(({ attrs }) =>
              local(attrs.href ?? '', page, gzipped),
            ),
          );
      const js = network
        ? requested(page, ['script'], gzipped)
        : distinct([
            ...tags(html, 'script')
              .filter(({ attrs }) => !Object.hasOwn(attrs, 'nomodule'))
              .map(({ attrs }) => (attrs.src ? local(attrs.src, page, gzipped) : undefined)),
            ...linksWithRel(html, 'modulepreload').map(({ attrs }) =>
              local(attrs.href ?? '', page, gzipped),
            ),
          ]);
      const images = tags(html, 'img');
      const imageAssets = network
        ? requested(page, ['image'], sized)
        : distinct(
            images.map(({ attrs }) =>
              local(attrs.src ?? srcsetUrls(attrs.srcset)[0] ?? '', page, sized),
            ),
          );
      const other = network
        ? requested(page, OTHER_REQUESTS, sized)
        : distinct([
            ...linksWithRel(html, 'preload')
              .filter(({ attrs }) => attrs.as?.toLowerCase() === 'font')
              .map(({ attrs }) => local(attrs.href ?? '', page, sized)),
            ...css.flatMap(({ file, url }) =>
              [...readFileSync(file, 'utf8').matchAll(/@font-face\s*{[^}]*}/gi)]
                .flatMap((face) => [...face[0].matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)])
                .map((ref) => local(ref[2] ?? '', { ...page, path: url }, sized)),
            ),
          ]);

      const totals: Record<Kind, { size: number; assets: Asset[] }> = {
        html: { size: htmlAsset.size, assets: [htmlAsset] },
        css: { size: sum(css), assets: css },
        js: { size: sum(js), assets: js },
        page: {
          size: htmlAsset.size + sum(css) + sum(js) + sum(imageAssets) + sum(other),
          assets: [htmlAsset, ...css, ...js, ...imageAssets, ...other],
        },
      };
      if (totals.page.size > heaviest.size) heaviest = { path: page.path, size: totals.page.size };

      const own = new URL(origin).origin;
      const urls = (page.requests ?? [])
        .map(({ url }) => url)
        .filter((url) => /^https?:/i.test(url));
      const counts = {
        requests: urls.length,
        thirdParty: urls.filter((url) => new URL(url).origin !== own).length,
      };
      for (const [key, label] of [
        ['requests', 'requests'],
        ['thirdParty', 'third-party requests'],
      ] as const) {
        const limit = limits[key];
        if (!network || !limit || counts[key] <= limit) continue;
        report(
          `${key} ${page.path}`,
          {
            message: `${counts[key]} ${label} > ${limit} budget`,
            file: page.file,
            fix: `Remove, bundle or lazy-load requests the page makes (third-party scripts, fonts, trackers), or raise budget.${key}.`,
          },
          page.path,
        );
      }

      for (const kind of ['html', 'css', 'js', 'page'] as const) {
        const limit = limits[kind];
        const { size, assets } = totals[kind];
        if (!limit || size <= limit) continue;
        const measured =
          kind === 'page'
            ? 'total'
            : { gzip: 'gzipped', brotli: 'brotli', none: 'raw' }[options.compression];
        report(
          `${kind} ${page.path}`,
          {
            message: `${kind} ${formatBytes(size)} ${measured} > ${formatBytes(limit)} budget`,
            details: topFiles(assets),
            file: page.file,
            fix: BUDGET_FIXES[kind],
          },
          page.path,
        );
      }

      for (const image of imageAssets) {
        if (!limits.image || image.size <= limits.image) continue;
        report(
          `image ${image.file}`,
          {
            message: `image ${image.url} ${formatBytes(image.size)} > ${formatBytes(limits.image)} budget`,
            file: image.file,
            fix: 'Resize/compress it (e.g. with sharp or squoosh) and serve AVIF/WebP, or raise budget.image.',
          },
          page.path,
        );
      }

      const blocks = pictures(html);
      for (const { attrs, index } of images.filter(({ name }) => name === 'img')) {
        const inModernPicture = blocks.some(
          ({ start, end, modern }) => modern && index > start && index < end,
        );

        if (options.legacyImage && !inModernPicture) {
          for (const ref of [attrs.src ?? '', ...srcsetUrls(attrs.srcset)]) {
            const image = ref ? local(ref, page, raw) : undefined;
            if (!image || !LEGACY.test(image.file) || image.size <= options.legacyImage) continue;
            report(
              `legacy ${image.file}`,
              {
                message: `image ${image.url} is ${formatBytes(image.size)}: serve AVIF or WebP`,
                file: image.file,
                severity: 'warn',
                fix: 'Add a <picture> with a <source type="image/avif"> or <source type="image/webp"> before this <img>.',
              },
              page.path,
            );
          }
        }

        const src = attrs.src ?? '';
        if (
          options.dimensions &&
          !src.trim().toLowerCase().startsWith('data:') &&
          !(attrs.width && attrs.height) &&
          !/aspect-ratio\s*:/i.test(attrs.style ?? '')
        ) {
          const intrinsic = src ? local(src, page, dimensionsOf) : undefined;
          const size = intrinsic?.size;
          const example = size ? `, e.g. width="${size.width}" height="${size.height}"` : '';
          report(
            `dimensions ${src}`,
            {
              message: `<img src="${src}"> has no width and height (layout shift)`,
              severity: 'warn',
              fix: `Add width and height attributes matching the image's intrinsic size${example} (CSS can still resize it).`,
            },
            page.path,
          );
        }
      }
    }

    const findings = [...groups.values()].map(({ finding, where }) => ({
      ...finding,
      where: [...where],
    }));
    const problems = findings.length ? `, ${findings.length} problem(s)` : '';
    return {
      summary: `${pages.length} page(s), heaviest ${heaviest.path || pages[0]?.path} ${formatBytes(heaviest.size)}${problems}`,
      findings,
    };
  },
};
