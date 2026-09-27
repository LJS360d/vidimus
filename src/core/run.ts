import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinAudits } from '../audits/registry.ts';
import { type LoadConfigOptions, loadConfig } from '../config/load.ts';
import type { VidimusConfig } from '../config/types.ts';
import { createReporters } from '../reporters/registry.ts';
import type { Reporter } from '../reporters/types.ts';
import { MissingPeerError, UsageError } from './errors.ts';
import { applyIgnore, readBaseline, settle, subtractBaseline, writeBaseline } from './findings.ts';
import { createPageReader } from './html.ts';
import { createPageUrls, pageUrlOf } from './pages.ts';
import { importPeer, launchBrowser, sharedBrowser } from './peer.ts';
import { createRenderer } from './render.ts';
import { clientRenderedBundle, clientRenderedHint, resolveRoutes } from './routes.ts';
import { serve } from './server.ts';
import type { Audit, AuditContext, AuditResult, Finding, PageSource, RunReport } from './types.ts';
import { basePathOf, matchesAny, pathOf } from './util.ts';

export interface RunOptions extends LoadConfigOptions {
  audits?: string[];
  config?: VidimusConfig;
  reporters?: Reporter[];
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

export const runAudits = async (
  config: VidimusConfig,
  audits: Audit[],
  reporters: Reporter[],
): Promise<RunReport> => {
  const startedAt = new Date();
  const dist = resolve(config.root, config.distDir);
  const needsDist = audits.some((audit) => requirement(audit) !== 'source');
  if (needsDist && !existsSync(dist)) {
    throw new UsageError(`no build output at ${dist}. Run the build first.`);
  }
  const builtPages = createPageReader(dist);
  const bundle = needsDist ? clientRenderedBundle(config, dist, builtPages) : 0;
  const rendering =
    needsDist && (config.render.mode === 'on' || (config.render.mode === 'auto' && bundle > 0));
  const needsServer = rendering || audits.some((audit) => requirement(audit) === 'server');
  createOutDir(resolve(config.root, config.outDir));

  const baselineFile = config.baseline.file ? resolve(config.root, config.baseline.file) : '';
  const baseline = baselineFile
    ? readBaseline(baselineFile)
    : { version: 1 as const, findings: [] };
  const unsuppressed = new Map<string, Finding[]>();

  const browser = sharedBrowser(() => launchBrowser(config));
  const renderer = createRenderer(config, browser);
  const server =
    needsServer && !config.origin
      ? await serve(dist, config.port, config.server, config.siteUrl, renderer.snapshot)
      : undefined;
  const origin = (
    config.origin || `http://localhost:${server?.port ?? config.port}${basePathOf(config.siteUrl)}`
  ).replace(/\/$/, '');
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
    return Promise.all(
      pages.map(async (page): Promise<PageSource> => {
        if (!included(page.path)) return page;
        try {
          const { html, requests } = await renderer.render(pageUrlOf(origin, page.rel));
          return { file: page.file, rel: page.rel, path: page.path, html, requests };
        } catch (error) {
          log(`could not render ${page.path}, read the built file: ${(error as Error).message}`);
          return page;
        }
      }),
    );
  };

  const runOne = async (audit: Audit): Promise<AuditResult> => {
    const log: string[] = [];
    const started = performance.now();
    const context: AuditContext = {
      config,
      root: config.root,
      dist,
      origin,
      resolve: (...segments) => resolve(config.root, ...segments),
      pageUrls,
      builtPages,
      renderedPages: (exclude) => renderedPages(exclude, (line) => log.push(line)),
      ...(rendering && { renderPage }),
      log: (line = '') => log.push(...line.split('\n')),
      importPeer,
      launchBrowser: (options) => (options ? launchBrowser(config, options) : browser()),
    };
    let settled: Pick<AuditResult, 'status' | 'summary' | 'findings'>;
    let suppressed = 0;
    try {
      const outcome = await audit.run(context);
      const raw = outcome.findings ?? [];
      const kept = applyIgnore(audit.name, raw, config.ignore);
      unsuppressed.set(audit.name, kept);
      const fresh = config.baseline.update
        ? []
        : subtractBaseline(config.root, audit.name, kept, baseline);
      suppressed = raw.length - fresh.length;
      settled = settle(outcome, fresh, {
        severity: config.severity[audit.name],
        strict: config.strict,
      });
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
    for (const reporter of reporters) await reporter.onAuditEnd?.(result);
    return result;
  };

  const results: AuditResult[] = [];
  try {
    const hint = needsServer ? clientRenderedHint(config, bundle) : undefined;
    for (const reporter of reporters) {
      await reporter.onStart?.({
        audits: audits.map(({ name }) => name),
        origin: needsServer ? origin : '',
        serving: server ? config.distDir : undefined,
        notes: hint ? [hint] : [],
      });
    }
    if (needsServer) {
      const routes = await resolveRoutes(config, dist, builtPages, origin, renderer);
      pageUrls = createPageUrls(config, dist, builtPages, origin, routes);
    }
    results.push(...(await Promise.all(audits.filter((audit) => !audit.exclusive).map(runOne))));
    for (const audit of audits.filter((audit) => audit.exclusive))
      results.push(await runOne(audit));
  } finally {
    await renderer.close();
    await server?.close();
  }

  if (baselineFile && config.baseline.update) {
    writeBaseline(baselineFile, config.root, unsuppressed);
  }

  const report: RunReport = {
    ok: results.every(({ status }) => status !== 'failed' && status !== 'errored'),
    origin: needsServer ? origin : '',
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    results,
  };
  for (const reporter of reporters) await reporter.onEnd?.(report);
  return report;
};

export const run = async ({
  audits = [],
  config: preloaded,
  reporters,
  ...loadOptions
}: RunOptions = {}) => {
  const config = preloaded ?? (await loadConfig(loadOptions)).config;
  const selected = selectAudits(auditRegistry(config), audits, config);
  return runAudits(
    config,
    selected,
    reporters ??
      createReporters(config.reporters, {
        cwd: loadOptions.cwd ?? process.cwd(),
        env: loadOptions.env ?? process.env,
      }),
  );
};
