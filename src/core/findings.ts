import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import type { AuditSeverity, IgnoreRule } from '../config/types.ts';
import { UsageError } from './errors.ts';
import type { AuditOutcome, AuditResult, Finding } from './types.ts';
import { regex } from './util.ts';

export interface AcceptedFinding {
  audit: string;
  message: string;
  file?: string;
  details?: string[];
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
    throw new UsageError(`ignore: ${(error as Error).message}`);
  }
};

export const applyIgnore = (audit: string, findings: Finding[], rules: IgnoreRule[]) => {
  const relevant = rules.filter((rule) => matches(rule.audit && `^(${rule.audit})$`, audit));
  if (!relevant.length) return findings;
  return findings.flatMap((finding) => {
    const applying = relevant.filter((rule) => matches(rule.message, finding.message));
    if (!applying.length) return [finding];
    const pageRules = applying.filter((rule) => rule.where !== undefined);
    if (pageRules.length < applying.length) return [];
    if (!finding.where?.length) return [finding];
    const where = finding.where.filter(
      (page) => !pageRules.some((rule) => matches(rule.where, page)),
    );
    return where.length ? [{ ...finding, where }] : [];
  });
};

const portable = (root: string, file: string | undefined) =>
  file === undefined
    ? undefined
    : (isAbsolute(file) ? relative(root, file) : file).split(sep).join('/').split('\\').join('/');

const toAccepted = (root: string, audit: string, finding: Finding): AcceptedFinding => ({
  audit,
  message: finding.message,
  ...(finding.file !== undefined && { file: portable(root, finding.file) }),
  ...(finding.details?.length && { details: finding.details }),
});

const fingerprint = ({ audit, message, file, details = [] }: AcceptedFinding) =>
  JSON.stringify([audit, message, file ?? '', details]);

export const readBaseline = (file: string): BaselineFile => {
  if (!existsSync(file)) return { version: 1, findings: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as BaselineFile;
    if (!Array.isArray(parsed.findings)) throw new Error('"findings" must be an array');
    return parsed;
  } catch (error) {
    throw new UsageError(`${file}: ${(error as Error).message}`);
  }
};

export const writeBaseline = (file: string, root: string, raw: Map<string, Finding[]>) => {
  const kept = readBaseline(file).findings.filter(({ audit }) => !raw.has(audit));
  const accepted = [...raw].flatMap(([audit, findings]) =>
    findings.map((finding) => toAccepted(root, audit, finding)),
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

export const subtractBaseline = (
  root: string,
  audit: string,
  findings: Finding[],
  baseline: BaselineFile,
) => {
  const known = new Set(baseline.findings.map(fingerprint));
  if (!known.size) return findings;
  return findings.filter((finding) => !known.has(fingerprint(toAccepted(root, audit, finding))));
};

export interface SettleOptions {
  severity: AuditSeverity | undefined;
  strict: boolean;
}

export const settle = (
  outcome: AuditOutcome,
  findings: Finding[],
  { severity, strict }: SettleOptions,
): Pick<AuditResult, 'status' | 'summary' | 'findings'> => {
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
