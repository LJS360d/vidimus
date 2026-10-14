import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  type Audit,
  type Finding,
  loadConfig,
  type RunOptions,
  run,
  runAudits,
} from '../src/index.ts';
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

describe('finding rule', () => {
  it('matches ignore.rule and keeps baseline entries when the message changes', async () => {
    const ruled: Finding = { message: 'size 10 kB', rule: 'probe/size' };
    const { results } = await probe([ruled, error], {
      overrides: { ignore: [{ rule: '^probe/size$' }] },
    });
    assert.deepEqual(
      results[0]?.findings.map(({ message }) => message),
      ['broken'],
    );
    const cwd = fixture({});
    await probe([ruled], { overrides: { baseline: { update: true } } }, cwd);
    const next = await probe([{ ...ruled, message: 'size 11 kB' }], {}, cwd);
    assert.equal(next.ok, true);
  });
});

describe('unused ignore rules', () => {
  it('reports dead rules on a full run and fails under strict', async () => {
    const writes: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const full = async (strict: boolean) => {
      const { config } = await loadConfig({
        cwd: fixture({}),
        env: {},
        overrides: { ignore: [{ message: '^orphan', reason: 'old' }], strict },
      });
      return runAudits(config, [reporting([])], [], { allAudits: true });
    };
    try {
      assert.equal((await full(false)).ok, true);
      assert.equal((await full(true)).ok, false);
    } finally {
      process.stderr.write = original;
    }
    assert.match(writes.join(''), /ignore\[0\] \(message=\^orphan\) matched nothing \(old\)/);
  });
});

describe('stale baseline and fuzzy matching', () => {
  const sized = (kb: number): Finding => ({ message: `html ${kb} kB gzipped > 100 kB budget` });

  it('tolerates drifting numbers with baseline.fuzzy', async () => {
    const cwd = fixture({});
    await probe([sized(312)], { overrides: { baseline: { update: true } } }, cwd);
    assert.equal((await probe([sized(313)], {}, cwd)).ok, false);
    assert.equal(
      (await probe([sized(313)], { overrides: { baseline: { fuzzy: true } } }, cwd)).ok,
      true,
    );
  });

  it('exposes stale entries and fails with baseline.failOnStale', async () => {
    const cwd = fixture({});
    await probe([error], { overrides: { baseline: { update: true } } }, cwd);
    const stale = await probe([], { overrides: { baseline: { failOnStale: true } } }, cwd);
    assert.equal(stale.staleBaseline, 1);
    assert.equal(stale.ok, false);
    assert.equal(stale.detail?.stale[0]?.message, 'broken');
  });
});

describe('report totals', () => {
  it('counts findings and audit statuses', async () => {
    const report = await probe([error, warning]);
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.totals, {
      errors: 1,
      warnings: 1,
      suppressed: 0,
      audits: { passed: 0, warned: 0, failed: 1, errored: 0, skipped: 0 },
    });
  });
});
