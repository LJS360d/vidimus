import { resolve } from 'node:path';
import type { IgnoreRule, VidimusConfig } from '../config/types.ts';
import {
  type AcceptedFinding,
  applyIgnore,
  countStale,
  readBaseline,
  settle,
  subtractBaseline,
  writeBaseline,
} from './findings.ts';
import type { AuditOutcome, Finding } from './types.ts';

const unusedIgnoreLine = ({ rule, index }: { rule: IgnoreRule; index: number }) => {
  const keys = Object.entries(rule)
    .filter(([key]) => key !== 'reason')
    .map(([key, value]) => `${key}=${value}`);
  return `vidimus: ignore[${index}] (${keys.join(', ')}) matched nothing${rule.reason ? ` (${rule.reason})` : ''}\n`;
};

export const createSuppression = (config: VidimusConfig) => {
  const { baseline: options, root } = config;
  const file = options.file ? resolve(root, options.file) : '';
  const baseline = file ? readBaseline(file) : { version: 1 as const, findings: [] };
  const unsuppressed = new Map<string, Finding[]>();
  const ignoreHits = new Map<IgnoreRule, number>();
  const hidden: Record<string, Finding[]> = {};

  const settleOutcome = (audit: string, outcome: AuditOutcome) => {
    const raw = outcome.findings ?? [];
    const kept = applyIgnore(audit, raw, config.ignore, ignoreHits);
    if (outcome.status !== 'skipped') unsuppressed.set(audit, kept);
    const fresh = options.update
      ? []
      : subtractBaseline(root, audit, kept, baseline, options.matchWhere, options.fuzzy);
    const suppressed = raw.length - fresh.length;
    if (suppressed) {
      const shown = new Set(fresh);
      hidden[audit] = raw.filter((finding) => !shown.has(finding));
    }
    const settled = settle(outcome, fresh, {
      severity: config.severity[audit],
      strict: config.strict,
    });
    return { settled, suppressed };
  };

  const finish = (checkUnusedIgnore: boolean) => {
    let stale: AcceptedFinding[] = [];
    if (file && options.update) {
      writeBaseline(file, root, unsuppressed, options.matchWhere);
    } else if (file) {
      stale = countStale(root, unsuppressed, baseline, options.matchWhere, options.fuzzy);
      if (stale.length) {
        const noun = stale.length === 1 ? 'entry' : 'entries';
        process.stderr.write(
          `vidimus: ${stale.length} stale baseline ${noun} no longer occur, re-run with --accept-findings to prune\n`,
        );
      }
    }
    const unused = checkUnusedIgnore
      ? config.ignore.flatMap((rule, index) => (ignoreHits.has(rule) ? [] : [{ rule, index }]))
      : [];
    for (const entry of unused) process.stderr.write(unusedIgnoreLine(entry));
    return { stale, unusedIgnore: unused.length };
  };

  return { settleOutcome, finish, hidden };
};
