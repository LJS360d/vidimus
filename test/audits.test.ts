import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const hash = (body: string) => `sha256-${createHash('sha256').update(body).digest('base64')}`;

describe('csp audit', () => {
  const allowed = 'console.log(1)';
  const page = (policy: string) => `<!doctype html>
<meta http-equiv="content-security-policy" content="${policy}">
<script>${allowed}</script>
<script type="application/ld+json">{"@type":"Thing"}</script>
<style>body{color:red}</style>`;

  it('flags inline blocks whose hash is missing', async () => {
    const cwd = fixture({
      'dist/index.html': page(`script-src '${hash(allowed)}'; style-src 'self'`),
    });
    const { ok, results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
    assert.equal(ok, false);
    assert.equal(results[0]?.findings.length, 1);
    assert.match(results[0]?.findings[0]?.message ?? '', /inline <style>/);
    assert.equal(
      results[0]?.findings[0]?.fix,
      `Add '${hash('body{color:red}')}' to style-src in the meta CSP, or move the code to a file.`,
    );
  });

  it('passes when every block is hashed', async () => {
    const policy = `script-src '${hash(allowed)}'; style-src '${hash('body{color:red}')}'`;
    const cwd = fixture({ 'dist/index.html': page(policy) });
    const { ok } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
    assert.equal(ok, true);
  });

  it('checks hashes per effective directive', async () => {
    const sha512 = (body: string) => `sha512-${createHash('sha512').update(body).digest('base64')}`;
    const css = 'body{color:red}';
    const count = async (policy: string, html = page(policy)) => {
      const cwd = fixture({ 'dist/index.html': html });
      const { results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
      return results[0]?.findings.length ?? 0;
    };
    assert.equal(await count(`script-src '${hash(allowed)}'`), 0);
    assert.equal(await count('upgrade-insecure-requests'), 0);
    assert.equal(await count("script-src 'unsafe-inline'; style-src 'unsafe-inline'"), 0);
    assert.equal(await count(`default-src 'self' '${hash(allowed)}' '${hash(css)}'`), 0);
    assert.equal(await count(`script-src '${sha512(allowed)}'; style-src '${sha512(css)}'`), 0);
    assert.equal(await count("default-src 'self'; script-src 'unsafe-inline'"), 1);
    const template = `<meta http-equiv="content-security-policy" content="script-src '${hash(allowed)}'">
<script>${allowed}</script><script type="text/x-template"><b>hi</b></script>`;
    assert.equal(await count('', template), 0);
  });

  it('flags style attributes, event handlers and javascript: URLs the CSP blocks', async () => {
    const markup = `<p style="color:red" onclick="go()"><a href="javascript:void(0)">x</a></p>`;
    const count = async (policy: string) => {
      const cwd = fixture({ 'dist/index.html': page(policy) + markup });
      const { results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
      return (
        results[0]?.findings.filter(({ message }) => /^inline \w+= attr/.test(message)).length ?? 0
      );
    };
    assert.equal(await count("script-src 'self'; style-src 'self'"), 3);
    assert.equal(await count("default-src 'self'"), 3);
    assert.equal(await count("script-src 'unsafe-inline'; style-src 'unsafe-inline'"), 0);
    assert.equal(await count("script-src 'self'; style-src-attr 'unsafe-inline'"), 2);
    assert.equal(await count("script-src-attr 'unsafe-inline'; script-src 'self'"), 1);
  });

  it('checks uppercase tags and data-src, and ignores commented-out blocks', async () => {
    const policy = `script-src '${hash(allowed)}'`;
    const cwd = fixture({
      'dist/index.html': `<meta http-equiv="content-security-policy" content="${policy}">
<!-- <script>commented()</script> -->
<SCRIPT>upper()</SCRIPT>
<script data-src="/lazy.js">inline()</script>
<script src="/app.js"></script>`,
    });
    const { results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
    assert.deepEqual(
      results[0]?.findings.map(({ details }) => details?.[0]),
      ['upper()…', 'inline()…'],
    );
  });

  it('reads a multi-line meta CSP with content before http-equiv', async () => {
    const cwd = fixture({
      'dist/index.html': `<!doctype html>
<meta
  content="script-src 'self'"
  http-equiv=content-security-policy>
<script>${allowed}</script>`,
    });
    const { results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
    assert.match(results[0]?.findings[0]?.message ?? '', /inline <script> has no CSP hash/);
  });

  it('skips when no page declares a CSP', async () => {
    const cwd = fixture({ 'dist/index.html': '<p>hi</p>' });
    const { results } = await run({ cwd, env: {}, audits: ['csp'], reporters: [] });
    assert.equal(results[0]?.status, 'skipped');
  });
});

describe('i18n audit', () => {
  it('reports missing, unknown and empty keys without a build', async () => {
    const cwd = fixture({
      'locales/en.json': JSON.stringify({ a: 'Hello', nested: { b: 'World' }, c: 'Bye' }),
      'locales/it.json': JSON.stringify({ a: 'Ciao', nested: { b: '' }, extra: 'x' }),
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'it'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.json' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    const messages = results[0]?.findings.map(({ message }) => message);
    assert.deepEqual(messages, [
      'it: 1 missing key(s)',
      'it: 1 unknown key(s)',
      'it: 1 empty key(s)',
    ]);
    assert.deepEqual(results[0]?.findings[0]?.details, ['c']);
    assert.deepEqual(
      results[0]?.findings.map(({ fix }) => fix),
      [
        'Add these keys to locales/it.json.',
        'Remove them or add them to the en file first.',
        'Translate them in locales/it.json, or copy the en text until a translation is ready.',
      ],
    );
  });

  it('treats keys named like Object.prototype members as ordinary keys', async () => {
    const cwd = fixture({
      'locales/en.json': JSON.stringify({ constructor: 'Build', toString: 'Text' }),
      'locales/it.json': JSON.stringify({ toString: '' }),
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'it'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.json' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    assert.deepEqual(
      results[0]?.findings.map(({ message, details }) => [message, details]),
      [
        ['it: 1 missing key(s)', ['constructor']],
        ['it: 1 empty key(s)', ['toString']],
      ],
    );
  });

  it('names the file of a malformed translation', async () => {
    const cwd = fixture({
      'locales/en.json': '{ nope',
      'vidimus.config.json': JSON.stringify({
        locales: ['en', 'it'],
        defaultLocale: 'en',
        i18n: { files: 'locales/{locale}.json' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['i18n'], reporters: [] });
    assert.equal(results[0]?.status, 'errored');
    assert.match(results[0]?.summary ?? '', /en\.json: /);
  });

  it('is skipped when not configured', async () => {
    const { results } = await run({ cwd: fixture({}), env: {}, audits: ['i18n'], reporters: [] });
    assert.equal(results[0]?.status, 'skipped');
  });
});

describe('runner', () => {
  it('rejects unknown audits', async () => {
    await assert.rejects(run({ cwd: fixture({}), env: {}, audits: ['nope'], reporters: [] }), {
      name: 'UsageError',
    });
  });

  it('runs plugin audits and reports thrown errors as errored', async () => {
    const cwd = fixture({});
    const { ok, results } = await run({
      cwd,
      env: {},
      audits: ['boom'],
      reporters: [],
      overrides: {
        plugins: [
          {
            name: 'boom',
            description: 'always throws',
            requires: 'source',
            run: async () => {
              throw new Error('kaput');
            },
          },
        ],
      },
    });
    assert.equal(ok, false);
    assert.equal(results[0]?.status, 'errored');
    assert.equal(results[0]?.summary, 'kaput');
  });

  it('requires a build for dist audits', async () => {
    await assert.rejects(
      run({ cwd: fixture({}), env: {}, audits: ['csp'], reporters: [] }),
      /no build output/,
    );
  });
});
