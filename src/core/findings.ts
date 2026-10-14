import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditSeverity, IgnoreRule } from '../config/types.ts';
import { UsageError } from './errors.ts';
import type { AuditOutcome, AuditResult, Finding } from './types.ts';
import { messageOf, portablePath, regex } from './util.ts';

export interface AcceptedFinding {
  audit: string;
  message: string;
  rule?: string;
  file?: string;
  details?: string[];
  where?: string[];
}

export interface BaselineFile {
  version: 1;
  findings: AcceptedFinding[];
}

const matches = (pattern: string | undefined, text: string | undefined) => {
  if (pattern === undefined) return true;
  try {
    return regex(pattern).test(text ?? '');
  } catch (error) {
    throw new UsageError(`ignore: ${messageOf(error)}`);
  }
};

export const applyIgnore = (
  audit: string,
  findings: Finding[],
  rules: IgnoreRule[],
  hits = new Map<IgnoreRule, number>(),
) => {
  const hit = (rule: IgnoreRule) => hits.set(rule, (hits.get(rule) ?? 0) + 1);
  const relevant = rules.filter((rule) => matches(rule.audit && `^(${rule.audit})$`, audit));
  if (!relevant.length) return findings;
  return findings.flatMap((finding) => {
    const applying = relevant.filter(
      (rule) => matches(rule.rule, finding.rule) && matches(rule.message, finding.message),
    );
    if (!applying.length) return [finding];
    const pageRules = applying.filter((rule) => rule.where !== undefined);
    if (pageRules.length < applying.length) {
      for (const rule of applying) hit(rule);
      return [];
    }
    if (!finding.where?.length) return [finding];
    const where = finding.where.filter((page) => {
      const dropping = pageRules.filter((rule) => matches(rule.where, page));
      for (const rule of dropping) hit(rule);
      return !dropping.length;
    });
    return where.length ? [{ ...finding, where }] : [];
  });
};

const toAccepted = (
  root: string,
  audit: string,
  finding: Finding,
  matchWhere: boolean,
): AcceptedFinding => ({
  audit,
  message: finding.message,
  ...(finding.rule !== undefined && { rule: finding.rule }),
  ...(finding.file !== undefined && { file: portablePath(root, finding.file) }),
  ...(finding.details?.length && { details: finding.details }),
  ...(matchWhere && finding.where?.length && { where: finding.where }),
});

const fingerprint = (
  { audit, rule, message, file, details = [], where = [] }: AcceptedFinding,
  matchWhere: boolean,
  fuzzy: boolean,
) => {
  const digits = (text: string) => (fuzzy ? text.replace(/\d+(\.\d+)?/g, '#') : text);
  return JSON.stringify([
    audit,
    digits(rule ?? message),
    file ?? '',
    details.map((detail) => digits(detail.replace(/(:\d+){1,2}(?!\d)/g, ''))),
    matchWhere ? [...where].sort() : [],
  ]);
};

export const readBaseline = (file: string): BaselineFile => {
  if (!existsSync(file)) return { version: 1, findings: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as BaselineFile;
    if (!Array.isArray(parsed.findings)) throw new Error('"findings" must be an array');
    return parsed;
  } catch (error) {
    throw new UsageError(`${file}: ${messageOf(error)}`);
  }
};

export const writeBaseline = (
  file: string,
  root: string,
  raw: Map<string, Finding[]>,
  matchWhere: boolean,
) => {
  const kept = readBaseline(file).findings.filter(({ audit }) => !raw.has(audit));
  const accepted = [...raw].flatMap(([audit, findings]) =>
    findings.map((finding) => toAccepted(root, audit, finding, matchWhere)),
  );
  const findings = [...kept, ...accepted].sort(
    (a, b) => a.audit.localeCompare(b.audit) || a.message.localeCompare(b.message),
  );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ version: 1, findings } satisfies BaselineFile, null, 2)}\n`,
  );
  return accepted.length;
};

export const countStale = (
  root: string,
  raw: Map<string, Finding[]>,
  baseline: BaselineFile,
  matchWhere: boolean,
  fuzzy: boolean,
) => {
  const current = new Set(
    [...raw].flatMap(([audit, findings]) =>
      findings.map((finding) =>
        fingerprint(toAccepted(root, audit, finding, matchWhere), matchWhere, fuzzy),
      ),
    ),
  );
  return baseline.findings.filter(
    (entry) => raw.has(entry.audit) && !current.has(fingerprint(entry, matchWhere, fuzzy)),
  );
};

export const subtractBaseline = (
  root: string,
  audit: string,
  findings: Finding[],
  baseline: BaselineFile,
  matchWhere: boolean,
  fuzzy: boolean,
) => {
  const known = new Set(baseline.findings.map((entry) => fingerprint(entry, matchWhere, fuzzy)));
  if (!known.size) return findings;
  return findings.filter(
    (finding) =>
      !known.has(fingerprint(toAccepted(root, audit, finding, matchWhere), matchWhere, fuzzy)),
  );
};

export type Settled = Pick<AuditResult, 'status' | 'summary' | 'findings'>;

export interface SettleOptions {
  severity: AuditSeverity | undefined;
  strict: boolean;
}

export const settle = (
  outcome: AuditOutcome,
  findings: Finding[],
  { severity, strict }: SettleOptions,
): Settled => {
  const downgraded = severity === 'warn';
  const settled = downgraded
    ? findings.map((finding) => ({ ...finding, severity: 'warn' as const }))
    : findings;
  const { summary } = outcome;
  if (outcome.status === 'skipped' || outcome.status === 'passed') {
    return { status: outcome.status, summary, findings: settled };
  }
  const failing =
    outcome.status === 'failed' ||
    settled.some((finding) => strict || (finding.severity ?? 'error') === 'error');
  if (failing && !(downgraded && !strict)) {
    const escalated = strict
      ? settled.map((finding) => ({ ...finding, severity: 'error' as const }))
      : settled;
    return { status: 'failed', summary, findings: escalated };
  }
  return { status: settled.length || failing ? 'warned' : 'passed', summary, findings: settled };
};
