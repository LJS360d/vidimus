import { createHash } from 'node:crypto';
import type { FieldInfo, FormInfo, Value } from './probe.ts';

export type Expect = 'valid' | 'invalid' | 'unknown';

export interface Case {
  label: string;
  field: string | null;
  values: Record<string, Value>;
  expect: Expect;
  check: string;
  times?: number;
}

// ---- identity ----

export const slugOf = (path: string) =>
  path
    .replace(/^\/+|\/+$/g, '')
    .replace(/(^|\/)index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/[^\w-]+/g, '_') || 'index';

// Line of the n-th <form> tag in served HTML, skipping comments, scripts and templates.
export const formLine = (html: string, ordinal: number) => {
  const tags = /<!--[\s\S]*?-->|<(script|style|template|textarea)\b[\s\S]*?<\/\1\s*>|<form\b/gi;
  let seen = 0;
  for (const match of html.matchAll(tags)) {
    if (!/^<form/i.test(match[0])) continue;
    if (seen++ === ordinal) return html.slice(0, match.index).split('\n').length;
  }
  return undefined;
};

export const formId = (form: FormInfo, page: string, html: string) => {
  if (form.id) return form.id;
  if (form.name) return `name:${form.name}`;
  const line = form.ordinal === null ? undefined : formLine(html, form.ordinal);
  return line ? `${slugOf(page)}_form_L${line}` : `${slugOf(page)}_form_${form.index + 1}`;
};

export const fingerprintOf = (form: FormInfo, origin: string) => {
  const action = form.action.startsWith(origin) ? new URL(form.action).pathname : form.action;
  const fields = form.fields.map(({ key, type }) => `${key}:${type}`).sort();
  return createHash('sha1')
    .update(JSON.stringify([form.kind, form.method, action, fields]))
    .digest('hex')
    .slice(0, 12);
};

// ---- what a field is ----

const TEXT = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'textarea']);

type Kind = 'email' | 'url' | 'tel' | 'postal' | 'password' | 'name' | 'text';

const AUTOCOMPLETE: Record<string, string> = {
  email: 'vidimus@example.com',
  url: 'https://example.com/',
  tel: '+12025550143',
  'tel-national': '2025550143',
  'postal-code': '10001',
  name: 'Vidimus Test',
  'given-name': 'Vidimus',
  'family-name': 'Test',
  username: 'vidimus',
  'new-password': 'Vidimus-2026!',
  'current-password': 'Vidimus-2026!',
  'one-time-code': '123456',
  organization: 'Vidimus',
  'street-address': '1 Main St',
  'address-line1': '1 Main St',
  'address-level2': 'Springfield',
  country: 'US',
  'country-name': 'United States',
  bday: '2000-01-15',
  'cc-name': 'Vidimus Test',
  'cc-number': '4242424242424242',
  'cc-exp': '12/34',
  'cc-csc': '123',
};

const KIND_BASELINE: Record<Kind, string> = {
  email: 'vidimus@example.com',
  url: 'https://example.com/',
  tel: '+12025550143',
  postal: '10001',
  password: 'Vidimus-2026!',
  name: 'Vidimus Test',
  text: 'vidimus',
};

const TYPE_BASELINE: Record<string, string> = {
  textarea: 'Hello from vidimus.',
  number: '1',
  range: '1',
  date: '2000-01-15',
  time: '12:00',
  'datetime-local': '2000-01-15T12:00',
  month: '2000-01',
  week: '2000-W03',
  color: '#336699',
};

export const kindOf = (field: FieldInfo): Kind => {
  if (['email', 'url', 'tel', 'password'].includes(field.type)) return field.type as Kind;
  const token = field.autocomplete.split(/\s+/).at(-1) ?? '';
  if (/email/.test(token)) return 'email';
  if (/^tel/.test(token)) return 'tel';
  if (/url/.test(token)) return 'url';
  if (/password/.test(token)) return 'password';
  if (token === 'postal-code') return 'postal';
  const words = `${field.name} ${field.id} ${field.label}`;
  if (/e-?mail/i.test(words)) return 'email';
  if (/pass(word)?\b|pwd/i.test(words)) return 'password';
  if (/phone|mobile|^tel\b|\btel(ephone)?\b/i.test(words)) return 'tel';
  if (/\b(url|website|homepage)\b/i.test(words)) return 'url';
  if (/zip|postal|postcode/i.test(words)) return 'postal';
  if (/name/i.test(words) && !/user ?name/i.test(words)) return 'name';
  return 'text';
};

export const AUTOCOMPLETE_FOR: Partial<Record<Kind, string>> = {
  email: 'email',
  tel: 'tel',
  url: 'url',
  postal: 'postal-code',
  name: 'name',
};

// ---- a string that matches an HTML pattern (common subset: classes, quantifiers, groups) ----

const CLASS_PICK: Record<string, string> = { d: '1', w: 'a', s: ' ', D: 'a', W: '-', S: 'a' };

export const fromPattern = (source: string): string | undefined => {
  let i = 0;
  const atom = (): string | undefined => {
    const c = source[i++];
    if (c === undefined) return undefined;
    if (c === '\\') {
      const e = source[i++] ?? '';
      return CLASS_PICK[e] ?? e;
    }
    if (c === '[') {
      const end = source.indexOf(']', i + 1);
      if (end < 0) return undefined;
      const body = source.slice(i, end);
      i = end + 1;
      if (body.startsWith('^')) {
        const outside = (ch: string) => {
          try {
            return !new RegExp(`[${body.slice(1)}]`, 'u').test(ch);
          } catch {
            return false;
          }
        };
        return ['a', 'x', '1', '-', '_'].find(outside);
      }
      return body.startsWith('\\') ? (CLASS_PICK[body[1] ?? ''] ?? body[1]) : body[0];
    }
    if (c === '(') {
      if (source.startsWith('?:', i)) i += 2;
      const branches: string[] = [];
      let current = '';
      while (i < source.length && source[i] !== ')') {
        if (source[i] === '|') {
          branches.push(current);
          current = '';
          i++;
          continue;
        }
        const piece = quantified();
        if (piece === undefined) return undefined;
        current += piece;
      }
      i++;
      branches.push(current);
      return branches.find((b) => b.length) ?? '';
    }
    if (c === '.') return 'a';
    if ('^$'.includes(c)) return '';
    return c;
  };
  const quantified = (): string | undefined => {
    const piece = atom();
    if (piece === undefined) return undefined;
    const q = source[i];
    if (q === '?' || q === '*') {
      i++;
      return '';
    }
    if (q === '+') {
      i++;
      return piece;
    }
    if (q === '{') {
      const m = /^\{(\d+)(,\d*)?\}/.exec(source.slice(i));
      if (!m) return piece;
      i += m[0].length;
      return piece.repeat(Number(m[1]));
    }
    return piece;
  };
  let out = '';
  while (i < source.length) {
    if (source[i] === '|') break;
    const piece = quantified();
    if (piece === undefined) return undefined;
    out += piece;
  }
  return matches(source, out) ? out : undefined;
};

// HTML compiles pattern with the v flag and anchors it.
export const matches = (pattern: string, value: string) => {
  try {
    return new RegExp(`^(?:${pattern})$`, 'v').test(value);
  } catch {
    return undefined;
  }
};

// ---- baseline: one valid value per field ----

const fit = (value: string, field: FieldInfo) => {
  let out = value;
  if (field.minLength && out.length < field.minLength) out = out.padEnd(field.minLength, 'x');
  if (field.maxLength !== undefined && out.length > field.maxLength)
    out = out.slice(0, field.maxLength);
  return out;
};

const firstOption = (field: FieldInfo) =>
  field.options.find((o) => !o.disabled && o.value !== '')?.value ?? null;

const baselineFor = (field: FieldInfo, configured: Record<string, string> = {}): Value => {
  if (field.type === 'checkbox') return true;
  if (field.type === 'radio' || field.tag === 'select') return firstOption(field);
  if (field.type === 'file') return 'file';
  const user = Object.entries(configured).find(([pattern]) =>
    [field.name, field.id, field.label].some((word) => word && new RegExp(pattern, 'i').test(word)),
  );
  if (user) return user[1];
  if (field.type === 'textarea') return fit(TYPE_BASELINE.textarea ?? '', field);
  if (field.type in TYPE_BASELINE) return field.min ?? field.max ?? TYPE_BASELINE[field.type] ?? '';
  const token = field.autocomplete.split(/\s+/).at(-1) ?? '';
  let value = AUTOCOMPLETE[token] ?? KIND_BASELINE[kindOf(field)];
  if (field.pattern && !matches(field.pattern, value)) value = fromPattern(field.pattern) ?? value;
  const fitted = fit(value, field);
  return field.pattern && matches(field.pattern, fitted) === false ? value : fitted;
};

// ---- cases: every boundary and violation the constraints imply, one field at a time ----

const LONG = 10_000;

const BAD: Partial<Record<Kind, string[]>> = {
  email: ['vidimus', 'vidimus@', '@example.com', 'vidimus@@example.com', 'vidi mus@example.com'],
  url: ['example', 'http://'],
  tel: ['not a phone'],
};

const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// A value that confirms another field ("confirm password", "repeat email").
const confirmsOf = (fields: FieldInfo[]) => {
  const pairs = new Map<string, string>();
  const words = (f: FieldInfo) => `${f.name} ${f.id} ${f.label}`;
  for (const [i, field] of fields.entries()) {
    if (!/confirm|repeat|again|verify|retype|_confirmation/i.test(words(field))) continue;
    const original = fields
      .slice(0, i)
      .reverse()
      .find((other) => other.type === field.type && kindOf(other) === kindOf(field));
    if (original) pairs.set(field.key, original.key);
  }
  return pairs;
};

// Other plausible values, tried when a field rejects its baseline for a rule the page does not
// declare (Angular Validators.min, a Zod schema): the audit probes until the form accepts one.
const ALTERNATES: Record<Kind, string[]> = {
  email: ['vidimus.test@example.com', 'test@vidimus.dev'],
  tel: ['2025550143', '+1 202 555 0143', '(202) 555-0143', '3125550143'],
  postal: ['90210', 'SW1A 1AA', '00100', '10115'],
  password: ['Vidimus-2026!Secure#1', 'Abcdefgh1!'],
  url: ['https://www.example.com', 'http://example.com'],
  name: ['Vidimus', 'Test'],
  text: ['vidimus-test', 'Vidimus Test 123', 'VIDIMUS', 'vidimus123', 'abcdefghij', '12345'],
};

export const alternatesFor = (field: FieldInfo): Value[] => {
  if (field.type === 'radio' || field.tag === 'select')
    return field.options.filter((o) => !o.disabled && o.value !== '').map((o) => o.value);
  if (field.type === 'number') return ['18', '21', '42', '100', '1000', '0', '-1', '0.5'];
  if (field.type === 'date') return ['2030-01-15', '1990-01-15', '2000-01-01'];
  if (!TEXT.has(field.type)) return [];
  return ALTERNATES[kindOf(field)].map((value) => fit(value, field));
};

export const casesFor = (
  fields: FieldInfo[],
  configured: Record<string, string> = {},
  known: Record<string, Value> = {},
) => {
  const usable = fields.filter((f) => f.usable);
  const baseline: Record<string, Value> = {};
  for (const field of usable)
    baseline[field.key] =
      field.key in known ? (known[field.key] ?? null) : baselineFor(field, configured);
  const confirms = confirmsOf(usable);
  for (const [copy, original] of confirms) baseline[copy] = baseline[original] ?? null;

  const cases: Case[] = [
    { label: 'baseline', field: null, values: baseline, expect: 'valid', check: 'baseline' },
  ];
  const one = (field: FieldInfo, label: string, value: Value, expect: Expect, check: string) => {
    const values = { ...baseline, [field.key]: value };
    // Changing a field also changes what its confirmation must repeat.
    for (const [copy, original] of confirms) if (original === field.key) values[copy] = value;
    cases.push({ label: `${field.key}=${label}`, field: field.key, values, expect, check });
  };
  const show = (value: string) =>
    value.length > 24 ? `${value.slice(0, 12)}…(${value.length})` : JSON.stringify(value);

  for (const field of usable) {
    const base = baseline[field.key];
    const required: Expect = field.required ? 'invalid' : 'valid';
    const kind = kindOf(field);

    if (field.type === 'checkbox') {
      one(field, 'unchecked', false, required, field.required ? 'required' : 'optional');
      continue;
    }
    if (field.type === 'radio' || field.tag === 'select') {
      for (const option of field.options.filter((o) => !o.disabled).slice(0, 20)) {
        if (option.value === base) continue;
        const empty = option.value === '';
        one(
          field,
          show(option.value),
          option.value,
          empty ? required : 'valid',
          empty ? 'required' : 'option',
        );
      }
      if (field.type === 'radio') one(field, 'none', null, required, 'required');
      continue;
    }
    if (field.type === 'file') {
      one(field, 'none', null, required, 'required');
      continue;
    }
    if (['number', 'range', 'date'].includes(field.type)) {
      if (field.type === 'range') continue;
      one(field, 'empty', '', required, 'required');
      const step = (value: string, by: number) =>
        field.type === 'date' ? shiftDate(value, by) : String(Number(value) + by);
      const unit =
        field.type === 'number' && field.step && field.step !== 'any' ? Number(field.step) : 1;
      if (field.min !== undefined) {
        const below = step(field.min, -unit);
        if (below !== undefined) one(field, `min-1 ${show(below)}`, below, 'invalid', 'min');
      }
      if (field.max !== undefined) {
        const above = step(field.max, unit);
        if (above !== undefined) one(field, `max+1 ${show(above)}`, above, 'invalid', 'max');
      }
      if (field.type === 'number' && unit !== 1) {
        const off = String(Number(field.min ?? 0) + unit / 2);
        one(field, `off-step ${off}`, off, 'invalid', 'step');
      }
      continue;
    }
    if (!TEXT.has(field.type)) {
      one(field, 'empty', '', required, 'required');
      continue;
    }

    const text = typeof base === 'string' ? base : '';
    one(field, 'empty', '', required, field.required ? 'required' : 'optional');
    if (field.required) one(field, 'spaces', '   ', 'invalid', 'whitespace');
    if (field.minLength) {
      const short = text.padEnd(field.minLength, 'x').slice(0, field.minLength - 1);
      one(field, `minlength-1 (${short.length})`, short, 'invalid', 'minLength');
    }
    if (field.maxLength !== undefined) {
      one(
        field,
        `maxlength (${field.maxLength})`,
        text.padEnd(field.maxLength, 'x').slice(0, field.maxLength),
        'valid',
        'maxLength',
      );
    } else if (!field.pattern) {
      one(field, `long (${LONG})`, 'x'.repeat(LONG), 'unknown', 'length');
    }
    if (field.pattern) {
      for (const bad of [`${text}!`, `!${text.slice(1)}`, text.slice(0, -1)])
        if (bad && matches(field.pattern, bad) === false) {
          one(field, show(bad), bad, 'invalid', 'pattern');
          break;
        }
    }
    // A value the pattern rejects tests the pattern; one it accepts tests the type or meaning.
    for (const bad of BAD[kind] ?? []) {
      const check = field.pattern && matches(field.pattern, bad) === false ? 'pattern' : undefined;
      one(field, show(bad), bad, 'invalid', check ?? (field.type === kind ? 'type' : 'semantic'));
    }
    if (kind === 'url')
      one(field, '"javascript:alert(1)"', 'javascript:alert(1)', 'unknown', 'unsafe-url');
    if (kind === 'text' || kind === 'name') {
      one(field, 'unicode', 'Zoë 😀 עברית', 'unknown', 'unicode');
      one(field, 'canary', '<i data-vidimus-canary>x</i>', 'unknown', 'canary');
    }
  }
  for (const [copy, original] of confirms) {
    const value = baseline[original];
    cases.push({
      label: `${copy}≠${original}`,
      field: copy,
      values: { ...baseline, [copy]: `${typeof value === 'string' ? value : ''}x` },
      expect: 'invalid',
      check: 'equals',
    });
  }

  const emptyOf = (f: FieldInfo): Value => {
    if (f.type === 'checkbox') return false;
    if (f.type === 'radio' || f.type === 'file') return null;
    // A select without an empty option cannot be emptied by a user.
    if (f.tag === 'select')
      return f.options.some((o) => o.value === '') ? '' : (baseline[f.key] ?? null);
    return '';
  };
  const empty = Object.fromEntries(usable.map((f) => [f.key, emptyOf(f)]));
  cases.push({
    label: 'all empty',
    field: null,
    values: empty,
    expect: usable.some((f) => f.required) ? 'invalid' : 'unknown',
    check: 'empty-form',
  });
  cases.push({
    label: 'double submit',
    field: null,
    values: baseline,
    expect: 'valid',
    check: 'double-submit',
    times: 2,
  });
  return { baseline, cases, confirms };
};
