import {
  type BuiltPage,
  linksWithRel,
  localFile,
  resolveHref,
  srcsetUrls,
  stripNonMarkup,
  tags,
} from '../../core/html.ts';
import type { PageSource } from '../../core/types.ts';
import { stripBase } from '../../core/util.ts';
import { type Asset, sum } from './format.ts';
import type { Measures } from './measure.ts';

const MODERN = /^image\/(avif|webp)$/i;
const MODERN_FILE = /\.(avif|webp)(\?|#|$)/i;
const OTHER_REQUESTS = ['font', 'media', 'fetch', 'xhr', 'other'];

export interface Env {
  dist: string;
  siteUrl: string;
  origin: string;
  measures: Measures;
}

export interface Picture {
  start: number;
  end: number;
  modern: boolean;
}

export const picturesOf = (html: string): Picture[] =>
  [...stripNonMarkup(html).matchAll(/<picture\b[\s\S]*?<\/picture\s*>/gi)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    modern: tags(match[0], 'source').some(
      ({ attrs }) =>
        MODERN.test(attrs.type ?? '') ||
        srcsetUrls(attrs.srcset).some((url) => MODERN_FILE.test(url)),
    ),
  }));

export const inside = (blocks: Picture[], index: number, onlyModern = false) =>
  blocks.some(({ start, end, modern }) => (!onlyModern || modern) && index > start && index < end);

export const localAsset = <T>(
  env: Env,
  ref: string,
  page: BuiltPage,
  measure: (file: string) => T,
) => {
  const resolved = resolveHref(ref, page.path, env.siteUrl);
  if (!resolved?.path) return undefined;
  const file = localFile(env.dist, resolved.path, true);
  return file ? { url: resolved.path, file, size: measure(file) } : undefined;
};

const distinct = (assets: (Asset | undefined)[]) => [
  ...new Map(assets.filter((asset) => asset !== undefined).map((a) => [a.file, a])).values(),
];

const servedAsset = (env: Env, href: string, measure: (file: string) => number) => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(env.origin).origin) return undefined;
  const path = stripBase(url.pathname, env.siteUrl);
  const file = localFile(env.dist, url.pathname, true) ?? localFile(env.dist, path, true);
  return file ? { url: path, file, size: measure(file) } : undefined;
};

const requested = (
  env: Env,
  page: PageSource,
  types: string[],
  measure: (file: string) => number,
) =>
  distinct(
    (page.requests ?? [])
      .filter(({ type }) => types.includes(type))
      .map(({ url }) => servedAsset(env, url, measure)),
  );

export interface PageAssets {
  html: Asset;
  css: Asset[];
  js: Asset[];
  images: Asset[];
  limitedImages: Asset[];
  other: Asset[];
}

// A rendered page measures what the browser loaded, lazy chunks and fonts included.
const fromNetwork = (env: Env, page: PageSource, html: Asset): PageAssets => {
  const { gzipped, sized } = env.measures;
  const images = requested(env, page, ['image'], sized);
  return {
    html,
    css: requested(env, page, ['stylesheet'], gzipped),
    js: requested(env, page, ['script'], gzipped),
    images,
    limitedImages: images,
    other: requested(env, page, OTHER_REQUESTS, sized),
  };
};

const fromMarkup = (env: Env, page: PageSource, html: Asset): PageAssets => {
  const { gzipped, sized, fontRefs } = env.measures;
  const markup = page.html;
  const css = distinct(
    linksWithRel(markup, 'stylesheet').map(({ attrs }) =>
      localAsset(env, attrs.href ?? '', page, gzipped),
    ),
  );
  const js = distinct([
    ...tags(markup, 'script')
      .filter(({ attrs }) => !Object.hasOwn(attrs, 'nomodule'))
      .map(({ attrs }) => (attrs.src ? localAsset(env, attrs.src, page, gzipped) : undefined)),
    ...linksWithRel(markup, 'modulepreload').map(({ attrs }) =>
      localAsset(env, attrs.href ?? '', page, gzipped),
    ),
  ]);
  const imgs = tags(markup, 'img');
  const blocks = picturesOf(markup);
  const images = distinct(
    imgs.map(({ attrs }) =>
      localAsset(env, attrs.src ?? srcsetUrls(attrs.srcset)[0] ?? '', page, sized),
    ),
  );
  const limitedImages = distinct([
    ...imgs.flatMap(({ attrs }) =>
      [attrs.src ?? '', ...srcsetUrls(attrs.srcset)].map((ref) =>
        localAsset(env, ref, page, sized),
      ),
    ),
    ...tags(markup, 'source')
      .filter(({ index }) => inside(blocks, index))
      .flatMap(({ attrs }) =>
        srcsetUrls(attrs.srcset).map((ref) => localAsset(env, ref, page, sized)),
      ),
  ]);
  const other = distinct([
    ...linksWithRel(markup, 'preload')
      .filter(({ attrs }) => attrs.as?.toLowerCase() === 'font')
      .map(({ attrs }) => localAsset(env, attrs.href ?? '', page, sized)),
    ...css.flatMap(({ file, url }) =>
      fontRefs(file).map((ref) => localAsset(env, ref, { ...page, path: url }, sized)),
    ),
  ]);
  return { html, css, js, images, limitedImages, other };
};

export const assetsOf = (env: Env, page: PageSource): PageAssets => {
  const html = { url: page.path, file: page.file, size: env.measures.gzipped(page.file) };
  return page.requests !== undefined ? fromNetwork(env, page, html) : fromMarkup(env, page, html);
};

export const totalsOf = ({ html, css, js, images, other }: PageAssets) => ({
  html: { size: html.size, assets: [html] },
  css: { size: sum(css), assets: css },
  js: { size: sum(js), assets: js },
  page: {
    size: html.size + sum(css) + sum(js) + sum(images) + sum(other),
    assets: [html, ...css, ...js, ...images, ...other],
  },
});
