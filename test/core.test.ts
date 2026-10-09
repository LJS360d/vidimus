import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MissingPeerError } from '../src/core/errors.ts';
import { decodeEntities, srcsetUrls, stripComments, tags, textOf } from '../src/core/html.ts';
import { pageUrlOf } from '../src/core/pages.ts';
import { importPeer, sharedBrowser } from '../src/core/peer.ts';
import type { Browser, Page } from '../src/core/peer-types.ts';
import { serve } from '../src/core/server.ts';
import { inParallel, inParallelTabs, slug } from '../src/core/util.ts';
import { type Audit, loadConfig, run, UsageError } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('html parsing', () => {
  it('decodes named, numeric and out-of-range entities', () => {
    assert.equal(decodeEntities('A &ndash; B &Eacute;&eacute; &frac12; &AMP;'), 'A – B Éé ½ &');
    assert.equal(
      decodeEntities('&#x1F680; &#99999999; &#x110000; &nope;'),
      '🚀 &#99999999; &#x110000; &nope;',
    );
    assert.equal(decodeEntities('&constructor; &toString;'), '&constructor; &toString;');
  });

  it('reads attributes that follow a quoted value without whitespace', () => {
    assert.deepEqual(
      tags('<a href="/x"class="y">x</a><img src=a alt=b>').map(({ name, attrs }) => [name, attrs]),
      [
        ['a', { href: '/x', class: 'y' }],
        ['img', { src: 'a', alt: 'b' }],
      ],
    );
  });

  it('ignores tags in comments and scripts, and keeps the first of repeated attributes', () => {
    const html = '<!-- <meta name="x"> --><script>"<meta name=y>"</script><meta name="z" name="w">';
    assert.deepEqual(
      tags(html, 'meta').map(({ attrs }) => attrs.name),
      ['z'],
    );
    assert.equal(tags('<p constructor="a">').at(0)?.attrs.constructor, 'a');
  });

  it('does not treat <!-- inside a script as the start of a comment', () => {
    const scripts = "<script>w('<!--')</script><script>b()</script>";
    assert.equal(stripComments(`${scripts}<!-- c -->`), `${scripts}          `);
  });

  it('reads text content with entities and nested tags', () => {
    assert.equal(textOf('<title> Foo &ndash; <b>Bar</b>\n</title>', 'title'), 'Foo – Bar');
    assert.equal(textOf('<p>x</p>', 'title'), undefined);
  });

  it('splits srcset candidates without breaking URLs that contain commas', () => {
    assert.deepEqual(srcsetUrls('/w_400,h_300/a.jpg 1x, /b.jpg 2x,/c.jpg'), [
      '/w_400,h_300/a.jpg',
      '/b.jpg',
      '/c.jpg',
    ]);
    assert.deepEqual(srcsetUrls('a.jpg, b.jpg 100w'), ['a.jpg', 'b.jpg']);
    assert.deepEqual(srcsetUrls(''), []);
  });
});

const fakeBrowser = () => {
  const opened: { closed: boolean }[] = [];
  let closed = 0;
  let contexts = 0;
  const newPage = async () => {
    const page = {
      closed: false,
      close: async () => {
        page.closed = true;
      },
    };
    opened.push(page);
    return page as unknown as Page;
  };
  const browser = {
    newPage,
    createBrowserContext: async () => {
      contexts += 1;
      return { newPage, close: async () => {} };
    },
    close: async () => {
      closed += 1;
    },
  } as unknown as Browser;
  return { browser, opened, closes: () => closed, contexts: () => contexts };
};

describe('slug', () => {
  it('keeps distinct pages on distinct filenames', () => {
    const urls = ['/a/b/', '/a_b/', '/a%5Fb/', '/a/', '/'].map((p) => `http://x.test${p}`);
    assert.equal(new Set(urls.map((u) => slug(u))).size, urls.length);
    assert.equal(slug('http://x.test/blog/post-1/'), 'blog_post-1');
    assert.equal(slug('http://x.test/'), 'index');
  });
});

describe('page urls', () => {
  it('encodes filename characters that would change the url meaning', () => {
    assert.equal(
      pageUrlOf('http://x.test', 'a#b/c?d%e.html'),
      'http://x.test/a%23b/c%3Fd%25e.html',
    );
    assert.equal(pageUrlOf('http://x.test', 'blog/index.html'), 'http://x.test/blog/');
  });
});

describe('parallel helpers', () => {
  it('still runs every item with a zero or NaN concurrency', async () => {
    for (const concurrency of [0, Number.NaN, -3, 2.5]) {
      const done: number[] = [];
      await inParallel(concurrency, [1, 2, 3], async (item) => void done.push(item));
      assert.deepEqual(done.sort(), [1, 2, 3], `concurrency ${concurrency}`);
    }
  });

  it('closes tabs when the work throws', async () => {
    const { browser, opened } = fakeBrowser();
    await assert.rejects(
      inParallelTabs(browser, 2, [1, 2, 3], async () => {
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.ok(opened.length > 0);
    assert.ok(opened.every(({ closed }) => closed));
  });

  it('opens no tabs for no items and at most one per item', async () => {
    const { browser, opened } = fakeBrowser();
    await inParallelTabs(browser, 8, [], async () => {});
    assert.equal(opened.length, 0);
    await inParallelTabs(browser, Number.POSITIVE_INFINITY, [1, 2], async () => {});
    assert.equal(opened.length, 2);
  });

  it('shares one browser and closes it after the last user', async () => {
    const { browser, closes, contexts } = fakeBrowser();
    let launches = 0;
    const shared = sharedBrowser(async () => {
      launches += 1;
      return browser;
    });
    const [a, b] = await Promise.all([shared(), shared()]);
    assert.equal(launches, 1);
    assert.equal(contexts(), 2);
    await a?.close();
    await a?.close();
    assert.equal(closes(), 0);
    await b?.close();
    assert.equal(closes(), 1);
    await (await shared()).close();
    assert.equal(launches, 2);
  });

  it('retries a launch that failed, and names a missing peer dependency', async () => {
    const { browser } = fakeBrowser();
    let launches = 0;
    const shared = sharedBrowser(async () => {
      launches += 1;
      if (launches === 1) throw new Error('no chrome');
      return browser;
    });
    await assert.rejects(shared(), /no chrome/);
    await (await shared()).close();
    assert.equal(launches, 2);

    const missing = await importPeer('vidimus-no-such-package').catch((error: unknown) => error);
    assert.ok(missing instanceof MissingPeerError);
    assert.equal(missing.peer, 'vidimus-no-such-package');
    assert.match(missing.message, /npm i -D vidimus-no-such-package/);
  });
});

const get = (port: number, path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`).then(async (res) => ({
    status: res.status,
    body: await res.text(),
  }));

describe('static server robustness', () => {
  it('answers bad paths instead of crashing', async () => {
    const root = fixture({ 'dist/index.html': 'home' });
    const server = await serve(join(root, 'dist'), 0, {
      gzip: false,
      headers: [],
      fallback: '',
      fallbackStatus: 200,
    });
    try {
      assert.ok(server.port > 0);
      assert.equal((await get(server.port, '/%00')).status, 404);
      assert.equal((await get(server.port, '/%E0%A4%A')).status, 404);
      assert.equal((await get(server.port, '/')).body, 'home');
    } finally {
      await server.close();
    }
  });

  it('reports a port in use as a usage error', async () => {
    const root = fixture({ 'dist/index.html': 'home' });
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as AddressInfo;
    try {
      await assert.rejects(
        serve(join(root, 'dist'), port, {
          gzip: false,
          headers: [],
          fallback: '',
          fallbackStatus: 200,
        }),
        (error) => error instanceof UsageError && /in use/.test(error.message),
      );
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });
});

const probe = (name: string, seen: string[] = []): Audit => ({
  name,
  description: 'records its origin',
  requires: 'server',
  run: async ({ origin }) => {
    seen.push(origin);
    return { summary: 'ok' };
  },
});

describe('runAudits', () => {
  it('serves on a free port with port 0 and points audits at it', async () => {
    const seen: string[] = [];
    const cwd = fixture({ 'dist/index.html': 'home' });
    const { ok } = await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: { port: 0, plugins: [probe('probe', seen)] },
    });
    assert.equal(ok, true);
    assert.match(seen[0] ?? '', /^http:\/\/localhost:[1-9]\d*$/);
  });

  it('ignores a newly created output directory in git, and leaves an existing one alone', async () => {
    const cwd = fixture({ 'dist/index.html': 'home', 'kept/report.json': '{}' });
    const options = { cwd, env: {}, audits: ['probe'], reporters: [] };
    await run({ ...options, overrides: { port: 0, plugins: [probe('probe')] } });
    assert.equal(readFileSync(join(cwd, '.vidimus', '.gitignore'), 'utf8'), '*\n');
    await run({ ...options, overrides: { port: 0, outDir: 'kept', plugins: [probe('probe')] } });
    assert.equal(existsSync(join(cwd, 'kept', '.gitignore')), false);
  });

  it('closes the server when a reporter fails to start', async () => {
    const cwd = fixture({ 'dist/index.html': 'home' });
    const port = await new Promise<number>((resolve) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });
    const options = {
      cwd,
      env: {},
      audits: ['probe'],
      overrides: { port, plugins: [probe('probe')] },
    };
    await assert.rejects(
      run({
        ...options,
        reporters: [
          {
            name: 'broken',
            onStart: () => {
              throw new Error('reporter down');
            },
          },
        ],
      }),
      /reporter down/,
    );
    const { ok } = await run({ ...options, reporters: [] });
    assert.equal(ok, true);
  });

  it('runs every audit plus named ones for "all"', async () => {
    const cwd = fixture({});
    const source = (name: string): Audit => ({
      name,
      description: name,
      requires: 'source',
      run: async () => ({ summary: 'ok' }),
    });
    const { config } = await loadConfig({
      cwd,
      env: {},
      overrides: { plugins: [source('extra')], severity: { extra: 'off' } },
    });
    const { selectAudits, auditRegistry } = await import('../src/index.ts');
    const names = (requested: string[]) =>
      selectAudits(auditRegistry(config), requested, config).map(({ name }) => name);
    assert.ok(!names(['all']).includes('extra'));
    assert.ok(names(['all', 'extra']).includes('extra'));
    assert.ok(names(['all', 'extra']).includes('seo'));
  });
});

describe('config coercion and patterns', () => {
  it('keeps numbers in mixed arrays and accepts false for required headers', async () => {
    const { config } = await loadConfig({
      cwd: fixture({}),
      env: {},
      set: ['shots.viewports=375,1280', 'security.require.permissions-policy=false'],
    });
    assert.deepEqual(config.shots.viewports, [375, 1280]);
    assert.equal(config.security.require['permissions-policy'], false);
  });

  it('rejects patterns that do not compile', async () => {
    for (const overrides of [
      { exclude: ['('] },
      { seo: { allowNoindex: ['['] } },
      { server: { headers: [{ match: '(', headers: {} }] } },
      { security: { require: { 'x-test': '(' } } },
    ]) {
      await assert.rejects(
        loadConfig({ cwd: fixture({}), env: {}, overrides }),
        (error) => error instanceof UsageError,
        JSON.stringify(overrides),
      );
    }
  });
});
