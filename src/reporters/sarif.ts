import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinAudits } from '../audits/registry.ts';
import type { Finding, RunReport } from '../core/types.ts';
import { portablePath } from '../core/util.ts';
import type { Reporter } from './types.ts';

const SRCROOT = '%SRCROOT%';

const pagePath = (distDir: string, page: string) =>
  join(distDir, page.endsWith('/') ? `${page}index.html` : page);

// GitHub's primaryLocationLineHash convention: `<hash>:<n>`, n counting results that share the
// hash, so two identical findings stay two distinct alerts.
type Seen = Map<string, number>;
const fingerprint = (seen: Seen, audit: string, uri: string | undefined, message: string) => {
  const hash = createHash('sha256')
    .update([audit, uri ?? '', message].join('\n'))
    .digest('hex');
  const count = (seen.get(hash) ?? 0) + 1;
  seen.set(hash, count);
  return `${hash}:${count}`;
};

const result = (audit: string, finding: Finding, root: string, distDir: string, seen: Seen) => {
  const text = [
    finding.message,
    ...(finding.details ?? []),
    ...(finding.where ?? []).map((where) => `on: ${where}`),
    ...(finding.fix ? [`fix: ${finding.fix}`] : []),
  ].join('\n');
  const page = finding.where?.[0] ?? '/';
  const file = finding.file ?? (distDir && page ? pagePath(distDir, page) : undefined);
  const relative = file && portablePath(root, file);
  // A path outside the repository has no %SRCROOT%-relative location code scanning can show.
  const inside = relative && !/^(?:\.\.(?:\/|$)|\/|[A-Za-z]:)/.test(relative);
  const uri = inside ? relative.split('/').map(encodeURIComponent).join('/') : undefined;
  return {
    ruleId: audit,
    level: finding.severity === 'warn' ? 'warning' : 'error',
    message: { text },
    partialFingerprints: {
      primaryLocationLineHash: fingerprint(seen, audit, uri, finding.message),
    },
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

const suppressed = (
  audit: string,
  finding: Finding,
  root: string,
  distDir: string,
  seen: Seen,
) => ({
  ...result(audit, finding, root, distDir, seen),
  suppressions: [{ kind: 'external', justification: 'ignore rule or baseline' }],
});

const descriptions = new Map(builtinAudits.map(({ name, description }) => [name, description]));

const driver = (report: RunReport, verbose: boolean) => ({
  name: 'vidimus',
  ...(verbose && report.detail && { version: report.detail.vidimus }),
  rules: report.results.map(({ name, status, summary, durationMs, log }) => {
    const text = descriptions.get(name) || summary || name;
    return {
      id: name,
      name,
      shortDescription: { text },
      fullDescription: { text },
      help: { text },
      ...(verbose && { properties: { status, summary, durationMs, log } }),
    };
  }),
});

const results = (report: RunReport, verbose: boolean, root: string) => {
  const seen: Seen = new Map();
  return report.results.flatMap(({ name, findings }) => [
    ...findings.map((finding) => result(name, finding, root, report.distDir, seen)),
    ...(verbose
      ? (report.detail?.suppressed[name] ?? []).map((f) =>
          suppressed(name, f, root, report.distDir, seen),
        )
      : []),
  ]);
};

const invocation = (report: RunReport, verbose: boolean, root: string) => ({
  executionSuccessful: report.ok,
  workingDirectory: { uri: rootUri(root) },
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

const rootUri = (root: string) => `${pathToFileURL(root).href.replace(/\/$/, '')}/`;

export const toSarif = (report: RunReport, verbose = false, root = process.cwd()) => ({
  $schema: 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: { driver: driver(report, verbose) },
      results: results(report, verbose, root),
      originalUriBaseIds: {
        [SRCROOT]: { uri: rootUri(root) },
      },
      invocations: [invocation(report, verbose, root)],
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
