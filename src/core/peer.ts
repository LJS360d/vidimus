import type { BrowserState, VidimusConfig } from '../config/types.ts';
import { MissingPeerError } from './errors.ts';
import type { Browser, LaunchOptions, Page } from './peer-types.ts';
import { instrument, span } from './profile.ts';

const isMissing = (error: unknown, peer: string) =>
  error instanceof Error &&
  'code' in error &&
  error.code === 'ERR_MODULE_NOT_FOUND' &&
  error.message.includes(`'${peer}'`);

const loaded = new Map<string, Promise<unknown>>();

export const importPeer = <T>(peer: string): Promise<T> => {
  if (!loaded.has(peer)) {
    loaded.set(
      peer,
      span(`import ${peer}`, () => import(peer)).catch((error: unknown) => {
        loaded.delete(peer);
        throw isMissing(error, peer) ? new MissingPeerError(peer) : error;
      }),
    );
  }
  return loaded.get(peer) as Promise<T>;
};

export const sharedBrowser = (launch: () => Promise<Browser>) => {
  let current: Promise<Browser> | undefined;
  let users = 0;
  return async (): Promise<Browser> => {
    users += 1;
    current ??= launch();
    const launching = current;
    let browser: Browser;
    try {
      browser = await launching;
    } catch (error) {
      users -= 1;
      if (current === launching) current = undefined;
      throw error;
    }
    const context = await browser.createBrowserContext();
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      users -= 1;
      await context.close().catch(() => {});
      if (users > 0 || current !== launching) return;
      current = undefined;
      await browser.close();
    };
    return new Proxy(browser, {
      get(target, property) {
        if (property === 'close') return release;
        if (property === 'newPage') return () => context.newPage();
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
};

// Runs in the page before its own scripts, so it must stay self-contained.
const seed = (local: Record<string, string>, session: Record<string, string>) => {
  try {
    for (const [key, value] of Object.entries(local)) localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(session)) sessionStorage.setItem(key, value);
  } catch {} // about:blank and opaque origins have no storage
};

// Every page opened through the returned browser, or a context it creates, gets `state`.
export const withState = (browser: Browser, state: BrowserState, origin: string): Browser => {
  const { localStorage, sessionStorage, cookies, script } = state;
  const storage = Object.keys(localStorage).length + Object.keys(sessionStorage).length > 0;
  if (!storage && !cookies.length && !script) return browser;
  const prepare = async (page: Page) => {
    if (storage) await page.evaluateOnNewDocument(seed, localStorage, sessionStorage);
    if (script) await page.evaluateOnNewDocument(script);
    if (cookies.length)
      await page.browserContext().setCookie(
        ...cookies.map(({ domain, path = '/', ...cookie }) => ({
          ...cookie,
          path,
          domain: domain ?? new URL(origin).hostname,
        })),
      );
    return page;
  };
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property, object);
        if (typeof value !== 'function') return value;
        if (property === 'newPage')
          return async (...args: unknown[]) => prepare(await value.apply(object, args));
        if (property === 'createBrowserContext')
          return async (...args: unknown[]) => wrap(await value.apply(object, args));
        return value.bind(object);
      },
    });
  return wrap(browser);
};

export const launchBrowser = async (
  config: VidimusConfig,
  options: LaunchOptions = {},
): Promise<Browser> => {
  const { default: puppeteer } = await importPeer<typeof import('puppeteer')>('puppeteer');
  const browser = await span('browser.launch', () =>
    puppeteer.launch({
      ...(config.browser.executablePath && { executablePath: config.browser.executablePath }),
      ...options,
      args: [...config.browser.args, ...(options.args ?? [])],
    }),
  );
  return instrument(browser, 'browser');
};
