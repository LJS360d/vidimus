import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { run } from '../src/core/run.ts';
import type { AuditResult, Finding, RunReport, RunTotals } from '../src/core/types.ts';
import { fixture } from './helpers.ts';

interface SchemaNode {
  required?: string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

const schema: SchemaNode = JSON.parse(
  readFileSync(new URL('../report.schema.json', import.meta.url), 'utf8'),
);

const finding: Required<Finding> = {
  message: '',
  rule: '',
  where: [],
  details: [],
  file: '',
  line: 1,
  severity: 'error',
  fix: '',
};

const totals: RunTotals = {
  errors: 0,
  warnings: 0,
  suppressed: 0,
  audits: { passed: 0, warned: 0, failed: 0, errored: 0, skipped: 0 },
};

const result: AuditResult = {
  name: '',
  status: 'passed',
  summary: '',
  findings: [finding],
  suppressed: 0,
  log: [],
  durationMs: 0,
};

const report: Required<RunReport> = {
  schemaVersion: 1,
  ok: true,
  origin: '',
  distDir: '',
  startedAt: '',
  durationMs: 0,
  results: [result],
  totals,
  staleBaseline: 0,
  timedOut: false,
  profile: undefined as never,
  detail: undefined as never,
};

const shapes: [string, SchemaNode | undefined, object][] = [
  ['report', schema, report],
  ['totals', schema.properties?.totals, totals],
  ['totals.audits', schema.properties?.totals?.properties?.audits, totals.audits],
  ['result', schema.properties?.results?.items, result],
  ['finding', schema.properties?.results?.items?.properties?.findings?.items, finding],
];

describe('report.schema.json', () => {
  for (const [name, node, sample] of shapes) {
    it(`lists exactly the keys of the ${name} type`, () => {
      assert.ok(node, `${name} missing from the schema`);
      assert.deepEqual(Object.keys(node.properties ?? {}).sort(), Object.keys(sample).sort());
      for (const key of node.required ?? []) assert.ok(key in sample, `${name}.${key} required`);
    });
  }

  it('describes a report a run produces', async () => {
    const { results, ...rest } = await run({
      cwd: fixture({}),
      env: {},
      audits: ['quiet'],
      reporters: [],
      overrides: {
        plugins: [
          {
            name: 'quiet',
            description: 'passes',
            requires: 'source',
            run: async () => ({ status: 'passed', summary: 'ok' }),
          },
        ],
      },
    });
    const actual: Record<string, unknown> = { ...rest, results };
    for (const key of schema.required ?? []) assert.ok(key in actual, `${key} required`);
    for (const key of Object.keys(actual)) assert.ok(key in (schema.properties ?? {}), `${key}`);
    for (const key of schema.properties?.results?.items?.required ?? [])
      assert.ok(key in (results[0] ?? {}), `result.${key}`);
  });
});
