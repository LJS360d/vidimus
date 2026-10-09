import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { type Audit, type Finding, type RunOptions, run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const reporting = (findings: Finding[], name = 'probe'): Audit => ({
  name,
  description: 'reports fixed findings',
  requires: 'source',
  run: async () => ({ summary: `${findings.length} finding(s)`, findings }),
});

const probe = (findings: Finding[], options: RunOptions = {}, cwd = fixture({})) =>
  run({
    cwd,
    env: {},
    audits: ['probe'],
    reporters: [],
    ...options,
    overrides: { plugins: [reporting(findings)], ...options.overrides },
  });

const error: Finding = { message: 'broken', where: ['/a/', '/b/'] };
const warning: Finding = { message: 'meh', severity: 'warn' };

describe('severity', () => {
  it('warns instead of failing when every finding is a warning', async () => {
    const { ok, results } = await probe([warning]);
    assert.equal(ok, true);
    assert.equal(results[0]?.status, 'warned');
  });

  it('downgrades a whole audit to warnings', async () => {
    const { ok, results } = await probe([error], { overrides: { severity: { probe: 'warn' } } });
    assert.equal(ok, true);
    assert.equal(results[0]?.status, 'warned');
    assert.equal(results[0]?.findings[0]?.severity, 'warn');
  });

  it('fails on warnings in strict mode', async () => {
    const { ok, results } = await probe([warning], { overrides: { strict: true } });
    assert.equal(ok, false);
    assert.equal(results[0]?.status, 'failed');
    assert.equal(results[0]?.findings[0]?.severity, 'error');
  });

  it('drops audits turned off from the default and "all" selections', async () => {
    const cwd = fixture({});
    const plugins = [reporting([error]), reporting([], 'other')];
    const overrides = { plugins, audits: ['probe', 'other'], severity: { probe: 'off' as const } };
    const selected = await run({ cwd, env: {}, reporters: [], overrides });
    assert.deepEqual(
      selected.results.map(({ name }) => name),
      ['other'],
    );
    const named = await run({ cwd, env: {}, reporters: [], audits: ['probe'], overrides });
    assert.equal(named.results[0]?.status, 'failed');
  });
});

describe('ignore rules', () => {
  it('drops findings by message', async () => {
    const { ok, results } = await probe([error, warning], {
      overrides: { ignore: [{ audit: 'probe', message: '^broken$' }] },
    });
    assert.equal(ok, true);
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message),
      ['meh'],
    );
    assert.equal(results[0]?.suppressed, 1);
  });

  it('removes matching pages and keeps the rest', async () => {
    const { results } = await probe([error], {
      overrides: { ignore: [{ message: 'broken', where: '^/a/' }] },
    });
    assert.deepEqual(results[0]?.findings[0]?.where, ['/b/']);
  });

  it('only applies to the named audits', async () => {
    const { results } = await probe([error], { overrides: { ignore: [{ audit: 'links|r12s' }] } });
    assert.equal(results[0]?.findings.length, 1);
  });
});

describe('findings baseline', () => {
  it('accepts current findings and only fails on new ones', async () => {
    const cwd = fixture({});
    const accepted = await probe([error], { overrides: { baseline: { update: true } } }, cwd);
    assert.equal(accepted.ok, true);
    const file = join(cwd, 'vidimus.baseline.json');
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).findings[0].message, 'broken');

    const same = await probe([error], {}, cwd);
    assert.equal(same.ok, true);
    assert.equal(same.results[0]?.suppressed, 1);

    const fresh = await probe([error, { message: 'new problem' }], {}, cwd);
    assert.equal(fresh.ok, false);
    assert.deepEqual(
      fresh.results[0]?.findings.map(({ message }) => message),
      ['new problem'],
    );
  });

  it('ignores line and column numbers in details when matching accepted findings', async () => {
    const cwd = fixture({});
    const at = (location: string): Finding => ({
      message: 'broken',
      details: [`${location} <div>`],
    });
    await probe([at('/a/index.html:3:9')], { overrides: { baseline: { update: true } } }, cwd);
    const moved = await probe([at('/a/index.html:12:4')], {}, cwd);
    assert.equal(moved.ok, true);
    assert.equal(moved.results[0]?.suppressed, 1);
  });

  it('treats the same finding on other pages as new when baseline.matchWhere is on', async () => {
    const cwd = fixture({});
    const on = { baseline: { matchWhere: true } };
    const at = (...where: string[]): Finding => ({ message: 'broken', where });
    await probe([at('/a/')], { overrides: { baseline: { update: true, matchWhere: true } } }, cwd);
    const same = await probe([at('/a/')], { overrides: on }, cwd);
    assert.equal(same.ok, true);
    const grown = await probe([at('/a/', '/b/')], { overrides: on }, cwd);
    assert.equal(grown.ok, false);
    const plain = await probe([at('/a/', '/b/')], {}, cwd);
    assert.equal(plain.ok, true);
  });

  it('keeps accepted findings of audits that did not run', async () => {
    const cwd = fixture({
      'vidimus.baseline.json': JSON.stringify({
        version: 1,
        findings: [{ audit: 'links', message: '404 https://gone.test' }],
      }),
    });
    await probe([error], { overrides: { baseline: { update: true } } }, cwd);
    const audits = JSON.parse(
      readFileSync(join(cwd, 'vidimus.baseline.json'), 'utf8'),
    ).findings.map(({ audit }: { audit: string }) => audit);
    assert.deepEqual(audits, ['links', 'probe']);
  });

  it('keeps accepted findings of audits that were skipped in this run', async () => {
    const cwd = fixture({
      'vidimus.baseline.json': JSON.stringify({
        version: 1,
        findings: [{ audit: 'probe', message: 'broken' }],
      }),
    });
    const skipped: Audit = {
      name: 'probe',
      description: 'skips this run',
      requires: 'source',
      run: async () => ({ status: 'skipped', summary: 'no pages to check' }),
    };
    await run({
      cwd,
      env: {},
      audits: ['probe'],
      reporters: [],
      overrides: { plugins: [skipped], baseline: { update: true } },
    });
    const messages = JSON.parse(
      readFileSync(join(cwd, 'vidimus.baseline.json'), 'utf8'),
    ).findings.map(({ message }: { message: string }) => message);
    assert.deepEqual(messages, ['broken']);
  });

  it('reports baseline entries that no longer occur on stderr', async () => {
    const cwd = fixture({
      'vidimus.baseline.json': JSON.stringify({
        version: 1,
        findings: [
          { audit: 'probe', message: 'fixed' },
          { audit: 'links', message: '404 https://gone.test' },
        ],
      }),
    });
    const write = process.stderr.write;
    let written = '';
    process.stderr.write = ((chunk: string) => {
      written += chunk;
      return true;
    }) as typeof process.stderr.write;
    try {
      await probe([], {}, cwd);
    } finally {
      process.stderr.write = write;
    }
    assert.match(written, /1 stale baseline entry/);
    assert.match(written, /--accept-findings/);
  });

  it('rejects a malformed baseline file', async () => {
    const cwd = fixture({ 'vidimus.baseline.json': '{"findings": 1}' });
    await assert.rejects(probe([error], {}, cwd), { name: 'UsageError' });
  });
});

describe('baseline paths', () => {
  it('stores files outside root relative to it, so the baseline works on other machines', async () => {
    const cwd = fixture({});
    const outside = join(cwd, '..', 'elsewhere', 'a.html');
    const file = join(cwd, 'vidimus.baseline.json');
    await probe(
      [{ message: 'x', file: outside }],
      { overrides: { baseline: { update: true } } },
      cwd,
    );
    const stored = JSON.parse(readFileSync(file, 'utf8')).findings[0].file;
    assert.equal(stored, '../elsewhere/a.html');
  });
});
