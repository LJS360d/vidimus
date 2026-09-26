import { isAbsolute, relative } from 'node:path';
import type { Pattern, ViewportSize } from '../config/types.ts';
import type { Browser, Page } from './peer-types.ts';

export const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

export const pathOf = (url: string) => new URL(url).pathname;

export const slug = (url: string) =>
  pathOf(url)
    .replace(/^\/|\/$/g, '')
    .replaceAll('/', '_') || 'index';

export const matchesAny = (patterns: Pattern[], text: string) =>
  patterns.some((pattern) => new RegExp(pattern).test(text));

export const firstFew = (values: Iterable<string>, max = 3) => {
  const all = [...values];
  return all.slice(0, max).join(' ') + (all.length > max ? ` +${all.length - max} more` : '');
};

export const viewport = (size: number | ViewportSize) => {
  const { width, height = 800 } = typeof size === 'number' ? { width: size } : size;
  return { width, height, isMobile: width < 768, hasTouch: width < 768 };
};

export const inParallel = async <T>(
  concurrency: number,
  items: T[],
  work: (item: T) => Promise<void>,
) => {
  const queue = items[Symbol.iterator]();
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      for (const item of queue) await work(item);
    }),
  );
};

export const inParallelTabs = <T>(
  browser: Browser,
  tabs: number,
  items: T[],
  work: (page: Page, item: T) => Promise<void>,
) => {
  const queue = items[Symbol.iterator]();
  return Promise.all(
    Array.from({ length: Math.min(tabs, items.length) }, async () => {
      const page = await browser.newPage();
      for (const item of queue) await work(page, item);
      await page.close();
    }),
  );
};

export const onePagePerTemplate = (urls: string[], templatePatterns: Pattern[]) => {
  const seen = new Set<Pattern>();
  return urls.filter((url) => {
    const template = templatePatterns.find((pattern) => new RegExp(pattern).test(pathOf(url)));
    if (!template) return true;
    if (seen.has(template)) return false;
    seen.add(template);
    return true;
  });
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const displayPath = (root: string, path: string) => {
  const fromRoot = relative(root, path);
  return !fromRoot ? '.' : fromRoot.startsWith('..') || isAbsolute(fromRoot) ? path : fromRoot;
};
