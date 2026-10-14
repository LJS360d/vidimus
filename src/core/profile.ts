import { AsyncLocalStorage } from 'node:async_hooks';
import diagnostics from 'node:diagnostics_channel';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join, relative } from 'node:path';
import { monitorEventLoopDelay, PerformanceObserver, performance } from 'node:perf_hooks';

import { analyse, hintsOf, wall } from './profile-analysis.ts';

export { diffProfiles, formatProfile } from './profile-report.ts';

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

export const addSpans = (
  entries: { name: string; startTime: number; duration: number }[],
  from: number,
  to: number,
) => {
  if (!recorder || !entries.length) return;
  const first = entries.reduce((min, entry) => Math.min(min, entry.startTime), Infinity);
  const shift = first >= from && first <= to ? 0 : from - first;
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

const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

// ---- Chrome trace format: opens in ui.perfetto.dev, chrome://tracing and speedscope ----

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
  for (const span of active.spans)
    if (Number.isNaN(span.end)) {
      span.end = stopped;
      span.error = true;
    }
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
    heapMaxMb: samples.reduce((max, s) => Math.max(max, s.heap), 0),
    loopBusy: average(samples.map((s) => s.elu)),
    lagMaxMs: samples.reduce((max, s) => Math.max(max, s.lag), 0),
    gcMs: gc.reduce((sum, { ms }) => sum + ms, 0),
    gcMaxMs: gc.reduce((max, { ms }) => Math.max(max, ms), 0),
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
