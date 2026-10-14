import type { Page } from '../../core/peer-types.ts';
import { addSpans, span } from '../../core/profile.ts';
import type { Lighthouse, Run } from './types.ts';

const DESKTOP = {
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
};

export interface RunOptions {
  runLighthouse: Lighthouse;
  newPage: () => Promise<Page>;
  categories: string[];
  onlyAudits: string[];
  preset: string;
  runs: number;
}

export interface Attempts {
  ok: Run[];
  failed?: Run;
  thrown: string;
}

const once = (url: string, options: RunOptions) =>
  span(
    'lighthouse.run',
    async () => {
      const started = performance.now();
      const page = await options.newPage();
      const done = await options
        .runLighthouse(
          url,
          {
            output: 'html',
            logLevel: 'error',
            onlyCategories: options.categories,
            ...(options.onlyAudits.length ? { onlyAudits: options.onlyAudits } : {}),
            ...(options.preset === 'desktop' ? DESKTOP : {}),
          },
          undefined,
          page,
        )
        .finally(() => page.close().catch(() => {}));
      addSpans(done?.lhr.timing?.entries ?? [], started, performance.now());
      return done;
    },
    { url },
  );

// Stops at the first failed run: the remaining runs would fail the same way.
export const runAll = async (url: string, options: RunOptions): Promise<Attempts> => {
  const attempts: Attempts = { ok: [], thrown: '' };
  for (let attempt = 0; attempt < options.runs; attempt++) {
    try {
      const ran = await once(url, options);
      if (ran && !ran.lhr.runtimeError) {
        attempts.ok.push(ran);
        continue;
      }
      attempts.failed = ran;
    } catch (error) {
      attempts.thrown = error instanceof Error ? error.message : String(error);
    }
    break;
  }
  return attempts;
};
