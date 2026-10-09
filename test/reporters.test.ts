import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { createReporters, type RunReport } from '../src/index.ts';
import { annotation, github } from '../src/reporters/github.ts';
import { toJUnit } from '../src/reporters/junit.ts';
import { pretty, progressLine } from '../src/reporters/pretty.ts';
import { fixture } from './helpers.ts';

const report: RunReport = {
  ok: false,
  origin: 'http://localhost:4322',
  startedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1500,
  results: [
    {
      name: 'csp',
      status: 'passed',
      summary: 'all hashed',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 10,
    },
    {
      name: 'links',
      status: 'failed',
      summary: '1 broken',
      findings: [{ message: '404 <https://x.test/?a=1&b=2>', where: ['/en/'] }],
      suppressed: 0,
      log: [],
      durationMs: 20,
    },
    {
      name: 'a11y',
      status: 'errored',
      summary: 'pa11y missing',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 1,
    },
    {
      name: 'i18n',
      status: 'skipped',
      summary: 'not configured',
      findings: [],
      suppressed: 0,
      log: [],
      durationMs: 0,
    },
  ],
};

describe('junit reporter', () => {
  it('counts results and escapes XML', () => {
    const xml = toJUnit(report);
    assert.match(xml, /<testsuites name="vidimus" tests="4" failures="1" errors="1" skipped="1"/);
    assert.match(xml, /404 &lt;https:\/\/x\.test\/\?a=1&amp;b=2&gt;/);
    assert.match(xml, /<error message="pa11y missing"\/>/);
    assert.match(xml, /<skipped message="not configured"\/>/);
  });
});

describe('junit reporter with warnings', () => {
  it('keeps warnings out of the failure count', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'warned',
          summary: '1 warning',
          findings: [{ message: 'title too long', severity: 'warn' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(xml, /failures="0"/);
    assert.match(xml, /<system-out>warning: <\/system-out>/);
  });
});

describe('junit reporter edge cases', () => {
  it('keeps characters outside the BMP and drops invalid control characters', () => {
    const xml = toJUnit({
      ...report,
      results: [
        {
          name: 'seo',
          status: 'failed',
          summary: 'x',
          findings: [{ message: 'rocket 🚀 bell \u0007' }],
          suppressed: 0,
          log: [],
          durationMs: 1,
        },
      ],
    });
    assert.match(xml, /rocket 🚀 bell "/);
  });
});

describe('github reporter', () => {
  it('escapes workflow command data and properties', () => {
    assert.equal(
      annotation('vidimus a:b', 'line 1\nline 2 100%'),
      '::error title=vidimus a%3Ab::line 1%0Aline 2 100%25\n',
    );
    assert.equal(annotation('t', 'm', undefined, 'warning'), '::warning title=t::m\n');
    assert.equal(
      annotation('t', 'm', join('/repo', 'site', 'dist', 'a.html'), 'error', '/repo'),
      '::error file=site/dist/a.html,title=t::m\n',
    );
  });
});

const sink = (isTTY = false) => {
  const chunks: string[] = [];
  const stream = Object.assign(new PassThrough(), {
    isTTY,
    columns: 80,
  }) as unknown as NodeJS.WriteStream;
  stream.write = ((chunk: string) => chunks.push(String(chunk)) > 0) as NodeJS.WriteStream['write'];
  return { stream, text: () => chunks.join('') };
};

describe('pretty reporter', () => {
  it('prints findings, warnings and a closing line', async () => {
    const { stream, text } = sink();
    const reporter = pretty(stream);
    await reporter.onStart?.({
      audits: ['links'],
      origin: 'http://localhost:1',
      serving: 'dist',
      notes: ['looks like a client-rendered app'],
    });
    for (const result of report.results) await reporter.onAuditEnd?.(result);
    await reporter.onAuditEnd?.({
      name: 'seo',
      status: 'warned',
      summary: 'long title',
      findings: [
        {
          message: 'title too long',
          severity: 'warn',
          file: '/x/index.html',
          fix: 'shorten the <title>',
        },
      ],
      suppressed: 2,
      log: ['checked 3 pages'],
      durationMs: 5,
    });
    await reporter.onEnd?.(report);
    const output = text();
    assert.match(output, /serving dist on http:\/\/localhost:1/);
    assert.match(output, /vidimus: looks like a client-rendered app/);
    assert.match(output, /✖ 404 <https:\/\/x\.test\/\?a=1&b=2>/);
    assert.match(output, /⚠ title too long/);
    assert.match(output, /→ shorten the <title>/);
    assert.match(output, /2 ignored or accepted/);
    assert.match(output, /failed: links, a11y/);
  });
});

describe('progress', () => {
  it('counts items', () => {
    const line = progressLine([
      { name: 'routes', done: 0, total: 0, since: 0 },
      { name: 'shots', done: 10, total: 40, since: 0 },
      { name: 'a11y', done: 5, total: 5, since: 0 },
    ]);
    assert.equal(line, 'routes · shots 10/40 · a11y 5/5');
  });

  it('pretty redraws one line on a terminal and clears it before printing', async () => {
    const { stream, text } = sink(true);
    const reporter = pretty(stream, {});
    await reporter.onStart?.({ audits: ['shots'], origin: '', serving: undefined, notes: [] });
    reporter.onProgress?.([{ name: 'shots', done: 1, total: 4, since: Date.now() }]);
    await reporter.onAuditEnd?.(report.results[0] as RunReport['results'][number]);
    reporter.onProgress?.([]);
    const output = text();
    const clear = '\r\x1b[2K';
    assert.ok(output.startsWith(clear));
    assert.match(output, /shots 1\/4/);
    assert.ok(output.includes(`${clear}\n`));
  });
});

describe('github reporter output', () => {
  it('annotates findings and appends a step summary', () => {
    const { stream, text } = sink();
    const summary = join(fixture({}), 'summary.md');
    const reporter = github(stream, { GITHUB_STEP_SUMMARY: summary });
    for (const result of report.results) reporter.onAuditEnd?.(result);
    reporter.onEnd?.(report);
    assert.match(text(), /::error title=vidimus links::404/);
    assert.match(text(), /::error title=vidimus a11y::pa11y missing/);
    assert.match(readFileSync(summary, 'utf8'), /\| links \| failed \| 1 broken \|/);
  });

  it('writes warnings with file, details, pages and fix, and no summary outside Actions', () => {
    const { stream, text } = sink();
    const root = fixture({});
    const reporter = github(stream, { GITHUB_WORKSPACE: root });
    reporter.onAuditEnd?.({
      name: 'seo',
      status: 'warned',
      summary: '1 problem',
      suppressed: 0,
      log: [],
      durationMs: 1,
      findings: [
        {
          message: 'title, too long: 70%',
          severity: 'warn',
          file: join(root, 'dist', 'index.html'),
          details: ['line\r\nbreak'],
          where: ['/'],
          fix: 'shorten it',
        },
      ],
    });
    reporter.onEnd?.(report);
    assert.equal(
      text(),
      '::warning file=dist/index.html,title=vidimus seo::title, too long: 70%25%0Aline%0D%0Abreak%0Aon: /%0Afix: shorten it\n',
    );
  });
});

describe('createReporters', () => {
  it('builds reporters from names and adds github on Actions', () => {
    const names = (specs: string[], env: NodeJS.ProcessEnv = {}) =>
      createReporters(specs, { cwd: process.cwd(), env }).map(({ name }) => name);
    assert.deepEqual(names([]), ['pretty']);
    assert.deepEqual(names([], { GITHUB_ACTIONS: 'true' }), ['pretty', 'github']);
    assert.deepEqual(names(['pretty', 'junit:r.xml'], { GITHUB_ACTIONS: 'true' }), [
      'pretty',
      'junit',
      'github',
    ]);
    assert.deepEqual(names(['github', 'json'], { GITHUB_ACTIONS: 'true' }), ['github', 'json']);
    assert.deepEqual(names(['pretty', 'json:out.json', 'junit']), ['pretty', 'json', 'junit']);
    assert.throws(() => names(['nope']), { name: 'UsageError' });
    assert.throws(() => names(['json', 'junit']), /both write to stdout/);
  });

  it('passes custom reporters through even when they have a target field', () => {
    const custom = { name: 'mine', target: 'somewhere', onEnd: () => {} };
    const [reporter] = createReporters([custom], { cwd: process.cwd(), env: {} });
    assert.equal(reporter, custom);
  });

  it('writes json and junit reports to files', async () => {
    const cwd = fixture({});
    const reporters = createReporters(['json:reports/r.json', 'junit:reports/r.xml'], {
      cwd,
      env: {},
    });
    for (const reporter of reporters) await reporter.onEnd?.(report);
    assert.equal(JSON.parse(readFileSync(join(cwd, 'reports/r.json'), 'utf8')).ok, false);
    assert.match(readFileSync(join(cwd, 'reports/r.xml'), 'utf8'), /<testsuites/);
  });

  it('adds reports in outDir next to the default pretty reporter', async () => {
    const cwd = fixture({});
    const outDir = join(cwd, '.vidimus');
    const reporters = createReporters([], { cwd, env: {}, reports: ['json', 'junit'], outDir });
    assert.deepEqual(
      reporters.map(({ name }) => name),
      ['pretty', 'json', 'junit'],
    );
    for (const reporter of reporters.slice(1)) await reporter.onEnd?.(report);
    assert.equal(JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).ok, false);
    assert.match(readFileSync(join(outDir, 'report.xml'), 'utf8'), /<testsuites/);
    assert.throws(
      () => createReporters([], { cwd, env: {}, reports: ['pretty'], outDir }),
      /unknown report "pretty"/,
    );
  });
});
