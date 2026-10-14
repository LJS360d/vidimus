import type { AuditProfile, PoolStats, ProfileSummary, Row, Span } from './profile.ts';

const union = (intervals: [number, number][]) => {
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    if (end <= reach) continue;
    total += end - Math.max(start, reach);
    reach = end;
  }
  return total;
};

export const wall = (span: Span) => span.end - span.start;

export const childrenOf = (spans: Span[]) => {
  const children = new Map<number, Span[]>();
  for (const span of spans)
    if (span.parent !== null)
      children.set(span.parent, [...(children.get(span.parent) ?? []), span]);
  return children;
};

const selfOf = (span: Span, children: Map<number, Span[]>) =>
  wall(span) -
  union(
    (children.get(span.id) ?? []).map((child) => [
      Math.max(child.start, span.start),
      Math.min(child.end, span.end),
    ]),
  );

export const descendants = (root: Span, children: Map<number, Span[]>) => {
  const out: Span[] = [];
  const stack = [...(children.get(root.id) ?? [])];
  while (stack.length) {
    const span = stack.pop() as Span;
    out.push(span);
    stack.push(...(children.get(span.id) ?? []));
  }
  return out;
};

export const rowsOf = (spans: Span[], children: Map<number, Span[]>) => {
  const rows = new Map<string, Row>();
  for (const span of spans) {
    const row = rows.get(span.name) ?? {
      name: span.name,
      count: 0,
      totalMs: 0,
      selfMs: 0,
      maxMs: 0,
    };
    row.count += 1;
    row.totalMs += wall(span);
    row.selfMs += selfOf(span, children);
    row.maxMs = Math.max(row.maxMs, wall(span));
    rows.set(span.name, row);
  }
  return [...rows.values()].sort((a, b) => b.selfMs - a.selfMs);
};

const pathOfUrl = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

export const analyse = (spans: Span[], top: number) => {
  const children = childrenOf(spans);
  const audits = spans.filter((span) => span.name.startsWith('audit '));
  const setup = rowsOf(
    spans.filter((span) => span.parent === null && !span.name.startsWith('audit ')),
    children,
  );
  return {
    setup,
    audits: audits.map((audit): AuditProfile => {
      const inside = descendants(audit, children);
      const pages = new Map<string, number>();
      for (const span of inside) {
        const url = span.attrs?.url;
        if (typeof url !== 'string' || span.name.startsWith('fetch')) continue;
        let parent = spans[span.parent as number] as Span;
        let nested = false;
        while (parent.id !== audit.id) {
          if (parent.attrs?.url === url) nested = true;
          parent = spans[parent.parent as number] as Span;
        }
        if (!nested) pages.set(pathOfUrl(url), (pages.get(pathOfUrl(url)) ?? 0) + wall(span));
      }
      const pools = inside
        .filter((span) => span.name === 'pool')
        .map((pool): PoolStats => {
          const tasks = children.get(pool.id) ?? [];
          const workers = Number(pool.attrs?.workers ?? 1);
          const slowest = tasks.reduce<Span | undefined>(
            (a, b) => (a && wall(a) >= wall(b) ? a : b),
            undefined,
          );
          return {
            workers,
            items: tasks.length,
            busy: tasks.reduce((sum, task) => sum + wall(task), 0) / (wall(pool) * workers || 1),
            queuedMs: tasks.reduce((sum, task) => sum + Number(task.attrs?.waitMs ?? 0), 0),
            meanMs: tasks.reduce((sum, task) => sum + wall(task), 0) / (tasks.length || 1),
            slowest: { item: String(slowest?.attrs?.item ?? ''), ms: slowest ? wall(slowest) : 0 },
          };
        });
      const rows = rowsOf(inside, children);
      return {
        name: audit.name.slice('audit '.length),
        wallMs: wall(audit),
        workMs: rows.reduce((sum, row) => sum + row.selfMs, selfOf(audit, children)),
        rows: rows.slice(0, top),
        pages: [...pages]
          .map(([path, ms]) => ({ path, ms }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, top),
        pools,
      };
    }),
  };
};

const GENERIC = new Set(['task', 'pool', 'navigate']);

export const hintsOf = (summary: Omit<ProfileSummary, 'hints'>) => {
  const hints: string[] = [];
  for (const audit of summary.audits) {
    const first = audit.rows.find((row) => !GENERIC.has(row.name));
    if (first && first.selfMs > audit.workMs * 0.3)
      hints.push(
        `${audit.name}: "${first.name}" is ${Math.round((first.selfMs / audit.workMs) * 100)}% of its work (${first.count} calls)`,
      );
    for (const pool of audit.pools)
      if (
        pool.items >= 3 &&
        pool.slowest.ms > audit.wallMs * 0.5 &&
        pool.slowest.ms > ((pool.meanMs * pool.items - pool.slowest.ms) / (pool.items - 1)) * 3
      )
        hints.push(
          `${audit.name}: one item (${pool.slowest.item}) holds the run for ${Math.round(pool.slowest.ms)}ms; split or sample it`,
        );
      else if (pool.items > pool.workers && pool.busy > 0.9)
        hints.push(
          `${audit.name}: all ${pool.workers} workers busy ${Math.round(pool.busy * 100)}% of the time with ${pool.items} items; more concurrency may help if the machine has spare CPU`,
        );
  }
  const imports = summary.setup.concat(summary.audits.flatMap((a) => a.rows));
  for (const row of imports)
    if (row.name.startsWith('import ') && row.maxMs > 1000)
      hints.push(`${row.name} took ${Math.round(row.maxMs)}ms to load`);
  if (summary.node.gcMs > summary.wallMs * 0.05)
    hints.push(
      `garbage collection took ${Math.round(summary.node.gcMs)}ms (${Math.round((summary.node.gcMs / summary.wallMs) * 100)}% of the run)`,
    );
  if (summary.node.cpu > 0.9) hints.push('the Node process was CPU bound: try --profile cpu');
  return [...new Set(hints)];
};
