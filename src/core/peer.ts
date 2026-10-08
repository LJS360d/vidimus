import type { VidimusConfig } from '../config/types.ts';
import { MissingPeerError } from './errors.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';
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
