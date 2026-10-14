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

const parsePo = (text: string, useSource: boolean): Record<string, string> => {
  const entries: Record<string, string> = {};
  let ctx = '';
  let id = '';
  let plural = '';
  const strs: string[] = [];
  let target: 'ctx' | 'id' | 'plural' | number | null = null;
  let fuzzy = false;
  const flush = () => {
    if (id && !fuzzy) {
      const key = ctx ? `${ctx}\x04${id}` : id;
      strs.forEach((str, index) => {
        const source = index > 0 && plural ? plural : id;
        entries[index === 0 ? key : `${key}[${index}]`] = useSource && !str.trim() ? source : str;
      });
      if (!strs.length) entries[key] = useSource ? id : '';
    }
    ctx = id = plural = '';
    strs.length = 0;
    target = null;
    fuzzy = false;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      if (typeof target === 'number') flush();
      if (line.startsWith('#,') && line.includes('fuzzy')) fuzzy = true;
    } else if (line.startsWith('msgctxt ')) {
      if (typeof target === 'number') flush();
      ctx = unquote(line);
      target = 'ctx';
    } else if (line.startsWith('msgid_plural ')) {
      plural = unquote(line);
      target = 'plural';
    } else if (line.startsWith('msgid ')) {
      if (typeof target === 'number') flush();
      id = unquote(line);
      target = 'id';
    } else if (line.startsWith('msgstr')) {
      const index = Number(/^msgstr\[(\d+)\]/.exec(line)?.[1] ?? 0);
      strs[index] = unquote(line);
      target = index;
    } else if (line.startsWith('"')) {
      if (target === 'ctx') ctx += unquote(line);
      else if (target === 'id') id += unquote(line);
      else if (target === 'plural') plural += unquote(line);
      else if (typeof target === 'number') strs[target] += unquote(line);
    }
  }
  flush();
  return entries;
};

const pluralBase = (key: string) =>
  key.replace(/\[\d+\]$/, '').replace(/_(zero|one|two|few|many|other)$/, '');
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

type Dict = Record<string, unknown>;

class MissingFileError extends Error {}

const readDict = (file: string, locale: string, useSource: boolean): Dict => {
  if (!existsSync(file))
    throw new MissingFileError(`no translation file for "${locale}" at ${file}`);
  try {
    const text = readFileSync(file, 'utf8');
    return Object.fromEntries(
      flatten(file.endsWith('.po') ? parsePo(text, useSource) : JSON.parse(text)),
    );
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`);
  }
};

interface LocaleContext {
  root: string;
  defaultLocale: string;
  base: Dict;
  baseKeys: string[];
  baseForms: Set<string>;
}

const mismatchedPlaceholders = (dict: Dict, base: Dict) =>
  Object.keys(dict).filter((key) => {
    const ref = Object.hasOwn(base, key) ? key : `${pluralBase(key)}_other`;
    return (
      Object.hasOwn(base, ref) &&
      typeof base[ref] === 'string' &&
      typeof dict[key] === 'string' &&
      !isBlank(dict[key]) &&
      !sameSet(placeholders(base[ref]), placeholders(dict[key]))
    );
  });

const compareLocale = (
  { root, defaultLocale, base, baseKeys, baseForms }: LocaleContext,
  locale: string,
  file: string,
  dict: Dict,
): Finding[] => {
  const keys = Object.keys(dict);
  const forms = new Set(keys.map(pluralBase));
  const shown = displayPath(root, file);
  const problems: [string, string[], string][] = [
    [
      'missing',
      baseKeys.filter((key) => !forms.has(pluralBase(key))),
      `Add these keys to ${shown}.`,
    ],
    [
      'unknown',
      keys.filter((key) => !baseForms.has(pluralBase(key))),
      `Remove them or add them to the ${defaultLocale} file first.`,
    ],
    [
      'empty',
      baseKeys.filter(
        (key) => Object.hasOwn(dict, key) && isBlank(dict[key]) && !isBlank(base[key]),
      ),
      `Translate them in ${shown}, or copy the ${defaultLocale} text until a translation is ready.`,
    ],
  ];
  const mismatched = mismatchedPlaceholders(dict, base);
  return [
    ...problems
      .filter(([, found]) => found.length)
      .map(([label, found, fix]) => ({
        message: `${locale}: ${found.length} ${label} key(s)`,
        details: found,
        file,
        fix,
      })),
    ...(mismatched.length
      ? [
          {
            message: `${locale}: ${mismatched.length} key(s) with mismatched placeholders`,
            details: mismatched,
            file,
            severity: 'warn' as const,
            fix: `Make the placeholders in ${shown} match the ${defaultLocale} text.`,
          },
        ]
      : []),
  ];
};

const logCoverage = (
  log: (line: string) => void,
  { defaultLocale, base, baseKeys }: LocaleContext,
  locale: string,
  dict: Dict,
) => {
  const translatable = baseKeys.filter((key) => hasLetters(base[key]));
  const untranslated = translatable.filter((key) => dict[key] === key || dict[key] === base[key]);
  const differ = translatable.length - untranslated.length;
  const pct = translatable.length ? Math.round((differ / translatable.length) * 100) : 100;
  log(`${locale}: ${differ}/${translatable.length} differ from ${defaultLocale} (${pct}%)`);
  if (!untranslated.length) return;
  log(`  identical to ${defaultLocale} (${untranslated.length}):`);
  for (const key of untranslated.slice(0, LIST_CAP)) log(`    ${key}`);
  if (untranslated.length > LIST_CAP) log(`    … +${untranslated.length - LIST_CAP} more`);
};

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
    const base = readDict(fileOf(defaultLocale), defaultLocale, true);
    const baseKeys = Object.keys(base);
    const context: LocaleContext = {
      root,
      defaultLocale,
      base,
      baseKeys,
      baseForms: new Set(baseKeys.map(pluralBase)),
    };

    const findings: Finding[] = [];
    const translations: [string, Dict][] = [];
    for (const locale of locales.filter((other) => other !== defaultLocale)) {
      const file = fileOf(locale);
      let dict: Dict;
      try {
        dict = readDict(file, locale, false);
      } catch (error) {
        const missing = error instanceof MissingFileError;
        findings.push({
          message: `${missing ? 'no' : 'invalid'} translation file for "${locale}"`,
          ...(!missing && { details: [(error as Error).message] }),
          file,
          fix: missing
            ? `Create ${displayPath(root, file)} or remove the locale from locales.`
            : `Fix ${displayPath(root, file)} so it parses.`,
        });
        continue;
      }
      translations.push([locale, dict]);
      findings.push(...compareLocale(context, locale, file, dict));
    }
    for (const [locale, dict] of translations) logCoverage(log, context, locale, dict);

    return {
      summary: `${locales.length} locales, ${baseKeys.length} keys${
        findings.length ? `, ${findings.length} problem(s)` : ''
      }`,
      findings,
    };
  },
};
