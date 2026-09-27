import type { AuditResult, RunReport } from '../core/types.ts';

export interface RunInfo {
  audits: string[];
  origin: string;
  serving: string | undefined;
  notes: string[];
}

export interface Reporter {
  name: string;
  onStart?: (info: RunInfo) => void | Promise<void>;
  onAuditEnd?: (result: AuditResult) => void | Promise<void>;
  onEnd?: (report: RunReport) => void | Promise<void>;
}
