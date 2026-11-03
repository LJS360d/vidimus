import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createHeaderSource, redirectMatches, redirectSources } from '../src/core/headers.ts';

const project = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), 'vidimus-headers-'));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return { root, dist };
};

describe('host config headers', () => {
  it('reports unsupported patterns per file', () => {
    const { root, dist } = project({
      'vercel.json': JSON.stringify({
        headers: [{ source: '/(a|b)', headers: [{ key: 'X-A', value: '1' }] }],
      }),
      'firebase.json': JSON.stringify({
        hosting: { headers: [{ source: '/ok', headers: [{ key: 'X-B', value: '2' }] }] },
      }),
    });
    const source = createHeaderSource(root, dist, '_headers', '');
    assert.deepEqual(source.notes, ['ignored 1 unsupported patterns in vercel.json: /(a|b)']);
    assert.deepEqual(source.sources, ['vercel.json', 'firebase.json']);
  });

  it('does not apply vercel header rules gated by has or missing', async () => {
    const { root, dist } = project({
      'vercel.json': JSON.stringify({
        headers: [
          { source: '/(.*)', headers: [{ key: 'X-Always', value: '1' }] },
          {
            source: '/:path*',
            has: [{ type: 'query', key: 'authorized' }],
            headers: [{ key: 'X-Authorized', value: 'true' }],
          },
        ],
      }),
    });
    const source = createHeaderSource(root, dist, '_headers', '');
    assert.deepEqual(await source.for('/page'), { 'x-always': '1' });
    assert.deepEqual(source.notes, ['ignored 1 unsupported patterns in vercel.json: /:path*']);
  });

  it('collects and matches redirect sources', () => {
    const { root, dist } = project({
      'vercel.json': JSON.stringify({ redirects: [{ source: '/old/:slug', destination: '/new' }] }),
      'netlify.toml': '[[redirects]]\nfrom = "/legacy/*"\nto = "/"\n',
    });
    const sources = redirectSources(root, dist);
    assert.deepEqual(sources, ['/old/:slug', '/legacy/*']);
    assert.ok(redirectMatches(sources, '/old/page'));
    assert.ok(redirectMatches(sources, '/legacy/a/b'));
    assert.ok(!redirectMatches(sources, '/other'));
  });
});

describe('live header fetch', () => {
  let server: Server;
  let origin = '';

  before(async () => {
    server = createServer((req, res) => {
      if (req.method === 'HEAD') {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(200, { 'x-frame-options': 'DENY' }).end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('retries with GET when HEAD is refused with a non-405 status', async () => {
    const { root, dist } = project({});
    const source = createHeaderSource(root, dist, '_headers', origin);
    const headers = await source.for('/');
    assert.equal(headers?.['x-frame-options'], 'DENY');
  });
});
