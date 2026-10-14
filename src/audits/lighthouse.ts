import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withState } from '../core/peer.ts';
import type { Audit, AuditContext, Finding } from '../core/types.ts';
import {
  displayPath,
  inParallel,
  onePagePerDirectory,
  onePagePerTemplate,
  pathOf,
  slug,
} from '../core/util.ts';
import { loadFailure, pageFindings } from './lighthouse/findings.ts';
import { type RunOptions, runAll } from './lighthouse/run.ts';
import {
  categoriesOf,
  categoryScore,
  concurrencyFor,
  median,
  medianRun,
} from './lighthouse/scoring.ts';
import type { Lighthouse } from './lighthouse/types.ts';

type Row = Record<string, string | number | null>;

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

export const lighthouse: Audit = {
  name: 'lighthouse',
  description: 'Lighthouse category scores meet their thresholds',
  exclusive: ({ lighthouse }) => categoriesOf(lighthouse).includes('performance'),
  async run(context) {
    const { config, root, origin, resolve, importPeer, launchBrowser, log } = context;
    const settings = config.lighthouse;
    const { overrides, preset, runs, ignoreAudits, audits, metrics } = settings;
    const ignored = new Set([
      ...ignoreAudits,
      ...Object.entries(audits).flatMap(([id, level]) => (level === 'off' ? [id] : [])),
    ]);
    const asserted = Object.entries(audits).flatMap(([id, level]) =>
      level === 'error' ? [id] : [],
    );
    const onlyAudits = [
      ...new Set([
        ...asserted,
        ...Object.keys(metrics),
        ...overrides.flatMap((rule) => Object.keys(rule.metrics ?? {})),
      ]),
    ];
    const { default: runLighthouse } = await importPeer<{ default: Lighthouse }>('lighthouse');
    const out = resolve(config.outDir, settings.outDir);
    const shown = displayPath(root, out);
    const categories = categoriesOf(settings);
    const urls = selectUrls(context);
    mkdirSync(out, { recursive: true });
    for (const file of readdirSync(out)) if (file.endsWith('.html')) rmSync(join(out, file));

    const browser = await launchBrowser({ args: ['--remote-debugging-port=0'] });
    const stateful = withState(browser, config.browser.state, origin);
    const options: Omit<RunOptions, 'newPage'> = {
      runLighthouse,
      categories,
      onlyAudits,
      preset,
      runs,
    };
    const outcomes = new Map<string, { row?: Row; findings: Finding[] }>();

    const audited = async (url: string) => {
      const path = pathOf(url, origin);
      const name = slug(url, origin);
      const attempts = await runAll(url, { ...options, newPage: () => stateful.newPage() });
      const { ok } = attempts;
      const result = ok.length ? medianRun(ok) : undefined;
      if (!result) {
        outcomes.set(url, {
          findings: [loadFailure(path, attempts, settings.urls.length > 0)],
        });
        return;
      }
      const { lhr, report } = result;
      writeFileSync(join(out, `${name}.html`), Array.isArray(report) ? report.join('') : report);

      const noindex = lhr.audits['is-crawlable']?.score === 0;
      const row: Row = { page: name };
      for (const category of categories) {
        const score = median(ok.map((ran) => categoryScore(ran.lhr, category, ignored)));
        row[category] =
          (category === 'seo' && noindex) || score == null ? null : Math.round(score * 100);
      }
      log(
        `${name}${noindex ? ' (noindex)' : ''}${ok.length < runs ? ` (${ok.length}/${runs} runs ok)` : ''}  ${categories
          .map((category) => `${category} ${row[category] ?? '-'}`)
          .join('  ')}`,
      );
      outcomes.set(url, {
        row,
        findings: pageFindings(lhr, row, categories, {
          config: settings,
          path,
          report: `${shown}/${name}.html`,
          ignored,
          asserted,
        }),
      });
    };
    try {
      await inParallel(concurrencyFor(settings), urls, audited);
    } finally {
      await browser.close();
    }
    const findings = urls.flatMap((url) => outcomes.get(url)?.findings ?? []);
    const reported = urls.filter((url) => outcomes.get(url)?.row).length;

    if (reported === 0) return { status: 'failed', summary: 'no page produced a report', findings };
    return {
      summary: findings.length
        ? `${findings.length} problem(s) across ${reported} pages, reports in ${shown}/`
        : `${reported} pages meet every threshold, reports in ${shown}/`,
      findings,
    };
  },
};
