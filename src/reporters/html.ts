import type { AuditResult, Finding, RunReport } from '../core/types.ts';
import type { Reporter } from './types.ts';

const esc = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const BAD = new Set(['failed', 'errored']);

const finding = ({ message, details = [], where = [], fix, severity }: Finding) => {
  const level = severity === 'warn' ? 'warn' : 'error';
  const lines = [
    ...details.map((line) => `<p>${esc(line)}</p>`),
    ...(where.length ? [`<ul>${where.map((page) => `<li>${esc(page)}</li>`).join('')}</ul>`] : []),
    ...(fix ? [`<p><strong>fix:</strong> ${esc(fix)}</p>`] : []),
  ];
  return `<details><summary><span class="badge ${level}">${level}</span> ${esc(message)}</summary>${lines.join('')}</details>`;
};

const section = (audit: AuditResult) =>
  `<section><h2>${esc(audit.name)} <span class="badge ${esc(audit.status)}">${esc(audit.status)}</span></h2><p>${esc(audit.summary)}</p>${audit.findings.map(finding).join('')}</section>`;

const row = (audit: AuditResult) =>
  `<tr><td>${esc(audit.name)}</td><td><span class="badge ${esc(audit.status)}">${esc(audit.status)}</span></td><td>${esc(audit.summary)}</td><td>${audit.durationMs} ms</td></tr>`;

export const toHtml = (report: RunReport) => {
  const ordered = [...report.results].sort(
    (a, b) => Number(BAD.has(b.status)) - Number(BAD.has(a.status)),
  );
  const failed = report.results.filter(({ status }) => BAD.has(status)).length;
  const ok = report.results.length - failed;
  const date = esc(report.startedAt.slice(0, 10));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vidimus ${date}</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--line:#d0d7de;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--line:#30363d;--ok:#3fb950;--bad:#f85149;--warn:#d29922}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:60rem;padding:1rem}
table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid var(--line);padding:.25rem .5rem;text-align:left}
details,section{border:1px solid var(--line);border-radius:.25rem;margin:.5rem 0;padding:.25rem .75rem}
.badge{border:1px solid currentColor;border-radius:1rem;font-size:.75rem;padding:0 .5rem}
.passed,.ok{color:var(--ok)}.failed,.errored,.error{color:var(--bad)}.warned,.warn{color:var(--warn)}
</style>
</head>
<body>
<h1>vidimus ${date}</h1>
<p>${esc(report.origin)}: ${ok} ok, ${failed} failed (${report.durationMs} ms)</p>
<table><thead><tr><th>Audit</th><th>Status</th><th>Summary</th><th>Duration</th></tr></thead><tbody>${ordered.map(row).join('')}</tbody></table>
${ordered.map(section).join('\n')}
</body>
</html>
`;
};

export const html = (write: (content: string) => void): Reporter => ({
  name: 'html',
  onEnd: (report) => write(toHtml(report)),
});
