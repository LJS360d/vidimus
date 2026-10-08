import { relative } from 'node:path';
import { styleText } from 'node:util';
import { formatProfile } from '../core/profile.ts';
import type { AuditStatus } from '../core/types.ts';
import { firstFew } from '../core/util.ts';
import type { Reporter } from './types.ts';

type Format = Parameters<typeof styleText>[0];

const STATUS: Record<AuditStatus, [Format, string]> = {
  passed: ['green', '✔'],
  warned: ['yellow', '⚠'],
  failed: ['red', '✖'],
  skipped: ['yellow', '○'],
  errored: ['red', '!'],
};

export const pretty = (stream: NodeJS.WriteStream = process.stdout): Reporter => {
  const paint = (format: Format, text: string) => styleText(format, text, { stream });
  const out = (line = '') => stream.write(`${line}\n`);

  return {
    name: 'pretty',
    onStart({ origin, serving, notes }) {
      if (serving) out(`vidimus: serving ${serving} on ${origin}`);
      else if (origin) out(`vidimus: auditing ${origin}`);
      for (const note of notes) out(paint('yellow', `vidimus: ${note}`));
    },
    onAuditEnd(result) {
      out();
      out(paint('bold', `─── ${result.name} ${'─'.repeat(Math.max(0, 60 - result.name.length))}`));
      if (result.log.length) out();
      for (const line of result.log) out(line);
      for (const finding of result.findings) {
        out();
        const warning = finding.severity === 'warn';
        out(`${warning ? paint('yellow', '⚠') : paint('red', '✖')} ${finding.message}`);
        for (const detail of finding.details ?? []) out(`    ${detail}`);
        if (finding.file) out(paint('dim', `    in: ${relative(process.cwd(), finding.file)}`));
        if (finding.where?.length) out(paint('dim', `    on: ${firstFew(finding.where)}`));
        if (finding.fix) out(paint('cyan', `    → ${finding.fix}`));
      }
      const [color, symbol] = STATUS[result.status];
      const known = result.suppressed ? `, ${result.suppressed} ignored or accepted` : '';
      out();
      out(
        `${paint(color, symbol)} ${result.name}: ${result.summary}${known} ${paint('dim', `(${(result.durationMs / 1000).toFixed(1)}s)`)}`,
      );
    },
    onEnd({ results, profile }) {
      if (profile) {
        out();
        out(paint('bold', `─── profile ${'─'.repeat(53)}`));
        for (const line of formatProfile(profile)) out(line);
      }
      const counted = results.filter(({ status }) => status !== 'skipped');
      const named = (status: AuditStatus[]) =>
        counted.filter((result) => status.includes(result.status)).map(({ name }) => name);
      const failed = named(['failed', 'errored']);
      const warned = named(['warned']);
      const line = `vidimus: ${counted.length - failed.length}/${counted.length} passed${
        warned.length ? ` — warnings: ${warned.join(', ')}` : ''
      }${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`;
      out();
      out(paint(failed.length ? 'red' : warned.length ? 'yellow' : 'green', line));
    },
  };
};
