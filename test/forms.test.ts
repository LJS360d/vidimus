import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  alternatesFor,
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
    assert.equal(formLine(html, 1), undefined);
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

  it('reads what a field means from its autocomplete token, name and label', () => {
    const kind = (overrides: Partial<FieldInfo>) => kindOf(field(overrides));
    assert.equal(kind({ autocomplete: 'shipping tel' }), 'tel');
    assert.equal(kind({ autocomplete: 'url' }), 'url');
    assert.equal(kind({ autocomplete: 'new-password' }), 'password');
    assert.equal(kind({ autocomplete: 'postal-code' }), 'postal');
    assert.equal(kind({ autocomplete: 'email' }), 'email');
    assert.equal(kind({ name: 'mobile' }), 'tel');
    assert.equal(kind({ label: 'Your website' }), 'url');
    assert.equal(kind({ name: 'zip' }), 'postal');
    assert.equal(kind({ name: 'full_name' }), 'name');
    assert.equal(kind({ name: 'username' }), 'text');
    assert.equal(kind({ type: 'url' }), 'url');
  });

  it('generates values for patterns it understands and declines the rest', () => {
    for (const pattern of [
      '[^0-9]{2}',
      '\\w+\\.\\s?x',
      '(?:ab|cd){2,3}',
      'a*b?c',
      '.{4}',
      '[\\d]{3}',
    ])
      assert.equal(matches(pattern, fromPattern(pattern) ?? ''), true, pattern);
    assert.equal(fromPattern('[abc'), undefined);
    assert.equal(fromPattern('[^\\q]'), undefined, 'a class the u flag rejects');
    assert.equal(matches('(', 'x'), undefined);
  });

  it('builds cases for choices, files, dates, steps and configured values', () => {
    const fields = [
      field({
        key: 'plan',
        tag: 'select',
        type: 'select',
        required: true,
        options: [
          { value: '', disabled: false },
          { value: 'free', disabled: false },
          { value: 'gold', disabled: true },
          { value: 'pro', disabled: false },
        ],
      }),
      field({
        key: 'size',
        type: 'radio',
        options: [
          { value: 's', disabled: false },
          { value: 'm', disabled: false },
        ],
      }),
      field({ key: 'cv', type: 'file', required: true }),
      field({ key: 'when', type: 'date', min: '2026-01-31', max: '2026-12-31' }),
      field({ key: 'qty', type: 'number', min: '0', step: '0.25' }),
      field({ key: 'color', type: 'color' }),
      field({ key: 'range', type: 'range' }),
      field({ key: 'coupon', name: 'coupon' }),
      field({ key: 'zip', name: 'zip', pattern: '\\d{5}', maxLength: 5 }),
      field({ key: 'card', autocomplete: 'cc-number' }),
      field({ key: 'gone', usable: false }),
    ];
    const { baseline, cases } = casesFor(fields, { '^coupon$': 'WELCOME10' });
    assert.equal(baseline.plan, 'free');
    assert.equal(baseline.size, 's');
    assert.equal(baseline.cv, 'file');
    assert.equal(baseline.when, '2026-01-31');
    assert.equal(baseline.color, '#336699');
    assert.equal(baseline.coupon, 'WELCOME10');
    assert.equal(baseline.zip, '10001');
    assert.equal(baseline.card, '4242424242424242');
    assert.equal('gone' in baseline, false);
    const labels = cases.map((c) => `${c.label}|${c.expect}|${c.check}`);
    for (const expected of [
      'plan=""|invalid|required',
      'plan="pro"|valid|option',
      'size="m"|valid|option',
      'size=none|valid|required',
      'cv=none|invalid|required',
      'when=min-1 "2026-01-30"|invalid|min',
      'when=max+1 "2027-01-01"|invalid|max',
      'qty=min-1 "-0.25"|invalid|min',
      'qty=off-step 0.125|invalid|step',
      'color=empty|valid|required',
      'zip="10001!"|invalid|pattern',
    ])
      assert.ok(labels.includes(expected), `${expected}\n${labels.join('\n')}`);
    assert.ok(!labels.some((l) => l.startsWith('plan="gold"')), 'disabled options are not offered');
    assert.ok(!labels.some((l) => l.startsWith('range=')), 'a slider cannot leave its range');
    const alternates = alternatesFor(field({ key: 'nick', maxLength: 6 }));
    assert.ok(alternates.every((value) => typeof value === 'string' && value.length <= 6));
    assert.deepEqual(alternatesFor(fields[0] as FieldInfo), ['free', 'pro']);
    assert.deepEqual(alternatesFor(field({ type: 'checkbox' })), []);
  });

  it('covers the edges of names, patterns, baselines and empty values', () => {
    const form = { id: '', name: 'newsletter', ordinal: null, index: 0 } as FormInfo;
    assert.equal(formId(form, '/', ''), 'name:newsletter');
    for (const pattern of ['a\\.b', '[\\w-]+', '(x|)y', '^ab$', 'a{x}', 'ab|cd', '\\', '(?:a'])
      assert.notEqual(fromPattern(pattern), 'never', pattern);
    assert.equal(fromPattern('ab|cd'), 'ab');
    assert.equal(fromPattern('[a-z]{2}\\d'), 'aa1');
    const fields = [
      field({ key: 'note', type: 'textarea', tag: 'textarea', minLength: 30 }),
      field({ key: 'num', type: 'number' }),
      field({ key: 'pin', pattern: '[0-9]{4}', label: 'Email' }),
      field({ key: 'odd', pattern: '(?=x)y' }),
      field({
        key: 'choice',
        tag: 'select',
        type: 'select',
        options: [{ value: 'a', disabled: false }],
      }),
      field({ key: 'none', tag: 'select', type: 'select', options: [] }),
      field({ key: 'agree', type: 'checkbox', required: true }),
      field({ key: 'bad', type: 'date', min: 'soon' }),
      field({ key: 'steps', type: 'number', step: '5' }),
      field({ key: 'mail', type: 'email' }),
      field({ key: 'mail_confirm', type: 'email', label: 'Repeat email' }),
    ];
    const { baseline, cases } = casesFor(fields, {}, { num: '7', mail: null });
    assert.equal((baseline.note as string).length, 30);
    assert.equal(baseline.num, '7');
    assert.equal(baseline.pin, '0000');
    assert.equal(
      baseline.odd,
      'vidimus',
      'keeps the plain value when the pattern cannot be generated',
    );
    assert.equal(baseline.none, null);
    assert.equal(baseline.mail_confirm, null);
    const labels = cases.map((c) => `${c.label}|${c.expect}|${c.check}`);
    for (const expected of [
      'agree=unchecked|invalid|required',
      'steps=off-step 2.5|invalid|step',
      'pin="vidimus"|invalid|pattern',
      'note=long (10000)|unknown|length',
      'mail_confirm≠mail|invalid|equals',
    ])
      assert.ok(labels.includes(expected), `${expected}\n${labels.join('\n')}`);
    assert.ok(
      !labels.some((l) => l.startsWith('bad=min')),
      'an unreadable min gets no boundary case',
    );
    const empty = cases.find((c) => c.check === 'empty-form');
    assert.equal(empty?.values.choice, 'a', 'a select without an empty option keeps its value');
    assert.deepEqual(alternatesFor(field({ type: 'date' })), [
      '2030-01-15',
      '1990-01-15',
      '2000-01-01',
    ]);
  });

  it('parses request bodies', () => {
    assert.deepEqual(parseBody('application/x-www-form-urlencoded', 'a=1&b=2'), { a: '1', b: '2' });
    assert.deepEqual(parseBody('application/json', '{"a":1}'), { a: 1 });
    assert.deepEqual(parseBody('text/plain;charset=UTF-8', '[1]'), [1]);
    assert.equal(parseBody('application/json', '{bad'), '{bad');
    assert.equal(parseBody('text/plain', ''), undefined);
    assert.equal((parseBody('text/plain', 'x'.repeat(3000)) as string).length, 2000);
    assert.deepEqual(
      parseBody(
        'multipart/form-data; boundary=b',
        '--b\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--b\r\nContent-Disposition: form-data; name="f"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nPNG\r\n--b--',
      ),
      { a: '1', f: '<file x.png>' },
    );
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
const rules = { username: (v) => v.length >= 3 && v.length <= 20, age: (v) => Number(v) >= 18 && Number(v) <= 120 };
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
    assert.deepEqual(field('username').inferred, ['required', 'minLength', 'maxLength']);
    assert.equal(field('username').minLength, 3);
    assert.equal(field('username').maxLength, 20);
    assert.deepEqual(field('age').inferred, ['required', 'min', 'max']);
    assert.deepEqual([field('age').min, field('age').max], ['18', '120']);
    const outcome = (label: string) =>
      custom.cases.find((c: { label: string }) => c.label === label)?.outcome;
    assert.equal(outcome('baseline'), 'sent');
    assert.equal(outcome('username=minlength-1 (2)'), 'blocked:script');
    assert.equal(outcome('age=max+1 "121"'), 'blocked:script');
  });

  it('reports every declared rule a form sends anyway', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="sink" action="/api/sink" method="post" novalidate>
  <input type="email" name="email" required aria-label="Email">
  <input name="code" pattern="[A-Z]{3}" required aria-label="Code">
  <input name="nick" minlength="3" aria-label="Nickname">
  <input type="number" name="qty" min="1" max="10" step="0.5" aria-label="Quantity">
  <input type="date" name="when" min="2026-01-01" max="2026-12-31" aria-label="Date">
  <input type="password" name="password" required aria-label="Password">
  <input type="password" name="password_confirmation" aria-label="Confirm password">
  <input type="url" name="site" aria-label="Website">
  <input name="phone" aria-label="Phone">
  <input name="hint_password" aria-label="Password hint">
  <select name="plan" required aria-label="Plan"><option value="">Pick</option><option>free</option><option>pro</option></select>
  <input type="radio" name="size" value="s" required aria-label="S"><input type="radio" name="size" value="m" aria-label="M">
  <input type="checkbox" name="terms" required aria-label="Terms">
  <input type="file" name="cv" required accept="image/*" aria-label="CV">
  <textarea name="msg" aria-label="Message"></textarea>
  <button>Send</button>
</form>`),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { settle: 50 } },
    });
    const messages = results[0]?.findings.map(({ message }) => message) ?? [];
    for (const expected of [
      'sink: email sent not a valid email',
      'sink: code sent not matching pattern [A-Z]{3}',
      'sink: code sent empty while required',
      'sink: nick sent shorter than minlength 3',
      'sink: qty sent below min 1',
      'sink: qty sent above max 10',
      'sink: qty sent off step 0.5',
      'sink: when sent below min 2026-01-01',
      'sink: when sent above max 2026-12-31',
      'sink: password_confirmation sent not matching password',
      'sink: plan sent empty while required',
      'sink: size sent empty while required',
      'sink: terms sent empty while required',
      'sink: cv sent empty while required',
      'sink: site accepts javascript: URLs',
      'sink: phone accepts an invalid tel',
      'sink: hint_password looks like a password but is type="text"',
      'sink: msg has no length limit',
      'sink: POST form without a CSRF token',
    ])
      assert.ok(messages.includes(expected), `${expected}\n${messages.join('\n')}`);
    const sink = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/sink.json'), 'utf8'));
    const baseline = sink.cases.find((c: { check: string }) => c.check === 'baseline');
    assert.equal(baseline.outcome, 'navigated');
    // A urlencoded POST carries only the file name; multipart would carry the file.
    assert.equal(baseline.requests[0].body.cv, 'vidimus.png');
    assert.deepEqual(sink.observed.plan.accepted, ['""', '"pro"']);
  });

  it('flags credentials in URLs, plain HTTP, workers, script errors; honours options', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="login" action="/search"><input name="user" aria-label="User"><input type="password" name="pw" aria-label="Password"><button>Go</button></form>
<form id="ext" action="http://example.test/collect" method="post"><input name="q" aria-label="Q"><button>Go</button></form>
<form id="work"><input name="q" aria-label="Q"><button>Go</button></form>
<form id="err"><input name="q" aria-label="Q" oninput="notDefined()"><button>Go</button></form>
<form id="skipme"><input name="q" aria-label="Q"><button>Go</button></form>
<form><input name="a" aria-label="A"><input name="b" aria-label="B"><button>Go</button></form>
<script>
document.getElementById('work').addEventListener('submit', (e) => {
  e.preventDefault();
  new Worker(URL.createObjectURL(new Blob(['1'])));
});
</script>`),
    });
    // Another page with a different form under the same id.
    writeFileSync(
      join(cwd, 'dist/other.html'),
      page('<form id="login"><input name="code" aria-label="Code"><button>Go</button></form>'),
    );
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: {
        port: await freePort(),
        forms: { settle: 50, skip: ['#skipme'], maxCases: 4, values: { '^user$': 'alice' } },
      },
    });
    const index = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/index.json'), 'utf8'));
    const ids = index.map((f: { id: string }) => f.id);
    assert.ok(ids.includes('login~2'), ids.join(' '));
    assert.ok(ids.includes('index_form_L10'), ids.join(' '));
    const messages = results[0]?.findings.map(({ message }) => message) ?? [];
    for (const expected of [
      'login: password sent in the URL',
      'ext: data sent over plain HTTP to example.test',
      'work: page starts web workers, whose requests the sandbox cannot see',
      'work: valid input sent nothing',
      'err: script errors while filling or submitting',
    ])
      assert.ok(messages.includes(expected), `${expected}\n${messages.join('\n')}`);
    assert.ok(
      messages.some((m) => /^login: \d+ cases not run$/.test(m)),
      messages.join('\n'),
    );
    assert.ok(!messages.some((m) => m.startsWith('skipme')));
    const login = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/login.json'), 'utf8'));
    assert.match(login.cases[0].requests[0].url, /user=alice/);
  });

  it('lets allowed requests through, stubs the rest, and refuses remote origins', {
    skip: noBrowser,
  }, async () => {
    const hits: string[] = [];
    const target = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.setHeader('access-control-allow-origin', '*');
      res.end('ok');
    });
    await new Promise<void>((done) => target.listen(0, '127.0.0.1', done));
    const api = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    try {
      const cwd = fixture({
        'dist/index.html': page(`
<form id="f"><input name="q" aria-label="Q"><button>Go</button></form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  fetch('${api}/allowed', { method: 'POST', body: 'x' });
  const res = await fetch('${api}/blocked', { method: 'POST', body: 'x' });
  document.title = 'stub ' + res.status;
});
</script>`),
      });
      await run({
        cwd,
        env: {},
        audits: ['forms'],
        reporters: [],
        overrides: {
          port: await freePort(),
          forms: { settle: 50, maxCases: 1, stub: 'ok', allowRequests: ['/allowed$'] },
        },
      });
      assert.ok(hits.length > 0);
      assert.deepEqual([...new Set(hits)], ['POST /allowed']);
      const f = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/f.json'), 'utf8'));
      assert.deepEqual(
        f.cases[0].requests.map((r: { url: string }) => r.url),
        [`${api}/blocked`],
      );
    } finally {
      target.close();
    }

    const remote = await run({
      cwd: fixture({ 'dist/index.html': page('<p>x</p>') }),
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { origin: 'https://example.invalid' },
    });
    assert.equal(remote.results[0]?.status, 'skipped');
    assert.match(remote.results[0]?.summary ?? '', /forms\.allowRemote/);
  });

  it('reports pages that do not load and pages without forms', { skip: noBrowser }, async () => {
    const cwd = fixture({ 'dist/index.html': page('<p>no forms</p>') });
    const empty = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort() },
    });
    assert.equal(empty.results[0]?.summary, '1 page(s), no forms');
    const slow = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { timeout: 1 } },
    });
    assert.equal(slow.results[0]?.findings[0]?.message, 'failed to load /');
  });
});
