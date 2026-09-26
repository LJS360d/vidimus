import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { UserConfig } from '../src/config/types.ts';
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

const page = '<!doctype html><html lang="en"><head><title>t</title></head><body>hi</body></html>';

describe('shots audit', () => {
  it('fails without a baseline and warns about pages that have none', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({ 'dist/index.html': page });
    const shots = async (shotsConfig: UserConfig['shots'] = {}) => {
      const { results } = await run({
        cwd,
        env: {},
        audits: ['shots'],
        reporters: [],
        overrides: {
          port: await freePort(),
          shots: { viewports: [320], motion: false, ...shotsConfig },
        },
      });
      const result = results[0];
      assert.ok(result);
      return result;
    };

    const none = await shots();
    assert.equal(none.status, 'failed');
    assert.match(none.findings[0]?.message ?? '', /^no baseline in .*: nothing was compared$/);

    assert.equal((await shots({ updateBaseline: true })).status, 'passed');
    assert.equal((await shots()).status, 'passed');

    writeFileSync(join(cwd, 'dist', 'new.html'), page);
    const partial = await shots();
    assert.equal(partial.status, 'warned');
    assert.equal(partial.findings[0]?.message, '1 screenshot(s) have no baseline');
    assert.equal(partial.findings[0]?.severity, 'warn');
  });
});
