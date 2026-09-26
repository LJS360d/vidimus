import type { VidimusConfig } from '../config/types.ts';
import { MissingPeerError } from './errors.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';

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
      import(peer).catch((error: unknown) => {
        loaded.delete(peer);
        throw isMissing(error, peer) ? new MissingPeerError(peer) : error;
      }),
    );
  }
  return loaded.get(peer) as Promise<T>;
};

export const launchBrowser = async (
  config: VidimusConfig,
  options: LaunchOptions = {},
): Promise<Browser> => {
  const { default: puppeteer } = await importPeer<typeof import('puppeteer')>('puppeteer');
  return puppeteer.launch({
    ...(config.browser.executablePath && { executablePath: config.browser.executablePath }),
    ...options,
    args: [...config.browser.args, ...(options.args ?? [])],
  });
};
