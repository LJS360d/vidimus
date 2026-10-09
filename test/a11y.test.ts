import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { a11y } from '../src/audits/a11y.ts';
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
});
