import { readFileSync } from 'node:fs';
import type { ProfileSummary, Row, Span } from './profile.ts';
import { childrenOf, descendants, rowsOf, wall } from './profile-analysis.ts';

const ms = (value: number) =>
  Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

export const diffProfiles = (before: string, after: string, top = 15) => {
  const load = (file: string) => {
    const { vidimus } = JSON.parse(readFileSync(file, 'utf8')) as {
      vidimus?: { spans: Span[]; summary: ProfileSummary };
    };
    if (!vidimus) throw new Error(`${file} is not a vidimus trace`);
    const { spans } = vidimus;
    const children = childrenOf(spans);
    const rows = new Map<string, Row>();
    for (const audit of spans.filter((span) => span.name.startsWith('audit ')))
      for (const row of [
        {
          name: '(audit wall)',
          count: 1,
          totalMs: wall(audit),
          selfMs: wall(audit),
          maxMs: wall(audit),
        },
        ...rowsOf(descendants(audit, children), children),
      ])
        rows.set(`${audit.name.slice(6)} › ${row.name}`, row);
    const { wallMs } = vidimus.summary;
    rows.set('run', { name: 'run', count: 1, totalMs: wallMs, selfMs: wallMs, maxMs: wallMs });
    return rows;
  };
  const a = load(before);
  const b = load(after);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const lines = keys
    .map((key) => {
      const was = a.get(key);
      const now = b.get(key);
      const delta = (now?.selfMs ?? 0) - (was?.selfMs ?? 0);
      return { key, was, now, delta };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, top);
  const width = Math.max(...lines.map(({ key }) => key.length), 4);
  return [
    `${'span'.padEnd(width)}  ${'before'.padStart(8)}  ${'after'.padStart(8)}  ${'change'.padStart(8)}`,
    ...lines.map(
      ({ key, was, now, delta }) =>
        `${key.padEnd(width)}  ${(was ? ms(was.selfMs) : '-').padStart(8)}  ${(now ? ms(now.selfMs) : '-').padStart(8)}  ${`${delta > 0 ? '+' : ''}${ms(delta)}`.padStart(8)}`,
    ),
    '',
    'self time (time not spent in child spans), largest changes first',
  ];
};

// ---- terminal summary ----

export const formatProfile = (summary: ProfileSummary) => {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const row = ({ name, count, selfMs, totalMs }: Row) =>
    `${name} ${ms(selfMs)} self${totalMs - selfMs > 1 ? ` / ${ms(totalMs)}` : ''} ×${count}`;
  const lines = [
    `run ${ms(summary.wallMs)} · ${summary.spans} spans · profiler overhead ~${ms(summary.overheadMs)}`,
  ];
  if (summary.setup.length)
    lines.push(`setup  ${summary.setup.map((r) => `${r.name} ${ms(r.totalMs)}`).join(' · ')}`);
  for (const audit of summary.audits) {
    lines.push(`${audit.name}  ${ms(audit.wallMs)}`);
    for (const r of audit.rows) lines.push(`    ${row(r)}`);
    if (audit.pages.length)
      lines.push(
        `  slowest pages  ${audit.pages.map(({ path, ms: t }) => `${path} ${ms(t)}`).join(' · ')}`,
      );
    for (const pool of audit.pools)
      lines.push(
        `  pool  ${pool.workers} workers · ${pool.items} items · busy ${pct(pool.busy)} · queued ${ms(pool.queuedMs)}${pool.slowest.item ? ` · slowest ${pool.slowest.item} ${ms(pool.slowest.ms)}` : ''}`,
      );
  }
  const { node } = summary;
  lines.push(
    `node  cpu ${pct(node.cpu)} · loop busy ${pct(node.loopBusy)} · lag max ${ms(node.lagMaxMs)} · heap max ${Math.round(node.heapMaxMb)}MB · gc ${ms(node.gcMs)} (max pause ${ms(node.gcMaxMs)})`,
  );
  for (const hint of summary.hints) lines.push(`hint  ${hint}`);
  lines.push(`trace ${summary.trace} (open in ui.perfetto.dev or speedscope.app)`);
  if (summary.cpuProfile)
    lines.push(`cpu   ${summary.cpuProfile} (open in Chrome DevTools or speedscope.app)`);
  return lines;
};
