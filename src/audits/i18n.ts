import { existsSync, readFileSync } from 'node:fs';
import type { Audit, Finding } from '../core/types.ts';
import { displayPath, isPlainObject } from '../core/util.ts';

const LIST_CAP = 5;

const flatten = (value: unknown, prefix = ''): [string, unknown][] =>
  isPlainObject(value) || Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
      )
    : [[prefix, value]];

const unquote = (line: string) =>
  line
    .slice(line.indexOf('"') + 1, line.lastIndexOf('"'))
    .replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));

const parsePo = (text: string): Record<string, string> => {
  const entries: Record<string, string> = {};
  let id = '';
  let str = '';
  let target: 'id' | 'str' | null = null;
  let fuzzy = false;
  const flush = () => {
    if (id && !fuzzy) entries[id] = str;
    id = str = '';
    target = null;
    fuzzy = false;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      if (target === 'str') flush();
      if (line.startsWith('#,') && line.includes('fuzzy')) fuzzy = true;
    } else if (line.startsWith('msgid ')) {
      if (target === 'str') flush();
      id = unquote(line);
      target = 'id';
    } else if (line.startsWith('msgstr ')) {
      str = unquote(line);
      target = 'str';
    } else if (line.startsWith('"')) {
      if (target === 'id') id += unquote(line);
      else if (target === 'str') str += unquote(line);
    }
  }
  flush();
  return entries;
};

const pluralBase = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
const placeholders = (value: unknown) =>
  new Set(
    [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*[,}]/g)].map(
      (match) => match[1] ?? match[2],
    ),
  );
const sameSet = (a: Set<string | undefined>, b: Set<string | undefined>) =>
  a.size === b.size && [...a].every((name) => b.has(name));
const isBlank = (value: unknown) => String(value).trim() === '';
const hasLetters = (value: unknown) => /\p{L}/u.test(String(value));

export const i18n: Audit = {
  name: 'i18n',
  description: 'every locale defines exactly the keys of the default locale',
  requires: 'source',
  async run({ config, root, resolve, log }) {
    const { locales, defaultLocale } = config;
    const template = config.i18n.files;
    if (!template || locales.length < 2 || !defaultLocale) {
      return {
        status: 'skipped',
        summary: 'not configured (set i18n.files, locales and defaultLocale)',
      };
    }

    const fileOf = (locale: string) => resolve(template.replaceAll('{locale}', locale));
    const load = (locale: string): Record<string, unknown> => {
      const file = fileOf(locale);
      if (!existsSync(file)) throw new Error(`no translation file for "${locale}" at ${file}`);
      let parsed: unknown;
      try {
        const text = readFileSync(file, 'utf8');
        parsed = file.endsWith('.po') ? parsePo(text) : JSON.parse(text);
      } catch (error) {
        throw new Error(`${file}: ${(error as Error).message}`);
      }
      return Object.fromEntries(flatten(parsed));
    };

    const base = load(defaultLocale);
    const baseKeys = Object.keys(base);
    const baseForms = new Set(baseKeys.map(pluralBase));
    const translations = locales
      .filter((locale) => locale !== defaultLocale)
      .map((locale) => [locale, load(locale)] as const);
    const findings: Finding[] = [];

    for (const [locale, dict] of translations) {
      const forms = new Set(Object.keys(dict).map(pluralBase));
      const problems = {
        missing: baseKeys.filter((key) => !forms.has(pluralBase(key))),
        unknown: Object.keys(dict).filter((key) => !baseForms.has(pluralBase(key))),
        empty: baseKeys.filter(
          (key) => Object.hasOwn(dict, key) && isBlank(dict[key]) && !isBlank(base[key]),
        ),
      };
      const shown = displayPath(root, fileOf(locale));
      const fixes = {
        missing: `Add these keys to ${shown}.`,
        unknown: `Remove them or add them to the ${defaultLocale} file first.`,
        empty: `Translate them in ${shown}, or copy the ${defaultLocale} text until a translation is ready.`,
      };
      for (const [label, keys] of Object.entries(problems)) {
        if (!keys.length) continue;
        findings.push({
          message: `${locale}: ${keys.length} ${label} key(s)`,
          details: keys,
          file: fileOf(locale),
          fix: fixes[label as keyof typeof fixes],
        });
      }
      const mismatched = Object.keys(dict).filter((key) => {
        const ref = Object.hasOwn(base, key) ? key : `${pluralBase(key)}_other`;
        return (
          Object.hasOwn(base, ref) &&
          typeof base[ref] === 'string' &&
          typeof dict[key] === 'string' &&
          !isBlank(dict[key]) &&
          !sameSet(placeholders(base[ref]), placeholders(dict[key]))
        );
      });
      if (mismatched.length) {
        findings.push({
          message: `${locale}: ${mismatched.length} key(s) with mismatched placeholders`,
          details: mismatched,
          file: fileOf(locale),
          severity: 'warn',
          fix: `Make the placeholders in ${shown} match the ${defaultLocale} text.`,
        });
      }
    }

    const translatable = baseKeys.filter((key) => hasLetters(base[key]));
    for (const [locale, dict] of translations) {
      const untranslated = translatable.filter(
        (key) => dict[key] === key || dict[key] === base[key],
      );
      const differ = translatable.length - untranslated.length;
      const pct = translatable.length ? Math.round((differ / translatable.length) * 100) : 100;
      log(`${locale}: ${differ}/${translatable.length} differ from ${defaultLocale} (${pct}%)`);
      if (!untranslated.length) continue;
      log(`  identical to ${defaultLocale} (${untranslated.length}):`);
      for (const key of untranslated.slice(0, LIST_CAP)) log(`    ${key}`);
      if (untranslated.length > LIST_CAP) log(`    … +${untranslated.length - LIST_CAP} more`);
    }

    return {
      summary: `${locales.length} locales, ${baseKeys.length} keys${
        findings.length ? `, ${findings.length} problem(s)` : ''
      }`,
      findings,
    };
  },
};
