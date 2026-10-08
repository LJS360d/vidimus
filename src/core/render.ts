import type { VidimusConfig } from '../config/types.ts';
import type { Browser } from './peer-types.ts';
import { span } from './profile.ts';
import { navigate } from './util.ts';

export interface RenderedRequest {
  url: string;
  type: string;
}

export interface RenderedPage {
  url: string;
  html: string;
  anchors: string[];
  links: string[];
  requests: RenderedRequest[];
  notFound: boolean;
}

export interface Renderer {
  render: (url: string) => Promise<RenderedPage>;
  snapshot: (pathname: string) => string | undefined;
  close: () => Promise<void>;
}

// Runs in the page: every URL the rendered DOM points at, and whether it shows a not-found view.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const collect = (selector: string, text: string) => {
  const absolute = (value: string | null) => {
    try {
      return value ? new URL(value, document.baseURI).href : '';
    } catch {
      return '';
    }
  };
  const srcset = (value: string | null) =>
    (value ?? '').split(',').map((part) => absolute(part.trim().split(/\s+/)[0] ?? ''));
  const all = (css: string) => [...document.querySelectorAll(css)];
  const anchors = all('a[href]').map((link) => (link as HTMLAnchorElement).href);
  const links = [
    ...anchors,
    ...all('img[src], iframe[src], source[src]').map((node) => absolute(node.getAttribute('src'))),
    ...all('img[srcset], source[srcset]').flatMap((node) => srcset(node.getAttribute('srcset'))),
    ...all('link[href]').map((node) => absolute(node.getAttribute('href'))),
  ];
  const notFound =
    (!!selector && !!document.querySelector(selector)) ||
    (!!text && new RegExp(text).test(document.body?.innerText ?? ''));
  return { anchors, links: [...new Set(links)].filter(Boolean), notFound };
};
/* node:coverage enable */

export const createRenderer = (
  config: VidimusConfig,
  browser: () => Promise<Browser>,
): Renderer => {
  const cache = new Map<string, Promise<RenderedPage>>();
  const snapshots = new Map<string, string>();
  const limit = Math.max(1, Math.floor(config.render.concurrency) || 1);
  const waiting: (() => void)[] = [];
  let active = 0;
  let handle: Promise<Browser> | undefined;

  const acquire = () => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  const load = async (url: string): Promise<RenderedPage> => {
    await span('render.wait', acquire);
    try {
      handle ??= browser();
      const page = await (await handle).newPage();
      const requests: RenderedRequest[] = [];
      page.on('request', (request) => {
        requests.push({ url: request.url(), type: request.resourceType() });
      });
      try {
        await navigate(page, url, config.render);
        const { selector, text } = config.links.notFound;
        const found = await page.evaluate(collect, selector, text);
        const html = await page.content();
        const { pathname, hash } = new URL(url);
        if (!hash) snapshots.set(pathname, html);
        return { url, html, requests, ...found };
      } finally {
        await page.close().catch(() => {});
      }
    } finally {
      release();
    }
  };

  return {
    render: (url) => {
      let rendered = cache.get(url);
      if (!rendered) {
        rendered = span('render', () => load(url), { url });
        cache.set(url, rendered);
      }
      return rendered;
    },
    snapshot: (pathname) => snapshots.get(pathname),
    close: async () => {
      if (handle) await (await handle.catch(() => undefined))?.close();
    },
  };
};
