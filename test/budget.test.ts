import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { imageSize } from '../src/audits/image-size.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

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

describe('imageSize', () => {
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
