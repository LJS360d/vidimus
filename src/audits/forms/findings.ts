import type { Finding } from '../../core/types.ts';
import { AUTOCOMPLETE_FOR, kindOf } from './cases.ts';
import { show } from './page.ts';
import type { FieldInfo, FieldState } from './probe.ts';
import type { Captured } from './sandbox.ts';
import { type CaseResult, type Exercised, isSent } from './types.ts';

const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])$/;
const BLOCKED = /Failed to fetch|ERR_BLOCKED_BY_CLIENT|NetworkError|Network Error|Load failed/i;
const CSRF = /csrf|xsrf|_token|authenticity|nonce/i;

const BROKE: Record<string, (field: FieldInfo, other: string) => string> = {
  required: () => 'empty while required',
  minLength: (f) => `shorter than minlength ${f.minLength}`,
  pattern: (f) => `not matching pattern ${f.pattern}`,
  type: (f) => `not a valid ${f.type}`,
  min: (f) => `below min ${f.min}`,
  max: (f) => `above max ${f.max}`,
  step: (f) => `off step ${f.step}`,
  equals: (_, other) => `not matching ${other}`,
};

const layers = (state: FieldState | undefined) =>
  state ? `browser ${state.native}, framework ${state.framework}, ui ${state.ui}` : 'n/a';

const requestLine = (request: Captured, origin: string) =>
  `${request.method} ${request.url.startsWith(origin) ? request.url.slice(origin.length) || '/' : request.url}${
    request.body === undefined ? '' : `  ${JSON.stringify(request.body).slice(0, 160)}`
  }`;

const evidenceOf = (list: CaseResult[], origin: string) =>
  list
    .slice(0, 3)
    .flatMap((c) => [
      `${c.label}: ${show(c.value)}`,
      ...c.requests.slice(0, 1).map((r) => `  → ${requestLine(r, origin)}`),
    ]);

type Add = (message: string, rest: Omit<Finding, 'message' | 'where'>) => void;

interface Warning {
  message: (name: string, info: FieldInfo) => string;
  fix: (info: FieldInfo) => string;
}

const WARNINGS: Record<string, Warning> = {
  semantic: {
    message: (name, info) => `${name} accepts an invalid ${kindOf(info)}`,
    fix: (info) =>
      `Use <input type="${kindOf(info)}"> or add a ${kindOf(info)} rule to the form's validator.`,
  },
  whitespace: {
    message: (name) => `${name} accepts only spaces as a required value`,
    fix: () =>
      'Trim before validating, or add pattern=".*\\S.*", so blank input counts as missing.',
  },
  length: {
    message: (name) => `${name} has no length limit`,
    fix: () =>
      'Add maxlength (and the same limit on the server) so oversized input is refused early.',
  },
  'unsafe-url': {
    message: (name) => `${name} accepts javascript: URLs`,
    fix: () =>
      'Restrict the scheme, e.g. pattern="https?://.+", and check it on the server before rendering it as a link.',
  },
};

const NOVALIDATE_FIX =
  'The form has novalidate and no script validation: remove novalidate, or validate in the submit handler before sending. Repeat the check on the server.';
const DECLARED_FIX =
  'The rule is declared but the form sends anyway: validate before sending (call checkValidity()/reportValidity() or the form library validator in the submit handler). Repeat the check on the server.';

const sentChecks = (form: Exercised, origin: string, add: Add) => {
  const groups = new Map<string, CaseResult[]>();
  for (const c of form.cases.filter(isSent)) {
    const key = `${c.field}\u0000${c.check}\u0000${c.expect}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const [key, list] of groups) {
    const [name = '', check = ''] = key.split('\u0000');
    const info = form.fields.find((f) => f.key === name) as FieldInfo;
    const first = list[0] as CaseResult;
    const details = evidenceOf(list, origin);
    const warning = WARNINGS[check];
    if (first.expect === 'invalid' && Object.hasOwn(BROKE, check)) {
      const novalidate = form.form.novalidate && form.form.adapters.length === 1;
      const broke = (BROKE[check] as (typeof BROKE)[string])(info, form.confirms[name] ?? '');
      const inferred = info.inferred?.includes(check) ? ' (rule inferred from the page)' : '';
      add(`${name} sent ${broke}${inferred}`, {
        details: [...details, `layers: ${layers(first.state)}`],
        fix: novalidate ? NOVALIDATE_FIX : DECLARED_FIX,
      });
    } else if (warning) {
      add(warning.message(name, info), { severity: 'warn', details, fix: warning.fix(info) });
    } else if (check === 'empty-form' && first.expect === 'unknown') {
      add('empty form was sent', {
        severity: 'warn',
        details,
        fix: 'Mark the fields the form needs as required, or ignore empty submissions in the handler.',
      });
    }
  }
};

const baselineCheck = (form: Exercised, baseline: CaseResult | undefined, add: Add) => {
  if (
    !baseline ||
    form.form.kind !== 'form' ||
    isSent(baseline) ||
    baseline.outcome === 'error' ||
    baseline.outcome === 'timeout'
  )
    return;
  add('valid input sent nothing', {
    severity: 'warn',
    details: [
      `outcome: ${baseline.outcome}`,
      ...baseline.invalid.map(
        (key) =>
          `still invalid: ${key} ${layers(baseline.state && key === baseline.field ? baseline.state : undefined)}`,
      ),
    ],
    fix: 'The audit could not find values the form accepts, so "invalid value sent" checks prove nothing here. Give known-good values in forms.values, or allow a needed request with forms.allowRequests.',
  });
};

const requestChecks = (
  form: Exercised,
  baseline: CaseResult | undefined,
  origin: string,
  add: Add,
) => {
  const passwords = form.fields.filter((f) => kindOf(f) === 'password');
  const requests = form.cases.flatMap((c) => c.requests);
  const leak = requests.find(
    (r) => r.method === 'GET' && passwords.some((f) => new URL(r.url).searchParams.has(f.name)),
  );
  if (leak)
    add('password sent in the URL', {
      details: [requestLine(leak, origin)],
      fix: 'Use method="post" (or a POST request) for forms with credentials, so they stay out of URLs, logs and history.',
    });
  const plain = requests.find((r) => {
    const url = new URL(r.url);
    return url.protocol === 'http:' && !LOOPBACK.test(url.hostname);
  });
  if (plain)
    add(`data sent over plain HTTP to ${new URL(plain.url).host}`, {
      details: [requestLine(plain, origin)],
      fix: 'Send form data to an https:// URL.',
    });
  const post = baseline?.requests.find((r) => r.method === 'POST' && r.url.startsWith(origin));
  if (post && !form.form.hidden.some((name) => CSRF.test(name)))
    add('POST form without a CSRF token', {
      severity: 'warn',
      details: [requestLine(post, origin)],
      fix: 'Add a per-session CSRF token as a hidden field and check it on the server (or rely on SameSite=Lax/Strict session cookies and say so in an ignore rule).',
    });
};

const fieldChecks = (form: Exercised, add: Add) => {
  const { fields, cases } = form;
  for (const f of fields.filter((f) => f.type === 'text' && kindOf(f) === 'password'))
    add(`${f.key} looks like a password but is type="text"`, {
      severity: 'warn',
      fix: 'Use <input type="password"> so the value is masked and password managers recognise it.',
    });

  const missing = fields.filter((f) => f.usable && AUTOCOMPLETE_FOR[kindOf(f)] && !f.autocomplete);
  if (missing.length)
    add(`${missing.length} personal-data field(s) without autocomplete`, {
      severity: 'warn',
      details: missing.map((f) => `${f.key}: autocomplete="${AUTOCOMPLETE_FOR[kindOf(f)]}"`),
      fix: 'Add the listed autocomplete tokens so browsers and assistive tech can fill them (WCAG 1.3.5).',
    });

  const unannounced = new Set<string>();
  for (const c of cases) {
    const s = c.state;
    if (!c.field || !s || c.expect !== 'invalid' || s.ariaInvalid || s.native === 'invalid')
      continue;
    if (s.framework === 'invalid' || s.ui === 'invalid') unannounced.add(c.field);
  }
  if (unannounced.size)
    add(`${[...unannounced].join(', ')} shows an error without aria-invalid`, {
      severity: 'warn',
      fix: 'Set aria-invalid="true" on the field while it is invalid and point aria-describedby at the error text.',
    });
};

const runtimeChecks = (form: Exercised, add: Add) => {
  const { cases } = form;
  // The sandbox aborting the app's own request is expected, not a bug in the page.
  const errors = [
    ...new Set(cases.flatMap((c) => [...c.events.errors, ...(c.error ? [c.error] : [])])),
  ].filter((error) => !BLOCKED.test(error));
  if (errors.length)
    add('script errors while filling or submitting', {
      severity: 'warn',
      details: errors.slice(0, 5),
      fix: 'Fix the errors listed; they can leave the form half-validated for real users too.',
    });
  for (const c of cases.filter((c) => c.outcome === 'timeout'))
    add(`form case timed out: ${c.field ?? 'form'}/${c.check}`, {
      details: [c.label],
      fix: 'The submit handler never settles: check for blocking dialogs (alert, confirm, beforeunload), infinite loops or a navigation that never commits, or raise forms.caseTimeout.',
    });
  if (form.dialogs?.length)
    add('submit shows a blocking dialog (alert/confirm/prompt)', {
      severity: 'warn',
      details: form.dialogs.slice(0, 5),
      fix: 'Use inline status text instead: dialogs block assistive technology and automation until dismissed.',
    });
  if (form.abortedCases)
    add(`${form.abortedCases} cases skipped after repeated timeouts`, {
      fix: 'Fix the submit handler that never settles, or raise forms.caseTimeout.',
    });
  const workers = [...new Set(cases.flatMap((c) => c.events.workers))];
  if (workers.length)
    add('page starts web workers, whose requests the sandbox cannot see', {
      severity: 'warn',
      details: workers,
      fix: 'Check that the workers do not send form data, or exclude the page with forms.exclude.',
    });
  if (form.skippedCases)
    add(`${form.skippedCases} cases not run`, {
      severity: 'warn',
      fix: 'Raise forms.maxCases to exercise every case.',
    });
};

export const findingsFor = (form: Exercised, origin: string): Finding[] => {
  const out: Finding[] = [];
  const add: Add = (message, rest) =>
    out.push({ message: `${form.id}: ${message}`, where: form.pages, ...rest });
  const baseline = form.cases.find((c) => c.check === 'baseline');

  sentChecks(form, origin, add);
  for (const c of form.cases.filter((c) => c.events.canary))
    add(`${c.field} value is rendered as HTML`, {
      details: [`${c.label}: ${show(c.value)} became a <i data-vidimus-canary> element`],
      fix: 'Insert user input as text (textContent, framework text bindings), never as HTML (innerHTML, dangerouslySetInnerHTML, v-html, [innerHTML]).',
    });
  const double = form.cases.find((c) => c.check === 'double-submit');
  if (double && double.requests.length > 1)
    add(`double click on submit sent ${double.requests.length} requests`, {
      severity: 'warn',
      details: double.requests.slice(0, 3).map((r) => requestLine(r, origin)),
      fix: 'Disable the submit button, or ignore submits, while a request is in flight.',
    });
  baselineCheck(form, baseline, add);
  requestChecks(form, baseline, origin, add);
  fieldChecks(form, add);
  runtimeChecks(form, add);
  return out;
};
