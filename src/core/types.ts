import type { Pattern, VidimusConfig } from '../config/types.ts';
import type { AcceptedFinding } from './findings.ts';
import type { HeaderMap, HeaderSource } from './headers.ts';
import type { BuiltPage } from './html.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';
import type { ProfileSummary } from './profile.ts';
import type { RenderedPage, RenderedRequest } from './render.ts';

export type AuditRequirement = 'source' | 'dist' | 'server';

export type Severity = 'error' | 'warn';

export interface Finding {
  message: string;
  rule?: string;
  where?: string[];
  details?: string[];
  file?: string;
  /** 1-based line in `file`; used by annotations, never by baseline fingerprints. */
  line?: number;
  severity?: Severity;
  fix?: string;
}

export interface AuditOutcome {
  status?: 'passed' | 'failed' | 'skipped';
  summary: string;
  findings?: Finding[];
}

export interface PageQuery {
  exclude?: Pattern[];
  allLocales?: boolean;
}

export interface PageSource extends BuiltPage {
  requests?: RenderedRequest[];
}

export interface AuditContext {
  config: VidimusConfig;
  root: string;
  dist: string;
  origin: string;
  resolve: (...segments: string[]) => string;
  pageUrls: (query?: PageQuery) => string[];
  builtPages: (exclude?: Pattern[]) => BuiltPage[];
  renderedPages: (exclude?: Pattern[]) => Promise<PageSource[]>;
  renderPage?: (url: string) => Promise<RenderedPage>;
  headersFor: (path: string) => Promise<HeaderMap | undefined>;
  headerSource: Pick<HeaderSource, 'sources' | 'notes'>;
  log: (line?: string) => void;
  /** Times fn as a named span in `--profile` runs; just calls fn otherwise. */
  span: <T>(name: string, fn: () => Promise<T>, attrs?: Record<string, unknown>) => Promise<T>;
  /** Aborted when the audit times out; long loops should stop once it is. */
  signal: AbortSignal;
  importPeer: <T>(name: string) => Promise<T>;
  launchBrowser: (options?: LaunchOptions) => Promise<Browser>;
}

export interface Audit {
  name: string;
  description: string;
  requires?: AuditRequirement;
  exclusive?: boolean | ((config: VidimusConfig) => boolean);
  run: (context: AuditContext) => Promise<AuditOutcome>;
}

export type AuditStatus = 'passed' | 'warned' | 'failed' | 'skipped' | 'errored';

export interface AuditResult {
  name: string;
  status: AuditStatus;
  summary: string;
  findings: Finding[];
  suppressed: number;
  log: string[];
  durationMs: number;
}

/** Everything a run knows beyond the audit results; written by reporters in verbose mode only. */
export interface RunDetail {
  vidimus: string;
  node: string;
  platform: string;
  audits: string[];
  /** What the built-in server serves, `undefined` when none runs. */
  serving: string | undefined;
  notes: string[];
  /** Every page URL path the audits could see. */
  pages: string[];
  /** The resolved config, without plugins and reporters. */
  config: unknown;
  /** Findings hidden by ignore rules or the baseline, per audit. */
  suppressed: Record<string, Finding[]>;
  /** Baseline entries that no longer occur. */
  stale: AcceptedFinding[];
}

export interface RunTotals {
  errors: number;
  warnings: number;
  suppressed: number;
  audits: Record<'passed' | 'warned' | 'failed' | 'errored' | 'skipped', number>;
}

export interface RunReport {
  schemaVersion: 1;
  ok: boolean;
  origin: string;
  /** Absolute path of the served build output, `''` when no selected audit needed it. */
  distDir: string;
  startedAt: string;
  durationMs: number;
  results: AuditResult[];
  totals: RunTotals;
  staleBaseline: number;
  timedOut?: boolean;
  profile?: ProfileSummary;
  detail?: RunDetail;
}
