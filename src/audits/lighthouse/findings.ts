import type { VidimusConfig } from '../../config/types.ts';
import type { Finding } from '../../core/types.ts';
import { assertedFix, auditFix, loadFailureFix } from './fixes.ts';
import type { Attempts } from './run.ts';
import { costliestAudits, metricsFor, thresholdsFor } from './scoring.ts';
import type { LighthouseResult } from './types.ts';

type Row = Record<string, string | number | null>;

export interface PageContext {
  config: VidimusConfig['lighthouse'];
  path: string;
  report: string;
  ignored: Set<string>;
  asserted: string[];
}

export const loadFailure = (
  path: string,
  { failed, thrown }: Attempts,
  listed: boolean,
): Finding => {
  const error = failed?.lhr.runtimeError;
  return {
    message: `failed to load ${path}`,
    details: thrown ? [thrown] : error ? [`${error.code} - ${error.message}`] : [],
    where: [path],
    fix: loadFailureFix(path, listed, error?.code),
  };
};

const scoreFindings = (lhr: LighthouseResult, row: Row, categories: string[], c: PageContext) => {
  const wanted = thresholdsFor(c.config, c.path);
  const out: Finding[] = [];
  for (const category of categories) {
    const min = Math.round((wanted[category] ?? 0) * 100);
    const score = row[category];
    if (min === 0 || typeof score !== 'number' || score >= min) continue;
    const costly = costliestAudits(lhr, category, c.ignored);
    const ids = costly.map(({ id }) => id);
    out.push({
      message: `${c.path} ${category} ${score} (want ${min})`,
      details: [
        ...costly.map(({ text }) => text),
        ...(ids.length ? [`audit ids: ${ids.join(', ')}`] : []),
      ],
      where: [c.path],
      fix: auditFix(ids, c.report, category),
    });
  }
  return out;
};

const metricFindings = (lhr: LighthouseResult, c: PageContext) => {
  const out: Finding[] = [];
  for (const [id, max] of Object.entries(metricsFor(c.config, c.path))) {
    const audit = lhr.audits[id];
    if (audit?.numericValue == null || audit.numericValue <= max) continue;
    out.push({
      message: `${c.path} ${id} ${audit.displayValue ?? audit.numericValue} (want <= ${max})`,
      where: [c.path],
      fix: `Improve ${audit.title} (see ${c.report}) or raise lighthouse.metrics.${id}.`,
    });
  }
  return out;
};

const assertedFindings = (lhr: LighthouseResult, c: PageContext) => {
  const out: Finding[] = [];
  for (const id of c.asserted) {
    const audit = lhr.audits[id];
    if (!audit || audit.score === null || audit.score >= 1) continue;
    out.push({
      message: `${c.path} ${id} failed: ${audit.title}${audit.displayValue ? ` ${audit.displayValue}` : ''}`,
      where: [c.path],
      fix: assertedFix(id, c.report),
    });
  }
  return out;
};

export const pageFindings = (
  lhr: LighthouseResult,
  row: Row,
  categories: string[],
  c: PageContext,
) => [
  ...scoreFindings(lhr, row, categories, c),
  ...metricFindings(lhr, c),
  ...assertedFindings(lhr, c),
];
