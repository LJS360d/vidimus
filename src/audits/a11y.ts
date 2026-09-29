import type { Audit, Finding } from '../core/types.ts';
import { inParallel, onePagePerTemplate, pathOf } from '../core/util.ts';

interface Pa11yIssue {
  code: string;
  message: string;
  selector: string;
  context: string | null;
}

const TECHNIQUE_DIRS: [RegExp, string][] = [
  [/^ARIA\d+$/, 'aria'],
  [/^SCR\d+$/, 'client-side-script'],
  [/^PDF\d+$/, 'pdf'],
  [/^G\d+$/, 'general'],
  [/^H\d+$/, 'html'],
  [/^F\d+$/, 'failures'],
  [/^C\d+$/, 'css'],
];

export const techniqueUrl = (code: string) => {
  const techniques = code.split('.')[4]?.split(/[,+]/) ?? [];
  for (const technique of techniques) {
    const dir = TECHNIQUE_DIRS.find(([pattern]) => pattern.test(technique))?.[1];
    if (dir) return `https://www.w3.org/WAI/WCAG21/Techniques/${dir}/${technique}`;
  }
  return undefined;
};

export const issueFix = (code: string) => {
  const url = techniqueUrl(code);
  return `${url ? `Apply ${url} to the element listed` : 'Fix the element listed'}, or add the code to a11y.ignore if it is a false positive.`;
};

export const loadFailureFix = (timeout: number) =>
  `Check the page loads in a browser, raise a11y.timeout (now ${timeout}ms) or add the page to a11y.exclude.`;

type Pa11y = (url: string, options: Record<string, unknown>) => Promise<{ issues: Pa11yIssue[] }>;

export const a11y: Audit = {
  name: 'a11y',
  description: 'pa11y (HTML_CodeSniffer) finds no WCAG violations',
  async run({ config, origin, pageUrls, importPeer, launchBrowser, log }) {
    const { standard, timeout, concurrency, hideElements, ignore, exclude, sample } = config.a11y;
    await importPeer('puppeteer');
    const { default: pa11y } = await importPeer<{ default: Pa11y }>('pa11y');
    const urls = onePagePerTemplate(pageUrls({ exclude }), sample, origin);
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
              fix: issueFix(issue.code),
            };
            finding.where.push(pathOf(url, origin));
            byIssue.set(key, finding);
          }
        } catch (error) {
          failedToLoad.push(`${pathOf(url, origin)}: ${(error as Error).message}`);
        } finally {
          await page.close();
        }
      });
    } finally {
      await browser.close();
    }

    const findings: Finding[] = [
      ...byIssue.values(),
      ...failedToLoad.map((message) => ({
        message: `failed to audit ${message}`,
        fix: loadFailureFix(timeout),
      })),
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
