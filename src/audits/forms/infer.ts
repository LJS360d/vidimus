import type { Page } from '../../core/peer-types.ts';
import { kindOf, LONG, TEXT_TYPES } from './cases.ts';
import { fill, layerInvalid, observe, settled } from './page.ts';
import type { FieldInfo, Value } from './probe.ts';

const TEXTUAL = new Set(['text', 'name']);
const UPPER = 1e9;

const emptyFor = (field: FieldInfo): Value =>
  field.type === 'checkbox' ? false : field.type === 'radio' ? null : '';

// Probes one field with values around what it accepts and reads back whether any layer
// rejects them. Monotone searches only: a rule that is not "longer/larger is fine" stays unknown.
const infer = async (page: Page, index: number, field: FieldInfo, base: Value) => {
  const ok = async (value: Value) => {
    await fill(page, index, { [field.key]: value });
    await settled(page);
    const state = (await observe(page, index))[field.key];
    return !!state && !layerInvalid(state);
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
  if (!field.required && field.type !== 'file' && !(await ok(emptyFor(field)))) {
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
      found.max = String(-(await search(-UPPER, -value, (n) => String(-n))));
      found.inferred.push('max');
    }
  }
  if (
    typeof base === 'string' &&
    TEXTUAL.has(kindOf(field)) &&
    TEXT_TYPES.has(field.type) &&
    !field.pattern
  ) {
    if (field.minLength === undefined && base.length > 1 && !(await ok(base.slice(0, 1)))) {
      found.minLength = await search(1, base.length, (n) => base.slice(0, n));
      found.inferred.push('minLength');
    }
    if (field.maxLength === undefined && !(await ok(base.padEnd(LONG, 'x')))) {
      found.maxLength = -(await search(-LONG, -base.length, (n) => base.padEnd(-n, 'x')));
      found.inferred.push('maxLength');
    }
  }
  await ok(base);
  return found.inferred.length ? found : undefined;
};

export const inferAll = async (
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
