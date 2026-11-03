import { join } from 'node:path';
import { isFile, linksWithRel, localFile, resolveHref } from '../../core/html.ts';
import type { Env, Report } from './env.ts';

const APPLE_TOUCH_SIZE = 180;

export const checkFavicon = ({ pages, dist, siteUrl, measure }: Env, report: Report) => {
  let declared = false;
  const appleTouchFiles = new Map<string, string>();
  const fallback = join(dist, 'apple-touch-icon.png');
  let appleTouch = isFile(fallback);
  if (appleTouch) appleTouchFiles.set('/apple-touch-icon.png', fallback);
  for (const page of pages) {
    const icons = linksWithRel(page.html, 'icon');
    const touch = [
      ...linksWithRel(page.html, 'apple-touch-icon'),
      ...linksWithRel(page.html, 'apple-touch-icon-precomposed'),
    ];
    declared ||= icons.length > 0;
    appleTouch ||= touch.length > 0;
    for (const { attrs } of [...icons, ...touch]) {
      const resolved = resolveHref(attrs.href ?? '', page.path, siteUrl);
      if (!resolved?.path || localFile(dist, resolved.path, true)) continue;
      report(
        {
          message: `icon ${resolved.path} not found`,
          fix: `Add ${resolved.path} to the build or fix the href of the <link rel="${attrs.rel}"> that points to it.`,
        },
        page.path,
      );
    }
    for (const { attrs } of touch) {
      const resolved = resolveHref(attrs.href ?? '', page.path, siteUrl);
      const file = resolved?.path ? localFile(dist, resolved.path) : null;
      if (resolved?.path && file) appleTouchFiles.set(resolved.path, file);
    }
  }
  for (const [pathname, file] of appleTouchFiles) {
    const size = measure(file);
    if (size && (size.width !== APPLE_TOUCH_SIZE || size.height !== APPLE_TOUCH_SIZE))
      report({
        message: `apple-touch-icon ${pathname} is ${size.width}x${size.height}, not 180x180`,
        severity: 'warn',
        fix: `Resize ${pathname} to a 180x180 PNG.`,
      });
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
};
