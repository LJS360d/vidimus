import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { RENDERED_HEADER, type StaticServer, serve } from '../src/core/server.ts';
import { fixture } from './helpers.ts';

const PORT = 4399;

const get = (path: string, headers: Record<string, string> = {}, port = PORT, method = 'GET') =>
  new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      request({ host: '127.0.0.1', port, path, headers, method }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      })
        .on('error', reject)
        .end();
    },
  );

describe('static server', () => {
  let server: StaticServer;
  const root = fixture({
    'dist/index.html': 'home',
    'dist/about/index.html': 'about',
    'dist/contact.html': 'contact',
    'dist/latin.html': Buffer.from('<meta charset="windows-1252"><title>caf\xe9</title>', 'latin1'),
    'dist/_astro/app.js': 'js',
    'dist/app.wasm': 'wasm',
    'dist/legacy.htm': Buffer.from('<meta charset="windows-1252"><title>caf\xe9</title>', 'latin1'),
    'dist/data.csv': 'a,b',
    'dist/feed.rss': '<rss/>',
    'dist/archive.zip': 'zip',
    'dist/data.json': '{}',
    'dist/favicon.ico': 'ico',
    'dist/sound.wav': 'wav',
    'dist/LOGO.PNG': 'png',
    'dist/photo.jxl': 'jxl',
    'dist/live.m3u8': '#EXTM3U',
    'dist/org.jsonld': '{}',
    'secret.txt': 'nope',
  });

  before(async () => {
    server = await serve(join(root, 'dist'), PORT, {
      gzip: true,
      headers: [{ match: '^/_astro/', headers: { 'cache-control': 'immutable' } }],
      fallback: '',
      fallbackStatus: 200,
    });
  });

  after(() => server.close());

  it('serves HTML with its detected charset', async () => {
    assert.match(
      String((await get('/latin.html')).headers['content-type']),
      /charset=windows-1252/,
    );
    assert.match(String((await get('/contact.html')).headers['content-type']), /charset=utf-8/);
  });

  it('resolves directories and extensionless paths', async () => {
    assert.equal((await get('/')).body, 'home');
    assert.equal((await get('/about/')).body, 'about');
    assert.equal((await get('/contact')).body, 'contact');
  });

  it('redirects directories without a trailing slash, like static hosts do', async () => {
    const res = await get('/about?x=1');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/about/?x=1');
    assert.equal((await get('/index.html')).body, 'home');
    assert.equal((await get('/about/index')).body, 'about');
  });

  it('keeps the directory redirect revalidated, since a 301 is heuristically cacheable (RFC 9111 §4.2.2)', async () => {
    const res = await get('/about?x=1');
    assert.equal(res.status, 301);
    assert.equal(res.headers['cache-control'], 'no-cache');
  });

  it('applies header rules and gzip', async () => {
    const res = await get('/_astro/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(res.headers['cache-control'], 'immutable');
    assert.equal(res.headers['content-encoding'], 'gzip');
  });

  it('honours accept-encoding q-values when choosing gzip', async () => {
    const gzipped = async (acceptEncoding: string) =>
      (await get('/_astro/app.js', { 'accept-encoding': acceptEncoding })).headers[
        'content-encoding'
      ] === 'gzip';
    assert.equal(await gzipped('gzip;q=0'), false);
    assert.equal(await gzipped('gzip;q=0.5'), true);
    assert.equal(await gzipped('*;q=0'), false);
    assert.equal(await gzipped('gzip;q=0, *'), false);
    assert.equal(await gzipped('br, *;q=0.1'), true);
    assert.equal(await gzipped('x-gzip'), true);
  });

  it('refuses paths outside the build', async () => {
    assert.equal((await get('/%2e%2e/secret.txt')).status, 404);
    assert.equal((await get('/missing')).status, 404);
  });

  it('answers unsupported methods with 405 and an Allow header', async () => {
    const res = await new Promise<{ status: number; allow: unknown }>((resolve, reject) => {
      request({ host: '127.0.0.1', port: PORT, path: '/contact.html', method: 'POST' }, (r) => {
        r.resume();
        r.on('end', () => resolve({ status: r.statusCode ?? 0, allow: r.headers.allow }));
      })
        .on('error', reject)
        .end();
    });
    assert.equal(res.status, 405);
    assert.equal(res.allow, 'GET, HEAD');
    assert.equal((await get('/contact.html')).status, 200);
  });

  it('reads an origin-form target starting with // as a path, not a host', async () => {
    const res = await get('//contact.html');
    assert.equal(res.status, 200);
    assert.equal(res.body, 'contact');
  });

  it('collapses leading slashes in a directory redirect, so Location stays a path', async () => {
    const res = await get('//about');
    assert.equal(res.status, 301);
    assert.equal(res.headers.location, '/about/');
  });

  it('answers HEAD with the GET headers and no body', async () => {
    const res = await get('/contact.html', { 'accept-encoding': 'gzip' }, PORT, 'HEAD');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.equal(res.body, '');
  });

  it('matches file extensions case-insensitively', async () => {
    assert.equal((await get('/LOGO.PNG')).headers['content-type'], 'image/png');
  });

  it('serves wasm as application/wasm', async () => {
    assert.equal((await get('/app.wasm')).headers['content-type'], 'application/wasm');
  });

  it('serves .htm as HTML with its charset and common extensions with their registered types', async () => {
    const htm = await get('/legacy.htm');
    assert.match(String(htm.headers['content-type']), /^text\/html; charset=windows-1252/);
    assert.equal((await get('/data.csv')).headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal((await get('/feed.rss')).headers['content-type'], 'application/rss+xml');
    assert.equal((await get('/archive.zip')).headers['content-type'], 'application/zip');
    assert.equal((await get('/photo.jxl')).headers['content-type'], 'image/jxl');
    assert.equal(
      (await get('/live.m3u8')).headers['content-type'],
      'application/vnd.apple.mpegurl',
    );
    assert.equal((await get('/org.jsonld')).headers['content-type'], 'application/ld+json');
  });

  it('uses IANA-registered media type names, and no charset parameter on JSON (RFC 8259 §11, RFC 2361)', async () => {
    assert.equal((await get('/data.json')).headers['content-type'], 'application/json');
    assert.equal((await get('/favicon.ico')).headers['content-type'], 'image/vnd.microsoft.icon');
    assert.equal((await get('/sound.wav')).headers['content-type'], 'audio/wave');
  });
});

describe('static server rendered snapshots', () => {
  const root = fixture({ 'dist/index.html': 'shell' });
  let server: StaticServer;

  before(async () => {
    server = await serve(
      join(root, 'dist'),
      0,
      { gzip: false, headers: [], fallback: '', fallbackStatus: 200 },
      '',
      (pathname) => (pathname === '/' ? 'rendered' : undefined),
    );
  });

  after(() => server.close());

  it('answers tagged requests with the snapshot and others with the file', async () => {
    assert.equal((await get('/', { [RENDERED_HEADER]: '1' }, server.port)).body, 'rendered');
    assert.equal((await get('/', {}, server.port)).body, 'shell');
    assert.equal((await get('/other', { [RENDERED_HEADER]: '1' }, server.port)).status, 404);
  });
});

describe('static server SPA fallback', () => {
  const root = fixture({
    'dist/index.html': 'shell',
    'dist/404.html': 'not found page',
    'dist/app.js': 'js',
  });
  const options = {
    gzip: false,
    headers: [],
    fallback: 'index.html',
    fallbackStatus: 200 as const,
  };
  const servers: StaticServer[] = [];
  const start = async (overrides = {}, siteUrl = '') => {
    const server = await serve(join(root, 'dist'), 0, { ...options, ...overrides }, siteUrl);
    servers.push(server);
    return server.port;
  };

  after(() => Promise.all(servers.map((server) => server.close())));

  it('serves the fallback for deep routes and still 404s missing assets', async () => {
    const port = await start();
    const deep = await get('/deep/route', {}, port);
    assert.equal(deep.status, 200);
    assert.equal(deep.body, 'shell');
    assert.match(String(deep.headers['content-type']), /text\/html/);
    assert.equal((await get('/missing.js', {}, port)).status, 404);
    assert.equal((await get('/app.js', {}, port)).body, 'js');
  });

  it('serves the fallback for html navigations to dotted paths', async () => {
    const port = await start();
    assert.equal((await get('/v1.2', { accept: 'text/html' }, port)).body, 'shell');
    assert.equal((await get('/users/jane.doe', { accept: 'text/html' }, port)).body, 'shell');
  });

  it('404s a missing asset even when the client accepts html (RFC 9110 §15.5.5)', async () => {
    const port = await start();
    for (const path of ['/nope/x.js', '/missing.css', '/gone.avif']) {
      const res = await get(path, { accept: 'text/html,*/*' }, port);
      assert.equal(res.status, 404, path);
    }
  });

  it('sends the configured status, GitHub Pages style', async () => {
    const port = await start({ fallback: '404.html', fallbackStatus: 404 });
    const res = await get('/deep/route', {}, port);
    assert.equal(res.status, 404);
    assert.equal(res.body, 'not found page');
  });

  it('picks the fallback file by path with fallback rules', async () => {
    const port = await start(
      {
        fallback: [
          { match: '^/app/', file: '404.html' },
          { match: '^/', file: 'index.html' },
        ],
      },
      'https://user.github.io/project',
    );
    assert.equal((await get('/project/app/deep', {}, port)).body, 'not found page');
    assert.equal((await get('/project/other', {}, port)).body, 'shell');
    const none = await start({ fallback: [{ match: '^/app/', file: 'index.html' }] });
    assert.equal((await get('/other', {}, none)).status, 404);
  });

  it('serves the fallback under the base path of siteUrl', async () => {
    const port = await start({}, 'https://user.github.io/project');
    const res = await get('/project/deep/route', {}, port);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'shell');
    assert.equal((await get('/project/missing.js', {}, port)).status, 404);
  });

  it('does not serve the fallback outside the base path of siteUrl', async () => {
    const port = await start({}, 'https://user.github.io/project');
    const res = await get('/other/deep', { accept: 'text/html' }, port);
    assert.equal(res.status, 404);
    assert.equal(res.body, 'Not found');
  });
});

describe('static server vary', () => {
  const root = fixture({
    'dist/index.html': 'home',
    'dist/app.js': 'js',
    'dist/logo.png': 'png',
  });
  let server: StaticServer;

  before(async () => {
    server = await serve(join(root, 'dist'), 0, {
      gzip: true,
      headers: [{ match: '^/app', headers: { Vary: 'Origin' } }],
      fallback: '',
      fallbackStatus: 200,
    });
  });

  after(() => server.close());

  it('varies compressible responses on accept-encoding, merged with configured vary', async () => {
    assert.equal((await get('/index.html', {}, server.port)).headers.vary, 'accept-encoding');
    assert.equal((await get('/logo.png', {}, server.port)).headers.vary, undefined);
    assert.equal((await get('/app.js', {}, server.port)).headers.vary, 'Origin, accept-encoding');
  });
});

describe('static server failures', () => {
  const root = fixture({
    'dist/index.html': 'home',
    'dist/locked.txt': 'secret',
  });
  let server: StaticServer;

  before(async () => {
    chmodSync(join(root, 'dist/locked.txt'), 0);
    server = await serve(join(root, 'dist'), 0, {
      gzip: false,
      headers: [],
      fallback: '',
      fallbackStatus: 200,
    });
  });

  after(() => server.close());

  it('answers server faults with 500 before committing a success status', {
    skip: process.getuid?.() === 0,
  }, async () => {
    const res = await get('/locked.txt', {}, server.port);
    assert.equal(res.status, 500);
    assert.equal(res.body, 'Internal server error');
  });
});
