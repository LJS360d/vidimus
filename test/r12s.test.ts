import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { r12s } from '../src/audits/r12s.ts';
import { defaults } from '../src/config/defaults.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const browserPath = async () => {
  try {
    const { default: puppeteer } = await import('puppeteer');
    return await puppeteer.executablePath();
  } catch {
    return '';
  }
};

const executable = await browserPath();
const noBrowser = !executable || !existsSync(executable);

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const page = (viewport: string, body: string) => `<!doctype html>
<html lang="en"><head><title>t</title><meta name="viewport" content="${viewport}"></head>
<body style="font-size:16px">${body}</body></html>`;

describe('r12s audit', () => {
  it('skips unrendered text, inline links and screen-reader-only links, and allows zoom above 1', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(
        'width=device-width, initial-scale=1, maximum-scale=1.5',
        '<a href="#main" style="position:absolute;top:20px;left:20px;width:1px;height:1px;padding:8px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%)">skip</a>' +
          '<a href="/x" style="display:inline-block;width:48px;height:48px">x</a>' +
          '<p>visible</p><ul style="display:none;font-size:8px"><li>hidden menu</li></ul>' +
          '<p>See <a href="/a">a</a> and <a href="/b">b</a> in a sentence.</p>',
      ),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['r12s'],
      reporters: [],
      overrides: { port: await freePort(), r12s: { viewports: [375] } },
    });
    assert.deepEqual(results[0]?.findings, []);
  });

  it('reports small text, crowded standalone links and locked zoom', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(
        'width=device-width, initial-scale=1, user-scalable=0',
        '<p style="font-size:8px">tiny</p><nav><a href="/a">a</a><a href="/b">b</a></nav>',
      ),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['r12s'],
      reporters: [],
      overrides: { port: await freePort(), r12s: { viewports: [375] } },
    });
    const messages = results[0]?.findings.map(({ message }) => message) ?? [];
    assert.ok(
      messages.some((message) => message.startsWith('font-size')),
      messages.join('\n'),
    );
    assert.ok(
      messages.some((message) => message.includes('pinch zoom')),
      messages.join('\n'),
    );
    assert.ok(
      messages.some((message) => message.startsWith('target-size')),
      messages.join('\n'),
    );
  });

  it('reports pages that fail to load instead of erroring', { skip: noBrowser }, async () => {
    const cwd = fixture({ 'dist/index.html': page('width=device-width', '<p>slow</p>') });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['r12s'],
      reporters: [],
      overrides: { port: await freePort(), r12s: { viewports: [320, 375], timeout: 1 } },
    });
    const result = results[0];
    assert.equal(result?.status, 'failed');
    assert.equal(result?.findings[0]?.message, 'failed to load /');
    assert.match(result?.findings[0]?.details?.[0] ?? '', /^@320\/375px: /);
    assert.match(result?.summary ?? '', /1 page\(s\) failed to load/);
  });

  it('turns a setViewport failure into a per-page finding', async () => {
    const cwd = fixture({});
    const config = defaults(cwd);
    config.r12s.viewports = [375];
    const page = {
      setViewport: async () => {
        throw new Error('viewport boom');
      },
      close: async () => {},
    };
    const browser = { newPage: async () => page, close: async () => {} };
    const result = await r12s.run({
      config,
      origin: 'http://localhost:1',
      pageUrls: () => ['http://localhost:1/'],
      launchBrowser: async () => browser,
      log: () => {},
    } as never);
    assert.equal(result.findings?.[0]?.message, 'failed to load /');
    assert.deepEqual(result.findings?.[0]?.details, ['@375px: viewport boom']);
    assert.ok(result.findings?.[0]?.fix);
  });
});
