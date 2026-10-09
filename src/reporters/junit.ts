import type { AuditResult, Finding, RunReport } from '../core/types.ts';
import type { Reporter } from './types.ts';

const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');

const attrs = (values: Record<string, string | number>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(' ');

const seconds = (ms: number) => (ms / 1000).toFixed(3);

const findingCase = (suite: string, finding: Finding) => {
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
      : `<failure ${attrs({ message: finding.message })}>${body}</failure>`;
  return `    <testcase ${attrs({ classname: `vidimus.${suite}`, name: finding.message, ...(finding.file && { file: finding.file }) })}>
      ${outcome}
    </testcase>`;
};

const summaryCase = ({ name, status, summary }: AuditResult) => {
  const head = `    <testcase ${attrs({ classname: `vidimus.${name}`, name: summary })}`;
  if (status === 'passed' || status === 'warned') return `${head}/>`;
  const child =
    status === 'skipped'
      ? `<skipped ${attrs({ message: summary })}/>`
      : status === 'errored'
        ? `<error ${attrs({ message: summary })}/>`
        : `<failure ${attrs({ message: summary })}/>`;
  return `${head}>\n      ${child}\n    </testcase>`;
};

type Counts = Record<'tests' | 'failures' | 'errors' | 'skipped', number>;

const suite = (result: AuditResult) => {
  const cases = result.findings.length
    ? result.findings.map((finding) => findingCase(result.name, finding))
    : [summaryCase(result)];
  const counts: Counts = {
    tests: cases.length,
    failures: result.findings.length
      ? result.findings.filter(({ severity }) => severity !== 'warn').length
      : Number(result.status === 'failed'),
    errors: result.status === 'errored' ? 1 : 0,
    skipped: result.status === 'skipped' ? 1 : 0,
  };
  const xml = `  <testsuite ${attrs({ name: result.name, ...counts, time: seconds(result.durationMs) })}>
${cases.join('\n')}
  </testsuite>`;
  return { xml, counts };
};

export const toJUnit = (report: RunReport) => {
  const suites = report.results.map(suite);
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

export const junit = (write: (content: string) => void): Reporter => ({
  name: 'junit',
  onEnd: (report) => write(toJUnit(report)),
});
