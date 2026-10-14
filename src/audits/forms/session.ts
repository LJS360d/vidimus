import type { VidimusConfig } from '../../config/types.ts';
import type { Browser, Page } from '../../core/peer-types.ts';
import { navigate } from '../../core/util.ts';
import { drain } from './page.ts';
import { probe } from './probe.ts';
import { sandbox } from './sandbox.ts';

export type Net = Awaited<ReturnType<typeof sandbox>>;

export interface Session {
  page: Page;
  net: Net;
  load(): Promise<void>;
  close(): Promise<void>;
}

export const openSession = async (
  browser: Browser,
  config: VidimusConfig,
  url: string,
  dialogs: string[],
): Promise<Session> => {
  const options = config.forms;
  const context = await browser.createBrowserContext();
  const close = () =>
    context.close().then(
      () => {},
      () => {},
    );
  try {
    const page = await context.newPage();
    const net = await sandbox(page, options.allowRequests, options.ignoreRequests, options.stub);
    page.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      (d.type() === 'beforeunload' ? d.dismiss() : d.accept()).catch(() => {});
    });
    await page.evaluateOnNewDocument(probe, options.skip);
    const load = async () => {
      net.arm(false);
      await navigate(page, url, { waitFor: config.render.waitFor, timeout: options.timeout });
      net.arm(true);
      net.take();
      await drain(page);
    };
    await load();
    return { page, net, load, close };
  } catch (error) {
    await close();
    throw error;
  }
};
