import { AsyncLocalStorage } from 'node:async_hooks';
import diagnostics from 'node:diagnostics_channel';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join, relative } from 'node:path';
import { monitorEventLoopDelay, PerformanceObserver, performance } from 'node:perf_hooks';

export type ProfileLevel = 'spans' | 'cpu';

export interface Span {
  id: number;
  parent: number | null;
  name: string;
  start: number;
  end: number;
  attrs?: Record<string, unknown>;
  error?: boolean;
}

interface Sample {
  t: number;
  cpu: number;
  heap: number;
  elu: number;
  lag: number;
}

export interface Row {
  name: string;
  count: number;
  totalMs: number;
  selfMs: number;
  maxMs: number;
}

export interface PoolStats {
  workers: number;
  items: number;
  busy: number;
  queuedMs: number;
  meanMs: number;
  slowest: { item: string; ms: number };
}

export interface AuditProfile {
  name: string;
  wallMs: number;
  /** Sum of every span's self time: more than wallMs when work runs in parallel. */
  workMs: number;
  rows: Row[];
  pages: { path: string; ms: number }[];
  pools: PoolStats[];
}

export interface ProfileSummary {
  trace: string;
  cpuProfile?: string;
  wallMs: number;
  spans: number;
  overheadMs: number;
  setup: Row[];
  audits: AuditProfile[];
  node: {
    cpu: number;
    heapMaxMb: number;
    loopBusy: number;
    lagMaxMs: number;
    gcMs: number;
    gcMaxMs: number;
  };
  hints: string[];
}

interface Recorder {
  spans: Span[];
  samples: Sample[];
  gc: { start: number; ms: number }[];
  started: number;
  stop: () => Promise<unknown>;
}

const store = new AsyncLocalStorage<number>();
let recorder: Recorder | undefined;

export const profiling = () => recorder !== undefined;

const open = (name: string, attrs?: Record<string, unknown>): Span => {
  const spans = (recorder as Recorder).spans;
  const span: Span = {
    id: spans.length,
    parent: store.getStore() ?? null,
    name,
    start: performance.now(),
    end: Number.NaN,
    ...(attrs && { attrs }),
  };
  spans.push(span);
  return span;
};

// Times fn as a child of the current span; its own awaits become its children. Off: just fn().
export const span = <T>(
  name: string,
  fn: () => Promise<T>,
  attrs?: Record<string, unknown>,
): Promise<T> => {
  if (!recorder) return fn();
  const current = open(name, attrs);
  return store.run(current.id, async () => {
    try {
      return await fn();
    } catch (error) {
      current.error = true;
      throw error;
    } finally {
      current.end = performance.now();
    }
  });
};

// Times a promise that is already running (a wrapped library call), without a new context.
const record = <T>(name: string, promise: Promise<T>, attrs?: Record<string, unknown>) => {
  const current = open(name, attrs);
  promise.then(
    () => {
      current.end = performance.now();
    },
    () => {
      current.end = performance.now();
      current.error = true;
    },
  );
  return promise;
};

// Adds timings a library measured itself (Lighthouse's lhr.timing.entries) as children of the
// current span. They use performance.now() too; if they do not fall inside [from, to], they are
// shifted so the first one starts at from.
export const addSpans = (
  entries: { name: string; startTime: number; duration: number }[],
  from: number,
  to: number,
) => {
  if (!recorder || !entries.length) return;
  const first = Math.min(...entries.map((entry) => entry.startTime));
  const shift = first >= from && first <= to ? 0 : from - first;
  // Entries come flat; nest each inside the innermost entry that contains it.
  const stack: Span[] = [];
  for (const entry of [...entries].sort(
    (a, b) => a.startTime - b.startTime || b.duration - a.duration,
  )) {
    const span = open(entry.name);
    span.start = entry.startTime + shift;
    span.end = span.start + entry.duration;
    while (stack.length && (stack.at(-1) as Span).end < span.end) stack.pop();
    const parent = stack.at(-1);
    if (parent) span.parent = parent.id;
    stack.push(span);
  }
};

// ---- automatic instrumentation of browser objects ----

const label = (value: unknown) => {
  if (typeof value === 'function')
    return value.name || value.toString().replace(/\s+/g, ' ').slice(0, 60);
  if (typeof value !== 'string') return '';
  // Injected libraries (pa11y's HTML_CodeSniffer, axe) arrive as long source strings.
  return value.length > 80 || value.includes('\n') ? `<script ${value.length} chars>` : value;
};

const DESCRIBED = new Set([
  'evaluate',
  'evaluateHandle',
  'evaluateOnNewDocument',
  '$eval',
  '$$eval',
]);
const WRAPPED_RESULTS = new Set(['createBrowserContext', 'newPage']);
const NESTED = new Set(['keyboard', 'mouse']);
const proxies = new WeakMap<object, unknown>();

// Every async method call on a Browser, BrowserContext, Page (and its keyboard/mouse) becomes a
// span: "page.goto", "page.evaluate <function>", "page.keyboard.type"…
export const instrument = <T extends object>(target: T, prefix: string): T => {
  if (!recorder) return target;
  const cached = proxies.get(target);
  if (cached) return cached as T;
  const proxy = new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof property !== 'string') return value;
      if (NESTED.has(property) && value && typeof value === 'object')
        return instrument(value, `${prefix}.${property}`);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = value.apply(object, args);
        if (!recorder || !(result instanceof Promise)) return result;
        const kind =
          property === 'newPage' ? 'page' : property === 'createBrowserContext' ? 'context' : '';
        const name = DESCRIBED.has(property)
          ? `${prefix}.${property} ${label(args[0])}`
          : `${prefix}.${property}`;
        const attrs =
          typeof args[0] === 'string' && /^https?:/.test(args[0]) ? { url: args[0] } : undefined;
        const timed = record(name, result, attrs);
        return WRAPPED_RESULTS.has(property)
          ? timed.then((made) => instrument(made as object, kind))
          : timed;
      };
    },
  });
  proxies.set(target, proxy);
  return proxy;
};

// ---- start / stop ----

const time = (fn: () => void) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

export const startProfile = async (level: ProfileLevel) => {
  const spans: Span[] = [];
  const samples: Sample[] = [];
  const gc: Recorder['gc'] = [];
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let cpu = process.cpuUsage();
  let elu = performance.eventLoopUtilization();
  let last = performance.now();
  const sampler = setInterval(() => {
    const now = performance.now();
    const usage = process.cpuUsage(cpu);
    cpu = process.cpuUsage();
    const loop = performance.eventLoopUtilization(elu);
    elu = performance.eventLoopUtilization();
    samples.push({
      t: now,
      cpu: (usage.user + usage.system) / 1000 / (now - last),
      heap: process.memoryUsage().heapUsed / 2 ** 20,
      elu: loop.utilization,
      lag: lag.max / 1e6,
    });
    lag.reset();
    last = now;
  }, 100);
  sampler.unref();
  const gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) gc.push({ start: entry.startTime, ms: entry.duration });
  });
  gcObserver.observe({ entryTypes: ['gc'] });

  // Node's fetch (undici) reports every request: links, security, assets, forms' page fetches.
  const requests = new WeakMap<object, Span>();
  const onCreate = (message: unknown) => {
    const { request } = message as { request: { origin: string; path: string; method: string } };
    requests.set(
      request,
      open(`fetch ${request.method}`, { url: `${request.origin}${request.path}` }),
    );
  };
  const onHeaders = (message: unknown) => {
    const { request, response } = message as { request: object; response: { statusCode: number } };
    const current = requests.get(request);
    if (!current) return;
    current.attrs = {
      ...current.attrs,
      status: response.statusCode,
      ttfbMs: performance.now() - current.start,
    };
    current.end = performance.now();
  };
  const onEnd = (message: unknown) => {
    const current = requests.get((message as { request: object }).request);
    if (current) current.end = performance.now();
  };
  const onError = (message: unknown) => {
    const current = requests.get((message as { request: object }).request);
    if (!current) return;
    current.end = performance.now();
    current.error = true;
  };
  const channels: [string, (message: unknown) => void][] = [
    ['undici:request:create', onCreate],
    ['undici:request:headers', onHeaders],
    ['undici:request:trailers', onEnd],
    ['undici:request:error', onError],
  ];
  for (const [name, listener] of channels) diagnostics.subscribe(name, listener);

  let session: Session | undefined;
  if (level === 'cpu') {
    session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
  }

  recorder = {
    spans,
    samples,
    gc,
    started: performance.now(),
    stop: async () => {
      clearInterval(sampler);
      gcObserver.disconnect();
      lag.disable();
      for (const [name, listener] of channels) diagnostics.unsubscribe(name, listener);
      if (!session) return undefined;
      const { profile } = await session.post('Profiler.stop');
      session.disconnect();
      return profile;
    },
  };
};

// ---- analysis ----

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

const wall = (span: Span) => span.end - span.start;

const childrenOf = (spans: Span[]) => {
  const children = new Map<number, Span[]>();
  for (const span of spans)
    if (span.parent !== null)
      children.set(span.parent, [...(children.get(span.parent) ?? []), span]);
  return children;
};

// Self time: the part of a span no child covers. Parallel children overlap, so take their union.
const selfOf = (span: Span, children: Map<number, Span[]>) =>
  wall(span) -
  union(
    (children.get(span.id) ?? []).map((child) => [
      Math.max(child.start, span.start),
      Math.min(child.end, span.end),
    ]),
  );

const descendants = (root: Span, children: Map<number, Span[]>) => {
  const out: Span[] = [];
  const stack = [...(children.get(root.id) ?? [])];
  while (stack.length) {
    const span = stack.pop() as Span;
    out.push(span);
    stack.push(...(children.get(span.id) ?? []));
  }
  return out;
};

const rowsOf = (spans: Span[], children: Map<number, Span[]>) => {
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

const analyse = (spans: Span[], top: number) => {
  const children = childrenOf(spans);
  const audits = spans.filter((span) => span.name.startsWith('audit '));
  // Anything timed outside an audit is setup: serving the build, finding routes.
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
        // Count each page once: its outermost span (the task or navigate holding the rest).
        // Inside an audit every span has a parent, up to the audit itself.
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

// Spans that only group others; their self time is untimed waiting, not a thing to optimise.
const GENERIC = new Set(['task', 'pool', 'navigate']);

export const hintsOf = (summary: Omit<ProfileSummary, 'hints'>) => {
  const hints: string[] = [];
  for (const audit of summary.audits) {
    const first = audit.rows.find((row) => !GENERIC.has(row.name));
    if (first && first.selfMs > audit.workMs * 0.3)
      hints.push(
        `${audit.name}: "${first.name}" is ${Math.round((first.selfMs / audit.workMs) * 100)}% of its work (${first.count} calls)`,
      );
    // The slowest item against the mean of the others: it dominates when it is several times longer.
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

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

// ---- Chrome trace format: opens in ui.perfetto.dev, chrome://tracing and speedscope ----

// Parallel spans cannot share a trace lane, so each goes in the first lane where it either
// starts after everything open has ended or fits inside the innermost open span.
const lanesOf = (spans: Span[]) => {
  const lanes: Span[][] = [];
  const lane = new Map<number, number>();
  for (const span of [...spans].sort((a, b) => a.start - b.start || wall(b) - wall(a))) {
    let index = 0;
    for (; ; index++) {
      if (!lanes[index]) lanes[index] = [];
      const stack = lanes[index] as Span[];
      while (stack.length && (stack.at(-1) as Span).end <= span.start) stack.pop();
      const top = stack.at(-1);
      if (!top || span.end <= top.end) {
        stack.push(span);
        break;
      }
    }
    lane.set(span.id, index + 1);
  }
  return { lane, count: lanes.length };
};

const traceOf = (spans: Span[], samples: Sample[], gc: Recorder['gc'], t0: number) => {
  const us = (ms: number) => Math.round((ms - t0) * 1000);
  const { lane, count } = lanesOf(spans);
  return [
    { name: 'process_name', ph: 'M', pid: 1, tid: 0, args: { name: 'vidimus' } },
    ...Array.from({ length: count + 1 }, (_, tid) => ({
      name: 'thread_name',
      ph: 'M',
      pid: 1,
      tid,
      args: { name: tid ? `lane ${tid}` : 'gc' },
    })),
    ...spans.map((span) => ({
      name: span.name,
      cat: span.name.split(/[ .]/)[0],
      ph: 'X',
      ts: us(span.start),
      dur: Math.max(1, Math.round(wall(span) * 1000)),
      pid: 1,
      tid: lane.get(span.id),
      args: { ...span.attrs, ...(span.error && { error: true }) },
    })),
    ...gc.map(({ start, ms }) => ({
      name: 'gc',
      ph: 'X',
      ts: us(start),
      dur: Math.round(ms * 1000),
      pid: 1,
      tid: 0,
    })),
    ...samples.flatMap(({ t, cpu, heap, elu, lag }) => [
      { name: 'cpu %', ph: 'C', ts: us(t), pid: 1, args: { cpu: Math.round(cpu * 100) } },
      { name: 'heap MB', ph: 'C', ts: us(t), pid: 1, args: { heap: Math.round(heap) } },
      {
        name: 'event loop',
        ph: 'C',
        ts: us(t),
        pid: 1,
        args: { busy: Math.round(elu * 100), lagMs: Math.round(lag) },
      },
    ]),
  ];
};

export const stopProfile = async (outDir: string, root: string, top = 5) => {
  const active = recorder;
  if (!active) return undefined;
  recorder = undefined;
  const cpuProfile = await active.stop();
  const stopped = performance.now();
  // Spans still open (a hung page, a crash) end with the run instead of vanishing.
  for (const span of active.spans)
    if (Number.isNaN(span.end)) {
      span.end = stopped;
      span.error = true;
    }
  // What one span costs to record, so the summary can say how much of the run is the profiler.
  const perSpan =
    time(() => {
      for (let i = 0; i < 1000; i++) store.run(i, () => performance.now());
    }) / 1000;

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const trace = join(outDir, `${stamp}.trace.json`);
  const { samples, spans, gc } = active;
  const node = {
    cpu: average(samples.map((s) => s.cpu)),
    heapMaxMb: Math.max(0, ...samples.map((s) => s.heap)),
    loopBusy: average(samples.map((s) => s.elu)),
    lagMaxMs: Math.max(0, ...samples.map((s) => s.lag)),
    gcMs: gc.reduce((sum, { ms }) => sum + ms, 0),
    gcMaxMs: Math.max(0, ...gc.map(({ ms }) => ms)),
  };
  const partial = {
    trace: relative(root, trace),
    ...(cpuProfile !== undefined && {
      cpuProfile: relative(root, join(outDir, `${stamp}.cpuprofile`)),
    }),
    wallMs: stopped - active.started,
    spans: spans.length,
    overheadMs: spans.length * perSpan,
    node,
    ...analyse(spans, top),
  };
  const summary: ProfileSummary = { ...partial, hints: hintsOf(partial) };
  writeFileSync(
    trace,
    JSON.stringify({
      traceEvents: traceOf(spans, samples, gc, active.started),
      displayTimeUnit: 'ms',
      vidimus: {
        summary,
        spans: spans.map((s) => ({
          ...s,
          start: s.start - active.started,
          end: s.end - active.started,
        })),
      },
    }),
  );
  if (cpuProfile !== undefined)
    writeFileSync(join(outDir, `${stamp}.cpuprofile`), JSON.stringify(cpuProfile));
  return summary;
};

// ---- comparing two runs ----

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
