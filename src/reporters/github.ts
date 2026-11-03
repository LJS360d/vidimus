import { appendFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { Finding } from '../core/types.ts';
import { firstFew } from '../core/util.ts';
import type { Reporter } from './types.ts';

const escapeData = (text: string) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const escapeProperty = (text: string) =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

const STEP_SUMMARY_BUDGET = 1024 * 1024 - 1024;

const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>');

const fitBudget = (text: string) => {
  if (Buffer.byteLength(text) <= STEP_SUMMARY_BUDGET) return text;
  const notice = '\n\n_Summary truncated to fit the 1 MiB step limit._\n';
  const keep = STEP_SUMMARY_BUDGET - Buffer.byteLength(notice);
  // Cut at a line end: no half table row, and no split UTF-8 sequence growing past the limit.
  const head = Buffer.from(text).subarray(0, keep).toString('latin1');
  return (
    Buffer.from(head.slice(0, Math.max(0, head.lastIndexOf('\n'))), 'latin1').toString() + notice
  );
};

const describe = ({ message, details = [], where = [], fix }: Finding) =>
  [
    message,
    ...details,
    ...(where.length ? [`on: ${firstFew(where, 10)}`] : []),
    ...(fix ? [`fix: ${fix}`] : []),
  ].join('\n');

export const annotation = (
  title: string,
  message: string,
  file?: string,
  level: 'error' | 'warning' = 'error',
  root = process.cwd(),
  line?: number,
) => {
  const properties = [
    ...(file
      ? [`file=${escapeProperty(relative(root, resolve(root, file)).split(sep).join('/'))}`]
      : []),
    ...(file && line ? [`line=${line}`] : []),
    `title=${escapeProperty(title)}`,
  ].join(',');
  return `::${level} ${properties}::${escapeData(message)}\n`;
};

export const github = (
  stream: NodeJS.WritableStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Reporter => {
  const root = env.GITHUB_WORKSPACE || process.cwd();
  return {
    name: 'github',
    onAuditEnd(result) {
      const title = `vidimus ${result.name}`;
      if (result.status === 'errored') stream.write(annotation(title, result.summary));
      for (const finding of result.findings) {
        const level = finding.severity === 'warn' ? 'warning' : 'error';
        stream.write(annotation(title, describe(finding), finding.file, level, root, finding.line));
      }
    },
    onEnd({ results }) {
      if (!env.GITHUB_STEP_SUMMARY) return;
      const rows = results.map(
        ({ name, status, summary }) => `| ${cell(name)} | ${cell(status)} | ${cell(summary)} |`,
      );
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        fitBudget(
          [
            '### vidimus',
            '',
            '| Audit | Status | Summary |',
            '| --- | --- | --- |',
            ...rows,
            '',
          ].join('\n'),
        ),
      );
    },
  };
};
