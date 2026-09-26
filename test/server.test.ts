import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { type StaticServer, serve } from '../src/core/server.ts';
import { fixture } from './helpers.ts';

const PORT = 4399;

const get = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      request({ host: '127.0.0.1', port: PORT, path, headers }, (res) => {
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
    'secret.txt': 'nope',
  });

  before(async () => {
    server = await serve(join(root, 'dist'), PORT, {
      gzip: true,
      headers: [{ match: '^/_astro/', headers: { 'cache-control': 'immutable' } }],
    });
  });

  after(() => server.close());

  it('resolves directories and extensionless paths', async () => {
    assert.equal((await get('/')).body, 'home');
    assert.equal((await get('/about/')).body, 'about');
    assert.equal((await get('/contact')).body, 'contact');
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
});
