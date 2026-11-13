import { hostname } from 'node:os';
import type { AuditResult, Finding, RunReport } from '../core/types.ts';
import type { Reporter } from './types.ts';

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    // XML §2.11 turns a raw CR in text into LF.
    .replaceAll('\r', '&#13;');

const attrs = (values: Record<string, string | number>) =>
  Object.entries(values)
    // XML §3.3.3 normalises raw tab, LF and CR in attribute values to spaces; refs survive.
    .map(
      ([key, value]) =>
        `${key}="${escapeXml(String(value)).replace(/[\t\n\r]/g, (c) => `&#${c.charCodeAt(0)};`)}"`,
    )
    .join(' ');

const seconds = (ms: number) => (ms / 1000).toFixed(3);

const findingCase = (suite: string, finding: Finding, tag: 'failure' | 'error') => {
  const body = [
    ...(finding.details ?? []),
    ...(finding.where ?? []).map((where) => `on: ${where}`),
    ...(finding.fix ? [`fix: ${finding.fix}`] : []),
  ]
    .map(escapeXml)
    .join('\n');
  const outcome =
    finding.severity === 'warn'
      ? `<system-out>${escapeXml('warning: ')}${body}</system-out>`
      : `<${tag} ${attrs({ message: finding.message, type: tag })}>${body}</${tag}>`;
  // Findings are not timed one by one; the suite carries the audit's duration.
  return `    <testcase ${attrs({ classname: `vidimus.${suite}`, name: finding.message, time: seconds(0), ...(finding.file && { file: finding.file }) })}>
      ${outcome}
    </testcase>`;
};

const summaryCase = ({ name, status, summary, durationMs }: AuditResult) => {
  const head = `    <testcase ${attrs({ classname: `vidimus.${name}`, name: summary, time: seconds(durationMs) })}`;
  if (status === 'passed' || status === 'warned') return `${head}/>`;
  const child =
    status === 'skipped'
      ? `<skipped ${attrs({ message: summary })}/>`
      : status === 'errored'
        ? `<error ${attrs({ message: summary, type: 'error' })}/>`
        : `<failure ${attrs({ message: summary, type: 'failure' })}/>`;
  return `${head}>\n      ${child}\n    </testcase>`;
};

type Counts = Record<'tests' | 'failures' | 'errors' | 'skipped', number>;

// Ant's JUnit.xsd requires package, id, timestamp (no zone) and hostname on each suite, and a
// <properties> first and <system-out>/<system-err> last; readers that ignore them are unaffected.
interface SuiteContext {
  id: number;
  timestamp: string;
  host: string;
}

const suite = (
  result: AuditResult,
  suppressed: Finding[] | undefined,
  { id, timestamp, host }: SuiteContext,
) => {
  const errored = result.status === 'errored';
  const tag = errored ? 'error' : 'failure';
  const cases = result.findings.length
    ? result.findings.map((finding) => findingCase(result.name, finding, tag))
    : [summaryCase(result)];
  const failing = result.findings.filter(({ severity }) => severity !== 'warn').length;
  const counts: Counts = {
    tests: cases.length,
    failures: result.findings.length ? (errored ? 0 : failing) : Number(result.status === 'failed'),
    errors: result.findings.length ? (errored ? failing : 0) : Number(errored),
    skipped: result.status === 'skipped' ? 1 : 0,
  };
  const head = attrs({
    name: result.name,
    package: 'vidimus',
    id,
    timestamp,
    hostname: host,
    ...counts,
    time: seconds(result.durationMs),
  });
  const xml = `  <testsuite ${head}>
    <properties/>
${cases.join('\n')}
    ${suiteOutput(result, suppressed)}
    <system-err/>
  </testsuite>`;
  return { xml, counts };
};

const suiteOutput = (result: AuditResult, suppressed: Finding[] | undefined) => {
  const lines = suppressed
    ? [...result.log, ...suppressed.map((finding) => `suppressed: ${finding.message}`)]
    : [];
  return lines.length ? `<system-out>${escapeXml(lines.join('\n'))}</system-out>` : '<system-out/>';
};

export const toJUnit = (report: RunReport, verbose = false) => {
  // xs:dateTime without a zone, as the XSD pattern requires; startedAt is UTC.
  const timestamp = report.startedAt.slice(0, 19);
  const host = hostname() || 'localhost';
  const suites = report.results.map((result, id) =>
    suite(result, verbose ? (report.detail?.suppressed[result.name] ?? []) : undefined, {
      id,
      timestamp,
      host,
    }),
  );
  const totals: Counts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  for (const { counts } of suites) {
    for (const key of Object.keys(totals) as (keyof Counts)[]) totals[key] += counts[key];
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites ${attrs({ name: 'vidimus', ...totals, time: seconds(report.durationMs) })}>
${suites.map(({ xml }) => xml).join('\n')}
</testsuites>
`;
};

export const junit = (write: (content: string) => void, verbose = false): Reporter => ({
  name: 'junit',
  onEnd: (report) => write(toJUnit(report, verbose)),
});
