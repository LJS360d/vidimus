import type { BuiltPage, Tag } from '../core/html.ts';
import { relTokens, resolveHref, srcsetUrls, tags } from '../core/html.ts';
import type { Finding } from '../core/types.ts';

const RESOURCE_ATTRS: Record<string, string[]> = {
  script: ['src'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  iframe: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  object: ['data'],
  embed: ['src'],
  form: ['action'],
  image: ['href', 'xlink:href'],
};

const LINK_RESOURCES = ['stylesheet', 'icon', 'preload', 'modulepreload', 'manifest'];
const LINK_ATTRS = ['href', 'imagesrcset'];
const INSECURE = /^http:\/\//i;

const urlsIn = (tag: Tag, attr: string) => {
  const value = tag.attrs[attr];
  if (!value) return [];
  return attr === 'srcset' || attr === 'imagesrcset' ? srcsetUrls(value) : [value.trim()];
};

const cssUrls = (css: string) => [
  ...Array.from(css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi), (m) => (m[2] ?? '').trim()),
  ...Array.from(css.matchAll(/@import\s*(["'])(.*?)\1/gi), (m) => (m[2] ?? '').trim()),
];

const attrsToCheck = (tag: Tag) => {
  if (tag.name !== 'link') return RESOURCE_ATTRS[tag.name] ?? [];
  return relTokens(tag).some((rel) => LINK_RESOURCES.includes(rel)) ? LINK_ATTRS : [];
};

const insecureResources = (html: string) => {
  const styles = Array.from(
    html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi),
    (m) => m[1] ?? '',
  );
  const inline = tags(html).map((tag) => tag.attrs.style ?? '');
  const fromCss = [...styles, ...inline].flatMap(cssUrls);
  const fromTags = tags(html, 'link', ...Object.keys(RESOURCE_ATTRS)).flatMap((tag) =>
    attrsToCheck(tag).flatMap((attr) => urlsIn(tag, attr)),
  );
  return [...new Set([...fromCss, ...fromTags].filter((url) => INSECURE.test(url)))];
};

export const mixedContentFindings = (html: string): Finding[] =>
  insecureResources(html).map((url) => ({
    message: `mixed content: ${url}`,
    fix: 'Load it over https:// or self-host it.',
  }));

const crossOriginResources = (page: BuiltPage, siteUrl: string) => {
  const candidates = [
    ...tags(page.html, 'script').map((tag) => ({ tag, href: tag.attrs.src })),
    ...tags(page.html, 'link')
      .filter((tag) => relTokens(tag).includes('stylesheet'))
      .map((tag) => ({ tag, href: tag.attrs.href })),
  ];
  return candidates.flatMap(({ tag, href }) => {
    if (!href) return [];
    const target = resolveHref(href, page.path, siteUrl);
    if (!target || target.internal || !target.absolute) return [];
    if (!/^https?:$/.test(target.url.protocol)) return [];
    return [
      {
        kind: tag.name,
        url: target.href,
        integrity: Boolean(tag.attrs.integrity),
        crossorigin: tag.attrs.crossorigin !== undefined,
      },
    ];
  });
};

export const sriFindings = (page: BuiltPage, siteUrl: string): Finding[] =>
  crossOriginResources(page, siteUrl).flatMap(({ kind, url, integrity, crossorigin }) => {
    if (!integrity) {
      return [
        {
          message: `cross-origin <${kind}> without integrity: ${url}`,
          severity: 'warn' as const,
          fix: 'Add integrity="sha384-…" and crossorigin="anonymous", or self-host the file.',
        },
      ];
    }
    if (crossorigin) return [];
    return [
      {
        message: `cross-origin <${kind}> with integrity but no crossorigin: ${url}`,
        fix: 'Add crossorigin="anonymous" to the tag, or the browser blocks the file.',
      },
    ];
  });
