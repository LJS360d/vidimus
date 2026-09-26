import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { UsageError } from '../src/core/errors.ts';
import { loadConfig } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('loadConfig', () => {
  it('uses defaults when no config file exists', async () => {
    const cwd = fixture({});
    const { config, source } = await loadConfig({ cwd, env: {} });
    assert.equal(source, undefined);
    assert.equal(config.root, cwd);
    assert.equal(config.distDir, 'dist');
  });

  it('finds vidimus.config.json and deep-merges it', async () => {
    const cwd = fixture({
      'vidimus.config.json': JSON.stringify({
        port: 9000,
        lighthouse: { thresholds: { seo: 0.5 } },
      }),
    });
    const { config, source } = await loadConfig({ cwd, env: {} });
    assert.equal(source, join(cwd, 'vidimus.config.json'));
    assert.equal(config.port, 9000);
    assert.equal(config.lighthouse.thresholds.seo, 0.5);
    assert.equal(config.lighthouse.thresholds.performance, 0.9);
  });

  it('prefers a TS config and supports the function form', async () => {
    const cwd = fixture({
      'vidimus.config.ts':
        'export default ({ env }: { env: Record<string, string> }) => ({ siteUrl: env.SITE });\n',
      'vidimus.config.json': JSON.stringify({ siteUrl: 'json' }),
    });
    const { config } = await loadConfig({ cwd, env: { SITE: 'https://ts.example' } });
    assert.equal(config.siteUrl, 'https://ts.example');
  });

  it('reads the "vidimus" field of package.json', async () => {
    const cwd = fixture({ 'package.json': JSON.stringify({ vidimus: { distDir: 'public' } }) });
    const { config } = await loadConfig({ cwd, env: {} });
    assert.equal(config.distDir, 'public');
  });

  it('resolves root relative to the config file', async () => {
    const cwd = fixture({ 'config/site.json': JSON.stringify({ root: '..' }) });
    const { config } = await loadConfig({ cwd, configFile: 'config/site.json', env: {} });
    assert.equal(config.root, cwd);
  });

  it('applies file < env < --set < overrides', async () => {
    const cwd = fixture({
      '.vidimusrc': JSON.stringify({ port: 1, siteUrl: 'file', distDir: 'file' }),
    });
    const { config } = await loadConfig({
      cwd,
      env: { VIDIMUS_PORT: '2', VIDIMUS_SITE_URL: 'env', VIDIMUS_DIST_DIR: 'env' },
      set: ['port=3', 'siteUrl=set'],
      overrides: { port: 4 },
    });
    assert.equal(config.distDir, 'env');
    assert.equal(config.siteUrl, 'set');
    assert.equal(config.port, 4);
  });

  it('maps nested env vars onto existing keys', async () => {
    const { config } = await loadConfig({
      cwd: fixture({}),
      env: {
        VIDIMUS_LIGHTHOUSE__THRESHOLDS__BEST_PRACTICES: '0.5',
        VIDIMUS_R12S__VIEWPORTS: '360,1024',
        VIDIMUS_SHOTS__MOTION: 'false',
        VIDIMUS_ALL_LOCALES: '1',
      },
    });
    assert.equal(config.lighthouse.thresholds['best-practices'], 0.5);
    assert.deepEqual(config.r12s.viewports, [360, 1024]);
    assert.equal(config.shots.motion, false);
    assert.equal(config.allLocales, true);
  });

  it('parses JSON values in --set and allows new threshold keys', async () => {
    const { config } = await loadConfig({
      cwd: fixture({}),
      env: {},
      set: ['exclude=["^admin/"]', 'lighthouse.thresholds.pwa=0.8'],
    });
    assert.deepEqual(config.exclude, ['^admin/']);
    assert.equal(config.lighthouse.thresholds.pwa, 0.8);
  });

  it('ignores unrelated VIDIMUS_* variables but still validates known ones', async () => {
    const cwd = fixture({});
    const { config } = await loadConfig({
      cwd,
      env: {
        VIDIMUS_TOKEN: 'secret',
        VIDIMUS_PORT__NESTED: '1',
        VIDIMUS_SITE_URL: 'https://x.test',
      },
    });
    assert.equal(config.siteUrl, 'https://x.test');
    await assert.rejects(loadConfig({ cwd, env: { VIDIMUS_PORT: 'abc' } }), UsageError);
  });

  it('adds env keys to open records in config spelling', async () => {
    const { config } = await loadConfig({
      cwd: fixture({}),
      env: { VIDIMUS_SEVERITY__LIGHTHOUSE: 'warn', VIDIMUS_HTML__RULES__NO_INLINE_STYLE: 'off' },
    });
    assert.equal(config.severity.lighthouse, 'warn');
    assert.equal(config.html.rules['no-inline-style'], 'off');
  });

  it('rejects ignore rules that would silently drop everything or never compile', async () => {
    const load = (ignore: unknown) =>
      loadConfig({ cwd: fixture({ 'vidimus.config.json': JSON.stringify({ ignore }) }), env: {} });
    await assert.rejects(load([{ adit: 'seo' }]), /ignore\[0\]: unknown key "adit"/);
    await assert.rejects(load([{ audit: 'seo' }, {}]), /ignore\[1\]: an empty rule/);
    await assert.rejects(load([{ message: 42 }]), /ignore\[0\]\.message: must be a string/);
    await assert.rejects(load([{ where: '(' }]), /ignore\[0\]\.where: Invalid regular expression/);
    const { config } = await load([{ audit: 'seo', where: '^/draft/' }]);
    assert.deepEqual(config.ignore, [{ audit: 'seo', where: '^/draft/' }]);
  });

  it('rejects unknown keys in config files and accepts $schema', async () => {
    const typo = fixture({ 'vidimus.config.json': JSON.stringify({ r12s: { viewport: [320] } }) });
    await assert.rejects(loadConfig({ cwd: typo, env: {} }), /unknown config key "r12s.viewport"/);
    const open = fixture({
      'vidimus.config.json': JSON.stringify({
        $schema: './node_modules/vidimus/schema.json',
        severity: { custom: 'warn' },
        lighthouse: { thresholds: { pwa: 0.5 } },
      }),
    });
    const { config } = await loadConfig({ cwd: open, env: {} });
    assert.equal(config.severity.custom, 'warn');
    assert.equal('$schema' in config, false);
  });

  it('reports a malformed package.json as a usage error', async () => {
    const cwd = fixture({ 'package.json': '{ nope' });
    await assert.rejects(loadConfig({ cwd, env: {} }), UsageError);
  });

  it('rejects unknown keys and bad values', async () => {
    const cwd = fixture({});
    await assert.rejects(loadConfig({ cwd, env: {}, set: ['nope=1'] }), UsageError);
    await assert.rejects(loadConfig({ cwd, env: {}, configFile: 'missing.json' }), UsageError);
  });
});
