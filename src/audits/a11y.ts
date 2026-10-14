import type { Audit, Finding } from '../core/types.ts';
import { inParallel, navigate, onePagePerTemplate, pathOf } from '../core/util.ts';
import { groupFindings } from './util.ts';

interface Pa11yIssue {
  code: string;
  message: string;
  selector: string;
  type?: string;
  context: string | null;
  runnerExtras?: { helpUrl?: string; help?: string };
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

const AXE_RULE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

export const issueFix = (code: string, helpUrl?: string) => {
  const url =
    helpUrl ??
    techniqueUrl(code) ??
    (AXE_RULE.test(code) ? `https://dequeuniversity.com/rules/axe/4.10/${code}` : undefined);
  return `${url ? `Apply ${url} to the element listed` : 'Fix the element listed'}, or add the code to a11y.ignore if it is a false positive.`;
};

export const loadFailureFix = (timeout: number) =>
  `Check the page loads in a browser, raise a11y.timeout (now ${timeout}ms) or add the page to a11y.exclude.`;

type Pa11y = (url: string, options: Record<string, unknown>) => Promise<{ issues: Pa11yIssue[] }>;

export const a11y: Audit = {
  name: 'a11y',
  description: 'pa11y (HTML_CodeSniffer) finds no WCAG violations',
  async run({ config, origin, pageUrls, importPeer, launchBrowser, log }) {
    const {
      standard,
      runner,
      includeWarnings,
      timeout,
      concurrency,
      hideElements,
      ignore,
      exclude,
      sample,
    } = config.a11y;
    await importPeer('puppeteer');
    const { default: pa11y } = await importPeer<{ default: Pa11y }>('pa11y');
    const urls = onePagePerTemplate(pageUrls({ exclude }), sample, origin);
    const browser = await launchBrowser();
    const byIssue = groupFindings();
    const results: { url: string; issues: Pa11yIssue[] }[] = [];
    const failures: { path: string; error: string }[] = [];

    try {
      await inParallel(concurrency, urls, async (url) => {
        const page = await browser.newPage();
        try {
          await navigate(page, url, { waitFor: config.render.waitFor, timeout });
          const { issues } = await pa11y(url, {
            browser,
            page,
            standard,
            runners: [runner],
            includeWarnings,
            timeout,
            hideElements,
            ignore,
            ignoreUrl: true,
          });
          results.push({ url, issues });
        } catch (error) {
          failures.push({ path: pathOf(url, origin), error: (error as Error).message });
        } finally {
          await page.close().catch(() => {});
        }
      });
    } finally {
      await browser.close();
    }

    results.sort((x, y) => x.url.localeCompare(y.url));
    for (const { url, issues } of results) {
      for (const issue of issues) {
        byIssue.add(
          {
            message: issue.message,
            details: [issue.selector, issue.code, ...(issue.context ? [issue.context] : [])],
            fix: issueFix(issue.code, issue.runnerExtras?.helpUrl),
            ...(issue.type === 'warning' && { severity: 'warn' as const }),
          },
          pathOf(url, origin),
          { key: `${issue.code} | ${issue.selector}` },
        );
      }
    }
    failures.sort((x, y) => x.path.localeCompare(y.path));

    const findings: Finding[] = [
      ...byIssue.values(),
      ...failures.map(({ path, error }) => ({
        message: `failed to audit ${path}`,
        details: [error],
        where: [path],
        fix: loadFailureFix(timeout),
      })),
    ];
    log(`${urls.length} pages against ${standard}`);
    return {
      summary: findings.length
        ? `${byIssue.size()} distinct issue(s), ${failures.length} page(s) failed to load`
        : `${urls.length} pages, no ${standard} violations`,
      findings,
    };
  },
};
