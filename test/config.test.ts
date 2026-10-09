import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { UsageError } from '../src/core/errors.ts';
import { loadConfig } from '../src/index.ts';
import { fixture } from './helpers.ts';

describe('loadConfig', () => {
  it('discovers the config in parent directories up to the .git boundary', async () => {
    const root = fixture({
      '.git/HEAD': '',
      'vidimus.config.json': JSON.stringify({ port: 9001 }),
      'pkg/vidimus.config.json': JSON.stringify({ port: 9002 }),
      'pkg/a/b/x': '',
      'c/d/x': '',
      'explicit.json': JSON.stringify({ port: 9003 }),
    });
    const nested = await loadConfig({ cwd: join(root, 'c/d'), env: {} });
    assert.equal(nested.source, join(root, 'vidimus.config.json'));
    assert.equal(nested.config.port, 9001);
    assert.equal(nested.config.root, root);
    const nearest = await loadConfig({ cwd: join(root, 'pkg/a/b'), env: {} });
    assert.equal(nearest.config.port, 9002);
    assert.equal(nearest.config.root, join(root, 'pkg'));
    const outer = fixture({ 'vidimus.config.json': JSON.stringify({ port: 9004 }) });
    const repo = join(outer, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'sub'));
    const bounded = await loadConfig({ cwd: join(repo, 'sub'), env: {} });
    assert.equal(bounded.source, undefined);
    const explicit = await loadConfig({
      cwd: join(root, 'c/d'),
      configFile: join(root, 'explicit.json'),
      env: {},
    });
    assert.equal(explicit.config.port, 9003);
  });

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

  it('parses a JSON array for server.fallback, which also accepts a file name', async () => {
    const rules = '[{"match":"^/blog","file":"blog.html"},{"match":"^/docs","file":"docs.html"}]';
    const { config } = await loadConfig({
      cwd: fixture({}),
      env: {},
      set: [`server.fallback=${rules}`],
    });
    assert.deepEqual(config.server.fallback, [
      { match: '^/blog', file: 'blog.html' },
      { match: '^/docs', file: 'docs.html' },
    ]);
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

  it('rejects a non-string privacy.rejectSelector', async () => {
    await assert.rejects(
      loadConfig({
        cwd: fixture({
          'vidimus.config.json': JSON.stringify({ privacy: { rejectSelector: 3 } }),
        }),
        env: {},
      }),
      /privacy\.rejectSelector: must be a string/,
    );
  });

  it('accepts CSS selectors in forms.skip while still checking links.skip as regexes', async () => {
    const selectors = await loadConfig({
      cwd: fixture({ 'vidimus.config.json': JSON.stringify({ forms: { skip: ['*[data-x]'] } }) }),
      env: {},
    });
    assert.deepEqual(selectors.config.forms.skip, ['*[data-x]']);
    await assert.rejects(
      loadConfig({
        cwd: fixture({ 'vidimus.config.json': JSON.stringify({ links: { skip: ['('] } }) }),
        env: {},
      }),
      /links\.skip\[0\]: Invalid regular expression/,
    );
  });

  it('rejects unknown keys in config files and accepts $schema', async () => {
    const typo = fixture({ 'vidimus.config.json': JSON.stringify({ r12s: { viewport: [320] } }) });
    await assert.rejects(loadConfig({ cwd: typo, env: {} }), /unknown config key "r12s.viewport"/);
    const open = fixture({
      'vidimus.config.json': JSON.stringify({
        $schema: './node_modules/vidimus/schema.json',
        severity: { a11y: 'warn' },
        lighthouse: { thresholds: { pwa: 0.5 } },
      }),
    });
    const { config } = await loadConfig({ cwd: open, env: {} });
    assert.equal(config.severity.a11y, 'warn');
    assert.equal('$schema' in config, false);
  });

  it('rejects an invalid shots.overrides pattern', async () => {
    const cwd = fixture({
      'vidimus.config.json': JSON.stringify({ shots: { overrides: [{ match: '(' }] } }),
    });
    await assert.rejects(loadConfig({ cwd, env: {} }), /shots\.overrides\[0\]\.match/);
  });

  it('rejects an unknown shots.colorSchemes value', async () => {
    const cwd = fixture({
      'vidimus.config.json': JSON.stringify({ shots: { colorSchemes: ['sepia'] } }),
    });
    await assert.rejects(loadConfig({ cwd, env: {} }), /shots\.colorSchemes\[0\]/);
  });

  it('reports a malformed package.json as a usage error', async () => {
    const cwd = fixture({ 'package.json': '{ nope' });
    await assert.rejects(loadConfig({ cwd, env: {} }), UsageError);
  });

  it('rejects values outside the allowed set for fallbackStatus, a11y.standard and forms.stub', async () => {
    const cwd = fixture({});
    for (const [path, pattern] of [
      ['server.fallbackStatus=500', /server\.fallbackStatus: "500" is not one of 200, 404/],
      ['a11y.standard=WCAG3', /a11y\.standard: "WCAG3" is not one of/],
      ['a11y.runner=pa11y', /a11y\.runner: "pa11y" is not one of htmlcs, axe/],
      ['budget.compression=zstd', /budget\.compression: "zstd" is not one of gzip, brotli, none/],
      ['forms.stub=nope', /forms\.stub: "nope" is not one of abort, ok/],
      ['forms.caseTimeout=-1', /forms\.caseTimeout: must be a number/],
    ] as const)
      await assert.rejects(loadConfig({ cwd, env: {}, set: [path] }), pattern);
    const { config } = await loadConfig({ cwd, env: {}, set: ['server.fallbackStatus=404'] });
    assert.equal(config.server.fallbackStatus, 404);
  });

  it('rejects severity keys that are not audit names and values that are not severities', async () => {
    const cwd = fixture({});
    await assert.rejects(
      loadConfig({ cwd, env: {}, set: ['severity.adit=warn'] }),
      /severity\.adit: unknown audit/,
    );
    await assert.rejects(
      loadConfig({ cwd, env: {}, set: ['severity.budget=warning'] }),
      /severity\.budget: "warning" is not one of error, warn, off/,
    );
    const { config } = await loadConfig({ cwd, env: {}, set: ['severity.budget=warn'] });
    assert.equal(config.severity.budget, 'warn');
  });

  it('reads timeouts and rejects negative ones', async () => {
    const cwd = fixture({});
    const { config } = await loadConfig({
      cwd,
      env: { VIDIMUS_AUDIT_TIMEOUT: '500' },
      set: ['timeout=2000'],
    });
    assert.equal(config.timeout, 2000);
    assert.equal(config.auditTimeout, 500);
    await assert.rejects(loadConfig({ cwd, env: {}, set: ['timeout=-1'] }), UsageError);
    await assert.rejects(loadConfig({ cwd, env: {}, set: ['lighthouse.runs=0'] }), UsageError);
    await assert.rejects(
      loadConfig({ cwd, env: {}, set: ['lighthouse.preset=tablet'] }),
      UsageError,
    );
    await assert.rejects(
      loadConfig({ cwd, env: {}, overrides: { auditTimeout: Number.NaN } }),
      UsageError,
    );
  });

  it('rejects unknown keys and bad values', async () => {
    const cwd = fixture({});
    await assert.rejects(loadConfig({ cwd, env: {}, set: ['nope=1'] }), UsageError);
    await assert.rejects(loadConfig({ cwd, env: {}, configFile: 'missing.json' }), UsageError);
  });
});
