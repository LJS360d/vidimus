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

export const toSarif = (report: RunReport) => ({
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'vidimus',
          rules: report.results.map(({ name }) => ({ id: name, name })),
        },
      },
      results: report.results.flatMap(({ name, findings }) =>
        findings.map((finding) => result(name, finding)),
      ),
    },
  ],
});

export const sarif = (write: (content: string) => void): Reporter => ({
  name: 'sarif',
  onEnd: (report) => write(`${JSON.stringify(toSarif(report), null, 2)}\n`),
});
