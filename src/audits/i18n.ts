import { existsSync, readFileSync } from 'node:fs';
import type { Audit, Finding } from '../core/types.ts';
import { displayPath, isPlainObject } from '../core/util.ts';

const LIST_CAP = 5;

const flatten = (value: unknown, prefix = ''): [string, unknown][] =>
  isPlainObject(value)
    ? Object.entries(value).flatMap(([key, child]) =>
        flatten(child, prefix ? `${prefix}.${key}` : key),
      )
    : [[prefix, value]];

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
      return Object.fromEntries(flatten(JSON.parse(readFileSync(file, 'utf8'))));
    };

    const base = load(defaultLocale);
    const baseKeys = Object.keys(base);
    const translations = locales
      .filter((locale) => locale !== defaultLocale)
      .map((locale) => [locale, load(locale)] as const);
    const findings: Finding[] = [];

    for (const [locale, dict] of translations) {
      const problems = {
        missing: baseKeys.filter((key) => !(key in dict)),
        unknown: Object.keys(dict).filter((key) => !Object.hasOwn(base, key)),
        empty: baseKeys.filter((key) => key in dict && isBlank(dict[key]) && !isBlank(base[key])),
      };
      const shown = displayPath(root, fileOf(locale));
      const fixes = {
        missing: `Add these keys to ${shown}.`,
        unknown: `Remove them or add them to the ${defaultLocale} file first.`,
        empty: `Translate them or remove the keys to fall back to ${defaultLocale}.`,
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
