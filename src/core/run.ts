import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtinAudits } from '../audits/registry.ts';
import { type LoadConfigOptions, loadConfig } from '../config/load.ts';
import type { VidimusConfig } from '../config/types.ts';
import { createReporters } from '../reporters/registry.ts';
import type { Reporter } from '../reporters/types.ts';
import { MissingPeerError, UsageError } from './errors.ts';
import { applyIgnore, readBaseline, settle, subtractBaseline, writeBaseline } from './findings.ts';
import { createPageReader } from './html.ts';
import { createPageUrls } from './pages.ts';
import { importPeer, launchBrowser, sharedBrowser } from './peer.ts';
import { serve } from './server.ts';
import type { Audit, AuditContext, AuditResult, Finding, RunReport } from './types.ts';
import { basePathOf } from './util.ts';

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

export const runAudits = async (
  config: VidimusConfig,
  audits: Audit[],
  reporters: Reporter[],
): Promise<RunReport> => {
  const startedAt = new Date();
  const dist = resolve(config.root, config.distDir);
  const needsDist = audits.some((audit) => requirement(audit) !== 'source');
  const needsServer = audits.some((audit) => requirement(audit) === 'server');
  if (needsDist && !existsSync(dist)) {
    throw new UsageError(`no build output at ${dist}. Run the build first.`);
  }

  const baselineFile = config.baseline.file ? resolve(config.root, config.baseline.file) : '';
  const baseline = baselineFile
    ? readBaseline(baselineFile)
    : { version: 1 as const, findings: [] };
  const unsuppressed = new Map<string, Finding[]>();

  const server =
    needsServer && !config.origin
      ? await serve(dist, config.port, config.server, config.siteUrl)
      : undefined;
  const origin = (
    config.origin || `http://localhost:${server?.port ?? config.port}${basePathOf(config.siteUrl)}`
  ).replace(/\/$/, '');
  const builtPages = createPageReader(dist);
  const browser = sharedBrowser(() => launchBrowser(config));
  const pageUrls = createPageUrls(config, dist, builtPages, origin);

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
    for (const reporter of reporters) {
      await reporter.onStart?.({
        audits: audits.map(({ name }) => name),
        origin: needsServer ? origin : '',
        serving: server ? config.distDir : undefined,
      });
    }
    results.push(...(await Promise.all(audits.filter((audit) => !audit.exclusive).map(runOne))));
    for (const audit of audits.filter((audit) => audit.exclusive))
      results.push(await runOne(audit));
  } finally {
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
