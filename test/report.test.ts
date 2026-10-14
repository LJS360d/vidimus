import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tally, unfinishedResult } from '../src/core/report.ts';
import type { AuditResult } from '../src/core/types.ts';

const result = (overrides: Partial<AuditResult>): AuditResult => ({
  name: 'a',
  status: 'passed',
  summary: '',
  findings: [],
  suppressed: 0,
  log: [],
  durationMs: 0,
  ...overrides,
});

describe('run report', () => {
  it('tallies statuses, findings by severity and suppressed counts', () => {
    const totals = tally([
      result({
        status: 'failed',
        findings: [{ message: 'x' }, { message: 'y', severity: 'warn' }],
      }),
      result({ status: 'warned', suppressed: 2, findings: [{ message: 'z', severity: 'warn' }] }),
      result({ status: 'skipped' }),
    ]);
    assert.deepEqual(totals, {
      errors: 1,
      warnings: 2,
      suppressed: 2,
      audits: { passed: 0, warned: 1, failed: 1, errored: 0, skipped: 1 },
    });
  });

  it('marks audits that never finished as errored with a fix', () => {
    const unfinished = unfinishedResult(
      { name: 'links', description: '', run: async () => ({ status: 'passed', summary: '' }) },
      500,
    );
    assert.equal(unfinished.status, 'errored');
    assert.match(unfinished.summary, /500 ms/);
    assert.ok(unfinished.findings.every((finding) => finding.fix));
  });
});
