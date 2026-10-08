import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { selectUrls, thresholdsFor } from '../src/audits/lighthouse.ts';
import { defaults } from '../src/config/defaults.ts';
import { merge } from '../src/config/merge.ts';
import type { UserConfig } from '../src/config/types.ts';
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
