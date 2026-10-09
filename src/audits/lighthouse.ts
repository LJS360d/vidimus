import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VidimusConfig } from '../config/types.ts';
import { addSpans, span } from '../core/profile.ts';
import type { Audit, AuditContext, Finding } from '../core/types.ts';
import {
  displayPath,
  onePagePerDirectory,
  onePagePerTemplate,
  pathOf,
  regex,
  slug,
  track,
} from '../core/util.ts';

interface CategoryRef {
  id: string;
  weight: number;
}

interface LighthouseResult {
  runtimeError?: { code: string; message: string };
  timing?: { entries?: { name: string; startTime: number; duration: number }[] };
  categories: Record<string, { score: number | null; auditRefs: CategoryRef[] } | undefined>;
  audits: Record<string, { score: number | null; title: string } | undefined>;
}

type Lighthouse = (
  url: string,
  flags: Record<string, unknown>,
) => Promise<{ lhr: LighthouseResult; report: string | string[] } | undefined>;

const DESKTOP = {
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
};

const median = (values: (number | null | undefined)[]) => {
  const sorted = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

const medianRun = <T extends { lhr: LighthouseResult }>(ran: T[]) =>
  [...ran].sort(
    (a, b) =>
      (a.lhr.categories.performance?.score ?? 0) - (b.lhr.categories.performance?.score ?? 0),
  )[(ran.length - 1) >> 1];

export const selectUrls = ({ config, origin, pageUrls }: AuditContext) => {
  const { exclude, sample, all, urls } = config.lighthouse;
  if (urls.length)
    return urls.map((path) => new URL(path.trim().replace(/^\/+/, ''), `${origin}/`).href);
  const candidates = pageUrls({ exclude, allLocales: true });
  if (all) return candidates;
  return sample.length
    ? onePagePerTemplate(candidates, sample, origin)
    : onePagePerDirectory(candidates, origin);
};

const costliestAudits = (lhr: LighthouseResult, category: string) =>
  (lhr.categories[category]?.auditRefs ?? [])
    .map((ref) => ({ ref, audit: lhr.audits[ref.id] }))
    .filter(({ ref, audit }) => ref.weight > 0 && audit && audit.score !== null && audit.score < 1)
    .sort((a, b) => b.ref.weight - a.ref.weight)
    .slice(0, 3)
    .map(({ audit }) => audit?.title ?? '');

// Later overrides win, so a specific pattern can follow a broad one.
export const thresholdsFor = (
  { thresholds, overrides }: Pick<VidimusConfig['lighthouse'], 'thresholds' | 'overrides'>,
  path: string,
): Record<string, number> =>
  Object.assign(
    {},
    thresholds,
    ...overrides.filter(({ match }) => regex(match).test(path)).map((rule) => rule.thresholds),
  );

export const scoreFix = (report: string, category: string) =>
  `Open ${report} and fix the audits listed first, or lower lighthouse.thresholds.${category} if the target is too strict.`;

export const loadFailureFix = (path: string, listed: boolean) =>
  `Check that ${path} loads in a browser without errors, or ${listed ? 'remove it from lighthouse.urls' : 'add it to lighthouse.exclude'}.`;

export const lighthouse: Audit = {
  name: 'lighthouse',
  description: 'Lighthouse category scores meet their thresholds',
  exclusive: true,
  async run(context) {
    const { config, root, origin, resolve, importPeer, launchBrowser, log } = context;
    const { thresholds, overrides, preset, runs } = config.lighthouse;
    const { default: runLighthouse } = await importPeer<{ default: Lighthouse }>('lighthouse');
    const out = resolve(config.outDir, config.lighthouse.outDir);
    const shown = displayPath(root, out);
    const categories = [
      ...new Set([thresholds, ...overrides.map((rule) => rule.thresholds)].flatMap(Object.keys)),
    ];
    const urls = selectUrls(context);
    mkdirSync(out, { recursive: true });

    const browser = await launchBrowser({ args: ['--remote-debugging-port=0'] });
    const port = Number(new URL(browser.wsEndpoint()).port);
    const scores: Record<string, string | number | null>[] = [];
    const findings: Finding[] = [];

    const tick = track(urls.length);
    try {
      for (const url of urls) {
        const path = pathOf(url, origin);
        const name = slug(url, origin);
        const ok: NonNullable<Awaited<ReturnType<Lighthouse>>>[] = [];
        let failed: Awaited<ReturnType<Lighthouse>>;
        let thrown = '';
        for (let attempt = 0; attempt < runs; attempt++) {
          try {
            const ran = await span(
              'lighthouse.run',
              async () => {
                const started = performance.now();
                const done = await runLighthouse(url, {
                  port,
                  output: 'html',
                  logLevel: 'error',
                  onlyCategories: categories,
                  ...(preset === 'desktop' ? DESKTOP : {}),
                });
                addSpans(done?.lhr.timing?.entries ?? [], started, performance.now());
                return done;
              },
              { url },
            );
            if (ran && !ran.lhr.runtimeError) ok.push(ran);
            else failed = ran;
          } catch (error) {
            thrown = error instanceof Error ? error.message : String(error);
          }
        }
        tick();
        const result = ok.length ? medianRun(ok) : undefined;
        if (!result) {
          const error = failed?.lhr.runtimeError;
          findings.push({
            message: `failed to load ${path}`,
            details: thrown ? [thrown] : error ? [`${error.code} - ${error.message}`] : [],
            fix: loadFailureFix(path, config.lighthouse.urls.length > 0),
          });
          continue;
        }
        const { lhr, report } = result;
        writeFileSync(join(out, `${name}.html`), Array.isArray(report) ? report.join('') : report);

        const noindex = lhr.audits['is-crawlable']?.score === 0;
        const row: Record<string, string | number | null> = { page: name };
        for (const category of categories) {
          const seoIsMeaningless = category === 'seo' && noindex;
          const score = median(ok.map((ran) => ran.lhr.categories[category]?.score));
          row[category] = seoIsMeaningless || score == null ? null : Math.round(score * 100);
        }
        scores.push(row);
        log(
          `${name}${noindex ? ' (noindex)' : ''}  ${categories
            .map((category) => `${category} ${row[category] ?? 'unavailable'}`)
            .join('  ')}`,
        );

        const wanted = thresholdsFor(config.lighthouse, path);
        for (const category of categories) {
          const min = Math.round((wanted[category] ?? 0) * 100);
          const score = row[category];
          if (min === 0 || typeof score !== 'number' || score >= min) continue;
          findings.push({
            message: `${path} ${category} ${score} (want ${min})`,
            details: costliestAudits(lhr, category),
            where: [path],
            fix: scoreFix(`${shown}/${name}.html`, category),
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
