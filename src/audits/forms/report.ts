import type { Finding } from '../../core/types.ts';
import type { CaseResult, Exercised } from './index.ts';
import type { FieldInfo, FieldState } from './probe.ts';
import type { Captured } from './sandbox.ts';

export type Verdict = 'pass' | 'fail' | 'info';

const esc = (text: unknown) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const sent = (c: CaseResult) => c.outcome === 'sent' || c.outcome === 'navigated';

// Did the form do what the case expected: stop an invalid value, send a valid one.
export const verdictOf = (c: CaseResult): Verdict => {
  if (c.outcome === 'error' || c.events.canary) return 'fail';
  if (c.check === 'double-submit') return c.requests.length > 1 ? 'fail' : 'pass';
  if (c.outcome === 'not-submitted' || c.expect === 'unknown') return 'info';
  if (c.expect === 'invalid') return sent(c) ? 'fail' : 'pass';
  return sent(c) ? 'pass' : 'fail';
};

const value = (v: unknown) => {
  const text = JSON.stringify(v ?? null);
  return text.length > 60 ? `${text.slice(0, 50)}…(${String(v).length} chars)` : text;
};

const rules = (f: FieldInfo) =>
  (
    [
      ['required', f.required],
      ['minlength', f.minLength],
      ['maxlength', f.maxLength],
      ['min', f.min],
      ['max', f.max],
      ['step', f.step],
      ['pattern', f.pattern],
      ['accept', f.accept],
    ] as const
  )
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => {
      const inferred = f.inferred?.includes(
        k === 'minlength' ? 'minLength' : k === 'maxlength' ? 'maxLength' : k,
      );
      return `<code${inferred ? ' class="inf" title="inferred from page behaviour"' : ''}>${esc(v === true ? k : `${k}=${v}`)}</code>`;
    })
    .join(' ');

const layer = (s: FieldState | undefined) =>
  s
    ? `<span class="${s.native}">browser ${s.native}</span> · <span class="${s.framework}">framework ${s.framework}</span> · <span class="${s.ui}">ui ${s.ui}</span>${s.ariaInvalid ? ' · aria-invalid' : ''}${s.flags.length ? `<br><small>${esc(s.flags.join(', '))}</small>` : ''}${s.messages.length ? `<br><small>“${esc(s.messages.join('” “'))}”</small>` : ''}`
    : '';

// What a request sent, as fields: the parsed body, else the query string of a GET.
const paramsOf = (r: Captured): Record<string, unknown> | undefined => {
  if (r.body && typeof r.body === 'object' && !Array.isArray(r.body))
    return r.body as Record<string, unknown>;
  const query = new URL(r.url).searchParams;
  return r.body === undefined && query.size ? Object.fromEntries(query) : undefined;
};

// Only what differs from the baseline request: the rest is noise when scanning cases.
const requestHtml = (r: Captured, origin: string, base: Record<string, unknown> | undefined) => {
  const params = paramsOf(r);
  const url = new URL(r.url);
  const where = `${esc(r.method)} ${esc(r.url.startsWith(origin) ? url.pathname : `${url.origin}${url.pathname}`)}`;
  if (!params) {
    const body =
      r.body === undefined
        ? ''
        : `<pre>${esc(JSON.stringify(r.body, null, 1).slice(0, 600))}</pre>`;
    return `<div><code>${where}${esc(url.search)}</code>${body}</div>`;
  }
  const keys = [...new Set([...Object.keys(base ?? {}), ...Object.keys(params)])];
  const changed = base
    ? keys.filter((k) => JSON.stringify(params[k]) !== JSON.stringify(base[k]))
    : Object.keys(params);
  const lines = changed.map((k) =>
    k in params
      ? `${esc(k)}: ${esc(value(params[k]))}${base && !(k in base) ? ' <i>(new)</i>' : ''}`
      : `<s>${esc(k)}</s> <i>(missing)</i>`,
  );
  const same = keys.length - changed.length;
  return `<div><code>${where}</code>${lines.length ? `<pre>${lines.join('\n')}</pre>` : ''}${base && same ? `<small>${changed.length ? `+ ${same} field(s)` : `all ${same} field(s)`} as baseline</small>` : ''}</div>`;
};

const caseRow = (
  c: CaseResult,
  i: number,
  origin: string,
  base: Record<string, unknown> | undefined,
) => {
  const v = verdictOf(c);
  const reqs = c.requests
    .map((r) => requestHtml(r, origin, c.check === 'baseline' ? undefined : base))
    .join('');
  const extra = [
    c.invalid.length && `invalid: ${esc(c.invalid.join(', '))}`,
    c.events.canary && '<b>input rendered as HTML</b>',
    c.events.errors.length && `errors: ${esc(c.events.errors.join(' | '))}`,
    c.error && `error: ${esc(c.error)}`,
  ]
    .filter(Boolean)
    .join('<br>');
  return `<tr class="${v}"><td>${i + 1}</td><td><b class="v">${v}</b></td><td>${esc(c.label)}<br><small>${esc(c.check)}</small></td><td><code>${esc(c.field === null ? '—' : value(c.value))}</code></td><td>${c.expect}</td><td>${c.outcome}</td><td>${layer(c.state)}${c.before ? `<br><img class="before" src="${esc(c.before)}" alt="form before submit" loading="lazy">` : ''}</td><td>${reqs}${extra && `<small>${extra}</small>`}</td></tr>`;
};

const formSection = (form: Exercised & { findings: Finding[] }, origin: string) => {
  const verdicts = form.cases.map(verdictOf);
  const count = (v: Verdict) => verdicts.filter((x) => x === v).length;
  const f = form.form;
  const first = form.cases.find((c) => c.check === 'baseline')?.requests[0];
  const base = first && paramsOf(first);
  return `<section id="${esc(form.id)}">
<h2>${esc(form.id)} <small>${count('pass')} pass · ${count('fail')} fail · ${count('info')} info${form.skippedCases ? ` · ${form.skippedCases} not run` : ''}</small></h2>
<p class="meta">${esc(f.kind)} · <code>${esc(f.method.toUpperCase())} ${esc(f.action)}</code>${f.novalidate ? ' · novalidate' : ''}${f.adapters.length ? ` · ${esc(f.adapters.join(', '))}` : ''} · on ${form.pages.map((p) => `<a href="${esc(origin + p)}">${esc(p)}</a>`).join(', ')}</p>
<div class="top">${form.shot ? `<img src="${esc(form.shot)}" alt="${esc(form.id)} filled with accepted values" loading="lazy">` : '<p class="noshot">no screenshot (form hidden or zero-size)</p>'}
<table><tr><th>field</th><th>type</th><th>label</th><th>rules</th><th>accepted</th><th>rejected</th></tr>${form.fields
    .map(
      (x) =>
        `<tr${x.usable ? '' : ' class="off"'}><td><code>${esc(x.key)}</code></td><td>${esc(x.type)}</td><td>${esc(x.label)}</td><td>${rules(x)}</td><td>${esc((form.observed[x.key]?.accepted ?? []).join(', '))}</td><td>${esc((form.observed[x.key]?.rejected ?? []).join(', '))}</td></tr>`,
    )
    .join('')}</table></div>
${
  form.findings.length
    ? `<ul class="findings">${form.findings.map((x) => `<li class="${x.severity ?? 'error'}"><b>${esc(x.message.slice(form.id.length + 2))}</b>${x.details?.length ? `<br><small>${x.details.map(esc).join('<br>')}</small>` : ''}${x.fix ? `<br><i>${esc(x.fix)}</i>` : ''}</li>`).join('')}</ul>`
    : '<p class="ok">no findings</p>'
}
<table class="cases"><tr><th>#</th><th>verdict</th><th>case</th><th>value</th><th>expect</th><th>outcome</th><th>field state</th><th>requests / events</th></tr>${form.cases.map((c, i) => caseRow(c, i, origin, base)).join('')}</table>
</section>`;
};

export const reportHtml = (
  forms: (Exercised & { findings: Finding[] })[],
  failed: Finding[],
  origin: string,
) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>vidimus forms report</title>
<style>
body{font:13px/1.45 system-ui,sans-serif;margin:1.5rem;color:#222;background:#fafafa}
h1{font-size:1.3rem}h2{font-size:1.05rem;margin:0}h2 small{font-weight:400;color:#666}
section{background:#fff;border:1px solid #ddd;border-radius:6px;padding:1rem;margin:1.5rem 0}
.meta{color:#555;margin:.3rem 0 1rem}.top{display:flex;gap:1rem;align-items:flex-start;flex-wrap:wrap}
img.before{max-width:260px;max-height:260px;margin-top:.3rem}
img{max-width:420px;max-height:600px;border:1px solid #ccc;object-fit:contain;object-position:top}
table{border-collapse:collapse;flex:1}td,th{border-bottom:1px solid #eee;padding:.3rem .45rem;text-align:left;vertical-align:top}
th{background:#f3f3f3;font-weight:600}.cases{width:100%;margin-top:1rem}
pre{margin:.2rem 0;white-space:pre-wrap;word-break:break-all;font-size:11px;max-height:8rem;overflow:auto;background:#f6f6f6;padding:.2rem}
code{font-size:12px;overflow-wrap:anywhere}.findings small{overflow-wrap:anywhere}.inf{background:#fff3c4}.off{opacity:.45}
tr.pass .v{color:#17803d}tr.fail{background:#fdecec}tr.fail .v{color:#c62828}tr.info .v{color:#777}
.invalid{color:#c62828}.valid{color:#17803d}.findings li{margin:.3rem 0}.findings .warn b{color:#a15c00}.findings .error b{color:#c62828}
.ok{color:#17803d}nav a{margin-right:.8rem}
</style>
<h1>Forms: ${forms.length} exercised, ${forms.reduce((n, f) => n + f.cases.length, 0)} cases</h1>
<nav>${forms.map((f) => `<a href="#${esc(f.id)}">${esc(f.id)}</a>`).join('')}</nav>
${failed.length ? `<section><h2>not exercised</h2><ul>${failed.map((x) => `<li>${esc(x.message)}<br><small>${esc((x.details ?? []).join(' '))}</small></li>`).join('')}</ul></section>` : ''}
${forms.map((f) => formSection(f, origin)).join('\n')}
</html>
`;
