import type { Case } from './cases.ts';
import type { FieldInfo, FieldState, FormInfo, PageEvents, Value } from './probe.ts';
import type { Captured } from './sandbox.ts';

export type Outcome =
  | 'sent'
  | 'navigated'
  | 'blocked:native'
  | 'blocked:script'
  | 'none'
  | 'not-submitted'
  | 'timeout'
  | 'error';

export type CaseEvents = Omit<PageEvents, 'submits' | 'invalid'>;

export interface CaseResult extends Omit<Case, 'values'> {
  value?: Value;
  outcome: Outcome;
  requests: Captured[];
  state?: FieldState;
  invalid: string[];
  events: CaseEvents;
  error?: string;
  before?: string;
}

export interface Found {
  url: string;
  path: string;
  form: FormInfo;
  id: string;
  fingerprint: string;
}

export interface Exercised {
  id: string;
  fingerprint: string;
  pages: string[];
  form: FormInfo;
  fields: FieldInfo[];
  confirms: Record<string, string>;
  cases: CaseResult[];
  skippedCases: number;
  abortedCases?: number;
  dialogs?: string[];
  observed: Record<string, { accepted: string[]; rejected: string[] }>;
  shot?: string;
}

const SENT = new Set<Outcome>(['sent', 'navigated']);
export const isSent = (c: { outcome: Outcome }) => SENT.has(c.outcome);
