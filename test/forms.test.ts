import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { type Exercised, findingsFor, forms, shotOf } from '../src/audits/forms/index.ts';
import type { FieldInfo, FormInfo } from '../src/audits/forms/probe.ts';
import { parseBody } from '../src/audits/forms/sandbox.ts';
import { defaults } from '../src/config/defaults.ts';
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
    assert.notEqual(slugOf('/a/b/'), slugOf('/a_b/'));
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

  it('tests a tel field for meaning, since browsers do not validate tel format', () => {
    const { cases } = casesFor([
      field({ key: 'phone', name: 'phone', type: 'tel' }),
      field({ key: 'mail', name: 'mail', type: 'email' }),
    ]);
    const labels = cases.map((c) => `${c.label}|${c.expect}|${c.check}`);
    assert.ok(labels.includes('phone="not a phone"|invalid|semantic'), labels.join('\n'));
    assert.ok(labels.includes('mail="vidimus"|invalid|type'), labels.join('\n'));
  });

  it('skips the minlength-1 case when minlength is 1, since browsers never apply it to an empty value', () => {
    const { cases } = casesFor([field({ key: 'code', name: 'code', minLength: 1 })]);
    const labels = cases.map((c) => `${c.label}|${c.expect}|${c.check}`);
    assert.ok(!labels.some((l) => l.includes('|minLength')), labels.join('\n'));
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

describe('forms findings grouping', () => {
  it('judges each case by its own expectation', () => {
    const base = {
      field: 'email',
      check: 'required',
      outcome: 'sent',
      requests: [],
      invalid: [],
      events: { errors: [], workers: [], canary: false },
    };
    const form = {
      id: 'f',
      pages: ['/'],
      form: { novalidate: false, adapters: [] },
      fields: [{ key: 'email', type: 'email', required: true }],
      confirms: {},
      cases: [
        { ...base, label: 'valid', expect: 'valid' },
        { ...base, label: 'bad', expect: 'invalid' },
      ],
    } as unknown as Exercised;
    const out = findingsFor(form, 'http://x');
    assert.equal(out.filter((f) => f.message.includes('sent ')).length, 1);
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
<iframe srcdoc="<script>onmessage = () => fetch('${api}/tile')</script>"></iframe>
<script>
document.getElementById('scripted').addEventListener('submit', (event) => {
  event.preventDefault();
  fetch('${api}/fetch', { method: 'POST', body: 'x' });
  fetch('${api}/fetch-get');
  navigator.sendBeacon('${api}/beacon', 'x');
  new WebSocket('${api.replace('http', 'ws')}/ws');
  window.open('${api}/open');
  // An embed reading its own data (map tiles) is stopped, but is not the form sending.
  frames[0].postMessage('', '*');
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

  it('refuses output dirs outside .vidimus and deletes nothing', { skip: noBrowser }, async () => {
    for (const pick of [() => '', () => '.', (cwd: string) => cwd, () => '../outside']) {
      const cwd = fixture({
        'dist/index.html': page('<form><input name="q"><button>Go</button></form>'),
        'outside/keep.txt': 'user data',
        '.vidimus/keep.txt': 'output',
      });
      const outDir = pick(cwd);
      const { results } = await run({
        cwd,
        env: {},
        audits: ['forms'],
        reporters: [],
        overrides: { port: await freePort(), forms: { outDir } },
      });
      assert.equal(results[0]?.status, 'errored', `outDir "${outDir}"`);
      assert.match(results[0]?.summary ?? '', /forms\.outDir/);
      assert.equal(readFileSync(join(cwd, 'outside/keep.txt'), 'utf8'), 'user data');
      assert.equal(readFileSync(join(cwd, '.vidimus/keep.txt'), 'utf8'), 'output');
    }
    const cwd = fixture({
      'dist/index.html': page('<form><input name="q"><button>Go</button></form>'),
      '.vidimus/keep.txt': 'output',
    });
    await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { outDir: 'forms' } },
    });
    assert.ok(existsSync(join(cwd, '.vidimus/forms')));
    assert.equal(readFileSync(join(cwd, '.vidimus/keep.txt'), 'utf8'), 'output');
  });

  it('abandons a case whose page never settles and runs the rest', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html':
        page(`<form id="stuck" onsubmit="alert('wait'); return false"><input name="q"><button>Go</button></form>
<form id="fine"><input name="p"><button>Go</button></form>`),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { caseTimeout: 1500 } },
    });
    const messages = (results[0]?.findings ?? []).map((f) => f.message);
    assert.ok(
      messages.some((m) => /^stuck: form case timed out: /.test(m)),
      messages.join('\n'),
    );
    assert.ok(!messages.some((m) => /^fine: form case timed out/.test(m)));
    const fine = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/fine.json'), 'utf8'));
    assert.ok(fine.cases.length > 0);
    const stuck = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/stuck.json'), 'utf8'));
    assert.ok(
      stuck.cases.every(
        (c: { outcome: string }) => c.outcome === 'timeout' || c.outcome === 'not-submitted',
      ),
    );
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

  it('treats form-associated custom elements as fields', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<script>
customElements.define('x-field', class extends HTMLElement {
  static formAssociated = true;
  #internals = this.attachInternals();
  get value() { return this._v ?? ''; }
  set value(v) {
    this._v = v;
    this.#internals.setFormValue(v);
    this.#internals.setValidity(v ? {} : { valueMissing: true }, 'required', this);
  }
  connectedCallback() { this.value = this.value; }
});
</script>
<form id="face" action="/api/face" method="post">
  <x-field id="widget" name="widget" style="display:block;width:100px;height:20px" aria-label="Widget"></x-field>
  <button>Go</button>
</form>`),
    });
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: { port: await freePort(), forms: { settle: 100 } },
    });
    const sent = JSON.stringify(results[0]?.findings);
    assert.match(sent, /\\"widget\\":\\"vidimus\\"/, sent);
  });

  it('probes contenteditable, select multiple and checkbox groups', {
    skip: noBrowser,
  }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="widgets" action="/api/widgets" method="post">
  <div id="note" contenteditable="true" aria-required="true" aria-label="Note" style="display:block;width:100px;height:20px"></div>
  <select name="tags" multiple required aria-label="Tags"><option value="a">a</option><option value="b">b</option></select>
  <label><input type="checkbox" name="color" value="red" required> red</label>
  <label><input type="checkbox" name="color" value="blue"> blue</label>
  <button>Go</button>
</form>
<script>
document.getElementById('widgets').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  fetch('/api/widgets', {
    method: 'POST',
    body: JSON.stringify({
      note: document.getElementById('note').textContent,
      tags: [...form.tags.selectedOptions].map((o) => o.value),
      color: [...form.querySelectorAll('[name=color]:checked')].map((o) => o.value),
    }),
  });
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
    const found = JSON.stringify(results[0]?.findings);
    assert.match(found, /note sent empty while required/, found);
    assert.match(found, /\\"note\\":\\"Hello from vidimus/, found);
    assert.match(found, /\\"tags\\":\[\\"a\\"\]/, found);
    assert.match(found, /\\"color\\":\[\\"red\\"\]/, found);
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

  it('counts only requests sent after submit', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="search" action="/api/search" method="post">
  <input type="hidden" name="csrf_token" value="t">
  <label>Email <input type="email" name="email" required autocomplete="email"></label>
  <button>Go</button>
</form>
<script>
document.querySelector('[name=email]').addEventListener('input', (e) => {
  fetch('/api/suggest', { method: 'POST', body: e.target.value });
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
    assert.deepEqual(
      messages.filter((m) => m.startsWith('search:')),
      [],
      messages.join('\n'),
    );
    const search = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/search.json'), 'utf8'));
    const outcome = (label: string) =>
      search.cases.find((c: { label: string }) => c.label === label)?.outcome;
    assert.equal(outcome('baseline'), 'navigated');
    assert.equal(outcome('email=empty'), 'blocked:native');
  });

  it('reloads the form after a blocked case', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="leak" action="/api/leak" method="post">
  <input type="hidden" name="csrf_token" value="t">
  <label>Email <input type="email" name="email" required autocomplete="email"></label>
  <label>Note <input name="note" autocomplete="off"></label>
  <button>Go</button>
</form>
<script>
window.invalids = 0;
document.addEventListener('invalid', () => { window.invalids++; }, true);
document.querySelector('form').addEventListener('submit', (e) => {
  e.preventDefault();
  fetch('/api/leak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invalids: window.invalids }) });
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
    const leak = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/leak.json'), 'utf8'));
    const counts = new Set<unknown>();
    let blocked = false;
    let after = 0;
    for (const c of leak.cases) {
      if (blocked && c.outcome !== 'blocked:native') {
        after++;
        for (const r of c.requests)
          counts.add((r.body as { invalids?: number } | undefined)?.invalids);
      }
      if (c.outcome === 'blocked:native') blocked = true;
    }
    assert.ok(after > 0);
    assert.deepEqual([...counts], [0]);
  });

  it('keeps exercising the same form when the DOM differs between loads', {
    skip: noBrowser,
  }, async () => {
    let hits = 0;
    const alpha =
      '<form id="alpha" action="/api/alpha" method="post"><label>Email <input type="email" name="email" required autocomplete="email"></label><button>Go</button></form>';
    const extra =
      '<form id="extra" action="/api/extra" method="post"><label>Zip <input name="zip" required autocomplete="off"></label><button>Go</button></form>';
    const target = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      if (req.url === '/') res.end(page(++hits > 2 ? extra + alpha : alpha));
      else res.end('');
    }).listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));
    try {
      const cwd = fixture({ 'dist/index.html': page(alpha) });
      await run({
        cwd,
        env: {},
        audits: ['forms'],
        reporters: [],
        overrides: {
          origin: `http://127.0.0.1:${(target.address() as AddressInfo).port}`,
          forms: { settle: 50, maxCases: 3 },
        },
      });
      const exercised = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/alpha.json'), 'utf8'));
      const urls = exercised.cases.flatMap((c: { requests: { url: string }[] }) =>
        c.requests.map((r) => r.url),
      );
      assert.ok(urls.length > 0);
      assert.ok(urls.every((u: string) => u.endsWith('/api/alpha')));
    } finally {
      target.close();
    }
  });

  it('sends browser.state cookies when it fetches the page source', {
    skip: noBrowser,
  }, async () => {
    const form =
      '<form action="/api/x" method="post"><label>Email <input type="email" name="email" required autocomplete="email"></label><button>Go</button></form>';
    const target = createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(page(req.headers.cookie?.includes('sid=1') ? form : '<p>login</p>'));
    }).listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));
    try {
      const cwd = fixture({ 'dist/index.html': page(form) });
      await run({
        cwd,
        env: {},
        audits: ['forms'],
        reporters: [],
        overrides: {
          origin: `http://127.0.0.1:${(target.address() as AddressInfo).port}`,
          browser: { state: { cookies: [{ name: 'sid', value: '1' }] } },
          forms: { settle: 50, maxCases: 3 },
        },
      });
      const files = readdirSync(join(cwd, '.vidimus/forms'));
      assert.ok(
        files.some((f) => /_form_L\d+\.json$/.test(f)),
        files.join('\n'),
      );
    } finally {
      target.close();
    }
  });

  it('flags a fetch POST without a CSRF token', { skip: noBrowser }, async () => {
    const cwd = fixture({
      'dist/index.html': page(`
<form id="api">
  <label>Email <input type="email" name="email" required autocomplete="email"></label>
  <button>Go</button>
</form>
<script>
document.getElementById('api').addEventListener('submit', (e) => {
  e.preventDefault();
  fetch('/api/save', { method: 'POST', body: new FormData(e.target) });
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
    assert.ok(messages.includes('api: POST form without a CSRF token'), messages.join('\n'));
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
    // Screenshots are embedded in the HTML report only, never in JSON or beside it.
    assert.equal(baseline.before, undefined);
    assert.equal(sink.shot, undefined);
    const html = readFileSync(join(cwd, '.vidimus/forms/index.html'), 'utf8');
    // Failing cases keep a screenshot of the form before submit; passing ones do not.
    assert.match(
      html,
      /<tr class="fail">(?:(?!<\/tr>).)*<img class="before" src="data:image\/jpeg;base64,/,
    );
    assert.doesNotMatch(html, /<tr class="pass">(?:(?!<\/tr>).)*<img class="before"/);
    assert.ok(!readdirSync(join(cwd, '.vidimus/forms')).some((f) => f.endsWith('.jpg')));
    // Case requests show only what differs from the baseline request.
    assert.match(html, /qty: &quot;0\.5&quot;<\/pre><small>\+ \d+ field\(s\) as baseline/);
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
<form id="noisy"><input name="term" aria-label="Term" oninput="fetch('/data.json')"><button>Go</button></form>
<div><select class="widget" aria-label="Theme"><option>dark</option></select><button type="button">Menu</button></div>
<script>
document.getElementById('work').addEventListener('submit', (e) => {
  e.preventDefault();
  new Worker(URL.createObjectURL(new Blob(['1'])));
});
</script>`),
    });
    // Another page with a different form under the same id, and the same action-less form.
    writeFileSync(
      join(cwd, 'dist/other.html'),
      page(
        '<form id="login"><input name="code" aria-label="Code"><button>Go</button></form><form id="noisy"><input name="term" aria-label="Term"><button>Go</button></form>',
      ),
    );
    const { results } = await run({
      cwd,
      env: {},
      audits: ['forms'],
      reporters: [],
      overrides: {
        port: await freePort(),
        forms: {
          settle: 50,
          skip: ['#skipme', '.widget'],
          maxCases: 4,
          values: { '^user$': 'alice' },
        },
      },
    });
    const index = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/index.json'), 'utf8'));
    const ids = index.map((f: { id: string }) => f.id);
    assert.ok(ids.includes('login~2'), ids.join(' '));
    assert.ok(ids.includes('index_form_L10'), ids.join(' '));
    // Fields matching forms.skip are left out of formless groups too.
    assert.ok(!ids.some((id: string) => id.startsWith('index_form_') && id !== 'index_form_L10'));
    // Without an action attribute a form posts to its own page: still one form on both.
    const noisy = JSON.parse(readFileSync(join(cwd, '.vidimus/forms/noisy.json'), 'utf8'));
    assert.deepEqual(noisy.pages, ['/', '/other.html']);
    // The page's own query-less fetch while typing is stopped but is not the form sending.
    for (const c of noisy.cases)
      assert.ok(!c.requests.some((r: { url: string }) => r.url.endsWith('/data.json')));
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
    const html = readFileSync(join(cwd, '.vidimus/forms/index.html'), 'utf8');
    assert.match(html, /<section id="login">/);
    assert.match(html, /<tr class="(pass|fail|info)">/);
    assert.match(html, /<img src="data:image\/jpeg;base64,[^"]+" alt="login filled/);
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
  fetch('${api}/beacon', { method: 'POST', body: 'x' });
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
          forms: {
            settle: 50,
            maxCases: 1,
            stub: 'ok',
            allowRequests: ['/allowed$'],
            ignoreRequests: ['/beacon$'],
          },
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

  it('closes the browser context when a page cannot be opened', async () => {
    const cwd = fixture({});
    let contexts = 0;
    let closed = 0;
    const browser = {
      createBrowserContext: async () => {
        contexts++;
        return {
          newPage: async () => {
            throw new Error('no page');
          },
          close: async () => {
            closed++;
          },
        };
      },
      close: async () => {},
    };
    const result = await forms.run({
      config: defaults(cwd),
      origin: 'http://localhost:1',
      resolve: (...segments: string[]) => join(cwd, ...segments),
      pageUrls: () => ['http://localhost:1/'],
      launchBrowser: async () => browser,
      log: () => {},
    } as never);
    assert.equal(contexts, 1);
    assert.equal(closed, 1);
    assert.equal(result.findings?.[0]?.message, 'failed to load /');
  });
});

describe('forms shot', () => {
  it('returns no shot when the page cannot resolve the form', async () => {
    const broken = {
      evaluateHandle: () => Promise.reject(new Error('detached')),
    } as unknown as Parameters<typeof shotOf>[0];
    assert.equal(await shotOf(broken, 0), undefined);
  });
});
