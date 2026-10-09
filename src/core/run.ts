import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinAudits } from '../audits/registry.ts';
import { type LoadConfigOptions, loadConfig } from '../config/load.ts';
import type { VidimusConfig } from '../config/types.ts';
import { createReporters } from '../reporters/registry.ts';
import type { Progress, Reporter } from '../reporters/types.ts';
import { serveCommand } from './command-server.ts';
import { MissingPeerError, UsageError } from './errors.ts';
import {
  applyIgnore,
  countStale,
  readBaseline,
  settle,
  subtractBaseline,
  writeBaseline,
} from './findings.ts';
import { createPageReader } from './html.ts';
import { createPageUrls, pageUrlOf } from './pages.ts';
import { importPeer, launchBrowser, sharedBrowser, withState } from './peer.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';
import { type ProfileLevel, span, startProfile, stopProfile } from './profile.ts';
import { createRenderer } from './render.ts';
import { clientRenderedBundle, clientRenderedHint, resolveRoutes } from './routes.ts';
import { serve } from './server.ts';
import type { Audit, AuditContext, AuditResult, Finding, PageSource, RunReport } from './types.ts';
import { basePathOf, matchesAny, pathOf, progressScope, track } from './util.ts';

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
  return [...new Set(names)].map((name) => registry.get(name) as Audit);
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
    // Only still recording when the run threw: keep what was measured up to the failure.
    createOutDir(resolve(config.root, config.outDir));
    await stopProfile(resolve(config.root, config.outDir, 'profile'), config.root);
  }
};

const execute = async (
  config: VidimusConfig,
  audits: Audit[],
  reporters: Reporter[],
  options: ProfileOptions,
): Promise<RunReport> => {
  const startedAt = new Date();
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
  // security fetches real response headers when there is a real server to ask.
  const needsServer =
    rendering ||
    audits.some((audit) => requirement(audit) === 'server') ||
    (!!command && audits.some(({ name }) => name === 'security'));
  createOutDir(resolve(config.root, config.outDir));

  const baselineFile = config.baseline.file ? resolve(config.root, config.baseline.file) : '';
  const baseline = baselineFile
    ? readBaseline(baselineFile)
    : { version: 1 as const, findings: [] };
  const unsuppressed = new Map<string, Finding[]>();

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

  // `origin` is read lazily: no page opens before the server answers.
  const stateful = async (launched: Promise<Browser>) =>
    withState(await launched, config.browser.state, origin);
  const browser = sharedBrowser(() => launchBrowser(config));
  const statefulBrowser = () => stateful(browser());
  const launched = new Set<Promise<Browser>>();
  const launchOwn = (options: LaunchOptions) => {
    const launching = launchBrowser(config, options);
    launched.add(launching);
    return launching;
  };
  const renderer = createRenderer(config, statefulBrowser);
  const server =
    needsServer && !config.origin
      ? await span('serve', () => startServer(config, dist, renderer.snapshot))
      : undefined;
  const origin = (
    config.origin ||
    `http://${command ? 'localhost' : '127.0.0.1'}:${server?.port ?? config.port}${command ? '' : basePathOf(config.siteUrl)}`
  ).replace(/\/$/, '');
  // Audits treat a server.command like --origin: the host tool, not vidimus, answers requests.
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
          log(`could not render ${page.path}, read the built file: ${(error as Error).message}`);
          return page;
        } finally {
          tick();
        }
      }),
    );
  };

  const finished = new Map<Audit, AuditResult>();
  let timedOut = false;
  const runOne = async (audit: Audit): Promise<AuditResult> => {
    if (timedOut) throw new Error('run timed out');
    const log: string[] = [];
    const started = performance.now();
    const context: AuditContext = {
      config: auditConfig,
      root: config.root,
      dist,
      origin,
      resolve: (...segments) => resolve(config.root, ...segments),
      pageUrls,
      builtPages,
      renderedPages: (exclude) => renderedPages(exclude, (line) => log.push(line)),
      ...(rendering && { renderPage }),
      log: (line = '') => log.push(...line.split('\n')),
      span,
      importPeer,
      launchBrowser: (options) => stateful(options ? launchOwn(options) : browser()),
    };
    let settled: Pick<AuditResult, 'status' | 'summary' | 'findings'>;
    let suppressed = 0;
    try {
      const outcome = await span(`audit ${audit.name}`, () =>
        task(audit.name, () => within(config.auditTimeout, audit.run(context))),
      );
      if (outcome === TIMED_OUT) {
        const summary = `did not finish within auditTimeout (${config.auditTimeout} ms)`;
        const fix =
          'raise auditTimeout, or rerun this audit alone with --profile to see where it hangs';
        settled = { status: 'errored', summary, findings: [{ message: summary, fix }] };
      } else {
        const raw = outcome.findings ?? [];
        const kept = applyIgnore(audit.name, raw, config.ignore);
        if (outcome.status !== 'skipped') unsuppressed.set(audit.name, kept);
        const fresh = config.baseline.update
          ? []
          : subtractBaseline(config.root, audit.name, kept, baseline, config.baseline.matchWhere);
        suppressed = raw.length - fresh.length;
        settled = settle(outcome, fresh, {
          severity: config.severity[audit.name],
          strict: config.strict,
        });
      }
    } catch (error) {
      const missingPeer = error instanceof MissingPeerError;
      if (!missingPeer && error instanceof Error && error.stack)
        log.push(...error.stack.split('\n'));
      settled = {
        status: 'errored',
        summary: error instanceof Error ? error.message : String(error),
        findings: [],
      };
    }
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

  const work = async () => {
    const hint = needsServer ? clientRenderedHint(config, bundle) : undefined;
    for (const reporter of reporters) {
      await reporter.onStart?.({
        audits: audits.map(({ name }) => name),
        origin: needsServer ? origin : '',
        serving: server && [config.distDir, command].filter(Boolean).join(' with '),
        notes: hint ? [hint] : [],
      });
    }
    if (needsServer) {
      const routes = await span('routes', () =>
        task('routes', () =>
          resolveRoutes(auditConfig, dist, builtPages, origin, renderer, rendering),
        ),
      );
      pageUrls = createPageUrls(config, dist, builtPages, origin, routes);
    }
    const parallel = options.serial ? [] : audits.filter((audit) => !audit.exclusive);
    const settled = await Promise.allSettled(parallel.map(runOne));
    const rejected = settled.find((outcome) => outcome.status === 'rejected');
    if (rejected) throw rejected.reason;
    for (const audit of audits.filter((audit) => !parallel.includes(audit))) await runOne(audit);
  };
  try {
    timedOut = (await within(config.timeout, work())) === TIMED_OUT;
  } finally {
    running.clear();
    publish();
    await Promise.allSettled([
      renderer.close(),
      ...[...launched].map((launching) => launching.then((own) => own.close())),
      browser.closeAll(),
      server?.close(),
    ]);
  }

  if (baselineFile && config.baseline.update) {
    writeBaseline(baselineFile, config.root, unsuppressed, config.baseline.matchWhere);
  } else if (baselineFile) {
    const stale = countStale(config.root, unsuppressed, baseline, config.baseline.matchWhere);
    if (stale)
      process.stderr.write(
        `vidimus: ${stale} stale baseline ${stale === 1 ? 'entry' : 'entries'} no longer occur, re-run with --accept-findings to prune\n`,
      );
  }

  const profile = await stopProfile(resolve(config.root, config.outDir, 'profile'), config.root);
  const results = audits.flatMap((audit) => finished.get(audit) ?? []);
  const report: RunReport = {
    ok: !timedOut && results.every(({ status }) => status !== 'failed' && status !== 'errored'),
    origin: needsServer ? origin : '',
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    results,
    ...(timedOut && { timedOut }),
    ...(profile && { profile }),
  };
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
        reports: config.reports,
        outDir: resolve(config.root, config.outDir),
      }),
    { profile, serial },
  );
};
