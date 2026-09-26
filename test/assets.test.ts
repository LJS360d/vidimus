import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const png = (width: number, height: number) => {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const head = ({
  icon = '<link rel="icon" href="/icon.svg"><link rel="apple-touch-icon" href="/touch.png">',
  manifest = '<link rel="manifest" href="/app/site.webmanifest">',
  ogImage = 'https://example.com/og.png',
  extra = '',
} = {}) => `<!doctype html><head>${icon}${manifest}
<meta property="og:title" content="Home">
<meta property="og:image" content="${ogImage}">
<meta property="og:url" content="https://example.com/">
<meta name="twitter:card" content="summary_large_image">${extra}</head>`;

const manifest = JSON.stringify({
  name: 'Site',
  icons: [{ src: 'icon-512.png' }, { src: '/icon.svg', sizes: '192x192' }],
});

const site = (overrides: Record<string, string | undefined> = {}, images = {}) => {
  const files = Object.fromEntries(
    Object.entries({
      'dist/index.html': head(),
      'dist/about/index.html': head(),
      'dist/404.html': '<p>Not found</p>',
      'dist/icon.svg': '<svg width="32" height="32"></svg>',
      'dist/app/site.webmanifest': manifest,
      'vidimus.config.json': JSON.stringify({ siteUrl: 'https://example.com' }),
      ...overrides,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const cwd = fixture(files);
  const binary: Record<string, Buffer> = {
    'dist/touch.png': png(180, 180),
    'dist/app/icon-512.png': png(512, 512),
    'dist/og.png': png(1200, 630),
    ...images,
  };
  for (const [path, content] of Object.entries(binary)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
  return cwd;
};

const audit = async (cwd: string) => {
  const { results } = await run({ cwd, env: {}, audits: ['assets'], reporters: [] });
  const result = results[0];
  assert.ok(result);
  return {
    ...result,
    messages: result.findings.map(({ message, severity }) => `${severity ?? 'error'}: ${message}`),
  };
};

describe('assets audit', () => {
  it('passes a complete site', async () => {
    const result = await audit(site());
    assert.deepEqual(result.messages, []);
    assert.equal(result.status, 'passed');
  });

  it('fails without any favicon and warns without apple-touch-icon', async () => {
    const result = await audit(
      site({ 'dist/index.html': head({ icon: '' }), 'dist/about/index.html': head({ icon: '' }) }),
    );
    assert.deepEqual(result.messages, [
      'error: no favicon: add <link rel="icon"> or /favicon.ico',
      'warn: no <link rel="apple-touch-icon"> on any page',
    ]);
  });

  it('accepts /favicon.ico and reports broken icon hrefs grouped', async () => {
    const icon = '<link rel="shortcut icon" href="img/missing.png">';
    const cwd = site({
      'dist/index.html': head({ icon }),
      'dist/about/index.html': head({ icon: '<link rel="icon" href="/missing.png">' }),
      'dist/favicon.ico': 'ico',
      'dist/apple-touch-icon.png': 'png',
    });
    const result = await audit(cwd);
    assert.deepEqual(result.messages, [
      'error: icon /missing.png not found',
      'error: icon /img/missing.png not found',
    ]);
    assert.deepEqual(result.findings[1]?.where, ['/']);
  });

  it('reports a missing manifest file', async () => {
    const result = await audit(site({ 'dist/app/site.webmanifest': undefined }));
    assert.deepEqual(result.messages, ['error: manifest /app/site.webmanifest not found']);
    assert.deepEqual(result.findings[0]?.where, ['/about/', '/']);
  });

  it('reports an invalid manifest', async () => {
    const result = await audit(site({ 'dist/app/site.webmanifest': '{ nope' }));
    assert.deepEqual(result.messages, ['error: manifest /app/site.webmanifest is not valid JSON']);
    const empty = await audit(site({ 'dist/app/site.webmanifest': '{"icons":[]}' }));
    assert.deepEqual(empty.messages, [
      'error: manifest /app/site.webmanifest has no name or short_name',
      'error: manifest /app/site.webmanifest has no icons',
    ]);
  });

  it('reports missing manifest icons and the lack of a 512px icon', async () => {
    const icons = [{ src: 'gone.png' }, { src: '/icon.svg', sizes: '192x192' }];
    const result = await audit(
      site({ 'dist/app/site.webmanifest': JSON.stringify({ short_name: 'S', icons }) }),
    );
    assert.deepEqual(result.messages, [
      'error: manifest icon /app/gone.png not found',
      'warn: manifest /app/site.webmanifest has no icon of at least 512x512',
    ]);
  });

  it('fails a relative og:image and a missing one', async () => {
    const page = head({ ogImage: '/og.png' });
    const result = await audit(site({ 'dist/index.html': page, 'dist/about/index.html': page }));
    assert.deepEqual(result.messages, ['error: og:image "/og.png" is not an absolute URL']);
    const unreadable = await audit(site({}, { 'dist/og.png': Buffer.from('') }));
    assert.deepEqual(unreadable.messages, []);
    const gone = head({ ogImage: 'https://example.com/gone.png' });
    const absent = await audit(site({ 'dist/index.html': gone }));
    assert.deepEqual(absent.messages, ['error: og:image /gone.png not found']);
  });

  it('warns about a small og:image and missing social tags', async () => {
    const bare = '<!doctype html><link rel="icon" href="/icon.svg">';
    const result = await audit(
      site(
        {
          'dist/about/index.html': bare,
          'dist/hidden.html': `${bare}<meta name="robots" content="noindex">`,
        },
        { 'dist/og.png': png(600, 315) },
      ),
    );
    assert.deepEqual(result.messages, [
      'warn: missing <meta property="og:title">',
      'warn: missing <meta property="og:image">',
      'warn: missing <meta property="twitter:card">',
      'warn: og:image /og.png is 600x315, smaller than 1200x630',
    ]);
    assert.deepEqual(result.findings[0]?.where, ['/about/']);
  });

  it('fails an og:url on another origin', async () => {
    const extra = '<meta property="og:url" content="https://staging.example.com/">';
    const page = head().replace('<meta property="og:url" content="https://example.com/">', extra);
    const result = await audit(site({ 'dist/index.html': page }));
    assert.deepEqual(result.messages, [
      'error: og:url origin https://staging.example.com differs from siteUrl https://example.com',
    ]);
  });

  it('warns without a 404 page', async () => {
    const result = await audit(site({ 'dist/404.html': undefined }));
    assert.equal(result.status, 'warned');
    assert.deepEqual(result.messages, ['warn: no 404 page (404.html or 404/index.html)']);
  });
});
