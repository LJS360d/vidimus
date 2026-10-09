import { UsageError } from '../core/errors.ts';
import { isPlainObject } from '../core/util.ts';

type Tree = Record<string, unknown>;

const OPEN_RECORDS = new Set([
  'lighthouse.thresholds',
  'forms.values',
  'severity',
  'security.require',
  'budget.routes',
  'html.rules',
  'browser.state.localStorage',
  'browser.state.sessionStorage',
]);

export const checkKeys = (
  base: unknown,
  input: unknown,
  source: string,
  parents: string[] = [],
) => {
  if (!isPlainObject(input) || !isPlainObject(base) || OPEN_RECORDS.has(parents.join('.'))) return;
  for (const [key, value] of Object.entries(input)) {
    const path = [...parents, key];
    if (!Object.hasOwn(base, key)) {
      throw new UsageError(`${source}: unknown config key "${path.join('.')}"`);
    }
    checkKeys(base[key], value, source, path);
  }
};

export const merge = <T extends object>(base: T, override: unknown): T => {
  if (!isPlainObject(override)) return base;
  const result: Tree = { ...(base as Tree) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isPlainObject(value) && isPlainObject(current) ? merge(current, value) : value;
  }
  return result as T;
};

const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const coerce = (raw: string, current: unknown, source: string): unknown => {
  if (typeof current === 'string') return raw;
  if (typeof current === 'number') {
    const number = Number(raw);
    if (raw.trim() === '' || Number.isNaN(number)) {
      throw new UsageError(`${source}: "${raw}" is not a number`);
    }
    return number;
  }
  if (typeof current === 'boolean') {
    if (/^(1|true|yes|on)$/i.test(raw)) return true;
    if (/^(0|false|no|off|)$/i.test(raw)) return false;
    throw new UsageError(`${source}: "${raw}" is not a boolean`);
  }
  if (Array.isArray(current) && !raw.trim().startsWith('[')) {
    const numeric = current.some((item) => typeof item === 'number');
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (numeric && !Number.isNaN(Number(item)) ? Number(item) : item));
  }
  try {
    return JSON.parse(raw);
  } catch {
    if (current === undefined) return raw;
    throw new UsageError(`${source}: "${raw}" is not valid JSON`);
  }
};

export interface SetOptions {
  source: string;
  fuzzy?: boolean;
  lenient?: boolean;
}

export const setPath = <T extends object>(
  object: T,
  segments: string[],
  raw: string,
  { source, fuzzy = false, lenient = false }: SetOptions,
  parents: string[] = [],
): T => {
  const tree = object as Tree;
  const [head, ...rest] = segments;
  if (head === undefined || head === '') throw new UsageError(`${source}: empty config key`);
  const key =
    Object.keys(tree).find((candidate) =>
      fuzzy ? normalize(candidate) === normalize(head) : candidate === head,
    ) ?? (fuzzy ? head.toLowerCase().replaceAll('_', '-') : head);
  if (!Object.hasOwn(tree, key) && !OPEN_RECORDS.has(parents.join('.'))) {
    if (lenient) return object;
    throw new UsageError(`${source}: unknown config key "${[...parents, head].join('.')}"`);
  }
  if (rest.length === 0) {
    const value =
      parents.join('.') === 'security.require' && /^false$/i.test(raw)
        ? false
        : coerce(raw, tree[key], source);
    return { ...tree, [key]: value } as T;
  }
  const child = tree[key];
  if (!isPlainObject(child)) {
    if (lenient) return object;
    throw new UsageError(`${source}: "${[...parents, key].join('.')}" has no nested keys`);
  }
  return {
    ...tree,
    [key]: setPath(child, rest, raw, { source, fuzzy, lenient }, [...parents, key]),
  } as T;
};
