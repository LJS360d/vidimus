import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinAudits } from '../audits/registry.ts';
import { type LoadConfigOptions, loadConfig } from '../config/load.ts';
import type { VidimusConfig } from '../config/types.ts';
import { createReporters } from '../reporters/registry.ts';
import type { Progress, Reporter, RunInfo } from '../reporters/types.ts';
import { serveCommand } from './command-server.ts';
import { MissingPeerError, UsageError } from './errors.ts';
import type { Settled } from './findings.ts';
import { createHeaderSource } from './headers.ts';
import { createPageReader } from './html.ts';
import { createPageUrls, pageUrlOf } from './pages.ts';
import { importPeer, launchBrowser, sharedBrowser, withState } from './peer.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';
import { type ProfileLevel, span, startProfile, stopProfile } from './profile.ts';
import { createRenderer } from './render.ts';
import { buildReport, unfinishedResult } from './report.ts';
import { clientRenderedBundle, clientRenderedHint, resolveRoutes } from './routes.ts';
import { serve } from './server.ts';
import { createSuppression } from './suppression.ts';
import type { Audit, AuditContext, AuditResult, PageSource, RunReport } from './types.ts';
import {
  abortScope,
  basePathOf,
  matchesAny,
  messageOf,
  pathOf,
  progressScope,
  track,
} from './util.ts';

export interface RunOptions extends LoadConfigOptions, ProfileOptions {
  audits?: string[];
  config?: VidimusConfig;
  reporters?: Reporter[];
}

export interface ProfileOptions {
  /** Record where the run spends its time; writes a trace to `<outDir>/profile/`. */
  profile?: ProfileLevel;
  /** Run audits one at a time, so each audit's profile is free of the others' load. */
  serial?: boolean;
  allAudits?: boolean;
}

export const auditRegistry = (config: VidimusConfig) =>
  new Map<string, Audit>([...builtinAudits, ...config.plugins].map((audit) => [audit.name, audit]));

export const selectAudits = (
  registry: Map<string, Audit>,
  requested: string[],
  config: VidimusConfig,
) => {
  const named = requested.filter((name) => name !== 'all');
  const enabled = (names: string[]) => names.filter((name) => config.severity[name] !== 'off');
  const names = requested.includes('all')
    ? [...enabled([...registry.keys()]), ...named]
    : named.length
      ? named
      : enabled(config.audits);
  const unknown = names.filter((name) => !registry.has(name));
  if (unknown.length) {
    throw new UsageError(
      `unknown audit(s) ${unknown.join(', ')}. Known: ${[...registry.keys()].join(', ')}`,
    );
  }
  return [...new Set(names)].flatMap((name) => registry.get(name) ?? []);
};

const requirement = (audit: Audit) => audit.requires ?? 'server';

const createOutDir = (dir: string) => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, '.gitignore'), '*\n');
};

const startServer = (config: VidimusConfig, dist: string, snapshot: Parameters<typeof serve>[4]) =>
  config.server.command
    ? serveCommand({
        command: config.server.command,
        cwd: config.root,
        dist,
        port: config.port,
        timeout: config.server.startTimeout,
        log: resolve(config.root, config.outDir, 'server.log'),
      })
    : serve(dist, config.port, config.server, config.siteUrl, snapshot);

const TIMED_OUT = Symbol('timed out');

const within = <T>(ms: number, work: Promise<T>): Promise<T | typeof TIMED_OUT> => {
  if (!ms) return work;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(resolve, ms, TIMED_OUT);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
};

export const runAudits = async (
  config: VidimusConfig,
  audits: Audit[],
  reporters: Reporter[],
  options: ProfileOptions = {},
): Promise<RunReport> => {
  if (!options.profile) return execute(config, audits, reporters, options);
  await startProfile(options.profile);
  try {
    return await execute(config, audits, reporters, options);
  } finally {
    createOutDir(resolve(config.root, config.outDir));
    await stopProfile(resolve(config.root, config.outDir, 'profile'), config.root);
  }
};

const prepare = (config: VidimusConfig, audits: Audit[]) => {
  const dist = resolve(config.root, config.distDir);
  const needsDist = audits.some((audit) => requirement(audit) !== 'source');
  if (needsDist && !existsSync(dist)) {
    throw new UsageError(`no build output at ${dist}. Run the build first.`);
  }
  const builtPages = createPageReader(dist);
  if (needsDist && !builtPages().length) {
    throw new UsageError(
      `no HTML files found in ${dist}; run your build first or point --dist at the build output`,
    );
  }
  const bundle = needsDist ? clientRenderedBundle(config, dist, builtPages) : 0;
  const rendering =
    needsDist && (config.render.mode === 'on' || (config.render.mode === 'auto' && bundle > 0));
  const command = !config.origin && config.server.command;
  const needsServer =
    rendering ||
    audits.some((audit) => requirement(audit) === 'server') ||
    (!!command && audits.some(({ name }) => name === 'security'));
  return { dist, needsDist, builtPages, bundle, rendering, command, needsServer };
};

const createProgress = (reporters: Reporter[]) => {
  const running = new Map<string, Progress>();
  const publish = () => {
    for (const reporter of reporters) reporter.onProgress?.([...running.values()]);
  };
  const task = async <T>(name: string, fn: () => Promise<T>) => {
    const update = (done: number, total: number) => {
      const since = (done && running.get(name)?.since) || Date.now();
      running.set(name, { name, done, total, since });
      publish();
    };
    update(0, 0);
    try {
      return await progressScope.run(update, fn);
    } finally {
      running.delete(name);
      publish();
    }
  };
  const clear = () => {
    running.clear();
    publish();
  };
  return { task, clear };
};

const createBrowsers = (config: VidimusConfig, origin: () => string) => {
  const shared = sharedBrowser(() => launchBrowser(config), config.browser.maxPages);
  const own = new Set<Promise<Browser>>();
  const stateful = async (launched: Promise<Browser>) =>
    withState(await launched, config.browser.state, origin());
  const launchOwn = (options: LaunchOptions) => {
    const launching = launchBrowser(config, options);
    own.add(launching);
    return launching;
  };
  return {
    shared: () => stateful(shared()),
    launch: (options?: LaunchOptions) => stateful(options ? launchOwn(options) : shared()),
    closeAll: () => [
      ...[...own].map((launching) => launching.then((browser) => browser.close())),
      shared.closeAll(),
    ],
  };
};

const unfinishedAudits = (
  audits: Audit[],
  finished: Map<Audit, AuditResult>,
  timedOut: boolean,
  timeout: number,
) =>
  audits.flatMap(
    (audit) => finished.get(audit) ?? (timedOut ? [unfinishedResult(audit, timeout)] : []),
  );

const isExclusive = (config: VidimusConfig, { exclusive }: Audit) =>
  typeof exclusive === 'function' ? exclusive(config) : !!exclusive;

const firstRejection = (outcomes: PromiseSettledResult<unknown>[]) => {
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  if (rejected) throw rejected.reason;
};

const schedule = async (
  config: VidimusConfig,
  audits: Audit[],
  serial: boolean | undefined,
  runOne: (audit: Audit) => Promise<unknown>,
  discover: () => Promise<void>,
) => {
  const parallel = serial ? [] : audits.filter((audit) => !isExclusive(config, audit));
  const local = parallel.filter((audit) => requirement(audit) !== 'server');
  const remote = parallel.filter((audit) => requirement(audit) === 'server');
  firstRejection(
    await Promise.allSettled([
      ...local.map(runOne),
      discover().then(async () => firstRejection(await Promise.allSettled(remote.map(runOne)))),
    ]),
  );
  if (serial) await discover();
  for (const audit of audits.filter((audit) => !parallel.includes(audit))) await runOne(audit);
};

const execute = async (
  config: VidimusConfig,
  audits: Audit[],
  reporters: Reporter[],
  options: ProfileOptions,
): Promise<RunReport> => {
  const startedAt = new Date();
  const { dist, needsDist, builtPages, bundle, rendering, command, needsServer } = prepare(
    config,
    audits,
  );
  createOutDir(resolve(config.root, config.outDir));
  const suppression = createSuppression(config);
  const progress = createProgress(reporters);
  const browsers = createBrowsers(config, () => origin);
  const renderer = createRenderer(config, browsers.shared);
  const server =
    needsServer && !config.origin
      ? await span('serve', () => startServer(config, dist, renderer.snapshot))
      : undefined;
  const origin = (
    config.origin ||
    `http://${command ? 'localhost' : '127.0.0.1'}:${server?.port ?? config.port}${command ? '' : basePathOf(config.siteUrl)}`
  ).replace(/\/$/, '');
  const auditConfig = command && server ? { ...config, origin } : config;
  let pageUrls = createPageUrls(config, dist, builtPages, origin);

  const included = (path: string) =>
    !config.render.include.length || matchesAny(config.render.include, path);
  const renderPage = (url: string) =>
    included(pathOf(url, origin))
      ? renderer.render(url)
      : Promise.reject(new Error(`${pathOf(url, origin)} is not in render.include`));
  const renderedPages = async (exclude: string[] = [], log: (line: string) => void) => {
    const pages = builtPages(exclude);
    if (!rendering) return pages;
    const tick = track(pages.length);
    return Promise.all(
      pages.map(async (page): Promise<PageSource> => {
        if (!included(page.path)) return page;
        try {
          const { html, requests } = await renderer.render(pageUrlOf(origin, page.rel));
          return { file: page.file, rel: page.rel, path: page.path, html, requests };
        } catch (error) {
          log(`could not render ${page.path}, read the built file: ${messageOf(error)}`);
          return page;
        } finally {
          tick();
        }
      }),
    );
  };

  const headerSource = createHeaderSource(
    config.root,
    dist,
    config.security.file,
    auditConfig.origin.replace(/\/$/, ''),
  );

  const finished = new Map<Audit, AuditResult>();
  let info: RunInfo | undefined;
  let timedOut = false;
  const stop = new AbortController();

  const settleRun = async (
    audit: Audit,
    context: AuditContext,
    own: AbortController,
  ): Promise<{ settled: Settled; suppressed: number }> => {
    const outcome = await span(`audit ${audit.name}`, () =>
      progress.task(audit.name, () =>
        abortScope.run(own.signal, () => within(config.auditTimeout, audit.run(context))),
      ),
    );
    if (outcome !== TIMED_OUT) return suppression.settleOutcome(audit.name, outcome);
    own.abort();
    const summary = `did not finish within auditTimeout (${config.auditTimeout} ms)`;
    const fix =
      'raise auditTimeout, or rerun this audit alone with --profile to see where it hangs';
    return {
      settled: { status: 'errored', summary, findings: [{ message: summary, fix }] },
      suppressed: 0,
    };
  };

  const runOne = async (audit: Audit): Promise<AuditResult> => {
    if (timedOut) throw new Error('run timed out');
    const log: string[] = [];
    const own = new AbortController();
    const abort = () => own.abort();
    stop.signal.addEventListener('abort', abort, { once: true });
    const started = performance.now();
    const context: AuditContext = {
      config: auditConfig,
      root: config.root,
      dist,
      origin,
      resolve: (...segments) => resolve(config.root, ...segments),
      pageUrls,
      headersFor: headerSource.for,
      headerSource,
      builtPages,
      renderedPages: (exclude) => renderedPages(exclude, (line) => log.push(line)),
      ...(rendering && { renderPage }),
      log: (line = '') => log.push(...line.split('\n')),
      span,
      signal: own.signal,
      importPeer,
      launchBrowser: browsers.launch,
    };
    let settled: Settled;
    let suppressed = 0;
    try {
      ({ settled, suppressed } = await settleRun(audit, context, own));
    } catch (error) {
      if (!(error instanceof MissingPeerError) && error instanceof Error && error.stack)
        log.push(...error.stack.split('\n'));
      settled = {
        status: 'errored',
        summary: messageOf(error),
        findings: [],
      };
    }
    stop.signal.removeEventListener('abort', abort);
    const result = {
      name: audit.name,
      ...settled,
      suppressed,
      log,
      durationMs: performance.now() - started,
    };
    if (timedOut) return result;
    for (const reporter of reporters) await reporter.onAuditEnd?.(result);
    finished.set(audit, result);
    return result;
  };

  const discover = async () => {
    if (!needsServer) return;
    const routes = await span('routes', () =>
      progress.task('routes', () =>
        resolveRoutes(auditConfig, dist, builtPages, origin, renderer, rendering),
      ),
    );
    pageUrls = createPageUrls(config, dist, builtPages, origin, routes);
  };

  const work = async () => {
    const hint = needsServer ? clientRenderedHint(config, bundle) : undefined;
    info = {
      audits: audits.map(({ name }) => name),
      origin: needsServer ? origin : '',
      serving: server && [config.distDir, command].filter(Boolean).join(' with '),
      notes: hint ? [hint] : [],
    };
    for (const reporter of reporters) await reporter.onStart?.(info);
    await schedule(config, audits, options.serial, runOne, discover);
  };

  try {
    timedOut = (await within(config.timeout, work())) === TIMED_OUT;
  } finally {
    stop.abort();
    progress.clear();
    await Promise.allSettled([renderer.close(), ...browsers.closeAll(), server?.close()]);
  }

  const { stale, unusedIgnore } = suppression.finish(!!options.allAudits && !timedOut);
  const profile = await stopProfile(resolve(config.root, config.outDir, 'profile'), config.root);
  const report = buildReport({
    config,
    results: unfinishedAudits(audits, finished, timedOut, config.timeout),
    startedAt,
    timedOut,
    unusedIgnore,
    stale,
    origin: needsServer ? origin : '',
    distDir: needsDist ? dist : '',
    profile,
    audits: info?.audits ?? audits.map(({ name }) => name),
    serving: info?.serving,
    notes: info?.notes ?? [],
    pages: needsServer ? pageUrls().map((url) => pathOf(url, origin)) : [],
    suppressed: suppression.hidden,
  });
  for (const reporter of reporters) await reporter.onEnd?.(report);
  return report;
};

export const run = async ({
  audits = [],
  config: preloaded,
  reporters,
  profile,
  serial,
  ...loadOptions
}: RunOptions = {}) => {
  const config = preloaded ?? (await loadConfig(loadOptions)).config;
  const selected = selectAudits(auditRegistry(config), audits, config);
  if (!selected.length) process.stderr.write('vidimus: no audits selected, nothing to run\n');
  return runAudits(
    config,
    selected,
    reporters ??
      createReporters(config.reporters, {
        cwd: loadOptions.cwd ?? process.cwd(),
        env: loadOptions.env ?? process.env,
      }),
    { profile, serial, allAudits: !audits.length },
  );
};
