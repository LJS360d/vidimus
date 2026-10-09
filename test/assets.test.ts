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
<meta property="og:image:alt" content="Logo">
<meta property="og:url" content="https://example.com/">
<meta name="twitter:card" content="summary_large_image">${extra}</head>`;

const manifest = JSON.stringify({
  name: 'Site',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  icons: [
    { src: 'icon-512.png', sizes: '512x512', purpose: 'any maskable' },
    { src: '/icon.svg', sizes: '192x192' },
  ],
});

const site = (overrides: Record<string, string | undefined> = {}, images = {}) => {
  const files = Object.fromEntries(
    Object.entries({
      'dist/index.html': head(),
      'dist/about/index.html': head(),
      'dist/404.html': '<p>Not found</p>',
      'dist/icon.svg': '<svg width="192" height="192"></svg>',
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

  it('warns when no page links a manifest', async () => {
    const page = head({ manifest: '' });
    const result = await audit(site({ 'dist/index.html': page, 'dist/about/index.html': page }));
    assert.deepEqual(result.messages, ['warn: no <link rel="manifest"> on any page']);
    const external = head({
      manifest: '<link rel="manifest" href="https://cdn.example.org/m.json">',
    });
    const linked = await audit(
      site({ 'dist/index.html': external, 'dist/about/index.html': page }),
    );
    assert.deepEqual(linked.messages, []);
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
    const icons = [
      { src: 'gone.png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: '192x192' },
    ];
    const result = await audit(
      site({
        'dist/app/site.webmanifest': JSON.stringify({
          short_name: 'S',
          start_url: '/',
          scope: '/',
          icons,
        }),
      }),
    );
    assert.deepEqual(result.messages, [
      'error: manifest icon /app/gone.png not found',
      'warn: manifest /app/site.webmanifest has no icon of at least 512x512',
    ]);
  });

  it('measures a manifest icon instead of trusting its declared sizes', async () => {
    const icons = [{ src: 'icon-192.png', sizes: '192x192', purpose: 'maskable' }];
    const result = await audit(
      site(
        {
          'dist/app/site.webmanifest': JSON.stringify({
            short_name: 'S',
            start_url: '/',
            scope: '/',
            icons,
          }),
        },
        { 'dist/app/icon-192.png': png(192, 192) },
      ),
    );
    assert.deepEqual(result.messages, [
      'warn: manifest /app/site.webmanifest has no icon of at least 512x512',
    ]);
  });

  it('validates manifest start_url, display, maskable icon and declared sizes', async () => {
    const manifest = {
      name: 'S',
      start_url: '/elsewhere/',
      scope: '/app/',
      display: 'huge',
      icons: [{ src: 'icon-512.png', sizes: '192x192' }],
    };
    const result = await audit(site({ 'dist/app/site.webmanifest': JSON.stringify(manifest) }));
    assert.deepEqual(result.messages, [
      'error: manifest /app/site.webmanifest start_url /elsewhere/ is outside scope /app/',
      'error: manifest /app/site.webmanifest display "huge" is not valid',
      'warn: manifest /app/site.webmanifest has no maskable icon',
      'warn: manifest icon /app/icon-512.png declares 192x192 but is 512x512',
    ]);
    const missing = await audit(
      site({
        'dist/app/site.webmanifest': JSON.stringify({ ...manifest, scope: '/', start_url: '/x/' }),
      }),
    );
    assert.ok(missing.messages.includes('error: manifest start_url /x/ not found'));
    assert.ok(result.findings.every((finding) => finding.fix));
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
      'warn: missing <meta name="twitter:card">',
      'warn: og:image /og.png is 600x315, smaller than 1200x630',
    ]);
    assert.deepEqual(result.findings[0]?.where, ['/about/']);
  });

  it('flags an og:image in an unsupported format or over the byte limit', async () => {
    const svg = head({ ogImage: 'https://example.com/og.svg' });
    const vector = await audit(
      site({ 'dist/index.html': svg, 'dist/og.svg': '<svg width="1200" height="630"></svg>' }),
    );
    assert.deepEqual(vector.messages, [
      'error: og:image /og.svg is SVG, which social crawlers do not accept',
    ]);
    const mb = (count: number) =>
      Buffer.concat([png(1200, 630), Buffer.alloc(count * 1024 * 1024)]);
    const heavy = await audit(site({}, { 'dist/og.png': mb(2) }));
    assert.deepEqual(heavy.messages, ['warn: og:image /og.png is 2.0 MB, over the 1 MB limit']);
    const huge = await audit(site({}, { 'dist/og.png': mb(9) }));
    assert.deepEqual(huge.messages, ['error: og:image /og.png is 9.0 MB, over the 8 MB limit']);
  });

  it('checks og:image:alt, og:image dimensions and twitter:image', async () => {
    const bare = head().replace('<meta property="og:image:alt" content="Logo">\n', '');
    const missingAlt = await audit(site({ 'dist/index.html': bare }));
    assert.deepEqual(missingAlt.messages, [
      'warn: missing <meta property="og:image:alt"> for og:image',
    ]);
    const sized = head({
      extra:
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="600">',
    });
    const wrong = await audit(site({ 'dist/index.html': sized }));
    assert.deepEqual(wrong.messages, ['warn: og:image:height is 600 but /og.png is 630']);
    const twitter = (path: string) =>
      head({ extra: `<meta name="twitter:image" content="https://example.com${path}">` });
    const gone = await audit(site({ 'dist/index.html': twitter('/gone.png') }));
    assert.deepEqual(gone.messages, ['error: twitter:image /gone.png not found']);
    const vector = await audit(
      site({
        'dist/index.html': twitter('/t.svg'),
        'dist/t.svg': '<svg width="10" height="10"></svg>',
      }),
    );
    assert.deepEqual(vector.messages, [
      'error: twitter:image /t.svg is SVG, which social crawlers do not accept',
    ]);
    const fine = await audit(site({ 'dist/index.html': twitter('/og.png') }));
    assert.deepEqual(fine.messages, []);
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

  it('gives every finding a fix', async () => {
    const page =
      '<!doctype html><link rel="icon" href="/gone.svg"><link rel="manifest" href="/m.json"><meta property="og:image" content="/small.png"><meta property="og:url" content="https://other.example/">';
    const cwd = site(
      {
        'dist/index.html': page,
        'dist/about/index.html': page,
        'dist/404.html': undefined,
        'dist/m.json': JSON.stringify({ icons: [{ src: '/nope.png' }] }),
      },
      { 'dist/small.png': png(100, 100) },
    );
    const result = await audit(cwd);
    assert.ok(result.findings.length >= 10);
    for (const { fix } of result.findings) assert.ok(fix?.trim());
    const relative = result.findings.find(({ message }) => message.includes('not an absolute'));
    assert.match(relative?.fix ?? '', /content="https:\/\/example\.com\/small\.png"/);
    const bare = await audit(
      site({ 'dist/index.html': '<!doctype html>', 'dist/about/index.html': '<!doctype html>' }),
    );
    assert.ok(bare.findings.length >= 2);
    for (const { fix } of bare.findings) assert.ok(fix?.trim());
  });
});
