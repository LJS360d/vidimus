import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
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
  it('applies the first matching override to a changed page', { skip: noBrowser }, async () => {
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
      return results[0];
    };
    assert.equal((await shots({ updateBaseline: true }))?.status, 'passed');
    writeFileSync(
      join(cwd, 'dist', 'index.html'),
      page.replace('<body>', '<body style="background:#c00">'),
    );
    assert.equal((await shots())?.status, 'failed');
    const loose = await shots({ overrides: [{ match: '^/$', viewport: 320, maxDiff: 1 }] });
    assert.notEqual(loose?.status, 'failed');
    const other = await shots({ overrides: [{ match: '^/other', maxDiff: 1 }] });
    assert.equal(other?.status, 'failed');
  });

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

  it('refuses a baseline inside its own output, and keeps the baseline when a capture fails', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({ 'dist/index.html': page });
    const shots = async (overrides: UserConfig) => {
      const { results } = await run({
        cwd,
        env: {},
        audits: ['shots'],
        reporters: [],
        overrides: { port: await freePort(), ...overrides },
      });
      return results[0];
    };
    const inside = await shots({ shots: { baselineDir: '.vidimus/shots', motion: false } });
    assert.equal(inside?.status, 'errored');
    assert.match(inside?.summary ?? '', /shots\.baselineDir must not be/);

    const broken = { waitFor: '#never', timeout: 300 };
    const refused = await shots({
      render: broken,
      shots: { viewports: [320], motion: false, updateBaseline: true },
    });
    assert.equal(refused?.status, 'failed');
    assert.equal(refused?.summary, 'baseline not updated: 1 screenshot(s) failed');
    const failed = await shots({ render: broken, shots: { viewports: [320], motion: false } });
    assert.ok(
      failed?.findings.some((f) => /^failed to capture /.test(f.message)),
      failed?.findings.map((f) => f.message).join('\n'),
    );
  });

  it('ignores an anti-aliased edge pixel only when shots.antialiasing is on', {
    skip: noBrowser,
  }, async () => {
    const strip = (grey: string) =>
      `<!doctype html><html lang="en"><head><title>t</title></head><body style="margin:0;display:flex;height:800px"><i style="display:block;height:800px;width:20px;background:#000"></i><i style="display:block;height:800px;width:1px;background:${grey}"></i></body></html>`;
    const cwd = fixture({ 'dist/index.html': strip('#808080') });
    const shots = async (shotsConfig: UserConfig['shots'] = {}) => {
      const { results } = await run({
        cwd,
        env: {},
        audits: ['shots'],
        reporters: [],
        overrides: {
          port: await freePort(),
          shots: { viewports: [320], motion: false, maxDiff: 0, ...shotsConfig },
        },
      });
      return results[0];
    };
    assert.equal((await shots({ updateBaseline: true }))?.status, 'passed');
    writeFileSync(join(cwd, 'dist', 'index.html'), strip('#d0d0d0'));
    assert.equal((await shots())?.status, 'failed');
    assert.equal((await shots({ antialiasing: true }))?.status, 'passed');
  });

  it('turns a corrupt baseline into a finding for that shot only', {
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
      return results[0];
    };
    assert.equal((await shots({ updateBaseline: true }))?.status, 'passed');
    const baselineDir = join(cwd, '.vidimus', 'shots', 'baseline');
    for (const file of readdirSync(baselineDir))
      writeFileSync(join(baselineDir, file), 'not a png');
    const corrupt = await shots();
    assert.notEqual(corrupt?.status, 'errored', corrupt?.summary);
    assert.equal(corrupt?.status, 'failed');
    assert.equal(corrupt?.findings.length, 1);
    assert.match(corrupt?.findings[0]?.message ?? '', /^failed to compare index/);
  });
});

// A canvas redrawn every frame from the clock and Math.random, next to a cross-origin iframe whose
// colour changes on every load.
const dynamic = (
  embed: string,
  head = '',
) => `<!doctype html><html lang="en"><head><title>t</title>${head}</head>
<body style="margin:0">
<canvas id="scene" width="200" height="100"></canvas>
<iframe src="${embed}" width="200" height="100" style="border:0;display:block"></iframe>
<canvas id="gl" width="10" height="10"></canvas>
<script>
const context = document.getElementById('scene').getContext('2d');
const draw = (time) => {
  context.fillStyle = 'hsl(' + Math.floor(Math.random() * 360) + ' 80% 50%)';
  context.fillRect(0, 0, 200, 100);
  context.fillStyle = '#000';
  context.fillRect((time / 5) % 200, 40, 20, 20);
  requestAnimationFrame(draw);
};
requestAnimationFrame(draw);
document.getElementById('gl').getContext('webgl');
</script>
</body></html>`;

describe('shots on dynamic content', { skip: noBrowser }, () => {
  let embed = '';
  const upstream = createServer((_req, res) => {
    const hue = Math.floor(Math.random() * 360);
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<body style="margin:0;background:hsl(${hue} 80% 50%)">embed ${hue}</body>`);
  });
  before(
    () =>
      new Promise<void>((resolve) =>
        upstream.listen(0, '127.0.0.1', () => {
          embed = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/`;
          resolve();
        }),
      ),
  );
  after(() => new Promise((resolve) => upstream.close(resolve)));

  const shots = async (cwd: string, shotsConfig: UserConfig['shots'] = {}, args: string[] = []) => {
    const { results } = await run({
      cwd,
      env: {},
      audits: ['shots'],
      reporters: [],
      overrides: {
        port: await freePort(),
        browser: { args: ['--no-sandbox', ...args] },
        shots: { viewports: [320], motion: false, maxDiff: 0, ...shotsConfig },
      },
    });
    const result = results[0];
    assert.ok(result);
    return result;
  };

  it('freezes the canvas and masks the embed, so reruns do not diff', async () => {
    const cwd = fixture({ 'dist/index.html': dynamic(embed) });
    assert.equal((await shots(cwd, { updateBaseline: true })).status, 'passed');
    const rerun = await shots(cwd);
    assert.equal(rerun.status, 'passed');
    assert.ok(rerun.log.some((line) => /index@320x800\.png\s+unchanged/.test(line)));

    const raw = await shots(cwd, { freeze: false, maskEmbeds: false });
    assert.equal(raw.status, 'failed');
  });

  it('masks embeds on pages whose CSP blocks injected styles', async () => {
    const csp = `<meta http-equiv="content-security-policy" content="style-src 'self'; script-src 'unsafe-inline'; frame-src *">`;
    const cwd = fixture({ 'dist/index.html': dynamic(embed, csp) });
    assert.equal((await shots(cwd, { updateBaseline: true })).status, 'passed');
    assert.equal((await shots(cwd)).status, 'passed');
  });

  it('names what keeps moving when motion never settles', async () => {
    const cwd = fixture({ 'dist/index.html': dynamic(embed) });
    const result = await shots(cwd, {
      updateBaseline: true,
      motion: { interval: 20, stableFrames: 3, maxFrames: 4 },
    });
    assert.ok(
      result.log.some((line) => /never settled: .*canvas#scene/.test(line)),
      result.log.join('\n'),
    );
  });

  it('logs canvases whose WebGL context failed', async () => {
    const cwd = fixture({ 'dist/index.html': dynamic(embed) });
    const result = await shots(cwd, { updateBaseline: true }, ['--disable-3d-apis']);
    assert.ok(
      result.log.some((line) => /no WebGL context for canvas#gl/.test(line)),
      result.log.join('\n'),
    );
  });
});
