import type { VidimusConfig } from '../config/types.ts';
import type { PageReader } from './html.ts';
import type { PageQuery } from './types.ts';
import { matchesAny, pathOf } from './util.ts';

export const pageUrlOf = (origin: string, rel: string) =>
  `${origin}/${rel
    .replace(/(^|\/)index\.html$/, '$1')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;

const routeUrlOf = (origin: string, route: string) => {
  const at = route.indexOf('#');
  return at < 0
    ? pageUrlOf(origin, route.slice(1))
    : pageUrlOf(origin, route.slice(1, at)) + route.slice(at);
};

export const createPageUrls = (
  config: VidimusConfig,
  dist: string,
  pages: PageReader,
  origin: string,
  routes: string[] = [],
) => {
  const translatedLocales = config.locales.filter((locale) => locale !== config.defaultLocale);
  const isTranslation = (page: string) =>
    translatedLocales.some(
      (locale) => page === locale || page === `${locale}.html` || page.startsWith(`${locale}/`),
    );
  const toUrl = (page: string) => pageUrlOf(origin, page);

  let builtPages: string[] | undefined;
  const findBuiltPages = () => {
    builtPages ??= pages(config.exclude).map(({ rel }) => rel);
    if (builtPages.length + routes.length === 0)
      throw new Error(`${dist} has no HTML pages. Rebuild.`);
    return builtPages;
  };

  return ({ exclude = [], allLocales = config.allLocales }: PageQuery = {}) =>
    [
      ...findBuiltPages()
        .filter((page) => allLocales || !isTranslation(page))
        .map(toUrl),
      ...routes
        .filter((route) => allLocales || !isTranslation(route.slice(1)))
        .map((route) => (config.routes.hash ? routeUrlOf(origin, route) : toUrl(route.slice(1)))),
    ].filter((url) => !matchesAny(exclude, pathOf(url, origin)));
};
