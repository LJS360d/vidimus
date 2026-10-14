import type { VidimusConfig } from '../../config/types.ts';
import { regex } from '../../core/util.ts';
import type { LighthouseResult, Run } from './types.ts';

type Settings = VidimusConfig['lighthouse'];

export const median = (values: (number | null | undefined)[]) => {
  const sorted = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

export const medianRun = (ran: Run[]) =>
  [...ran].sort(
    (a, b) =>
      (a.lhr.categories.performance?.score ?? 0) - (b.lhr.categories.performance?.score ?? 0),
  )[(ran.length - 1) >> 1];

export const categoryScore = (lhr: LighthouseResult, category: string, ignored: Set<string>) => {
  const ref = lhr.categories[category];
  if (!ref) return null;
  if (!ignored.size) return ref.score;
  let total = 0;
  let sum = 0;
  for (const { id, weight } of ref.auditRefs) {
    const score = lhr.audits[id]?.score;
    if (ignored.has(id) || score == null) continue;
    total += weight;
    sum += weight * score;
  }
  return total ? sum / total : ref.score;
};

export const costliestAudits = (lhr: LighthouseResult, category: string, ignored: Set<string>) =>
  (lhr.categories[category]?.auditRefs ?? [])
    .filter(({ id, weight }) => weight > 0 && !ignored.has(id))
    .map(({ id, weight }) => ({ id, weight, audit: lhr.audits[id] }))
    .filter(({ audit }) => audit && audit.score !== null && audit.score < 1)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(({ id, audit }) => ({
      id,
      text: `${audit?.title ?? id}${audit?.displayValue ? ` ${audit.displayValue}` : ''} (score ${audit?.score})`,
    }));

const matching = ({ overrides }: Pick<Settings, 'overrides'>, path: string) =>
  overrides.filter(({ match }) => regex(match).test(path));

export const metricsFor = (
  config: Pick<Settings, 'metrics' | 'overrides'>,
  path: string,
): Record<string, number> =>
  Object.assign({}, config.metrics, ...matching(config, path).map((rule) => rule.metrics));

// Later overrides win, so a specific pattern can follow a broad one.
export const thresholdsFor = (
  config: Pick<Settings, 'thresholds' | 'overrides'>,
  path: string,
): Record<string, number> =>
  Object.assign({}, config.thresholds, ...matching(config, path).map((rule) => rule.thresholds));

export const categoriesOf = ({
  thresholds,
  overrides,
}: Pick<Settings, 'thresholds' | 'overrides'>) => [
  ...new Set([thresholds, ...overrides.map((rule) => rule.thresholds ?? {})].flatMap(Object.keys)),
];

export const concurrencyFor = (
  config: Pick<Settings, 'thresholds' | 'overrides' | 'concurrency'>,
) => config.concurrency || (categoriesOf(config).includes('performance') ? 1 : 3);
