import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type StaticServer, serve } from '../src/core/server.ts';
import { fixture } from './helpers.ts';

const PORT = 4399;

const get = (path: string, headers: Record<string, string> = {}, port = PORT) =>
  new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      request({ host: '127.0.0.1', port, path, headers }, (res) => {
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
    'dist/_astro/app.js': 'js',
    'dist/app.wasm': 'wasm',
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

  it('applies header rules and gzip', async () => {
    const res = await get('/_astro/app.js', { 'accept-encoding': 'gzip' });
    assert.equal(res.headers['cache-control'], 'immutable');
    assert.equal(res.headers['content-encoding'], 'gzip');
  });

  it('refuses paths outside the build', async () => {
    assert.equal((await get('/%2e%2e/secret.txt')).status, 404);
    assert.equal((await get('/missing')).status, 404);
  });

  it('serves wasm as application/wasm', async () => {
    assert.equal((await get('/app.wasm')).headers['content-type'], 'application/wasm');
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
  });

  it('sends the configured status, GitHub Pages style', async () => {
    const port = await start({ fallback: '404.html', fallbackStatus: 404 });
    const res = await get('/deep/route', {}, port);
    assert.equal(res.status, 404);
    assert.equal(res.body, 'not found page');
  });

  it('serves the fallback under the base path of siteUrl', async () => {
    const port = await start({}, 'https://user.github.io/project');
    const res = await get('/project/deep/route', {}, port);
    assert.equal(res.status, 200);
    assert.equal(res.body, 'shell');
    assert.equal((await get('/project/missing.js', {}, port)).status, 404);
  });
});
