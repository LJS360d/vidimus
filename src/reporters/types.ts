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
