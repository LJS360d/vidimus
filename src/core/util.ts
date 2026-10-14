import { AsyncLocalStorage } from 'node:async_hooks';
import { isAbsolute, relative, sep } from 'node:path';
import type { NavigateOptions, Pattern, ViewportSize } from '../config/types.ts';
import type { Browser, Page } from './peer-types.ts';
import { span } from './profile.ts';

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const escapeRegExp = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

export const basePathOf = (siteUrl: string) => {
  try {
    return new URL(siteUrl).pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
};

export const stripBase = (pathname: string, siteUrl: string) => {
  const base = basePathOf(siteUrl);
  if (!base) return pathname;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
};

export const underBase = (pathname: string, siteUrl: string) => {
  const base = basePathOf(siteUrl);
  return !base || pathname === base || pathname.startsWith(`${base}/`);
};

export const fallbackFor = (fallback: string | { match: Pattern; file: string }[], path: string) =>
  typeof fallback === 'string'
    ? fallback
    : (fallback.find(({ match }) => regex(match).test(path))?.file ?? '');

export const pathOf = (url: string, root = '') => stripBase(new URL(url).pathname, root);

const escaped = (text: string) =>
  text.replaceAll('%', '%25').replaceAll('_', '%5F').replaceAll('/', '_');

export const slug = (url: string, root = '') => {
  const { hash } = new URL(url);
  const path = escaped(pathOf(url, root).replace(/^\/|\/$/g, '')) || 'index';
  return hash ? `${path}%23${escaped(hash.slice(1))}` : path;
};

const compiled = new Map<Pattern, RegExp>();

export const regex = (pattern: Pattern) => {
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    compiled.set(pattern, re);
  }
  return re;
};

export const matchesAny = (patterns: Pattern[], text: string) =>
  patterns.some((pattern) => regex(pattern).test(text));

export const firstFew = (values: Iterable<string>, max = 3) => {
  const all = [...values];
  return all.slice(0, max).join(' ') + (all.length > max ? ` +${all.length - max} more` : '');
};

export const viewport = (size: number | ViewportSize) => {
  const { width, height = 800 } = typeof size === 'number' ? { width: size } : size;
  return { width, height, isMobile: width < 768, hasTouch: width < 768 };
};

export const abortScope = new AsyncLocalStorage<AbortSignal>();

const stopped = (failure: unknown) => failure || abortScope.getStore()?.aborted;

export const progressScope = new AsyncLocalStorage<(done: number, total: number) => void>();

export const track = (total: number) => {
  const report = progressScope.getStore();
  let done = 0;
  report?.(0, total);
  return () => report?.(++done, total);
};

interface PoolWorker<T> {
  run: (item: T) => Promise<void>;
  close?: () => Promise<void>;
}

const runPool = async <T>(size: number, items: T[], open: () => Promise<PoolWorker<T>>) => {
  if (!items.length) return;
  const queue = items[Symbol.iterator]();
  const workers = Math.min(Math.max(1, Math.floor(size) || 1), items.length);
  const tick = track(items.length);
  let failure: { error: unknown } | undefined;
  await span(
    'pool',
    async () => {
      const opened = performance.now();
      await Promise.allSettled(
        Array.from({ length: workers }, async () => {
          const worker = await open().catch((error: unknown) => {
            failure ??= { error };
            throw error;
          });
          try {
            for (const item of queue) {
              if (stopped(failure)) return;
              try {
                await span(
                  'task',
                  () => worker.run(item),
                  taskAttrs(item, performance.now() - opened),
                );
              } catch (error) {
                failure ??= { error };
                throw error;
              }
              tick();
            }
          } finally {
            await worker.close?.();
          }
        }),
      );
      if (failure) throw failure.error;
    },
    { workers, items: items.length },
  );
};

export const inParallel = <T>(concurrency: number, items: T[], work: (item: T) => Promise<void>) =>
  runPool(concurrency, items, async () => ({ run: work }));

const taskAttrs = (item: unknown, waitMs: number) => {
  const named = item as { id?: unknown; url?: unknown; path?: unknown } | undefined;
  const label =
    typeof item === 'string' ? item : String(named?.id ?? named?.url ?? named?.path ?? '');
  return { waitMs, ...(label && { item: label }), ...(/^https?:/.test(label) && { url: label }) };
};

export const inParallelTabs = <T>(
  browser: Browser,
  tabs: number,
  items: T[],
  work: (page: Page, item: T) => Promise<void>,
) =>
  runPool(tabs, items, async () => {
    const page = await browser.newPage();
    return {
      run: (item) => work(page, item),
      close: () => page.close().catch(() => {}),
    };
  });

export const onePagePerTemplate = (urls: string[], templatePatterns: Pattern[], root = '') => {
  const seen = new Set<Pattern>();
  return urls.filter((url) => {
    const path = pathOf(url, root);
    const template = templatePatterns.find((pattern) => regex(pattern).test(path));
    if (!template) return true;
    if (seen.has(template)) return false;
    seen.add(template);
    return true;
  });
};

export const onePagePerDirectory = (urls: string[], root = '') => {
  const seen = new Set<string>();
  return urls.filter((url) => {
    const directory = pathOf(url, root).replace(/[^/]*\/?$/, '');
    if (seen.has(directory)) return false;
    seen.add(directory);
    return true;
  });
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const portablePath = (root: string, file: string) =>
  (isAbsolute(file) ? relative(root, file) : file).split(sep).join('/').split('\\').join('/');

export const displayPath = (root: string, path: string) => {
  const fromRoot = relative(root, path);
  return !fromRoot ? '.' : fromRoot.startsWith('..') || isAbsolute(fromRoot) ? path : fromRoot;
};

export const navigate = (page: Page, url: string, { waitFor, timeout }: NavigateOptions) =>
  span(
    'navigate',
    async () => {
      const wait = typeof waitFor === 'number' || /^\d+$/.test(waitFor) ? Number(waitFor) : waitFor;
      await page.goto(url, {
        waitUntil: wait === 'networkidle' ? 'networkidle0' : 'load',
        timeout,
      });
      if (typeof wait === 'number')
        await span(`wait ${wait}ms`, () => new Promise((done) => setTimeout(done, wait)));
      else if (wait !== 'load' && wait !== 'networkidle')
        await page.waitForSelector(wait, { timeout });
    },
    { url },
  );
