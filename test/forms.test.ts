import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  casesFor,
  formId,
  formLine,
  fromPattern,
  kindOf,
  matches,
  slugOf,
} from '../src/audits/forms/cases.ts';
import type { FieldInfo, FormInfo } from '../src/audits/forms/probe.ts';
import { parseBody } from '../src/audits/forms/sandbox.ts';
import { run } from '../src/index.ts';
import { fixture } from './helpers.ts';

const browserPath = async () => {
  try {
    const { default: puppeteer } = await import('puppeteer');
    return await puppeteer.executablePath();
  } catch {
    return '';
  }
};
const executable = await browserPath();
const noBrowser = !executable || !existsSync(executable);

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const field = (overrides: Partial<FieldInfo>): FieldInfo => ({
  key: 'f',
  name: 'f',
  id: '',
  tag: 'input',
  type: 'text',
  label: '',
  autocomplete: '',
  usable: true,
  required: false,
  multiple: false,
  options: [],
  custom: [],
  ...overrides,
});

const page = (body: string) =>
  `<!doctype html>\n<html lang="en"><head><title>t</title></head>\n<body>\n${body}\n</body></html>`;

describe('forms cases', () => {
  it('derives deterministic ids', () => {
    const html = '<!-- <form> -->\n<script>"<form>"</script>\n<p>\n<form action="/a">';
    assert.equal(formLine(html, 0), 4);
    assert.equal(slugOf('/blog/post-1/'), 'blog_post-1');
    assert.equal(slugOf('/'), 'index');
    const form = { id: '', name: '', ordinal: 0, index: 2 } as FormInfo;
    assert.equal(formId(form, '/contact/', html), 'contact_form_L4');
    assert.equal(formId({ ...form, ordinal: null }, '/contact/', html), 'contact_form_3');
    assert.equal(formId({ ...form, id: 'signup' }, '/contact/', html), 'signup');
  });

  it('generates a value matching common patterns', () => {
    for (const pattern of ['[A-Z]{2}\\d{4}', '\\d{5}(-\\d{4})?', '(foo|bar)-[a-z]+', '[^@]+@[^@]+'])
      assert.equal(matches(pattern, fromPattern(pattern) ?? ''), true, pattern);
  });

  it('grinds boundaries and violations of declared constraints', () => {
    const fields = [
      field({ key: 'email', name: 'email', label: 'Email', required: true }),
      field({ key: 'code', name: 'code', minLength: 3, maxLength: 5 }),
      field({ key: 'age', name: 'age', type: 'number', min: '18', max: '99' }),
      field({ key: 'password', name: 'password', type: 'password' }),
      field({ key: 'confirm', name: 'confirm', type: 'password', label: 'Confirm password' }),
    ];
    assert.equal(kindOf(fields[0] as FieldInfo), 'email');
    const { baseline, cases } = casesFor(fields);
    assert.equal(baseline.email, 'vidimus@example.com');
    assert.equal(baseline.confirm, baseline.password);
    const labels = cases.map((c) => `${c.label}|${c.expect}|${c.check}`);
    for (const expected of [
      'email=empty|invalid|required',
      'email="vidimus"|invalid|semantic',
      'code=minlength-1 (2)|invalid|minLength',
      'code=maxlength (5)|valid|maxLength',
      'age=min-1 "17"|invalid|min',
      'age=max+1 "100"|invalid|max',
      'confirm≠password|invalid|equals',
      'all empty|invalid|empty-form',
    ])
      assert.ok(labels.includes(expected), `${expected}\n${labels.join('\n')}`);
    // Changing the password changes what the confirmation must repeat.
    const changed = cases.find((c) => c.label === 'password=empty');
    assert.equal(changed?.values.confirm, '');
  });

  it('parses request bodies', () => {
    assert.deepEqual(parseBody('application/x-www-form-urlencoded', 'a=1&b=2'), { a: '1', b: '2' });
    assert.deepEqual(parseBody('application/json', '{"a":1}'), { a: 1 });
    assert.deepEqual(parseBody('text/plain;charset=UTF-8', '[1]'), [1]);
  });
});

describe('forms audit', () => {
  it('never lets a submission reach a server', { skip: noBrowser }, async () => {
    const hits: string[] = [];
    const target = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.end('ok');
    });
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    const api = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    try {
      const cwd = fixture({
        'dist/index.html': page(`
<form id="native" action="${api}/post" method="post"><input name="q" required><button>Go</button></form>
<form id="get" action="${api}/get"><input name="q"><button>Go</button></form>
<form id="blank" action="${api}/blank" method="post" target="_blank"><input name="q"><button>Go</button></form>
<form id="scripted"><input name="q"><button>Go</button></form>
<script>
document.getElementById('scripted').addEventListener('submit', (event) => {
  event.preventDefault();
  fetch('${api}/fetch', { method: 'POST', body: 'x' });
  fetch('${api}/fetch-get');
  navigator.sendBeacon('${api}/beacon', 'x');
  new WebSocket('${api.replace('http', 'ws')}/ws');
  window.open('${api}/open');
});
</script>`),
      });
      const { results } = await run({
        cwd,
        env: {},
        audits: ['forms'],
        reporters: [],
        overrides: { port: await freePort(), forms: { settle: 200 } },
      });
      assert.notEqual(results[0]?.status, 'errored', results[0]?.summary);
      assert.match(results[0]?.summary ?? '', /4 form\(s\)/);
      assert.deepEqual(hits, []);
      const scripted = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/scripted.json'), 'utf8'));
      const baseline = scripted.cases.find((c: { check: string }) => c.check === 'baseline');
      assert.deepEqual(
        baseline.requests.map((r: { url: string }) => r.url.replace(api, '')).sort(),
        ['/beacon', '/fetch', '/fetch-get'],
      );
      assert.deepEqual(baseline.events.sockets, [`${api.replace('http', 'ws')}/ws`]);
    } finally {
      target.close();
    }
  });

  it('reports missing validation and unsafe output', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/contact/index.html': page(`<p>contact</p>
<form action="/api/contact" method="post" novalidate>
  <label>Email <input name="email" required></label>
  <label>Name <input name="name" autocomplete="name"></label>
  <button>Send</button>
</form>
<div id="out"></div>
<script>
document.querySelector('[name=name]').addEventListener('input', (e) => {
  document.getElementById('out').innerHTML = e.target.value;
});
</script>`),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { settle: 100 } },
    });
    const messages = results[0]?.findings.map(({ message }) => message) ?? [];
    for (const expected of [
      'contact_form_L5: email sent empty while required',
      'contact_form_L5: email accepts an invalid email',
      'contact_form_L5: name value is rendered as HTML',
      'contact_form_L5: 1 personal-data field(s) without autocomplete',
      'contact_form_L5: POST form without a CSRF token',
    ])
      assert.ok(messages.includes(expected), `${expected}\n${messages.join('\n')}`);
    assert.equal(results[0]?.status, 'failed');
  });

  it('accepts a well-validated form and exercises formless groups', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="signup" action="/api/signup" method="post">
  <input type="hidden" name="csrf_token" value="t">
  <label>Email <input type="email" name="email" required autocomplete="email"></label>
  <label>Code <input name="code" required pattern="[A-Z]{3}" maxlength="3"></label>
  <label>Age <input type="number" name="age" min="18" max="99" step="1"></label>
  <label><input type="checkbox" name="terms" required> Terms</label>
  <button>Sign up</button>
</form>
<div class="widget"><input aria-label="Quantity" name="qty"><button type="button">Add</button></div>`),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { settle: 100 } },
    });
    const result = results[0];
    const messages = result?.findings.map(({ message }) => message) ?? [];
    assert.deepEqual(
      messages.filter((m) => m.startsWith('signup:')),
      [],
      messages.join('\n'),
    );
    assert.match(result?.summary ?? '', /2 form\(s\)/);
    const signup = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/signup.json'), 'utf8'));
    const outcome = (label: string) =>
      signup.cases.find((c: { label: string }) => c.label === label)?.outcome;
    assert.equal(outcome('baseline'), 'navigated');
    assert.equal(outcome('email=empty'), 'blocked:native');
    assert.equal(outcome('terms=unchecked'), 'blocked:native');
    assert.equal(outcome('age=max+1 "100"'), 'blocked:native');
  });

  it('infers rules the markup does not declare by probing the page', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="custom" novalidate>
  <label>Username <input name="username"></label>
  <label>Age <input type="number" name="age"></label>
  <button>Save</button>
</form>
<script>
const form = document.getElementById('custom');
const rules = { username: (v) => v.length >= 3, age: (v) => Number(v) >= 18 && Number(v) <= 120 };
const check = (el) => {
  const ok = rules[el.name](el.value);
  el.classList.toggle('is-invalid', !ok);
  el.setAttribute('aria-invalid', String(!ok));
  return ok;
};
form.addEventListener('blur', (e) => e.target.name && check(e.target), true);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if ([...form.elements].filter((el) => el.name).map(check).every(Boolean))
    fetch('/api/save', { method: 'POST', body: new FormData(form) });
});
</script>`),
    });
    await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { settle: 100 } },
    });
    const custom = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/custom.json'), 'utf8'));
    const field = (key: string) => custom.fields.find((f: { key: string }) => f.key === key);
    assert.deepEqual(field('username').inferred, ['required', 'minLength']);
    assert.equal(field('username').minLength, 3);
    assert.deepEqual(field('age').inferred, ['required', 'min', 'max']);
    assert.deepEqual([field('age').min, field('age').max], ['18', '120']);
    const outcome = (label: string) =>
      custom.cases.find((c: { label: string }) => c.label === label)?.outcome;
    assert.equal(outcome('baseline'), 'sent');
    assert.equal(outcome('username=minlength-1 (2)'), 'blocked:script');
    assert.equal(outcome('age=max+1 "121"'), 'blocked:script');
  });
});
