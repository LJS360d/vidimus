import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
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
