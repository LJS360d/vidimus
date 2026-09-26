import { globSync } from 'node:fs';
import { sep } from 'node:path';
import type { VidimusConfig } from '../config/types.ts';
import type { PageQuery } from './types.ts';
import { matchesAny, pathOf } from './util.ts';

export const createPageUrls = (config: VidimusConfig, dist: string, origin: string) => {
  const translatedLocales = config.locales.filter((locale) => locale !== config.defaultLocale);
  const isTranslation = (page: string) =>
    translatedLocales.some((locale) => page.startsWith(`${locale}/`));
  const toUrl = (page: string) => `${origin}/${page.replace(/(^|\/)index\.html$/, '$1')}`;

  let builtPages: string[] | undefined;
  const findBuiltPages = () => {
    builtPages ??= globSync('**/*.html', { cwd: dist })
      .map((page) => page.split(sep).join('/'))
      .filter((page) => !matchesAny(config.exclude, page))
      .sort();
    if (builtPages.length === 0) throw new Error(`${dist} has no HTML pages. Rebuild.`);
    return builtPages;
  };

  return ({ exclude = [], allLocales = config.allLocales }: PageQuery = {}) =>
    findBuiltPages()
      .filter((page) => allLocales || !isTranslation(page))
      .map(toUrl)
      .filter((url) => !matchesAny(exclude, pathOf(url)));
};
