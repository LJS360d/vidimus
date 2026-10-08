import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from '../../core/peer-types.ts';
import { span } from '../../core/profile.ts';
import type { Audit, Finding } from '../../core/types.ts';
import { inParallel, navigate, onePagePerTemplate, pathOf } from '../../core/util.ts';
import {
  AUTOCOMPLETE_FOR,
  alternatesFor,
  type Case,
  casesFor,
  fingerprintOf,
  formId,
  kindOf,
} from './cases.ts';
import {
  type FieldInfo,
  type FieldState,
  type FormInfo,
  type PageEvents,
  probe,
  type Value,
} from './probe.ts';
import { type Captured, sandbox } from './sandbox.ts';

type Outcome =
  | 'sent'
  | 'navigated'
  | 'blocked:native'
  | 'blocked:script'
  | 'none'
  | 'not-submitted'
  | 'error';

interface CaseResult extends Omit<Case, 'values'> {
  value?: Value;
  outcome: Outcome;
  requests: Captured[];
  state?: FieldState;
  invalid: string[];
  events: Omit<PageEvents, 'submits' | 'invalid'>;
  error?: string;
}

interface Found {
  url: string;
  path: string;
  form: FormInfo;
  id: string;
  fingerprint: string;
}

interface Exercised {
  id: string;
  fingerprint: string;
  pages: string[];
  form: FormInfo;
  fields: FieldInfo[];
  confirms: Record<string, string>;
  cases: CaseResult[];
  skippedCases: number;
  observed: Record<string, { accepted: string[]; rejected: string[] }>;
}

// Per field: which tried values the form let through and which it stopped.
const observedOf = (fields: FieldInfo[], results: CaseResult[]) =>
  Object.fromEntries(
    fields.map((f) => {
      const mine = results.filter((c) => c.field === f.key);
      const value = (c: CaseResult) => c.label.slice(f.key.length + 1);
      const stopped = (c: CaseResult) =>
        c.outcome.startsWith('blocked') || c.outcome === 'not-submitted';
      return [
        f.key,
        {
          accepted: mine.filter((c) => SENT.has(c.outcome)).map(value),
          rejected: mine.filter(stopped).map(value),
        },
      ];
    }),
  );

const LOOPBACK = /^(localhost|127(\.\d+){3}|\[::1\])$/;
const SENT = new Set<Outcome>(['sent', 'navigated']);
const BLOCKED = /Failed to fetch|ERR_BLOCKED_BY_CLIENT|NetworkError|Network Error|Load failed/i;
const CSRF = /csrf|xsrf|_token|authenticity|nonce/i;
// 1x1 transparent PNG: accepted by image/* inputs and harmless everywhere else.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const show = (value: Value | undefined) => {
  const text = JSON.stringify(value ?? null);
  return text.length > 40 ? `${text.slice(0, 30)}…(${String(value).length} chars)` : text;
};
const requestLine = (request: Captured, origin: string) =>
  `${request.method} ${request.url.startsWith(origin) ? request.url.slice(origin.length) || '/' : request.url}${
    request.body === undefined ? '' : `  ${JSON.stringify(request.body).slice(0, 160)}`
  }`;

// What a sent value broke, for each rule a field declares (or the audit inferred).
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

const findingsFor = (form: Exercised, origin: string): Finding[] => {
  const { id, pages, fields, cases } = form;
  const where = pages;
  const field = (key: string | null) => fields.find((f) => f.key === key);
  const out: Finding[] = [];
  const add = (message: string, rest: Omit<Finding, 'message' | 'where'>) =>
    out.push({ message: `${id}: ${message}`, where, ...rest });
  const sent = cases.filter((c) => SENT.has(c.outcome));
  const byFieldCheck = new Map<string, CaseResult[]>();
  for (const c of sent) {
    const key = `${c.field}\u0000${c.check}`;
    byFieldCheck.set(key, [...(byFieldCheck.get(key) ?? []), c]);
  }
  const evidence = (list: CaseResult[]) =>
    list
      .slice(0, 3)
      .flatMap((c) => [
        `${c.label}: ${show(c.value)}`,
        ...c.requests.slice(0, 1).map((r) => `  → ${requestLine(r, origin)}`),
      ]);

  for (const [key, list] of byFieldCheck) {
    const [name = '', check = ''] = key.split('\u0000');
    // Every sent case changed one field (or the whole form, which BROKE never covers).
    const info = field(name) as FieldInfo;
    const first = list[0] as CaseResult;
    if (first.expect === 'invalid' && Object.hasOwn(BROKE, check)) {
      const novalidate = form.form.novalidate && form.form.adapters.length === 1;
      const broke = (BROKE[check] as (typeof BROKE)[string])(info, form.confirms[name] ?? '');
      const inferred = info.inferred?.includes(check) ? ' (rule inferred from the page)' : '';
      add(`${name} sent ${broke}${inferred}`, {
        details: [...evidence(list), `layers: ${layers(first.state)}`],
        fix: novalidate
          ? 'The form has novalidate and no script validation: remove novalidate, or validate in the submit handler before sending. Repeat the check on the server.'
          : 'The rule is declared but the form sends anyway: validate before sending (call checkValidity()/reportValidity() or the form library validator in the submit handler). Repeat the check on the server.',
      });
    } else if (check === 'semantic') {
      const kind = kindOf(info);
      add(`${name} accepts an invalid ${kind}`, {
        severity: 'warn',
        details: evidence(list),
        fix: `Use <input type="${kind}"> or add a ${kind} rule to the form's validator.`,
      });
    } else if (check === 'whitespace') {
      add(`${name} accepts only spaces as a required value`, {
        severity: 'warn',
        details: evidence(list),
        fix: 'Trim before validating, or add pattern=".*\\S.*", so blank input counts as missing.',
      });
    } else if (check === 'length') {
      add(`${name} has no length limit`, {
        severity: 'warn',
        details: evidence(list),
        fix: 'Add maxlength (and the same limit on the server) so oversized input is refused early.',
      });
    } else if (check === 'unsafe-url') {
      add(`${name} accepts javascript: URLs`, {
        severity: 'warn',
        details: evidence(list),
        fix: 'Restrict the scheme, e.g. pattern="https?://.+", and check it on the server before rendering it as a link.',
      });
    } else if (check === 'empty-form' && first.expect === 'unknown') {
      add('empty form was sent', {
        severity: 'warn',
        details: evidence(list),
        fix: 'Mark the fields the form needs as required, or ignore empty submissions in the handler.',
      });
    }
  }

  for (const c of cases.filter((c) => c.events.canary))
    add(`${c.field} value is rendered as HTML`, {
      details: [`${c.label}: ${show(c.value)} became a <i data-vidimus-canary> element`],
      fix: 'Insert user input as text (textContent, framework text bindings), never as HTML (innerHTML, dangerouslySetInnerHTML, v-html, [innerHTML]).',
    });

  const double = cases.find((c) => c.check === 'double-submit');
  if (double && double.requests.length > 1)
    add(`double click on submit sent ${double.requests.length} requests`, {
      severity: 'warn',
      details: double.requests.slice(0, 3).map((r) => requestLine(r, origin)),
      fix: 'Disable the submit button, or ignore submits, while a request is in flight.',
    });

  const baseline = cases.find((c) => c.check === 'baseline');
  if (
    baseline &&
    // Formless groups often hold local widgets ("Add", "Filter"): only real forms count here.
    form.form.kind === 'form' &&
    !SENT.has(baseline.outcome) &&
    baseline.outcome !== 'error'
  )
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

  const passwords = fields.filter((f) => kindOf(f) === 'password');
  const requests = cases.flatMap((c) => c.requests);
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
  const post = baseline?.requests.find(
    (r) => r.navigation && r.method === 'POST' && r.url.startsWith(origin),
  );
  if (post && !form.form.hidden.some((name) => CSRF.test(name)))
    add('POST form without a CSRF token', {
      severity: 'warn',
      details: [requestLine(post, origin)],
      fix: 'Add a per-session CSRF token as a hidden field and check it on the server (or rely on SameSite=Lax/Strict session cookies and say so in an ignore rule).',
    });

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
  return out;
};

const layers = (state: FieldState | undefined) =>
  state ? `browser ${state.native}, framework ${state.framework}, ui ${state.ui}` : 'n/a';

export const forms: Audit = {
  name: 'forms',
  description: 'fill every form with valid and invalid values, sandboxed submits',
  requires: 'server',
  async run({ config, origin, resolve, pageUrls, launchBrowser, log }) {
    const options = config.forms;
    if (!LOOPBACK.test(new URL(origin).hostname) && !options.allowRemote)
      return {
        status: 'skipped',
        summary: `not pressing submit buttons on ${origin}: set forms.allowRemote to audit a remote site`,
      };
    const urls = onePagePerTemplate(pageUrls({ exclude: options.exclude }), options.sample, origin);
    const out = resolve(config.outDir, options.outDir);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const scratch = mkdtempSync(join(tmpdir(), 'vidimus-forms-'));
    const upload = join(scratch, 'vidimus.png');
    writeFileSync(upload, PNG);

    const browser = await launchBrowser();
    const open = async (url: string) => {
      const context = await (browser as Browser).createBrowserContext();
      const page = await context.newPage();
      const net = await sandbox(page, options.allowRequests, options.stub);
      await page.evaluateOnNewDocument(probe, options.skip);
      const load = async () => {
        net.arm(false);
        await navigate(page, url, { waitFor: config.render.waitFor, timeout: options.timeout });
        net.arm(true);
        net.take();
        await page.evaluate(() => window.__vidimus.drain());
      };
      await load();
      return { page, net, load, close: () => context.close().catch(() => {}) };
    };

    type Session = Awaited<ReturnType<typeof open>>;
    const failed: Finding[] = [];
    const found: Found[] = [];
    const exercised: Exercised[] = [];
    try {
      await inParallel(options.concurrency, urls, async (url) => {
        const path = pathOf(url, origin);
        let session: Awaited<ReturnType<typeof open>> | undefined;
        try {
          session = await open(url);
          const list = await session.page.evaluate(() => window.__vidimus.forms());
          const html = list.some((f) => f.ordinal !== null)
            ? await fetch(url).then(
                (r) => r.text(),
                () => '',
              )
            : '';
          for (const form of list)
            found.push({
              url,
              path,
              form,
              id: formId(form, path, html),
              fingerprint: fingerprintOf(form, origin),
            });
        } catch (error) {
          failed.push({
            message: `failed to load ${path}`,
            details: [(error as Error).message],
            where: [path],
            fix: `Check that ${path} loads within forms.timeout (${options.timeout} ms), or add it to forms.exclude.`,
          });
        } finally {
          await session?.close();
        }
      });

      // The same form on many pages (a footer newsletter) is exercised once. Look-alike forms
      // on one page stay apart: the n-th of them only matches the n-th on another page.
      const groups = new Map<string, Found[]>();
      const seen = new Map<string, number>();
      for (const item of found.sort(
        (a, b) => a.path.localeCompare(b.path) || a.form.index - b.form.index,
      )) {
        const nth = seen.get(`${item.path} ${item.fingerprint}`) ?? 0;
        seen.set(`${item.path} ${item.fingerprint}`, nth + 1);
        const key = `${item.fingerprint}#${nth}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      const ids = new Map<string, number>();
      const unique = [...groups.values()].map((items) => {
        const first = items[0] as Found;
        const seen = (ids.get(first.id) ?? 0) + 1;
        ids.set(first.id, seen);
        return {
          first,
          id: seen > 1 ? `${first.id}~${seen}` : first.id,
          pages: [...new Set(items.map((i) => i.path))],
        };
      });

      await inParallel(options.concurrency, unique, async ({ first, id, pages }) => {
        const { url, form, fingerprint } = first;
        const index = form.index;
        let session: Session | undefined;
        try {
          session = await open(url);
          const { page, net } = session;
          // Find a baseline the form really accepts. Ticking boxes and picking options can
          // reveal more fields, and undeclared rules can reject the generated values: fill,
          // try alternatives for rejected fields, rescan, repeat.
          let fields = form.fields;
          const known: Record<string, Value> = {};
          const rejected = (state: FieldState | undefined) =>
            !!state &&
            (state.native === 'invalid' || state.framework === 'invalid' || state.ui === 'invalid');
          fields = await span('forms.baseline', async () => {
            for (let round = 0; round < 3; round++) {
              const { baseline } = casesFor(fields, options.values, known);
              await page.evaluate((i, v) => window.__vidimus.fill(i, v, null), index, baseline);
              await settled(page);
              let states = await page.evaluate((i) => window.__vidimus.observe(i), index);
              for (const field of fields.filter((f) => f.usable && !(f.key in known))) {
                if (!rejected(states[field.key])) continue;
                for (const value of alternatesFor(field)) {
                  await page.evaluate((i, v) => window.__vidimus.fill(i, v, null), index, {
                    [field.key]: value,
                  });
                  await settled(page);
                  states = await page.evaluate((i) => window.__vidimus.observe(i), index);
                  if (rejected(states[field.key])) continue;
                  known[field.key] = value;
                  break;
                }
              }
              const rescanned =
                (await page.evaluate(() => window.__vidimus.forms()))[index]?.fields ?? fields;
              const keys = new Set(fields.map((f) => f.key));
              const added = rescanned.filter((f) => !keys.has(f.key) && f.usable);
              if (!added.length) break;
              fields = [...fields, ...added];
            }
            return fields;
          });
          // Rules the markup does not declare (Angular Validators, Zod, custom code) are found
          // by probing one field at a time, so their boundaries get cases too.
          const accepted = casesFor(fields, options.values, known).baseline;
          await page.evaluate((i, v) => window.__vidimus.fill(i, v, null), index, accepted);
          fields = await span('forms.infer', () => inferAll(page, index, fields, accepted));
          const generated = casesFor(fields, options.values, known);
          const cases = generated.cases.slice(0, options.maxCases);
          const results: CaseResult[] = [];
          let dirty = true;
          for (const c of cases) {
            const { values, ...rest } = c;
            const base = { ...rest, ...(c.field && { value: values[c.field] }) };
            try {
              const reload = dirty;
              const ran = await span(
                'forms.case',
                async () => {
                  if (reload) await span('forms.reload', () => (session as Session).load());
                  return runCase(
                    page,
                    net,
                    index,
                    c,
                    fields,
                    upload,
                    options.settle,
                    !!form.submitter || form.kind === 'form',
                  );
                },
                { case: c.label },
              );
              results.push(ran);
              const last = ran;
              dirty = last.outcome !== 'blocked:native' && last.outcome !== 'not-submitted';
            } catch (error) {
              results.push({
                ...base,
                outcome: 'error',
                requests: net.take(),
                invalid: [],
                events: { errors: [], sockets: [], opened: [], workers: [], canary: false },
                error: (error as Error).message.split('\n')[0],
              });
              dirty = true;
            }
          }
          exercised.push({
            id,
            fingerprint,
            pages,
            form: { ...form, fields },
            fields,
            confirms: Object.fromEntries(generated.confirms),
            cases: results,
            skippedCases: generated.cases.length - cases.length,
            observed: observedOf(fields, results),
          });
        } catch (error) {
          failed.push({
            message: `${id}: could not be exercised`,
            details: [(error as Error).message.split('\n')[0] ?? ''],
            where: pages,
            fix: `Check that ${first.path} loads within forms.timeout (${options.timeout} ms), or skip the form with forms.skip.`,
          });
        } finally {
          await session?.close();
        }
      });
    } finally {
      await browser.close();
      rmSync(scratch, { recursive: true, force: true });
    }

    exercised.sort((a, b) => a.id.localeCompare(b.id));
    const file = (id: string) => `${id.replace(/[^\w.~-]+/g, '_')}.json`;
    for (const form of exercised)
      writeFileSync(join(out, file(form.id)), `${JSON.stringify(form, null, 2)}\n`);
    writeFileSync(
      join(out, 'index.json'),
      `${JSON.stringify(
        exercised.map(({ id, fingerprint, pages, cases }) => ({
          id,
          fingerprint,
          pages,
          cases: cases.length,
          file: file(id),
        })),
        null,
        2,
      )}\n`,
    );
    log(`forms: wrote ${exercised.length} report(s) to ${out}`);

    const findings = [...exercised.flatMap((form) => findingsFor(form, origin)), ...failed];
    const caseCount = exercised.reduce((sum, form) => sum + form.cases.length, 0);
    const pagesWithForms = new Set(exercised.flatMap((form) => form.pages)).size;
    return {
      summary: exercised.length
        ? `${exercised.length} form(s) on ${pagesWithForms} of ${urls.length} page(s), ${caseCount} cases${findings.length ? '' : ', no findings'}`
        : `${urls.length} page(s), no forms`,
      findings,
    };
  },
};

const runCase = async (
  page: Page,
  net: Awaited<ReturnType<typeof sandbox>>,
  index: number,
  c: Case,
  fields: FieldInfo[],
  upload: string,
  settle: number,
  submittable: boolean,
): Promise<CaseResult> => {
  const { values, ...original } = c;
  let rest = original;
  const tail = await page.evaluate(
    (i, v, t) => window.__vidimus.fill(i, v, t),
    index,
    values,
    c.field,
  );
  if (tail && c.field) {
    await page.evaluate((i, k) => window.__vidimus.focus(i, k), index, c.field);
    await page.keyboard.type(tail);
    await page.evaluate((i, k) => window.__vidimus.blur(i, k), index, c.field);
  }
  for (const field of fields.filter((f) => f.type === 'file' && values[f.key])) {
    const handle = await page.evaluateHandle(
      (i, k) => window.__vidimus.element(i, k),
      index,
      field.key,
    );
    const input = handle.asElement() as unknown as {
      uploadFile(...paths: string[]): Promise<void>;
    } | null;
    await input?.uploadFile(upload);
    await handle.dispose();
  }
  await settled(page);
  const states = await page.evaluate((i) => window.__vidimus.observe(i), index);
  // The browser may refuse input (typing past maxlength, sanitising email or number values):
  // then the case did not test what it meant to and proves nothing either way.
  const intended = c.field ? values[c.field] : undefined;
  const actual = c.field ? states[c.field]?.value : undefined;
  if (typeof intended === 'string' && actual !== undefined && actual !== intended)
    rest = { ...rest, expect: 'unknown', label: `${rest.label} (browser kept ${show(actual)})` };
  const invalid = Object.entries(states)
    .filter(([, s]) => s.native === 'invalid' || s.framework === 'invalid' || s.ui === 'invalid')
    .map(([key]) => key);

  let outcome: Outcome = 'not-submitted';
  let events = await page.evaluate(() => window.__vidimus.drain());
  if (
    submittable &&
    (await page.evaluate((i, n) => window.__vidimus.submit(i, n), index, c.times ?? 1))
  ) {
    await sleep(20);
    let after = await page.evaluate(() => window.__vidimus.drain());
    // Browser validation blocks synchronously; anything else gets the settle window.
    const nativeBlock = after.invalid.length > 0 && after.submits.length === 0;
    if (!nativeBlock) {
      await span('forms.settle', async () => {
        // Wait up to settle ms for the form to send; once it has, a short grace period catches
        // a second request (double submit) and the wait ends.
        const until = performance.now() + settle;
        while (performance.now() < until && !net.pending()) await sleep(25);
        if (net.pending()) await sleep(50);
      });
      const more = await page.evaluate(() => window.__vidimus.drain());
      after = mergeEvents(after, more);
    }
    events = mergeEvents(events, after);
    const requests = net.take();
    outcome = requests.some((r) => r.navigation)
      ? 'navigated'
      : requests.length
        ? 'sent'
        : nativeBlock
          ? 'blocked:native'
          : after.submits.some((s) => s.prevented)
            ? 'blocked:script'
            : 'none';
    return result(rest, values, outcome, requests, states, invalid, events);
  }
  return result(rest, values, outcome, net.take(), states, invalid, events);
};

const TEXTUAL = new Set(['text', 'name']);
const UPPER = 1e9;

// Probes one field with values around what it accepts and reads back whether any layer
// rejects them. Monotone searches only: a rule that is not "longer/larger is fine" stays unknown.
const infer = async (page: Page, index: number, field: FieldInfo, base: Value) => {
  const ok = async (value: Value) => {
    await page.evaluate((i, v) => window.__vidimus.fill(i, v, null), index, { [field.key]: value });
    await settled(page);
    const s = (await page.evaluate((i) => window.__vidimus.observe(i), index))[field.key];
    return !!s && s.native !== 'invalid' && s.framework !== 'invalid' && s.ui !== 'invalid';
  };
  // Smallest value in (lo, hi] that passes, given lo fails and hi passes.
  const search = async (lo: number, hi: number, at: (n: number) => Value) => {
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (await ok(at(mid))) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const found: Partial<FieldInfo> & { inferred: string[] } = { inferred: [] };
  const kind = kindOf(field);
  const empty = field.type === 'checkbox' ? false : field.type === 'radio' ? null : '';
  if (!field.required && field.type !== 'file' && !(await ok(empty))) {
    found.required = true;
    found.inferred.push('required');
  }
  if (typeof base === 'string' && field.type === 'number' && base !== '') {
    const value = Number(base);
    if (field.min === undefined && !(await ok(String(-UPPER)))) {
      found.min = String(await search(-UPPER, value, String));
      found.inferred.push('min');
    }
    if (field.max === undefined && !(await ok(String(UPPER)))) {
      // Largest passing value: search on the negated axis.
      found.max = String(-(await search(-UPPER, -value, (n) => String(-n))));
      found.inferred.push('max');
    }
  }
  if (
    typeof base === 'string' &&
    TEXTUAL.has(kind) &&
    TEXT_TYPES.has(field.type) &&
    !field.pattern
  ) {
    if (field.minLength === undefined && base.length > 1 && !(await ok(base.slice(0, 1)))) {
      found.minLength = await search(1, base.length, (n) => base.slice(0, n));
      found.inferred.push('minLength');
    }
    if (field.maxLength === undefined && !(await ok(base.padEnd(LONG, 'x')))) {
      // Largest passing length, between the baseline (passes) and LONG (fails).
      found.maxLength = -(await search(-LONG, -base.length, (n) => base.padEnd(-n, 'x')));
      found.inferred.push('maxLength');
    }
  }
  await ok(base);
  return found.inferred.length ? found : undefined;
};

const inferAll = async (
  page: Page,
  index: number,
  fields: FieldInfo[],
  base: Record<string, Value>,
) => {
  const out: FieldInfo[] = [];
  for (const field of fields) {
    const found =
      field.usable && field.key in base
        ? await infer(page, index, field, base[field.key] ?? null)
        : undefined;
    out.push(found ? { ...field, ...found } : field);
  }
  return out;
};

const TEXT_TYPES = new Set(['text', 'search', 'textarea', 'password']);
const LONG = 10_000;

// Let frameworks re-render after the last event before reading what the user would see.
const settled = (page: Page) =>
  page.evaluate(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done))));

const mergeEvents = (a: PageEvents, b: PageEvents): PageEvents => ({
  submits: [...a.submits, ...b.submits],
  invalid: [...a.invalid, ...b.invalid],
  errors: [...a.errors, ...b.errors],
  sockets: [...a.sockets, ...b.sockets],
  opened: [...a.opened, ...b.opened],
  workers: [...a.workers, ...b.workers],
  canary: a.canary || b.canary,
});

const result = (
  rest: Omit<Case, 'values'>,
  values: Record<string, Value>,
  outcome: Outcome,
  requests: Captured[],
  states: Record<string, FieldState>,
  invalid: string[],
  { submits: _s, invalid: _i, ...events }: PageEvents,
): CaseResult => ({
  ...rest,
  ...(rest.field && { value: values[rest.field], state: states[rest.field] }),
  outcome,
  requests,
  invalid,
  events,
});
