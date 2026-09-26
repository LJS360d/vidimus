import type { Pattern, VidimusConfig } from '../config/types.ts';
import type { BuiltPage } from './html.ts';
import type { Browser, LaunchOptions } from './peer-types.ts';

export type AuditRequirement = 'source' | 'dist' | 'server';

export type Severity = 'error' | 'warn';

export interface Finding {
  message: string;
  where?: string[];
  details?: string[];
  file?: string;
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

export interface AuditContext {
  config: VidimusConfig;
  root: string;
  dist: string;
  origin: string;
  resolve: (...segments: string[]) => string;
  pageUrls: (query?: PageQuery) => string[];
  builtPages: (exclude?: Pattern[]) => BuiltPage[];
  log: (line?: string) => void;
  importPeer: <T>(name: string) => Promise<T>;
  launchBrowser: (options?: LaunchOptions) => Promise<Browser>;
}

export interface Audit {
  name: string;
  description: string;
  requires?: AuditRequirement;
  exclusive?: boolean;
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

export interface RunReport {
  ok: boolean;
  origin: string;
  startedAt: string;
  durationMs: number;
  results: AuditResult[];
}
