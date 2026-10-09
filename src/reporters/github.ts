import { appendFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import type { Finding } from '../core/types.ts';
import { firstFew } from '../core/util.ts';
import type { Reporter } from './types.ts';

const escapeData = (text: string) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const escapeProperty = (text: string) =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

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
    ...(file ? [`file=${escapeProperty(relative(root, file).split(sep).join('/'))}`] : []),
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
        ({ name, status, summary }) =>
          `| ${name} | ${status} | ${summary.replaceAll('|', '\\|').replaceAll(/\r?\n/g, '<br>')} |`,
      );
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        [
          '### vidimus',
          '',
          '| Audit | Status | Summary |',
          '| --- | --- | --- |',
          ...rows,
          '',
        ].join('\n'),
      );
    },
  };
};
