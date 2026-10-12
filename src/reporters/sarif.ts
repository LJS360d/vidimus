import type { Finding, RunReport } from '../core/types.ts';
import type { Reporter } from './types.ts';

const result = (audit: string, finding: Finding) => {
  const text = [
    finding.message,
    ...(finding.details ?? []),
    ...(finding.where ?? []).map((where) => `on: ${where}`),
    ...(finding.fix ? [`fix: ${finding.fix}`] : []),
  ].join('\n');
  return {
    ruleId: audit,
    level: finding.severity === 'warn' ? 'warning' : 'error',
    message: { text },
    ...(finding.file && {
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: finding.file },
            ...(finding.line && { region: { startLine: finding.line } }),
          },
        },
      ],
    }),
  };
};

const suppressed = (audit: string, finding: Finding) => ({
  ...result(audit, finding),
  suppressions: [{ kind: 'external', justification: 'ignore rule or baseline' }],
});

export const toSarif = (report: RunReport, verbose = false) => {
  const { detail } = report;
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'vidimus',
            ...(verbose && detail && { version: detail.vidimus }),
            rules: report.results.map(({ name, status, summary, durationMs, log }) => ({
              id: name,
              name,
              ...(verbose && { properties: { status, summary, durationMs, log } }),
            })),
          },
        },
        results: report.results.flatMap(({ name, findings }) => [
          ...findings.map((finding) => result(name, finding)),
          ...(verbose ? (detail?.suppressed[name] ?? []).map((f) => suppressed(name, f)) : []),
        ]),
        ...(verbose && {
          invocations: [
            {
              executionSuccessful: report.ok,
              startTimeUtc: report.startedAt,
              properties: { durationMs: report.durationMs, origin: report.origin, ...detail },
            },
          ],
        }),
      },
    ],
  };
};

export const sarif = (write: (content: string) => void, verbose = false): Reporter => ({
  name: 'sarif',
  onEnd: (report) => write(`${JSON.stringify(toSarif(report, verbose), null, 2)}\n`),
});
