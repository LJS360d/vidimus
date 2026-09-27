import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  type Audit,
  loadConfig,
  type PageQuery,
  type RunInfo,
  run,
  UsageError,
} from '../src/index.ts';
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

const SHELL =
  '<!doctype html><title>app</title><div id="root"></div><script src="/app.js"></script>';

// Renders the links of the current route after a tick, like a client-side router.
const APP = `
const nav = { '/': ['/a', '/b', '/guide.pdf', 'https://example.org/'], '/a': ['/c'], '/b': ['/a'] };
setTimeout(() => {
  const root = document.getElementById('root');
  for (const href of nav[location.pathname] ?? []) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = href;
    root.append(link);
  }
  root.dataset.ready = '';
}, 50);
`;

const collect = async (
  files: Record<string, string>,
  overrides: Record<string, unknown>,
  query?: PageQuery,
) => {
  const seen: { origin: string; paths: string[] } = { origin: '', paths: [] };
  const probe: Audit = {
    name: 'probe',
    description: 'records the page list',
    run: async ({ origin, pageUrls }) => {
      seen.origin = origin;
      seen.paths = pageUrls(query).map((url) => url.slice(origin.length));
      return { summary: 'ok' };
    },
  };
  const infos: RunInfo[] = [];
  await run({
    cwd: fixture(files),
    env: {},
    audits: ['probe'],
    reporters: [{ name: 'spy', onStart: (info) => void infos.push(info) }],
    overrides: { port: 0, plugins: [probe], ...overrides },
  });
  return { ...seen, notes: infos[0]?.notes ?? [] };
};

describe('routes', () => {
  it('adds listed routes to the built pages, through the server fallback', async () => {
    const { paths } = await collect(
      { 'dist/index.html': SHELL, 'dist/about/index.html': 'about' },
      {
        server: { fallback: 'index.html' },
        routes: { paths: ['/docs/seo', '/about/', '/admin/users'] },
        exclude: ['^admin/'],
      },
    );
    assert.deepEqual(paths, ['/about/', '/', '/docs/seo']);
  });

  it('keeps translated routes out unless allLocales is set', async () => {
    const files = { 'dist/index.html': SHELL };
    const overrides = {
      server: { fallback: 'index.html' },
      locales: ['en', 'fr'],
      defaultLocale: 'en',
      routes: { paths: ['/docs', '/fr/docs'] },
    };
    assert.deepEqual((await collect(files, overrides)).paths, ['/', '/docs']);
    assert.deepEqual((await collect(files, overrides, { allLocales: true })).paths, [
      '/',
      '/docs',
      '/fr/docs',
    ]);
  });

  it('fails fast when a route has no file and the fallback is off', async () => {
    await assert.rejects(
      collect({ 'dist/index.html': SHELL }, { routes: { paths: ['/docs/seo'] } }),
      (error) =>
        error instanceof UsageError &&
        /\/docs\/seo/.test(error.message) &&
        /server\.fallback/.test(error.message) &&
        /routes/.test(error.message),
    );
  });

  it('reads routes from the sitemap and its index, under the base path', async () => {
    const { paths } = await collect(
      {
        'dist/index.html': SHELL,
        'dist/sitemap-index.xml':
          '<sitemapindex><sitemap><loc>https://user.github.io/project/sitemap-0.xml</loc></sitemap></sitemapindex>',
        'dist/sitemap-0.xml': `<urlset>
          <url><loc>https://user.github.io/project/</loc></url>
          <url><loc>https://user.github.io/project/docs/seo</loc></url>
          <url><loc>https://elsewhere.test/project/other</loc></url>
        </urlset>`,
      },
      {
        siteUrl: 'https://user.github.io/project',
        server: { fallback: 'index.html' },
        routes: { discover: 'sitemap' },
      },
    );
    assert.deepEqual(paths, ['/', '/docs/seo']);
  });

  it('crawls links from the rendered DOM', { skip: noBrowser }, async () => {
    const files = { 'dist/index.html': SHELL, 'dist/app.js': APP };
    const overrides = {
      server: { fallback: 'index.html' },
      routes: { discover: 'crawl' },
      render: { waitFor: '#root[data-ready]' },
    };
    assert.deepEqual((await collect(files, overrides)).paths, ['/', '/a', '/b', '/c']);
    const limited = await collect(files, {
      ...overrides,
      routes: { ...overrides.routes, limit: 1 },
    });
    assert.deepEqual(limited.paths, ['/', '/a']);
  });

  it('hints at routes for a single page with a large script', async () => {
    const files = { 'dist/index.html': SHELL, 'dist/app.js': 'x'.repeat(150_000) };
    const [hint] = (await collect(files, {})).notes;
    assert.match(hint ?? '', /one HTML page and a 150 kB script/);
    assert.deepEqual(
      (await collect(files, { server: { fallback: 'index.html' }, routes: { paths: ['/x'] } }))
        .notes,
      [],
    );
    assert.deepEqual((await collect({ ...files, 'dist/about.html': 'about' }, {})).notes, []);
  });

  it('rejects an unknown discovery mode and relative paths', async () => {
    const cwd = fixture({});
    await assert.rejects(
      loadConfig({ cwd, env: {}, set: ['routes.discover=spider'] }),
      /routes\.discover: "spider"/,
    );
    await assert.rejects(
      loadConfig({ cwd, env: {}, overrides: { routes: { paths: ['docs'] } } as never }),
      /routes\.paths\[0\]/,
    );
  });
});
