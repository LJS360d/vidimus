import { extname } from 'node:path';
import { localFile } from '../core/html.ts';
import type { RenderedPage } from '../core/render.ts';
import { RENDERED_HEADER } from '../core/server.ts';
import type { Audit, Finding } from '../core/types.ts';
import { escapeRegExp, pathOf } from '../core/util.ts';

interface LinkResult {
  url: string;
  status?: number;
  state: string;
  parent?: string;
}

export const brokenLinkFix = (status: number | undefined, url = '') => {
  if (status === 200 && url.includes('#')) {
    return 'Fix the #fragment so it matches an id on the target page, or remove it.';
  }
  if (status === 404 || status === 410) {
    return 'Fix or remove the link on the pages listed, or add a pattern to links.skip if the target blocks bots.';
  }
  if (status && status < 500) {
    return 'Check the link in a browser; if it works there the target blocks bots, so add a pattern to links.skip.';
  }
  return 'Check the target is up, raise links.timeout or enable links.retry, or add a pattern to links.skip if it is flaky.';
};

// Internal links the fallback answers with 200, so only the browser can tell a missing route.
const routeLinks = (pages: RenderedPage[], origin: string, dist: string) => {
  const targets = new Map<string, { display: string; sources: Set<string> }>();
  const audited = new URL(origin).origin;
  for (const page of pages) {
    for (const href of page.anchors) {
      if (!URL.canParse(href)) continue;
      const url = new URL(href);
      if (url.origin !== audited) continue;
      const path = pathOf(href, origin);
      const hashRoute = url.hash.startsWith('#/');
      if (!hashRoute && (extname(path) || localFile(dist, path))) continue;
      const key = `${url.origin}${url.pathname}${url.search}${hashRoute ? url.hash : ''}`;
      const target = targets.get(key) ?? {
        display: `${path}${url.search}${hashRoute ? url.hash : ''}`,
        sources: new Set(),
      };
      target.sources.add(pathOf(page.url, origin));
      targets.set(key, target);
    }
  }
  return targets;
};

export const links: Audit = {
  name: 'links',
  description: 'no broken internal links, assets or external targets',
  async run({ config, origin, dist, pageUrls, importPeer, renderPage, log }) {
    const { LinkChecker } = await importPeer<typeof import('linkinator')>('linkinator');
    const urls = pageUrls();
    const rendered = renderPage
      ? (await Promise.all(urls.map((url) => renderPage(url).catch(() => undefined)))).filter(
          (page) => page !== undefined,
        )
      : [];
    // The built-in server hands linkinator the rendered DOM of these pages instead of the shell.
    const snapshots = rendered.length > 0 && !config.origin;
    if (renderPage && config.origin)
      log(
        `${config.server.command ? 'server.command' : '--origin'}: links are read from the HTML the server sends, not the rendered DOM`,
      );
    const site = config.siteUrl.replace(/\/$/, '');
    const checker = new LinkChecker();
    const broken: LinkResult[] = [];
    const redirected = new Map<string, string>();
    const parents = new Map<string, Set<string>>();
    let scanned = 0;

    checker.on('redirect', ({ url, targetUrl }: { url: string; targetUrl?: string }) => {
      redirected.set(url, targetUrl ?? '');
    });
    checker.on('link', (result: LinkResult) => {
      scanned += 1;
      const set = parents.get(result.url) ?? new Set();
      set.add(result.parent ? pathOf(result.parent, origin) : '(root)');
      parents.set(result.url, set);
      if (result.state === 'BROKEN') broken.push(result);
    });

    await checker.check({
      path: urls,
      recurse: true,
      concurrency: config.links.concurrency,
      timeout: config.links.timeout,
      retry: config.links.retry,
      retryErrors: config.links.retry,
      checkCss: config.links.checkCss,
      checkFragments: config.links.checkFragments,
      redirects: config.links.warnRedirects ? 'warn' : 'allow',
      ...(snapshots && { headers: { [RENDERED_HEADER]: '1' } }),
      urlRewriteExpressions: site
        ? [{ pattern: new RegExp(`^${escapeRegExp(site)}(?=[/?#]|$)`), replacement: origin }]
        : [],
      linksToSkip: [
        ...config.links.skip,
        ...(config.links.checkExternal
          ? []
          : [
              `^(?!${[escapeRegExp(origin), site && `${escapeRegExp(site)}(?=[/?#]|$)`].filter(Boolean).join('|')})`,
            ]),
      ],
    });

    const byTarget = new Map<string, { status: number | undefined; sources: Set<string> }>();
    for (const result of broken) {
      const target = byTarget.get(result.url) ?? { status: result.status, sources: new Set() };
      target.sources.add(result.parent ? pathOf(result.parent, origin) : '(root)');
      byTarget.set(result.url, target);
    }

    const findings: Finding[] = [...byTarget].map(([url, { status, sources }]) => ({
      message: `${status || 'ERR'} ${url}`,
      where: [...sources],
      fix: brokenLinkFix(status, url),
    }));

    for (const [url, target] of redirected) {
      findings.push({
        message: `redirect ${url}${target ? ` -> ${target}` : ''}`,
        where: [...(parents.get(url) ?? [])],
        severity: 'warn',
        fix: 'Link to the final URL directly to save a request, or add a pattern to links.skip.',
      });
    }

    const { selector, text } = config.links.notFound;
    if (renderPage && (selector || text)) {
      for (const [url, { display, sources }] of routeLinks(rendered, origin, dist)) {
        const target = await renderPage(url).catch(() => undefined);
        if (!target?.notFound) continue;
        findings.push({
          message: `not-found view ${display}`,
          where: [...sources],
          fix: 'Fix or remove the link on the pages listed, or add the route to the app router.',
        });
      }
    }
    return {
      summary:
        findings.length > redirected.size
          ? `${findings.length - redirected.size} broken target(s) out of ${scanned} links checked`
          : `${scanned} links checked across ${urls.length} pages, none broken`,
      findings,
    };
  },
};
