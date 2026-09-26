import type { Audit, Finding } from '../core/types.ts';
import { escapeRegExp, pathOf } from '../core/util.ts';

interface LinkResult {
  url: string;
  status?: number;
  state: string;
  parent?: string;
}

export const brokenLinkFix = (status: number | undefined) => {
  if (status === 404 || status === 410) {
    return 'Fix or remove the link on the pages listed, or add a pattern to links.skip if the target blocks bots.';
  }
  if (status && status < 500) {
    return 'Check the link in a browser; if it works there the target blocks bots, so add a pattern to links.skip.';
  }
  return 'Check the target is up, raise links.timeout or enable links.retry, or add a pattern to links.skip if it is flaky.';
};

export const links: Audit = {
  name: 'links',
  description: 'no broken internal links, assets or external targets',
  async run({ config, origin, pageUrls, importPeer }) {
    const { LinkChecker } = await importPeer<typeof import('linkinator')>('linkinator');
    const urls = pageUrls();
    const site = config.siteUrl.replace(/\/$/, '');
    const checker = new LinkChecker();
    const broken: LinkResult[] = [];
    let scanned = 0;

    checker.on('link', (result: LinkResult) => {
      scanned += 1;
      if (result.state === 'BROKEN') broken.push(result);
    });

    await checker.check({
      path: urls,
      recurse: true,
      concurrency: config.links.concurrency,
      timeout: config.links.timeout,
      retry: config.links.retry,
      retryErrors: config.links.retry,
      urlRewriteExpressions: site
        ? [{ pattern: new RegExp(`^${escapeRegExp(site)}`), replacement: origin }]
        : [],
      linksToSkip: [
        ...config.links.skip,
        ...(config.links.checkExternal ? [] : [`^(?!${escapeRegExp(origin)})`]),
      ],
    });

    const byTarget = new Map<string, { status: number | undefined; sources: Set<string> }>();
    for (const result of broken) {
      const target = byTarget.get(result.url) ?? { status: result.status, sources: new Set() };
      target.sources.add(result.parent ? pathOf(result.parent) : '(root)');
      byTarget.set(result.url, target);
    }

    const findings: Finding[] = [...byTarget].map(([url, { status, sources }]) => ({
      message: `${status || 'ERR'} ${url}`,
      where: [...sources],
      fix: brokenLinkFix(status),
    }));
    return {
      summary: findings.length
        ? `${findings.length} broken target(s) out of ${scanned} links checked`
        : `${scanned} links checked across ${urls.length} pages, none broken`,
      findings,
    };
  },
};
