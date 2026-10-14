export interface LighthouseResult {
  runtimeError?: { code: string; message: string };
  timing?: { entries?: { name: string; startTime: number; duration: number }[] };
  categories: Record<
    string,
    { score: number | null; auditRefs: { id: string; weight: number }[] } | undefined
  >;
  audits: Record<
    string,
    | { score: number | null; title: string; displayValue?: string; numericValue?: number }
    | undefined
  >;
}

export interface Run {
  lhr: LighthouseResult;
  report: string | string[];
}

export type Lighthouse = (
  url: string,
  flags: Record<string, unknown>,
  config?: undefined,
  page?: unknown,
) => Promise<Run | undefined>;
