import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { createReporters, type RunReport } from '../src/index.ts';
import { annotation, github } from '../src/reporters/github.ts';
import { toJUnit } from '../src/reporters/junit.ts';
import { pretty } from '../src/reporters/pretty.ts';
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

describe('github reporter', () => {
  it('escapes workflow command data and properties', () => {
    assert.equal(
      annotation('vidimus a:b', 'line 1\nline 2 100%'),
      '::error title=vidimus a%3Ab::line 1%0Aline 2 100%25\n',
    );
    assert.equal(annotation('t', 'm', undefined, 'warning'), '::warning title=t::m\n');
  });
});

const sink = () => {
  const chunks: string[] = [];
  const stream = Object.assign(new PassThrough(), {
    isTTY: false,
  }) as unknown as NodeJS.WriteStream;
  stream.write = ((chunk: string) => chunks.push(String(chunk)) > 0) as NodeJS.WriteStream['write'];
  return { stream, text: () => chunks.join('') };
};

describe('pretty reporter', () => {
  it('prints findings, warnings and a closing line', async () => {
    const { stream, text } = sink();
    const reporter = pretty(stream);
    await reporter.onStart?.({ audits: ['links'], origin: 'http://localhost:1', serving: 'dist' });
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
    assert.match(output, /✖ 404 <https:\/\/x\.test\/\?a=1&b=2>/);
    assert.match(output, /⚠ title too long/);
    assert.match(output, /→ shorten the <title>/);
    assert.match(output, /2 ignored or accepted/);
    assert.match(output, /failed: links, a11y/);
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
});
