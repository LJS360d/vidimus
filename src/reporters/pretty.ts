import { relative } from 'node:path';
import { styleText } from 'node:util';
import { formatProfile } from '../core/profile.ts';
import type { AuditStatus } from '../core/types.ts';
import { firstFew } from '../core/util.ts';
import type { Progress, Reporter } from './types.ts';

type Format = Parameters<typeof styleText>[0];

const STATUS: Record<AuditStatus, [Format, string]> = {
  passed: ['green', '✔'],
  warned: ['yellow', '⚠'],
  failed: ['red', '✖'],
  skipped: ['yellow', '○'],
  errored: ['red', '!'],
};

const duration = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
};

export const progressLine = (running: Progress[]) =>
  running.map(({ name, done, total }) => (total ? `${name} ${done}/${total}` : name)).join(' · ');

export const pretty = (
  stream: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Reporter => {
  const paint = (format: Format, text: string) => styleText(format, text, { stream });
  // A terminal gets one line redrawn in place; a log gets a line every 30s.
  const live = stream.isTTY && !env.CI;
  let running: Progress[] = [];
  let started = Date.now();
  let drawn = false;
  let timer: NodeJS.Timeout | undefined;
  const status = () => `${progressLine(running)} (${duration(Date.now() - started)})`;
  const draw = () => {
    if (!live || !running.length) return;
    const line = `… ${status()}`.slice(0, (stream.columns || 80) - 1);
    stream.write(`\r\x1b[2K${paint('dim', line)}`);
    drawn = true;
  };
  const clear = () => {
    if (drawn) stream.write('\r\x1b[2K');
    drawn = false;
  };
  const out = (line = '') => {
    clear();
    stream.write(`${line}\n`);
  };

  return {
    name: 'pretty',
    onProgress(tasks) {
      running = tasks;
      if (!tasks.length) {
        clearInterval(timer);
        timer = undefined;
        clear();
        return;
      }
      timer ??= setInterval(
        () => (live ? draw() : out(`vidimus: running ${status()}`)),
        live ? 1000 : 30_000,
      ).unref();
      draw();
    },
    onStart({ origin, serving, notes }) {
      started = Date.now();
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
      draw();
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
