import type { Audit, Finding } from '../core/types.ts';
import { inParallel, pathOf } from '../core/util.ts';

interface Pa11yIssue {
  code: string;
  message: string;
  selector: string;
  context: string | null;
}

type Pa11y = (url: string, options: Record<string, unknown>) => Promise<{ issues: Pa11yIssue[] }>;

export const a11y: Audit = {
  name: 'a11y',
  description: 'pa11y (HTML_CodeSniffer) finds no WCAG violations',
  async run({ config, pageUrls, importPeer, launchBrowser, log }) {
    const { standard, timeout, concurrency, hideElements, ignore, exclude } = config.a11y;
    await importPeer('puppeteer');
    const { default: pa11y } = await importPeer<{ default: Pa11y }>('pa11y');
    const urls = pageUrls({ exclude });
    const browser = await launchBrowser();
    const byIssue = new Map<string, Finding & { where: string[] }>();
    const failedToLoad: string[] = [];

    try {
      await inParallel(concurrency, urls, async (url) => {
        const page = await browser.newPage();
        try {
          const { issues } = await pa11y(url, {
            browser,
            page,
            standard,
            timeout,
            hideElements,
            ignore,
          });
          for (const issue of issues) {
            const key = [issue.code, issue.selector].join(' | ');
            const finding = byIssue.get(key) ?? {
              message: issue.message,
              details: [issue.selector, issue.code, ...(issue.context ? [issue.context] : [])],
              where: [],
            };
            finding.where.push(pathOf(url));
            byIssue.set(key, finding);
          }
        } catch (error) {
          failedToLoad.push(`${pathOf(url)}: ${(error as Error).message}`);
        } finally {
          await page.close();
        }
      });
    } finally {
      await browser.close();
    }

    const findings: Finding[] = [
      ...byIssue.values(),
      ...failedToLoad.map((message) => ({ message: `failed to audit ${message}` })),
    ];
    log(`${urls.length} pages against ${standard}`);
    return {
      summary: findings.length
        ? `${byIssue.size} distinct issue(s), ${failedToLoad.length} page(s) failed to load`
        : `${urls.length} pages, no ${standard} violations`,
      findings,
    };
  },
};
