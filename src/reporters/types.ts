import type { AuditResult, RunReport } from '../core/types.ts';

export interface RunInfo {
  audits: string[];
  origin: string;
  serving: string | undefined;
  notes: string[];
}

export interface Progress {
  /** An audit's name, or `routes` while client-rendered routes are found. */
  name: string;
  done: number;
  /** 0 until the task knows how many items it has. */
  total: number;
  /** When counting towards `total` started, in ms since the epoch. */
  since: number;
}

export interface Reporter {
  name: string;
  onStart?: (info: RunInfo) => void | Promise<void>;
  onProgress?: (running: Progress[]) => void;
  onAuditEnd?: (result: AuditResult) => void | Promise<void>;
  onEnd?: (report: RunReport) => void | Promise<void>;
}

/** A built-in reporter, spelled as an object instead of `name` or `name:file`. */
export interface ReporterOptions {
  type: 'pretty' | 'github' | 'json' | 'junit' | 'sarif' | 'html';
  /** Where `json`, `junit`, `sarif` and `html` write, relative to the working directory; stdout without it. */
  file?: string;
  /** `json`, `junit`, `sarif` and `html` also write each audit's log, hidden findings, pages, config and versions. On unless `false`. */
  verbose?: boolean;
}
