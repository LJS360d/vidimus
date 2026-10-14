import type { VidimusConfig } from '../../config/types.ts';
import type { Browser, Page } from '../../core/peer-types.ts';
import { span } from '../../core/profile.ts';
import type { Finding } from '../../core/types.ts';
import { findBaseline } from './baseline.ts';
import { casesFor, fingerprintOf } from './cases.ts';
import type { Unique } from './discover.ts';
import { inferAll } from './infer.ts';
import { dataUri, emptyEvents, fill, scan, shotOf } from './page.ts';
import type { FieldInfo, Value } from './probe.ts';
import { verdictOf } from './report.ts';
import { type CaseContext, runCase } from './run-case.ts';
import { openSession, type Session } from './session.ts';
import { type CaseResult, type Exercised, isSent } from './types.ts';

const MAX_TIMEOUTS = 3;
const TIMED_OUT = Symbol('timed out');

const withTimeout = async <T>(ms: number, work: Promise<T>) => {
  if (!ms) return work;
  let timer: NodeJS.Timeout | undefined;
  work.catch(() => {});
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((done) => {
        timer = setTimeout(() => done(TIMED_OUT), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const locateIndex = async (page: Page, origin: string, unique: Unique, fallback: number) => {
  const { fingerprint } = unique.first;
  const loaded = await scan(page);
  return (
    loaded.filter((f) => fingerprintOf(f, origin) === fingerprint)[unique.nth]?.index ?? fallback
  );
};

const firstLine = (error: unknown) => (error as Error).message.split('\n')[0] ?? '';

const observedOf = (fields: FieldInfo[], results: CaseResult[]) =>
  Object.fromEntries(
    fields.map((f) => {
      const mine = results.filter((c) => c.field === f.key);
      const value = (c: CaseResult) => c.label.slice(f.key.length + 1);
      const stopped = (c: CaseResult) =>
        c.outcome.startsWith('blocked') || c.outcome === 'not-submitted';
      return [
        f.key,
        { accepted: mine.filter(isSent).map(value), rejected: mine.filter(stopped).map(value) },
      ];
    }),
  );

interface Env {
  browser: Browser;
  config: VidimusConfig;
  origin: string;
  upload: string;
  failed: Finding[];
}

const runCases = async (
  env: Env,
  unique: Unique,
  session: Session,
  startIndex: number,
  fields: FieldInfo[],
  cases: ReturnType<typeof casesFor>['cases'],
  dialogs: string[],
) => {
  const { config } = env;
  const options = config.forms;
  const { first, id, pages } = unique;
  const results: CaseResult[] = [];
  let current = session;
  let index = startIndex;
  let timeouts = 0;
  let unchanged = false;
  for (const c of cases) {
    const { values, ...rest } = c;
    const base = { ...rest, ...(c.field && { value: values[c.field] }) };
    try {
      const ran = await withTimeout(
        options.caseTimeout,
        span(
          'forms.case',
          async () => {
            if (!unchanged) await span('forms.reload', () => current.load());
            index = await locateIndex(current.page, env.origin, unique, index);
            const ctx: CaseContext = {
              page: current.page,
              net: current.net,
              index,
              fields,
              upload: env.upload,
              settle: options.settle,
              submittable: !!first.form.submitter || first.form.kind === 'form',
              screenshots: options.screenshots,
            };
            return runCase(ctx, c);
          },
          { case: c.label },
        ),
      );
      if (ran === TIMED_OUT) {
        timeouts++;
        await current.close();
        let reopened = true;
        try {
          current = await openSession(env.browser, config, first.url, dialogs);
        } catch (error) {
          reopened = false;
          env.failed.push({
            message: `${id}: page could not be reopened after a timeout`,
            details: [firstLine(error)],
            where: pages,
            fix: `Check that ${first.path} loads within forms.timeout (${options.timeout} ms).`,
          });
        }
        unchanged = false;
        results.push({
          ...base,
          outcome: 'timeout',
          requests: [],
          invalid: [],
          events: emptyEvents(),
        });
        if (!reopened || timeouts >= MAX_TIMEOUTS) break;
        continue;
      }
      timeouts = 0;
      // The form as the user saw it before pressing submit: kept for failures only.
      const { snap, ...last } = ran;
      unchanged =
        (last.outcome === 'none' || last.outcome === 'not-submitted') && last.requests.length === 0;
      if (snap && verdictOf(last) === 'fail') last.before = dataUri(snap);
      results.push(last);
    } catch (error) {
      unchanged = false;
      results.push({
        ...base,
        outcome: 'error',
        requests: current.net.take(),
        invalid: [],
        events: emptyEvents(),
        error: (error as Error).message.split('\n')[0],
      });
    }
  }
  return { results, session: current };
};

export const exerciseForm = async (env: Env, unique: Unique): Promise<Exercised | undefined> => {
  const { browser, config, origin, failed } = env;
  const options = config.forms;
  const { first, id, pages } = unique;
  const { form, fingerprint } = first;
  const dialogs: string[] = [];
  let session: Session | undefined;
  try {
    session = await openSession(browser, config, first.url, dialogs);
    const { page } = session;
    const index = await locateIndex(page, origin, unique, form.index);
    const known: Record<string, Value> = {};
    let fields = await span('forms.baseline', () =>
      findBaseline(page, index, form.fields, options.values, known),
    );
    // Rules the markup does not declare (Angular Validators, Zod, custom code) are found
    // by probing one field at a time, so their boundaries get cases too.
    const accepted = casesFor(fields, options.values, known).baseline;
    await fill(page, index, accepted);
    fields = await span('forms.infer', () => inferAll(page, index, fields, accepted));
    const shot = await span('forms.shot', () => shotOf(page, index));
    const generated = casesFor(fields, options.values, known);
    const cases = generated.cases.slice(0, options.maxCases);
    dialogs.length = 0;
    const ran = await runCases(env, unique, session, index, fields, cases, dialogs);
    session = ran.session;
    return {
      id,
      fingerprint,
      pages,
      form: { ...form, fields },
      fields,
      confirms: Object.fromEntries(generated.confirms),
      cases: ran.results,
      skippedCases: generated.cases.length - cases.length,
      abortedCases: cases.length - ran.results.length,
      dialogs: [...new Set(dialogs)],
      observed: observedOf(fields, ran.results),
      ...(shot && { shot: dataUri(shot) }),
    };
  } catch (error) {
    failed.push({
      message: `${id}: could not be exercised`,
      details: [firstLine(error)],
      where: pages,
      fix: `Check that ${first.path} loads within forms.timeout (${options.timeout} ms), or skip the form with forms.skip.`,
    });
    return undefined;
  } finally {
    await session?.close();
  }
};
