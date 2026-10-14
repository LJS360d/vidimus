import type { Page } from '../../core/peer-types.ts';
import type { FieldState, PageEvents, Value } from './probe.ts';
import type { CaseEvents } from './types.ts';

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export const settled = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));

export const scan = (page: Page) => page.evaluate(() => window.__vidimus.forms());

export const drain = (page: Page) => page.evaluate(() => window.__vidimus.drain());

export const fill = (page: Page, index: number, values: Record<string, Value>) =>
  page.evaluate((i, v) => window.__vidimus.fill(i, v, null), index, values);

export const observe = (page: Page, index: number) =>
  page.evaluate((i) => window.__vidimus.observe(i), index);

export const layerInvalid = (state: FieldState | undefined) =>
  !!state &&
  (state.native === 'invalid' || state.framework === 'invalid' || state.ui === 'invalid');

export const show = (value: Value | undefined) => {
  const text = JSON.stringify(value ?? null);
  return text.length > 40 ? `${text.slice(0, 30)}…(${String(value).length} chars)` : text;
};

export const emptyEvents = (): CaseEvents => ({
  errors: [],
  sockets: [],
  opened: [],
  workers: [],
  canary: false,
});

export const mergeEvents = (a: PageEvents, b: PageEvents): PageEvents => ({
  submits: [...a.submits, ...b.submits],
  invalid: [...a.invalid, ...b.invalid],
  errors: [...a.errors, ...b.errors],
  sockets: [...a.sockets, ...b.sockets],
  opened: [...a.opened, ...b.opened],
  workers: [...a.workers, ...b.workers],
  canary: a.canary || b.canary,
});

export const shotOf = async (page: Page, index: number) => {
  try {
    const handle = await page.evaluateHandle((i) => window.__vidimus.root(i), index);
    try {
      const el = handle.asElement() as unknown as {
        screenshot(o: object): Promise<Uint8Array>;
      } | null;
      return await el?.screenshot({ type: 'jpeg', quality: 60, optimizeForSpeed: true });
    } finally {
      await handle.dispose();
    }
  } catch {
    return undefined;
  }
};

export const dataUri = (jpeg: Uint8Array) =>
  `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`;
