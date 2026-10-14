import type { VidimusConfig } from '../../config/types.ts';
import { srcsetUrls, tags } from '../../core/html.ts';
import type { Finding, PageSource } from '../../core/types.ts';
import { type Env, inside, localAsset, type PageAssets, picturesOf, totalsOf } from './collect.ts';
import { BUDGET_FIXES, formatBytes, formatExceeded, topFiles } from './format.ts';

const LEGACY = /\.(png|jpe?g|gif)$/i;
const KINDS = ['html', 'css', 'js', 'page'] as const;

type Report = (key: string, finding: Finding, where: string) => void;
type Limits = VidimusConfig['budget'];

interface Check {
  env: Env;
  page: PageSource;
  limits: Limits;
  options: Limits;
  report: Report;
}

const checkRequestCounts = ({ env, page, limits, report }: Check) => {
  const own = new URL(env.origin).origin;
  const urls = (page.requests ?? []).map(({ url }) => url).filter((url) => /^https?:/i.test(url));
  const counts = {
    requests: urls.length,
    thirdParty: urls.filter((url) => new URL(url).origin !== own).length,
  };
  for (const [key, label] of [
    ['requests', 'requests'],
    ['thirdParty', 'third-party requests'],
  ] as const) {
    const limit = limits[key];
    if (page.requests === undefined || !limit || counts[key] <= limit) continue;
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
};

const checkSizes = ({ page, limits, options, report }: Check, found: PageAssets) => {
  const totals = totalsOf(found);
  for (const kind of KINDS) {
    const limit = limits[kind];
    const { size, assets } = totals[kind];
    if (!limit || size <= limit) continue;
    const measured =
      kind === 'page'
        ? 'total'
        : { gzip: 'gzipped', brotli: 'brotli', none: 'raw' }[options.compression];
    const [sized, limited] = formatExceeded(size, limit);
    report(
      `${kind} ${page.path}`,
      {
        message: `${kind} ${sized} ${measured} > ${limited} budget`,
        details: topFiles(assets),
        file: page.file,
        fix: BUDGET_FIXES[kind],
      },
      page.path,
    );
  }
  return totals.page.size;
};

const checkImageLimit = ({ page, limits, report }: Check, found: PageAssets) => {
  for (const image of found.limitedImages) {
    if (!limits.image || image.size <= limits.image) continue;
    const [sized, limited] = formatExceeded(image.size, limits.image);
    report(
      `image ${image.file}`,
      {
        message: `image ${image.url} ${sized} > ${limited} budget`,
        file: image.file,
        fix: 'Resize/compress it (e.g. with sharp or squoosh) and serve AVIF/WebP, or raise budget.image.',
      },
      page.path,
    );
  }
};

const checkLegacy = (c: Check, attrs: Record<string, string>) => {
  const { env, page, options, report } = c;
  for (const ref of [attrs.src ?? '', ...srcsetUrls(attrs.srcset)]) {
    const image = ref ? localAsset(env, ref, page, env.measures.raw) : undefined;
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
};

const hasFilledStyle = (style: string) =>
  /position\s*:\s*absolute/i.test(style) ||
  (/(^|;)\s*width\s*:\s*100%/i.test(style) && /(^|;)\s*height\s*:\s*100%/i.test(style));

const checkDimensions = ({ env, page, report }: Check, attrs: Record<string, string>) => {
  const src = attrs.src || srcsetUrls(attrs.srcset)[0] || '';
  const style = attrs.style ?? '';
  if (
    hasFilledStyle(style) ||
    src.trim().toLowerCase().startsWith('data:') ||
    (attrs.width && attrs.height) ||
    /aspect-ratio\s*:/i.test(style)
  )
    return;
  const size = src ? localAsset(env, src, page, env.measures.dimensionsOf)?.size : undefined;
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
};

const checkImageTags = (c: Check) => {
  const { page, options } = c;
  if (!options.legacyImage && !options.dimensions) return;
  const blocks = picturesOf(page.html);
  for (const { attrs, index } of tags(page.html, 'img')) {
    if (options.legacyImage && !inside(blocks, index, true)) checkLegacy(c, attrs);
    if (options.dimensions) checkDimensions(c, attrs);
  }
};

export const checkPage = (c: Check, found: PageAssets) => {
  checkRequestCounts(c);
  const pageSize = checkSizes(c, found);
  checkImageLimit(c, found);
  checkImageTags(c);
  return pageSize;
};
