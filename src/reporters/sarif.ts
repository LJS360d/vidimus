import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Finding, RunReport } from '../core/types.ts';
import { portablePath } from '../core/util.ts';
import type { Reporter } from './types.ts';

const SRCROOT = '%SRCROOT%';

const pagePath = (distDir: string, page: string) =>
  join(distDir, page.endsWith('/') ? `${page}index.html` : page);

const result = (audit: string, finding: Finding, root: string, distDir: string) => {
  const text = [
    finding.message,
    ...(finding.details ?? []),
    ...(finding.where ?? []).map((where) => `on: ${where}`),
    ...(finding.fix ? [`fix: ${finding.fix}`] : []),
  ].join('\n');
  const page = finding.where?.[0];
  const file = finding.file ?? (distDir && page ? pagePath(distDir, page) : undefined);
  const uri = file && portablePath(root, file);
  return {
    ruleId: audit,
    level: finding.severity === 'warn' ? 'warning' : 'error',
    message: { text },
    ...(uri && {
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri, uriBaseId: SRCROOT },
            ...(finding.file && finding.line && { region: { startLine: finding.line } }),
          },
        },
      ],
    }),
  };
};

const suppressed = (audit: string, finding: Finding, root: string, distDir: string) => ({
  ...result(audit, finding, root, distDir),
  suppressions: [{ kind: 'external', justification: 'ignore rule or baseline' }],
});

const driver = (report: RunReport, verbose: boolean) => ({
  name: 'vidimus',
  ...(verbose && report.detail && { version: report.detail.vidimus }),
  rules: report.results.map(({ name, status, summary, durationMs, log }) => ({
    id: name,
    name,
    ...(verbose && { properties: { status, summary, durationMs, log } }),
  })),
});

const results = (report: RunReport, verbose: boolean, root: string) =>
  report.results.flatMap(({ name, findings }) => [
    ...findings.map((finding) => result(name, finding, root, report.distDir)),
    ...(verbose
      ? (report.detail?.suppressed[name] ?? []).map((f) =>
          suppressed(name, f, root, report.distDir),
        )
      : []),
  ]);

const invocation = (report: RunReport, verbose: boolean) => ({
  executionSuccessful: report.ok,
  toolExecutionNotifications: report.results
    .filter(({ status }) => status === 'errored')
    .map(({ name, summary }) => ({
      level: 'error',
      message: { text: `${name}: ${summary}` },
      associatedRule: { id: name },
    })),
  ...(verbose && {
    startTimeUtc: report.startedAt,
    properties: { durationMs: report.durationMs, origin: report.origin, ...report.detail },
  }),
});

export const toSarif = (report: RunReport, verbose = false, root = process.cwd()) => ({
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: { driver: driver(report, verbose) },
      results: results(report, verbose, root),
      originalUriBaseIds: {
        [SRCROOT]: { uri: `${pathToFileURL(root).href.replace(/\/$/, '')}/` },
      },
      invocations: [invocation(report, verbose)],
    },
  ],
});

export const sarif = (
  write: (content: string) => void,
  verbose = false,
  root = process.cwd(),
): Reporter => ({
  name: 'sarif',
  onEnd: (report) => write(`${JSON.stringify(toSarif(report, verbose, root), null, 2)}\n`),
});
