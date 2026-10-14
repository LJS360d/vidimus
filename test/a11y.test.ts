import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { a11y, issueFix } from '../src/audits/a11y.ts';
import { defaults } from '../src/config/defaults.ts';
import { fixture } from './helpers.ts';

describe('a11y audit', () => {
  it('ignores a failing page close after a clean audit', async () => {
    const cwd = fixture({});
    const page = {
      goto: async () => {},
      close: async () => {
        throw new Error('already gone');
      },
    };
    const browser = { newPage: async () => page, close: async () => {} };
    const result = await a11y.run({
      config: defaults(cwd),
      origin: 'http://localhost:1',
      pageUrls: () => ['http://localhost:1/'],
      importPeer: async (name: string) =>
        name === 'pa11y' ? { default: async () => ({ issues: [] }) } : {},
      launchBrowser: async () => browser,
      log: () => {},
    } as never);
    assert.deepEqual(result.findings, []);
    assert.match(result.summary, /1 pages, no WCAG2AA violations/);
  });

  it('forwards the runner and reports warnings as warn findings only when enabled', async () => {
    const calls: Record<string, unknown>[] = [];
    const run = async (a11yConfig: object) => {
      const cwd = fixture({});
      const config = defaults(cwd);
      Object.assign(config.a11y, a11yConfig);
      const browser = {
        newPage: async () => ({ goto: async () => {}, close: async () => {} }),
        close: async () => {},
      };
      return a11y.run({
        config,
        origin: 'http://localhost:1',
        pageUrls: () => ['http://localhost:1/'],
        importPeer: async (name: string) =>
          name === 'pa11y'
            ? {
                default: async (_: string, options: Record<string, unknown>) => {
                  calls.push(options);
                  return {
                    issues: [
                      {
                        code: 'a',
                        message: 'warned',
                        selector: 'p',
                        context: null,
                        type: 'warning',
                      },
                    ],
                  };
                },
              }
            : {},
        launchBrowser: async () => browser,
        log: () => {},
      } as never);
    };
    await run({});
    const result = await run({ runner: 'axe', includeWarnings: true });
    assert.deepEqual(calls[0]?.runners, ['htmlcs']);
    assert.deepEqual(calls[1]?.runners, ['axe']);
    assert.equal(calls[0]?.includeWarnings, false);
    assert.equal(result.findings?.[0]?.severity, 'warn');
  });

  it('waits for render.waitFor after navigation and before pa11y', async () => {
    const order: string[] = [];
    const config = defaults(fixture({}));
    config.render.waitFor = '#app';
    const page = {
      goto: async () => void order.push('goto'),
      waitForSelector: async (selector: string) => void order.push(`wait ${selector}`),
      close: async () => {},
    };
    await a11y.run({
      config,
      origin: 'http://localhost:1',
      pageUrls: () => ['http://localhost:1/'],
      importPeer: async (name: string) =>
        name === 'pa11y'
          ? {
              default: async () => {
                order.push('pa11y');
                return { issues: [] };
              },
            }
          : {},
      launchBrowser: async () => ({ newPage: async () => page, close: async () => {} }),
      log: () => {},
    } as never);
    assert.deepEqual(order, ['goto', 'wait #app', 'pa11y']);
  });

  it('orders findings by url and keeps load errors out of the message', async () => {
    const urls = ['http://localhost:1/b', 'http://localhost:1/a', 'http://localhost:1/c'];
    const run = (delays: number[]) =>
      a11y.run({
        config: defaults(fixture({})),
        origin: 'http://localhost:1',
        pageUrls: () => urls,
        importPeer: async (name: string) =>
          name === 'pa11y'
            ? {
                default: async (url: string) => {
                  await new Promise((r) => setTimeout(r, delays[urls.indexOf(url)]));
                  if (url.endsWith('/c')) throw new Error(`timed out ${delays[2]}ms`);
                  return {
                    issues: [
                      { code: 'x', message: 'm', selector: 'a', context: `<a href="${url}">` },
                    ],
                  };
                },
              }
            : {},
        launchBrowser: async () => ({
          newPage: async () => ({ goto: async () => {}, close: async () => {} }),
          close: async () => {},
        }),
        log: () => {},
      } as never);
    const first = await run([1, 20, 5]);
    const second = await run([20, 1, 5]);
    assert.deepEqual(first.findings, second.findings);
    assert.deepEqual(first.findings?.[0]?.where, ['/a', '/b']);
    assert.equal(first.findings?.[1]?.message, 'failed to audit /c');
    assert.deepEqual(first.findings?.[1]?.where, ['/c']);
  });

  it('links axe rules to their help page', () => {
    assert.match(issueFix('x', 'https://h/x'), /Apply https:\/\/h\/x /);
    assert.match(
      issueFix('color-contrast'),
      /dequeuniversity\.com\/rules\/axe\/4\.10\/color-contrast /,
    );
    assert.match(issueFix('WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'), /Techniques\/html\/H37/);
  });
});
