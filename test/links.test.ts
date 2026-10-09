import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('links skip', () => {
  it('checks absolute self-links against the build when external links are off', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="https://example.org/old/">old</a>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { siteUrl: 'https://example.org', links: { checkExternal: false } },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message.replace(/:\d+/, '')),
      ['404 http://localhost/old/'],
    );
  });
});

describe('links options', () => {
  it('warns on redirects when warnRedirects is on', async () => {
    const cwd = fixture({
      'dist/index.html': '<title>home</title><h1>x</h1><a href="/new">new</a>',
      'dist/new/index.html': '<title>new</title><h1>x</h1>',
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['links'],
      reporters: [],
      overrides: { links: { checkExternal: false, warnRedirects: true } },
    });
    const [finding] = results[0]?.findings ?? [];
    assert.equal(finding?.severity, 'warn');
    assert.match(finding?.message ?? '', /^redirect .*\/new /);
  });
});
