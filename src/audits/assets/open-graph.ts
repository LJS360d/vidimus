import { statSync } from 'node:fs';
import { extname } from 'node:path';
import { isNoindex, localFile, meta, originOf, resolveHref } from '../../core/html.ts';
import type { PageSource } from '../../core/types.ts';
import type { Env, Report } from './env.ts';

const OG_WARN_BYTES = 1024 * 1024;
const OG_ERROR_BYTES = 8 * 1024 * 1024;
const OG_UNSUPPORTED = new Set(['svg', 'avif']);

const SOCIAL_FIXES: Record<string, (origin: string) => string> = {
  'og:title': () => 'Add <meta property="og:title" content="<page title>"> to the <head>.',
  'og:image': (origin) =>
    `Add <meta property="og:image" content="${origin}/og.png"> pointing at a 1200x630 image.`,
  'twitter:card': () =>
    'Add <meta name="twitter:card" content="summary_large_image"> to the <head>.',
};

interface Page {
  env: Env;
  page: PageSource;
  report: Report;
  exampleOrigin: string;
}

const tag = ({ page }: Page, name: string) => meta(page.html, name)?.trim();

const checkRequiredTags = (p: Page) => {
  for (const property of ['og:title', 'og:image', 'twitter:card']) {
    if (tag(p, property)) continue;
    p.report(
      {
        message: `missing <meta ${property.startsWith('og:') ? 'property' : 'name'}="${property}">`,
        severity: 'warn',
        fix: SOCIAL_FIXES[property]?.(p.exampleOrigin),
      },
      p.page.path,
    );
  }
};

const checkImageFile = (p: Page, path: string, file: string) => {
  const { env, report } = p;
  const { width: minWidth, height: minHeight } = env.options.ogImage;
  const size = env.measure(file);
  const format = size?.type ?? extname(file).slice(1).toLowerCase();
  if (OG_UNSUPPORTED.has(format)) {
    report(
      {
        message: `og:image ${path} is ${format.toUpperCase()}, which social crawlers do not accept`,
        file,
        fix: 'Export the image as PNG or JPEG and point og:image at it.',
      },
      p.page.path,
    );
  }
  const bytes = statSync(file).size;
  if (bytes > OG_WARN_BYTES) {
    const mb = (bytes / OG_WARN_BYTES).toFixed(1);
    report(
      {
        message: `og:image ${path} is ${mb} MB, over the ${bytes > OG_ERROR_BYTES ? 8 : 1} MB limit`,
        file,
        severity: bytes > OG_ERROR_BYTES ? 'error' : 'warn',
        fix: 'Compress the image below 1 MB; crawlers such as Facebook reject files over 8 MB.',
      },
      p.page.path,
    );
  }
  if (size && (size.width < minWidth || size.height < minHeight)) {
    report(
      {
        message: `og:image ${path} is ${size.width}x${size.height}, smaller than ${minWidth}x${minHeight}`,
        file,
        severity: 'warn',
        fix: `Replace it with an image of at least ${minWidth}x${minHeight} (1200x630 is the common Open Graph size).`,
      },
      p.page.path,
    );
  }
  return size;
};

const checkOgImage = (p: Page, image: string | undefined) => {
  const { env, page, report } = p;
  const resolved = image ? resolveHref(image, page.path, env.siteUrl) : null;
  if (image && resolved && !resolved.absolute) {
    report(
      {
        message: `og:image "${image}" is not an absolute URL`,
        fix: `Use an absolute URL, e.g. <meta property="og:image" content="${p.exampleOrigin}${resolved.url.pathname}">.`,
      },
      page.path,
    );
  }
  const file = resolved?.path ? localFile(env.dist, resolved.path) : null;
  if (resolved?.path && !file) {
    report(
      {
        message: `og:image ${resolved.path} not found`,
        fix: `Add ${resolved.path} to the build or point og:image at an existing image.`,
      },
      page.path,
    );
  }
  const size = resolved?.path && file ? checkImageFile(p, resolved.path, file) : undefined;
  if (image && !tag(p, 'og:image:alt')) {
    report(
      {
        message: 'missing <meta property="og:image:alt"> for og:image',
        severity: 'warn',
        fix: 'Add <meta property="og:image:alt" content="..."> describing the image for screen readers.',
      },
      page.path,
    );
  }
  for (const [key, actual] of [
    ['width', size?.width],
    ['height', size?.height],
  ] as const) {
    const declared = tag(p, `og:image:${key}`);
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
};

const checkTwitterImage = (p: Page) => {
  const { env, page, report } = p;
  const image = tag(p, 'twitter:image');
  const resolved = image ? resolveHref(image, page.path, env.siteUrl) : null;
  if (!resolved?.path) return;
  const file = localFile(env.dist, resolved.path);
  if (!file) {
    report(
      {
        message: `twitter:image ${resolved.path} not found`,
        fix: `Add ${resolved.path} to the build, or remove twitter:image so it falls back to og:image.`,
      },
      page.path,
    );
    return;
  }
  const format = env.measure(file)?.type ?? extname(file).slice(1).toLowerCase();
  if (OG_UNSUPPORTED.has(format)) {
    report(
      {
        message: `twitter:image ${resolved.path} is ${format.toUpperCase()}, which social crawlers do not accept`,
        file,
        fix: 'Export the image as PNG or JPEG and point twitter:image at it.',
      },
      page.path,
    );
  }
};

const checkOgUrl = (p: Page, siteOrigin: string) => {
  const url = tag(p, 'og:url');
  const urlOrigin = url ? originOf(url) : '';
  if (url && siteOrigin && urlOrigin !== siteOrigin) {
    p.report(
      {
        message: `og:url origin ${urlOrigin || url} differs from siteUrl ${siteOrigin}`,
        fix: `Set og:url to the page's URL on ${siteOrigin}, or update siteUrl if the site moved.`,
      },
      p.page.path,
    );
  }
};

export const checkOpenGraph = (env: Env, report: Report) => {
  const siteOrigin = originOf(env.siteUrl);
  const exampleOrigin = siteOrigin || 'https://example.com';
  for (const page of env.pages) {
    if (isNoindex(page.html)) continue;
    const p: Page = { env, page, report, exampleOrigin };
    checkRequiredTags(p);
    checkOgImage(p, tag(p, 'og:image'));
    checkTwitterImage(p);
    checkOgUrl(p, siteOrigin);
  }
};
