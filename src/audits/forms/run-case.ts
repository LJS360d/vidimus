import type { Page } from '../../core/peer-types.ts';
import { span } from '../../core/profile.ts';
import type { Case } from './cases.ts';
import { drain, layerInvalid, mergeEvents, observe, settled, shotOf, show, sleep } from './page.ts';
import type { FieldInfo, FieldState, PageEvents, Value } from './probe.ts';
import type { Captured } from './sandbox.ts';
import type { Net } from './session.ts';
import type { CaseResult, Outcome } from './types.ts';

export interface CaseContext {
  page: Page;
  net: Net;
  index: number;
  fields: FieldInfo[];
  upload: string;
  settle: number;
  submittable: boolean;
  screenshots: boolean;
}

const fillCase = async ({ page, index, fields, upload }: CaseContext, c: Case) => {
  const tail = await page.evaluate(
    (i, v, t) => window.__vidimus.fill(i, v, t),
    index,
    c.values,
    c.field,
  );
  if (tail && c.field) {
    await page.evaluate((i, k) => window.__vidimus.focus(i, k), index, c.field);
    await page.keyboard.type(tail);
    await page.evaluate((i, k) => window.__vidimus.blur(i, k), index, c.field);
  }
  for (const field of fields.filter((f) => f.type === 'file' && c.values[f.key])) {
    const handle = await page.evaluateHandle(
      (i, k) => window.__vidimus.element(i, k),
      index,
      field.key,
    );
    try {
      const input = handle.asElement() as unknown as {
        uploadFile(...paths: string[]): Promise<void>;
      } | null;
      await input?.uploadFile(upload);
    } finally {
      await handle.dispose();
    }
  }
  await settled(page);
};

const waitForRequests = (net: Net, settle: number) =>
  span('forms.settle', async () => {
    const until = performance.now() + settle;
    while (performance.now() < until && !net.pending()) await sleep(25);
    if (net.pending()) await sleep(50);
  });

const outcomeOf = (nativeBlock: boolean, requests: Captured[], after: PageEvents): Outcome => {
  if (nativeBlock) return 'blocked:native';
  if (requests.some((r) => r.navigation)) return 'navigated';
  if (requests.length) return 'sent';
  return after.submits.some((s) => s.prevented) ? 'blocked:script' : 'none';
};

const settleSubmit = async ({ page, net, settle }: CaseContext) => {
  await sleep(20);
  let after = await drain(page);
  const nativeBlock = after.invalid.length > 0 && after.submits.length === 0;
  if (!nativeBlock) {
    await waitForRequests(net, settle);
    after = mergeEvents(after, await drain(page));
  }
  const requests = net.take();
  return { after, requests, outcome: outcomeOf(nativeBlock, requests, after) };
};

const invalidKeys = (states: Record<string, FieldState>) =>
  Object.entries(states)
    .filter(([, s]) => layerInvalid(s))
    .map(([key]) => key);

const toResult = (
  rest: Omit<Case, 'values'>,
  values: Record<string, Value>,
  outcome: Outcome,
  requests: Captured[],
  states: Record<string, FieldState>,
  invalid: string[],
  { submits: _s, invalid: _i, ...events }: PageEvents,
): CaseResult => ({
  ...rest,
  ...(rest.field && { value: values[rest.field], state: states[rest.field] }),
  outcome,
  requests,
  invalid,
  events,
});

export const runCase = async (
  ctx: CaseContext,
  c: Case,
): Promise<CaseResult & { snap?: Uint8Array }> => {
  const { page, net, index } = ctx;
  const { values, ...original } = c;
  let rest = original;
  await fillCase(ctx, c);
  const states = await observe(page, index);
  const snap = ctx.screenshots ? await span('forms.shot', () => shotOf(page, index)) : undefined;
  // The browser may refuse input (typing past maxlength, sanitising email or number values):
  // then the case did not test what it meant to and proves nothing either way.
  const intended = c.field ? values[c.field] : undefined;
  const actual = c.field ? states[c.field]?.value : undefined;
  if (typeof intended === 'string' && actual !== undefined && actual !== intended)
    rest = { ...rest, expect: 'unknown', label: `${rest.label} (browser kept ${show(actual)})` };
  const invalid = invalidKeys(states);

  let events = await drain(page);
  const early = net.take();
  const submitted =
    ctx.submittable &&
    (await page.evaluate((i, n) => window.__vidimus.submit(i, n), index, c.times ?? 1));
  if (!submitted)
    return {
      ...toResult(
        rest,
        values,
        'not-submitted',
        [...early, ...net.take()],
        states,
        invalid,
        events,
      ),
      snap,
    };
  const { after, requests, outcome } = await settleSubmit(ctx);
  events = mergeEvents(events, after);
  return { ...toResult(rest, values, outcome, requests, states, invalid, events), snap };
};
