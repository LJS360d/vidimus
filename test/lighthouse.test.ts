import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertedFix, auditFix } from '../src/audits/lighthouse/fixes.ts';
import {
  categoryScore,
  concurrencyFor,
  metricsFor,
  thresholdsFor,
} from '../src/audits/lighthouse/scoring.ts';
import { lighthouse, selectUrls } from '../src/audits/lighthouse.ts';
import { defaults } from '../src/config/defaults.ts';
import { merge } from '../src/config/merge.ts';
import type { UserConfig, VidimusConfig } from '../src/config/types.ts';
import type { AuditContext } from '../src/core/types.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const browserPath = async () => {
  try {
    const { default: puppeteer } = await import('puppeteer');
    return await puppeteer.executablePath();
  } catch {
    return '';
  }
};
const executable = await browserPath();
const noBrowser = !executable || !existsSync(executable);

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const ORIGIN = 'http://localhost:4322';
const PAGES = ['/', '/about/', '/contact/', '/blog/', '/blog/a/', '/blog/b/', '/docs/x', '/docs/y'];

const select = (lighthouse: UserConfig['lighthouse'] = {}) =>
  selectUrls({
    config: merge(defaults(process.cwd()), { lighthouse }),
    origin: ORIGIN,
    pageUrls: () => PAGES.map((path) => `${ORIGIN}${path}`),
  } as unknown as AuditContext).map((url) => new URL(url).pathname);

describe('lighthouse page selection', () => {
  it('audits one page per directory by default', () => {
    assert.deepEqual(select(), ['/', '/about/', '/blog/a/', '/docs/x']);
  });

  it('audits every page with all, one per sample pattern, or a fixed list', () => {
    assert.deepEqual(select({ all: true }), PAGES);
    assert.deepEqual(select({ sample: ['^/blog/.+'] }), [
      '/',
      '/about/',
      '/contact/',
      '/blog/',
      '/blog/a/',
      '/docs/x',
      '/docs/y',
    ]);
    assert.deepEqual(select({ urls: ['/contact/'] }), ['/contact/']);
  });
});

describe('lighthouse thresholds', () => {
  it('applies every matching override in order, over the global thresholds', () => {
    const config = {
      thresholds: { performance: 0.9, seo: 1 },
      overrides: [
        { match: '^/app/', thresholds: { performance: 0.85 } },
        { match: 'showcase', thresholds: { performance: 0.75 } },
      ],
    };
    assert.deepEqual(thresholdsFor(config, '/docs/'), { performance: 0.9, seo: 1 });
    assert.deepEqual(thresholdsFor(config, '/app/docs'), { performance: 0.85, seo: 1 });
    assert.deepEqual(thresholdsFor(config, '/app/showcase'), { performance: 0.75, seo: 1 });
  });
});

describe('lighthouse categories', () => {
  it('runs override-only categories and logs a null score as -', async () => {
    const cwd = fixture({ 'dist/index.html': '<!doctype html><title>x</title>' });
    const config = defaults(cwd);
    config.lighthouse = {
      ...config.lighthouse,
      urls: ['/'],
      thresholds: { seo: 1 },
      overrides: [{ match: '^/$', thresholds: { accessibility: 1 } }],
    };
    const ran: string[][] = [];
    const logged: string[] = [];
    const context = {
      config,
      root: cwd,
      origin: ORIGIN,
      resolve: (...parts: string[]) => join(cwd, ...parts),
      importPeer: async () => ({
        default: async (_url: string, flags: { onlyCategories: string[] }) => {
          ran.push(flags.onlyCategories);
          return {
            lhr: {
              categories: {
                seo: { score: 1, auditRefs: [] },
                accessibility: { score: null, auditRefs: [] },
              },
              audits: {},
            },
            report: '<html></html>',
          };
        },
      }),
      launchBrowser: async () => ({
        newPage: async () => ({ close: async () => {} }),
        close: async () => {},
      }),
      pageUrls: () => [],
      log: (line: string) => logged.push(line),
    } as unknown as AuditContext;
    const result = await lighthouse.run(context);
    assert.match(logged.join('\n'), /accessibility -/);
    assert.deepEqual(ran, [['seo', 'accessibility']]);
    assert.deepEqual(result?.findings, []);
  });
});

describe('lighthouse runs', () => {
  it('scores the median of several runs and passes the desktop preset', async () => {
    const cwd = fixture({});
    const config = defaults(cwd);
    config.lighthouse = {
      ...config.lighthouse,
      urls: ['/'],
      thresholds: { performance: 0 },
      preset: 'desktop',
      runs: 3,
    };
    const scores = [0.9, 0.5, 0.7];
    const seen: unknown[] = [];
    const logged: string[] = [];
    const context = {
      config,
      root: cwd,
      origin: ORIGIN,
      resolve: (...parts: string[]) => join(cwd, ...parts),
      importPeer: async () => ({
        default: async (_url: string, flags: { formFactor?: string }) => {
          seen.push(flags.formFactor);
          return {
            lhr: {
              categories: { performance: { score: scores.shift(), auditRefs: [] } },
              audits: {},
            },
            report: '<html></html>',
          };
        },
      }),
      launchBrowser: async () => ({
        newPage: async () => ({ close: async () => {} }),
        close: async () => {},
      }),
      pageUrls: () => [],
      log: (line: string) => logged.push(line),
    } as unknown as AuditContext;
    await lighthouse.run(context);
    assert.deepEqual(seen, ['desktop', 'desktop', 'desktop']);
    assert.match(logged[0] ?? '', /performance 70/);
  });
});

describe('lighthouse browser state', () => {
  it('opens every run on a page that carries browser.state', async () => {
    const cwd = fixture({});
    const config = defaults(cwd);
    config.lighthouse = {
      ...config.lighthouse,
      urls: ['/'],
      thresholds: { performance: 0 },
      runs: 3,
    };
    config.browser.state.script = 'window.__seeded = 1';
    config.browser.state.cookies = [{ name: 'sid', value: 'abc' }];
    const seeded: unknown[] = [];
    const context = {
      config,
      root: cwd,
      origin: ORIGIN,
      resolve: (...parts: string[]) => join(cwd, ...parts),
      importPeer: async () => ({
        default: async (
          _url: string,
          _flags: unknown,
          _config: unknown,
          page: { seeded: unknown },
        ) => {
          seeded.push(page.seeded);
          return {
            lhr: { categories: { performance: { score: 1, auditRefs: [] } }, audits: {} },
            report: '<html></html>',
          };
        },
      }),
      launchBrowser: async () => ({
        newPage: async () => {
          const page = {
            seeded: [] as unknown[],
            evaluateOnNewDocument: async (...args: unknown[]) => {
              page.seeded.push(args[0]);
            },
            browserContext: () => ({
              setCookie: async (...cookies: { name: string; domain: string }[]) => {
                page.seeded.push(cookies.map((c) => `${c.name}@${c.domain}`));
              },
            }),
            close: async () => {},
          };
          return page;
        },
        close: async () => {},
      }),
      pageUrls: () => [],
      log: () => {},
    } as unknown as AuditContext;
    await lighthouse.run(context);
    const one = ['window.__seeded = 1', ['sid@localhost']];
    assert.deepEqual(seeded, [one, one, one]);
  });
});

describe('lighthouse audit', () => {
  it('scores pages, writes reports and fails below a threshold', {
    skip: noBrowser,
    timeout: 180_000,
  }, async () => {
    const cwd = fixture({
      'dist/index.html':
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lighthouse page</title><meta name="description" content="A tiny page for the lighthouse audit test, long enough to count."></head><body><main><h1>Hi</h1><img src="/missing.png"></main></body></html>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['lighthouse'],
      reporters: [],
      overrides: {
        port: await freePort(),
        lighthouse: { thresholds: { seo: 0.5, accessibility: 1 } },
      },
    });
    const result = results[0];
    assert.equal(result?.status, 'failed', result?.summary);
    const finding = result?.findings.find((f) => / accessibility \d+ \(want 100\)/.test(f.message));
    assert.ok(finding, result?.findings.map((f) => f.message).join('\n'));
    assert.ok((finding?.details?.length ?? 0) > 0, 'lists the costliest audits');
    assert.ok(existsSync(join(cwd, '.vidimus/lighthouse/index.html')));
  });

  it('reports a page that fails to load', { skip: noBrowser, timeout: 180_000 }, async () => {
    const cwd = fixture({ 'dist/index.html': '<!doctype html><title>x</title>' });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['lighthouse'],
      reporters: [],
      overrides: { port: await freePort(), lighthouse: { urls: ['/missing/'] } },
    });
    assert.equal(results[0]?.findings[0]?.message, 'failed to load /missing/');
  });
});

describe('lighthouse assertions', () => {
  it('reports values and ids, maps fixes and honours ignoreAudits', () => {
    const lhr = {
      categories: {
        seo: {
          score: 0.5,
          auditRefs: [
            { id: 'meta-description', weight: 1 },
            { id: 'noisy', weight: 1 },
          ],
        },
      },
      audits: {
        'meta-description': { score: 0, title: 'Meta' },
        noisy: { score: 1, title: 'Noisy' },
      },
    };
    assert.equal(categoryScore(lhr, 'seo', new Set()), 0.5);
    assert.equal(categoryScore(lhr, 'seo', new Set(['meta-description'])), 1);
    assert.match(auditFix(['meta-description'], 'r.html', 'seo'), /meta name="description"/);
    assert.match(auditFix(['x'], 'r.html', 'seo'), /lighthouse\.thresholds\.seo/);
  });

  it('words asserted-audit fixes around the audit, not a category threshold', () => {
    assert.match(
      assertedFix('image-alt', 'r.html'),
      /^image-alt: add alt text.*set lighthouse\.audits\.image-alt to 'off'/,
    );
    const generic = assertedFix('x', 'r.html');
    assert.match(generic, /^Open r\.html and fix x, or set lighthouse\.audits\.x to 'off'\.$/);
    assert.doesNotMatch(generic, /thresholds/);
  });

  it('fails metrics above their maximum and failing asserted audits', async () => {
    const cwd = fixture({});
    const config = defaults(cwd);
    config.lighthouse = {
      ...config.lighthouse,
      urls: ['/'],
      thresholds: { seo: 0 },
      metrics: { 'cumulative-layout-shift': 0.1 },
      audits: { 'image-alt': 'error' },
    };
    assert.deepEqual(metricsFor(config.lighthouse, '/'), { 'cumulative-layout-shift': 0.1 });
    const context = {
      config,
      root: cwd,
      origin: ORIGIN,
      resolve: (...parts: string[]) => join(cwd, ...parts),
      importPeer: async () => ({
        default: async () => ({
          lhr: {
            categories: { seo: { score: 1, auditRefs: [] } },
            audits: {
              'cumulative-layout-shift': { score: 0, title: 'CLS', numericValue: 0.3 },
              'image-alt': { score: 0, title: 'Alt' },
            },
          },
          report: '<html></html>',
        }),
      }),
      launchBrowser: async () => ({
        newPage: async () => ({ close: async () => {} }),
        close: async () => {},
      }),
      pageUrls: () => [],
      log: () => {},
    } as unknown as AuditContext;
    const result = await lighthouse.run(context);
    assert.equal(result?.findings?.length, 2);
    assert.match(result?.findings[0]?.message ?? '', /cumulative-layout-shift 0.3 \(want <= 0.1\)/);
    assert.match(result?.findings[1]?.message ?? '', /image-alt failed/);
  });
});

describe('lighthouse scheduling', () => {
  const base = defaults('/');
  const only = (...categories: string[]) => ({
    ...base.lighthouse,
    thresholds: Object.fromEntries(categories.map((name) => [name, 1])),
  });

  it('runs alone with one page at a time only when performance is measured', () => {
    const exclusive = lighthouse.exclusive as unknown as (config: VidimusConfig) => boolean;
    const config = (categories: string[]) => ({ ...base, lighthouse: only(...categories) });
    assert.equal(exclusive(config(['performance', 'seo'])), true);
    assert.equal(exclusive(config(['seo'])), false);
    assert.equal(concurrencyFor(only('performance')), 1);
    assert.equal(concurrencyFor(only('seo')), 3);
    assert.equal(concurrencyFor({ ...only('seo'), concurrency: 2 }), 2);
  });
});

const stubRuns = (results: (object | Error)[], extra: Record<string, unknown> = {}) => {
  const cwd = fixture({});
  const config = defaults(cwd);
  config.lighthouse = {
    ...config.lighthouse,
    urls: ['/'],
    thresholds: { performance: 0 },
    runs: results.length,
  };
  const logged: string[] = [];
  let calls = 0;
  const context = {
    config,
    root: cwd,
    origin: ORIGIN,
    resolve: (...parts: string[]) => join(cwd, ...parts),
    importPeer: async () => ({
      default: async () => {
        const next = results[calls++];
        if (next instanceof Error) throw next;
        return next;
      },
    }),
    launchBrowser: async () => ({
      newPage: async () => ({ close: async () => {} }),
      close: async () => {},
    }),
    pageUrls: () => [],
    log: (line: string) => logged.push(line),
    ...extra,
  } as unknown as AuditContext;
  return { cwd, context, logged, calls: () => calls };
};

const good = (score: number) => ({
  lhr: { categories: { performance: { score, auditRefs: [] } }, audits: {} },
  report: '<html></html>',
});
const broken = (code: string) => ({
  lhr: { runtimeError: { code, message: 'boom' }, categories: {}, audits: {} },
  report: '',
});

describe('lighthouse failing runs', () => {
  it('stops after the first failing run', async () => {
    const { context, calls } = stubRuns([broken('NO_FCP'), good(1), good(1)]);
    const result = await lighthouse.run(context);
    assert.equal(calls(), 1);
    assert.equal(result?.findings?.[0]?.message, 'failed to load /');
  });
});

describe('lighthouse partial failures', () => {
  it('notes how many runs succeeded and tailors the load failure fix', async () => {
    const partial = stubRuns([good(0.9), broken('NO_FCP')]);
    await lighthouse.run(partial.context);
    assert.match(partial.logged[0] ?? '', /\(1\/2 runs ok\)/);
    const failed = stubRuns([broken('ERRORED_DOCUMENT_REQUEST')]);
    const result = await lighthouse.run(failed.context);
    assert.deepEqual(result?.findings?.[0]?.where, ['/']);
    assert.match(result?.findings?.[0]?.fix ?? '', /error status/);
  });
});

describe('lighthouse report directory', () => {
  it('removes stale html reports before running', async () => {
    const { cwd, context } = stubRuns([good(1)]);
    const dir = join(cwd, context.config.outDir, context.config.lighthouse.outDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'gone.html'), 'old');
    await lighthouse.run(context);
    assert.equal(existsSync(join(dir, 'gone.html')), false);
  });
});
