import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isNoindex, localFile, meta, textOf } from '../src/core/html.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const page = (body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Page</title>
  </head>
  <body>
    ${body}
  </body>
</html>
`;

const duplicateIds = page('<p id="a">one</p>\n    <p id="a">two</p>');

const audit = async (files: Record<string, string>) => {
  const cwd = fixture(files);
  const { results } = await run({ cwd, env: {}, audits: ['html'], reporters: [] });
  const [result] = results;
  assert.ok(result);
  return result;
};

const config = (html: Record<string, unknown>) => JSON.stringify({ html });

describe('html audit', () => {
  it('passes a valid page', async () => {
    const result = await audit({ 'dist/index.html': page('<p>hello</p>') });
    assert.equal(result.status, 'passed');
    assert.equal(result.summary, '1 pages, valid');
  });

  it('groups the same problem across pages', async () => {
    const result = await audit({
      'dist/index.html': duplicateIds,
      'dist/about/index.html': duplicateIds,
    });
    assert.equal(result.status, 'failed');
    const finding = result.findings.find(({ message }) => message.startsWith('no-dup-id:'));
    assert.ok(finding);
    assert.deepEqual(finding.where, ['/about/', '/']);
    assert.equal(finding.file, undefined);
    assert.equal(finding.line, undefined);
    assert.match(finding.details?.[0] ?? '', /^\/about\/:9:\d+ /);
    assert.match(finding.details?.at(-1) ?? '', /^https:\/\/html-validate\.org\//);
  });

  it('reports misnested and unclosed elements', async () => {
    const result = await audit({ 'dist/index.html': page('<div><span>text</div>') });
    assert.equal(result.status, 'failed');
    assert.ok(result.findings.some(({ message }) => message.startsWith('close-order:')));
    assert.match(result.findings[0]?.file ?? '', /dist\/index\.html$/);
    assert.ok((result.findings[0]?.line ?? 0) > 0);
    assert.match(result.summary, /^1 pages, \d+ distinct problem\(s\)$/);
  });

  it('warns when a rule is set to warn', async () => {
    const result = await audit({
      'dist/index.html': duplicateIds,
      'vidimus.config.json': config({ rules: { 'no-dup-id': 'warn' } }),
    });
    assert.equal(result.status, 'warned');
    assert.equal(result.findings[0]?.severity, 'warn');
  });

  it('drops findings for rules turned off', async () => {
    const result = await audit({
      'dist/index.html': duplicateIds,
      'vidimus.config.json': config({ rules: { 'no-dup-id': 'off' } }),
    });
    assert.equal(result.status, 'passed');
  });

  it('honours .htmlvalidate.json in the project root', async () => {
    const result = await audit({
      'dist/index.html': page('<p>hello</p>\n    <p>trailing</p>   '),
      '.htmlvalidate.json': JSON.stringify({ rules: { 'no-trailing-whitespace': 'error' } }),
    });
    assert.deepEqual(
      result.findings.map(({ message }) => message.split(':')[0]),
      ['no-trailing-whitespace'],
    );
  });

  it('loads .htmlvalidate.mjs and .htmlvalidate.cjs and rejects a throwing one', async () => {
    const files = { 'dist/index.html': page('<p>hello</p>\n    <p>trailing</p>   ') };
    const rule = { rules: { 'no-trailing-whitespace': 'error' } };
    const names = async (extra: Record<string, string>) =>
      (await audit({ ...files, ...extra })).findings.map(({ message }) => message.split(':')[0]);
    assert.deepEqual(
      await names({ '.htmlvalidate.mjs': `export default ${JSON.stringify(rule)};` }),
      ['no-trailing-whitespace'],
    );
    assert.deepEqual(
      await names({ '.htmlvalidate.cjs': `module.exports = ${JSON.stringify(rule)};` }),
      ['no-trailing-whitespace'],
    );
    const broken = await audit({ ...files, '.htmlvalidate.mjs': "throw new Error('boom');" });
    assert.equal(broken.status, 'errored');
    assert.match(broken.summary, /\.htmlvalidate\.mjs: .*boom/);
  });

  it('rejects a malformed or non-object .htmlvalidate.json', async () => {
    const malformed = await audit({
      'dist/index.html': page('<p>hello</p>'),
      '.htmlvalidate.json': '{',
    });
    assert.equal(malformed.status, 'errored');
    assert.match(malformed.summary, /\.htmlvalidate\.json: /);

    const array = await audit({
      'dist/index.html': page('<p>hello</p>'),
      '.htmlvalidate.json': '[]',
    });
    assert.equal(array.status, 'errored');
    assert.match(array.summary, /\.htmlvalidate\.json: .*config object/);
  });

  it('applies rules on top of .htmlvalidate.json', async () => {
    const result = await audit({
      'dist/index.html': duplicateIds,
      '.htmlvalidate.json': JSON.stringify({ extends: ['html-validate:standard'] }),
      'vidimus.config.json': config({ rules: { 'no-dup-id': 'off' } }),
    });
    assert.equal(result.status, 'passed');
  });

  it('skips excluded pages', async () => {
    const result = await audit({
      'dist/index.html': page('<p>hello</p>'),
      'dist/broken/index.html': duplicateIds,
      'vidimus.config.json': config({ exclude: ['^/broken/'] }),
    });
    assert.equal(result.status, 'passed');
  });

  it('is skipped without pages', async () => {
    const result = await audit({ 'dist/asset.txt': 'x' });
    assert.equal(result.status, 'skipped');
  });

  it('gives every finding a fix', async () => {
    const result = await audit({
      'dist/index.html': page('<div><span>text</div>\n    <p id="a"><div id="a"></div></p><br/>'),
    });
    assert.ok(result.findings.length > 2);
    for (const { fix } of result.findings) assert.ok(fix?.trim());
    const dup = result.findings.find(({ message }) => message.startsWith('no-dup-id:'));
    assert.match(dup?.fix ?? '', /unique id.*html\.rules\["no-dup-id"\] to "off"/);
  });

  it('does not resolve the dist root to a sibling html file', () => {
    const root = fixture({
      'dist/about.html': page('<p>about</p>'),
      'dist.html': page('<p>outside</p>'),
    });
    const dist = join(root, 'dist');
    assert.equal(localFile(dist, ''), null);
    assert.equal(localFile(dist, '/.'), null);
    assert.equal(localFile(dist, '/'), null);
  });

  it('treats robots content none as noindex', () => {
    assert.equal(isNoindex('<meta name="robots" content="none">'), true);
    assert.equal(isNoindex('<meta name="googlebot" content="noindex, nofollow">'), true);
    assert.equal(isNoindex('<meta name="robots" content="nofollow">'), false);
  });

  it('matches meta by name or property', () => {
    assert.equal(meta('<meta name=image property=og:image content="a.png">', 'og:image'), 'a.png');
    assert.equal(meta('<meta name=description content="d">', 'description'), 'd');
  });
});

describe('textOf within', () => {
  it('falls back to the part before body when head is omitted', () => {
    assert.equal(textOf('<!doctype html><html><title>x</title><h1>y</h1>', 'title', 'head'), 'x');
    assert.equal(
      textOf('<html><body><svg><title>no</title></svg></body></html>', 'title', 'head'),
      undefined,
    );
    assert.equal(
      textOf('<html><title>x</title><body><svg><title>no</title></svg>', 'title', 'head'),
      'x',
    );
  });
});
