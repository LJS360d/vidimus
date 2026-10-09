import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { imageSize, imageSizeOf } from '../src/audits/image-size.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const browser = await import('puppeteer')
  .then(async ({ default: puppeteer }) => existsSync(await puppeteer.executablePath()))
  .catch(() => false);

const pngBuffer = (width: number, height: number, padding = 0) => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.alloc(padding)]);
};

const noise = (bytes: number) => randomBytes(bytes).toString('base64');

const audit = async (files: Record<string, string>, budget = {}, binary = {}) => {
  const cwd = fixture({ ...files, 'vidimus.config.json': JSON.stringify({ budget }) });
  for (const [path, content] of Object.entries<Buffer>(binary)) {
    writeFileSync(join(cwd, path), content);
  }
  const { results } = await run({ cwd, env: {}, audits: ['budget'], reporters: [] });
  const result = results[0];
  assert.ok(result);
  return result;
};

const img = '<img src="/a.png" width="10" height="10">';

describe('budget compression', () => {
  const files = {
    'dist/index.html': '<script src="/a.js"></script>',
    'dist/a.js': `//${noise(9000)}`,
    'dist/a.js.br': 'x'.repeat(50),
  };

  it('uses precompressed siblings and the configured codec', async () => {
    const sibling = await audit(files, { js: 100 });
    assert.deepEqual(sibling.findings, []);
    const { 'dist/a.js.br': _, ...plain } = files;
    const gzip = await audit(plain, { js: 100 });
    assert.match(gzip.findings[0]?.message ?? '', /gzipped/);
    const brotli = await audit(plain, { js: 100, compression: 'brotli' });
    assert.match(brotli.findings[0]?.message ?? '', /brotli/);
    const none = await audit(plain, { js: 100, compression: 'none' });
    assert.match(none.findings[0]?.message ?? '', /12 kB raw/);
  });
});

describe('imageSize', () => {
  it('swaps JPEG dimensions for EXIF orientations 5-8 and ignores malformed EXIF', () => {
    const jpegWith = (exif: Buffer) => {
      const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), exif]);
      app1.writeUInt16BE(app1.length - 2, 2);
      const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, 0, 100, 0, 200, 1, 1, 0x11, 0]);
      return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof]);
    };
    const exif = (orientation: number) => {
      const body = Buffer.alloc(8 + 2 + 12 + 4);
      body.write('MM', 0, 'latin1');
      body.writeUInt16BE(42, 2);
      body.writeUInt32BE(8, 4);
      body.writeUInt16BE(1, 8);
      body.writeUInt16BE(0x0112, 10);
      body.writeUInt16BE(3, 12);
      body.writeUInt32BE(1, 14);
      body.writeUInt16BE(orientation, 18);
      return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), body]);
    };
    assert.deepEqual(imageSize(jpegWith(exif(6))), { width: 100, height: 200, type: 'jpeg' });
    assert.deepEqual(imageSize(jpegWith(exif(1))), { width: 200, height: 100, type: 'jpeg' });
    const truncated = exif(6).subarray(0, 16);
    assert.deepEqual(imageSize(jpegWith(truncated)), { width: 200, height: 100, type: 'jpeg' });
  });

  it('reads PNG', () => {
    assert.deepEqual(imageSize(pngBuffer(640, 480)), { width: 640, height: 480, type: 'png' });
  });

  it('reads GIF', () => {
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1');
    assert.deepEqual(imageSize(gif), { width: 32, height: 16, type: 'gif' });
  });

  it('reads JPEG past APP segments', () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x58,
      0x03, 0x20, 0x03,
    ]);
    assert.deepEqual(imageSize(jpeg), { width: 800, height: 600, type: 'jpeg' });
  });

  it('reads WebP VP8, VP8L and VP8X', () => {
    const riff = (chunk: string, body: number[]) =>
      Buffer.concat([
        Buffer.from(`RIFF\0\0\0\0WEBP${chunk}\0\0\0\0`, 'latin1'),
        Buffer.from(body),
        Buffer.alloc(8),
      ]);
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x01, 0xf0, 0x00]);
    assert.deepEqual(imageSize(lossy), { width: 320, height: 240, type: 'webp' });
    const bits = 99 | (49 << 14);
    const lossless = riff('VP8L', [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, 0]);
    assert.deepEqual(imageSize(lossless), { width: 100, height: 50, type: 'webp' });
    const extended = riff('VP8X', [0, 0, 0, 0, 0xaf, 0x04, 0x00, 0x75, 0x02, 0x00]);
    assert.deepEqual(imageSize(extended), { width: 1200, height: 630, type: 'webp' });
  });

  it('reads AVIF dimensions from the primary item and accepts mif1 major brand', () => {
    const box = (type: string, ...parts: Buffer[]) => {
      const body = Buffer.concat(parts);
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length + 8, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const u32 = (...values: number[]) => {
      const out = Buffer.alloc(values.length * 4);
      for (const [index, value] of values.entries()) out.writeUInt32BE(value, index * 4);
      return out;
    };
    const ispe = (width: number, height: number) => box('ispe', u32(0, width, height));
    const build = (major: string, compatible: string) => {
      const ftyp = box(
        'ftyp',
        Buffer.from(major, 'latin1'),
        u32(0),
        Buffer.from(compatible, 'latin1'),
      );
      const pitm = box('pitm', u32(0), Buffer.from([0, 2]));
      const ipco = box('ipco', ispe(16, 16), ispe(64, 32));
      const ipma = box('ipma', u32(0, 1), Buffer.from([0, 2, 1, 2]));
      const meta = box('meta', u32(0), pitm, box('iprp', ipco, ipma));
      return Buffer.concat([ftyp, meta]);
    };
    assert.deepEqual(imageSize(build('avif', 'mif1')), { width: 64, height: 32, type: 'avif' });
    assert.deepEqual(imageSize(build('mif1', 'avif')), { width: 64, height: 32, type: 'avif' });
    assert.equal(imageSize(build('mif1', 'heic')), undefined);
    const full = build('mif1', 'avif');
    for (let cut = 0; cut < full.length; cut += 3) {
      assert.doesNotThrow(() => imageSize(full.subarray(0, cut)));
    }
    assert.equal(imageSize(full.subarray(0, 30)), undefined);
  });

  it('reads AVIF ispe box', () => {
    const avif = Buffer.alloc(40);
    avif.write('ftypavif', 4, 'latin1');
    avif.write('ispe', 20, 'latin1');
    avif.writeUInt32BE(64, 28);
    avif.writeUInt32BE(32, 32);
    assert.deepEqual(imageSize(avif), { width: 64, height: 32, type: 'avif' });
  });

  it('reads SVG attributes and viewBox', () => {
    const sized = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48px" height="24">');
    assert.deepEqual(imageSize(sized), { width: 48, height: 24, type: 'svg' });
    const boxed = Buffer.from('<?xml version="1.0"?><svg width="100%" viewBox="0 0 512 256">');
    assert.deepEqual(imageSize(boxed), { width: 512, height: 256, type: 'svg' });
    assert.equal(imageSize(Buffer.from('not an image')), undefined);
  });

  it('walks JPEG markers and rejects truncated or malformed files', () => {
    // SOI, a fill byte, a restart marker, an APP0 segment, then the frame header.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xff, 0xd0, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x11,
      0x08, 0x00, 0x20, 0x00, 0x40, 0x03,
    ]);
    assert.deepEqual(imageSize(jpeg), { width: 64, height: 32, type: 'jpeg' });
    assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0])), undefined);
    assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), undefined);
    const riff = Buffer.alloc(30);
    riff.write('RIFF', 0, 'latin1');
    riff.write('WEBPVP8?', 8, 'latin1');
    assert.equal(imageSize(riff), undefined);
    assert.equal(imageSize(Buffer.from('<svg viewBox="0 0 1">')), undefined);
    assert.equal(imageSizeOf('/no/such/file.png'), undefined);
  });
});

describe('budget audit', () => {
  it('passes a light page', async () => {
    const result = await audit(
      {
        'dist/index.html': `<link rel="stylesheet" href="/a.css"><script src="/a.js"></script>${img}`,
        'dist/a.css': 'body{}',
        'dist/a.js': 'console.log(1)',
      },
      {},
      { 'dist/a.png': pngBuffer(10, 10) },
    );
    assert.equal(result.status, 'passed');
    assert.match(result.summary, /^1 page\(s\), heaviest \/ /);
  });

  it('fails each exceeded budget with the biggest files', async () => {
    const result = await audit(
      {
        'dist/index.html': `<link rel="stylesheet" href="a.css"><link rel="modulepreload" href="/b.js">
<script src="/a.js"></script><script src="/a.js"></script>${img}<p>${noise(3000)}</p>`,
        'dist/a.css': `/*${noise(3000)}*/`,
        'dist/a.js': `//${noise(3000)}`,
        'dist/b.js': `//${noise(3000)}`,
      },
      { html: 2000, css: 2000, js: 5000, image: 1000, page: 12_000 },
      { 'dist/a.png': pngBuffer(10, 10, 2000) },
    );
    assert.equal(result.status, 'failed');
    const messages = result.findings.map(({ message }) => message);
    assert.equal(messages.length, 5);
    assert.match(messages[0] ?? '', /^html \d kB gzipped > 2 kB budget$/);
    assert.match(messages[1] ?? '', /^css \d kB gzipped > 2 kB budget$/);
    assert.match(messages[2] ?? '', /^js \d kB gzipped > 5 kB budget$/);
    assert.match(messages[3] ?? '', /^page 1\d kB total > 12 kB budget$/);
    assert.equal(messages[4], 'image /a.png 2 kB > 1 kB budget');
    assert.equal(result.findings[2]?.details?.length, 2);
    assert.equal(result.findings[3]?.details?.length, 3);
    assert.deepEqual(result.findings[4]?.where, ['/']);
  });

  it('never shows an exceeded image budget as equal to its limit', async () => {
    const over = await audit(
      { 'dist/index.html': img },
      { image: 250_000 },
      {
        'dist/a.png': pngBuffer(10, 10, 250_376),
      },
    );
    assert.equal(over.findings[0]?.message, 'image /a.png 250.4 kB > 250.0 kB budget');
    const mega = await audit(
      { 'dist/index.html': img },
      { image: 500_000 },
      {
        'dist/a.png': pngBuffer(10, 10, 1_000_000 - 24),
      },
    );
    assert.equal(mega.findings[0]?.message, 'image /a.png 1.0 MB > 500 kB budget');
  });

  it('counts preloaded and @font-face fonts in the page total', async () => {
    const result = await audit(
      {
        'dist/index.html': `<link rel="stylesheet" href="/css/a.css"><link rel="preload" as="font" href="/p.woff2">`,
        'dist/css/a.css': `@font-face{font-family:A;src:url(../f.woff2) format("woff2")}`,
        'dist/f.woff2': noise(4000),
        'dist/p.woff2': noise(4000),
      },
      { page: 6000 },
    );
    assert.equal(result.status, 'failed');
  });

  it('measures compressible SVG gzipped and PNG raw', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0h10v10z"/>'.repeat(500)}</svg>`;
    const page = (src: string) => `<img src="${src}" width="10" height="10">`;
    const light = await audit(
      { 'dist/index.html': page('/a.svg'), 'dist/a.svg': svg },
      { page: 3000 },
    );
    assert.equal(light.status, 'passed');
    const heavy = await audit(
      { 'dist/index.html': page('/a.png') },
      { page: 3000 },
      { 'dist/a.png': pngBuffer(10, 10, 4000) },
    );
    assert.equal(heavy.status, 'failed');
  });

  it('counts one candidate per picture and srcset', async () => {
    const result = await audit(
      {
        'dist/index.html': `<picture><source srcset="/b.png 1x, /c.png 2x"><img src="/a.png" srcset="/b.png 2x" width="10" height="10"></picture>`,
      },
      { page: 3000 },
      {
        'dist/a.png': pngBuffer(10, 10),
        'dist/b.png': pngBuffer(10, 10, 5000),
        'dist/c.png': pngBuffer(10, 10, 5000),
      },
    );
    assert.equal(result.status, 'passed');
  });

  it('skips nomodule scripts in the js total', async () => {
    const result = await audit(
      {
        'dist/index.html': `<script type="module" src="/modern.js"></script><script nomodule src="/legacy.js"></script>`,
        'dist/modern.js': 'console.log(1)',
        'dist/legacy.js': `//${noise(6000)}`,
      },
      { js: 2000 },
    );
    assert.equal(result.status, 'passed');
  });

  it('treats 0 as disabled', async () => {
    const result = await audit(
      {
        'dist/index.html': `<script src="/a.js"></script><img src="/a.png">`,
        'dist/a.js': noise(4000),
      },
      { html: 0, css: 0, js: 0, image: 0, page: 0, legacyImage: 0, dimensions: false },
      { 'dist/a.png': pngBuffer(10, 10, 200_000) },
    );
    assert.equal(result.status, 'passed');
  });

  it('warns about large legacy images once per file', async () => {
    const result = await audit(
      {
        'dist/index.html': img,
        'dist/about/index.html': `<img srcset="/a.png 1x, /a.png 2x" width="1" height="1">`,
      },
      { legacyImage: 1000 },
      { 'dist/a.png': pngBuffer(10, 10, 5000) },
    );
    assert.equal(result.status, 'warned');
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0]?.message, 'image /a.png is 5 kB: serve AVIF or WebP');
    assert.deepEqual(result.findings[0]?.where, ['/about/', '/']);
  });

  it('accepts legacy images with a modern picture source', async () => {
    const result = await audit(
      {
        'dist/index.html': `<picture><source type="image/avif" srcset="/a.avif">${img}</picture>
<picture><source srcset="/a.webp 1x">${img}</picture>`,
      },
      { legacyImage: 1000 },
      { 'dist/a.png': pngBuffer(10, 10, 5000) },
    );
    assert.equal(result.status, 'passed');
  });

  it('warns about images without dimensions unless sized or data URIs', async () => {
    const result = await audit({
      'dist/index.html': `<img src="/x.png"><img src="/x.png" width="5">
<img src="/y.png" width="1" height="1"><img src="/z.png" style="aspect-ratio: 1">
<img src="data:image/png;base64,AAAA">`,
      'dist/other.html': '<img src="/x.png">',
    });
    assert.equal(result.status, 'warned');
    assert.equal(result.findings.length, 1);
    assert.equal(
      result.findings[0]?.message,
      '<img src="/x.png"> has no width and height (layout shift)',
    );
    assert.deepEqual(result.findings[0]?.where, ['/', '/other.html']);
  });

  it('respects the exclude option and skips without pages', async () => {
    const result = await audit({ 'dist/index.html': '<img src="/x.png">' }, { exclude: ['^/$'] });
    assert.equal(result.status, 'skipped');
  });

  it('gives every finding a fix', async () => {
    const result = await audit(
      {
        'dist/index.html': `<link rel="stylesheet" href="/a.css"><script src="/a.js"></script>
<img src="/a.png"><p>${noise(3000)}</p>`,
        'dist/a.css': `/*${noise(3000)}*/`,
        'dist/a.js': `//${noise(3000)}`,
      },
      { html: 1000, css: 1000, js: 1000, image: 1000, page: 1000, legacyImage: 1000 },
      { 'dist/a.png': pngBuffer(64, 32, 5000) },
    );
    assert.equal(result.findings.length, 7);
    for (const { fix } of result.findings) assert.ok(fix?.trim());
    const dimensions = result.findings.find(({ message }) => message.includes('no width'));
    assert.match(dimensions?.fix ?? '', /width="64" height="32"/);
  });
});

describe('budget routes', () => {
  it('overrides limits for matching pages only', async () => {
    const files = {
      'dist/index.html': '<script src="/a.js"></script>',
      'dist/big/index.html': '<script src="/a.js"></script>',
      'dist/a.js': `//${noise(9000)}`,
    };
    const result = await audit(files, { js: 100, routes: { '^/big/': { js: 0 } } });
    assert.deepEqual(
      result.findings.map((f) => f.where),
      [['/']],
    );
  });
});

describe('budget request counts', { skip: !browser }, () => {
  it('flags pages over the request and third-party limits', async () => {
    const cwd = fixture({
      'dist/index.html':
        '<img src="/a.png" width="1" height="1"><img src="http://example.invalid/t.png" width="1" height="1"><img src="http://example.invalid/u.png" width="1" height="1">',
      'dist/a.png': 'x',
      'vidimus.config.json': JSON.stringify({
        budget: { requests: 2, thirdParty: 1, legacyImage: 0 },
        render: { mode: 'on' },
      }),
    });
    const { results } = await run({ cwd, env: {}, audits: ['budget'], reporters: [] });
    const messages = results[0]?.findings.map(({ message }) => message);
    assert.equal(messages?.length, 2);
    assert.match(messages?.[0] ?? '', /^\d+ requests > 2 budget$/);
    assert.equal(messages?.[1], '2 third-party requests > 1 budget');
  });
});
