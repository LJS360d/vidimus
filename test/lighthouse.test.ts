import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectUrls, thresholdsFor } from '../src/audits/lighthouse.ts';
import { defaults } from '../src/config/defaults.ts';
import { merge } from '../src/config/merge.ts';
import type { UserConfig } from '../src/config/types.ts';
import type { AuditContext } from '../src/core/types.ts';

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
