import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Audit, AuditContext, Finding } from '../core/types.ts';
import { displayPath, onePagePerTemplate, pathOf, slug } from '../core/util.ts';

interface CategoryRef {
  id: string;
  weight: number;
}

interface LighthouseResult {
  runtimeError?: { code: string; message: string };
  categories: Record<string, { score: number | null; auditRefs: CategoryRef[] } | undefined>;
  audits: Record<string, { score: number | null; title: string } | undefined>;
}

type Lighthouse = (
  url: string,
  flags: Record<string, unknown>,
) => Promise<{ lhr: LighthouseResult; report: string | string[] } | undefined>;

const selectUrls = ({ config, origin, pageUrls }: AuditContext) => {
  const { exclude, sample, all, urls } = config.lighthouse;
  if (urls.length) return urls.map((path) => new URL(path.trim(), `${origin}/`).href);
  const candidates = pageUrls({ exclude, allLocales: true });
  return all ? candidates : onePagePerTemplate(candidates, sample);
};

const costliestAudits = (lhr: LighthouseResult, category: string) =>
  (lhr.categories[category]?.auditRefs ?? [])
    .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
    .filter(({ ref, audit }) => ref.weight > 0 && audit && audit.score !== null && audit.score < 1)
    .sort((a, b) => b.ref.weight - a.ref.weight)
    .slice(0, 3)
    .map(({ audit }) => audit?.title ?? '');

export const lighthouse: Audit = {
  name: 'lighthouse',
  description: 'Lighthouse category scores meet their thresholds',
  exclusive: true,
  async run(context) {
    const { config, root, resolve, importPeer, launchBrowser, log } = context;
    const { thresholds } = config.lighthouse;
    const { default: runLighthouse } = await importPeer<{ default: Lighthouse }>('lighthouse');
    const out = resolve(config.outDir, config.lighthouse.outDir);
    const shown = displayPath(root, out);
    const categories = Object.keys(thresholds);
    const urls = selectUrls(context);
    mkdirSync(out, { recursive: true });

    const browser = await launchBrowser({ args: ['--remote-debugging-port=0'] });
    const port = Number(new URL(browser.wsEndpoint()).port);
    const scores: Record<string, string | number | null>[] = [];
    const findings: Finding[] = [];

    try {
      for (const url of urls) {
        const path = pathOf(url);
        const name = slug(url);
        const result = await runLighthouse(url, {
          port,
          output: 'html',
          logLevel: 'error',
          onlyCategories: categories,
        });
        if (!result || result.lhr.runtimeError) {
          const error = result?.lhr.runtimeError;
          findings.push({
            message: `failed to load ${path}`,
            details: error ? [`${error.code} - ${error.message}`] : [],
          });
          continue;
        }
        const { lhr, report } = result;
        writeFileSync(join(out, `${name}.html`), Array.isArray(report) ? report.join('') : report);

        const noindex = lhr.audits['is-crawlable']?.score === 0;
        const row: Record<string, string | number | null> = { page: name };
        for (const category of categories) {
          const seoIsMeaningless = category === 'seo' && noindex;
          row[category] = seoIsMeaningless
            ? null
            : Math.round((lhr.categories[category]?.score ?? 0) * 100);
        }
        scores.push(row);
        log(
          `${name}${noindex ? ' (noindex)' : ''}  ${categories
            .map((category) => `${category} ${row[category] ?? '-'}`)
            .join('  ')}`,
        );

        for (const category of categories) {
          const min = Math.round((thresholds[category] ?? 0) * 100);
          const score = row[category];
          if (min === 0 || typeof score !== 'number' || score >= min) continue;
          findings.push({
            message: `${path} ${category} ${score} (want ${min})`,
            details: costliestAudits(lhr, category),
            where: [path],
          });
        }
      }
    } finally {
      await browser.close();
    }

    if (scores.length === 0) {
      return { status: 'failed', summary: 'no page produced a report', findings };
    }
    return {
      summary: findings.length
        ? `${findings.length} problem(s) across ${scores.length} pages, reports in ${shown}/`
        : `${scores.length} pages meet every threshold, reports in ${shown}/`,
      findings,
    };
  },
};
