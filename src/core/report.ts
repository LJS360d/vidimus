import type { VidimusConfig } from '../config/types.ts';
import type { AcceptedFinding } from './findings.ts';
import type { ProfileSummary } from './profile.ts';
import type { Audit, AuditResult, Finding, RunReport, RunTotals } from './types.ts';
import { version } from './version.ts';

const REDACTED = '<redacted>';

const redactValues = (record: Record<string, string>) =>
  Object.fromEntries(Object.keys(record).map((key) => [key, REDACTED]));

const serializableConfig = ({ plugins, reporters, ...config }: VidimusConfig): unknown => {
  const { state } = config.browser;
  const redacted = {
    ...config,
    browser: {
      ...config.browser,
      state: {
        localStorage: redactValues(state.localStorage),
        sessionStorage: redactValues(state.sessionStorage),
        cookies: state.cookies.map((cookie) => ({ ...cookie, value: REDACTED })),
        script: state.script && REDACTED,
      },
    },
    server: {
      ...config.server,
      command: config.server.command.replace(/\b([A-Za-z_][A-Za-z0-9_]*)=\S+/g, `$1=${REDACTED}`),
    },
  };
  return JSON.parse(
    JSON.stringify(redacted, (_key, value) => (value instanceof RegExp ? String(value) : value)),
  );
};

export const unfinishedResult = (audit: Audit, timeout: number): AuditResult => {
  const summary = `did not finish within timeout (${timeout} ms)`;
  return {
    name: audit.name,
    status: 'errored',
    summary,
    findings: [
      { message: summary, fix: 'raise timeout, or set auditTimeout to find the audit that hangs' },
    ],
    suppressed: 0,
    log: [],
    durationMs: 0,
  };
};

export const tally = (results: AuditResult[]): RunTotals => {
  const totals: RunTotals = {
    errors: 0,
    warnings: 0,
    suppressed: 0,
    audits: { passed: 0, warned: 0, failed: 0, errored: 0, skipped: 0 },
  };
  for (const result of results) {
    totals.audits[result.status]++;
    totals.suppressed += result.suppressed;
    for (const { severity } of result.findings) {
      if (severity === 'warn') totals.warnings++;
      else totals.errors++;
    }
  }
  return totals;
};

export interface ReportInput {
  config: VidimusConfig;
  results: AuditResult[];
  startedAt: Date;
  timedOut: boolean;
  unusedIgnore: number;
  stale: AcceptedFinding[];
  origin: string;
  distDir: string;
  profile: ProfileSummary | undefined;
  audits: string[];
  serving: string | undefined;
  notes: string[];
  pages: string[];
  suppressed: Record<string, Finding[]>;
}

export const buildReport = (input: ReportInput): RunReport => {
  const { config, results, timedOut, stale, profile } = input;
  return {
    schemaVersion: 1,
    ok:
      !timedOut &&
      !(config.strict && input.unusedIgnore) &&
      !(config.baseline.failOnStale && stale.length) &&
      results.every(({ status }) => status !== 'failed' && status !== 'errored'),
    origin: input.origin,
    distDir: input.distDir,
    startedAt: input.startedAt.toISOString(),
    durationMs: Date.now() - input.startedAt.getTime(),
    results,
    totals: tally(results),
    staleBaseline: stale.length,
    ...(timedOut && { timedOut }),
    ...(profile && { profile }),
    detail: {
      vidimus: version,
      node: process.version,
      platform: process.platform,
      audits: input.audits,
      serving: input.serving,
      notes: input.notes,
      pages: input.pages,
      config: serializableConfig(config),
      suppressed: input.suppressed,
      stale,
    },
  };
};
