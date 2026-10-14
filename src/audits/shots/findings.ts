import type { Finding } from '../../core/types.ts';
import { type Change, overLimit } from './compare.ts';

export const changedShotFix = (gallery: string) =>
  `Open ${gallery} to review; if the change is intended, run vidimus shots --update-baseline.`;

const byName = <T>([a]: [string, T], [b]: [string, T]) => a.localeCompare(b);

export const failureFindings = (failed: Map<string, { path: string; error: string }>) =>
  [...failed].sort(byName).map(
    ([name, { path, error }]): Finding => ({
      message: `failed to capture ${name}`,
      details: [error],
      where: [path],
      fix: `Check that ${path} loads in a browser, raise shots.settleTimeout or shots.protocolTimeout, or add it to shots.exclude.`,
    }),
  );

const changeFinding = (change: Change, shown: string): Finding => {
  const { name, percent, maxDiff, maxDiffPixels, changed, sizeChange, region } = change;
  const over = overLimit(change);
  return {
    message: over
      ? `${name}: ${percent}% changed (${changed} px) > ${(maxDiff * 100).toFixed(2)}%${
          maxDiffPixels > 0 ? ` or ${maxDiffPixels} px` : ''
        } allowed`
      : `${name}: size changed ${sizeChange}`,
    details: [
      ...(over && sizeChange ? [`size changed ${sizeChange}`] : []),
      ...(region ? [`changed region ${region}`] : []),
      `${shown}/diff/${name}.png`,
    ],
    fix: changedShotFix(`${shown}/diff.html`),
  };
};

export const changeFindings = (changes: Change[], shown: string) =>
  changes
    .filter((change) => change.sizeChange || overLimit(change))
    .map((change) => changeFinding(change, shown));

export const compareFailureFindings = (diffFailed: Map<string, string>, shownBaseline: string) =>
  [...diffFailed].sort(byName).map(
    ([name, error]): Finding => ({
      message: `failed to compare ${name}`,
      details: [error],
      where: [`${shownBaseline}/${name}.png`],
      fix: `Delete ${shownBaseline}/${name}.png, then run vidimus shots --update-baseline.`,
    }),
  );

export const motionFinding = (skipped: Map<string, string>): Finding => ({
  message: 'motion GIFs skipped',
  details: [...new Set(skipped.values())],
  severity: 'warn',
  fix: 'Install sharp (pnpm add -D sharp) or set shots.motion to false.',
});

export const missingBaselineFinding = (
  missing: string[],
  compared: number,
  shownBaseline: string,
): Finding => {
  const none = missing.length === compared;
  return {
    message: none
      ? `no baseline in ${shownBaseline}: nothing was compared`
      : `${missing.length} screenshot(s) have no baseline`,
    ...(!none && { details: missing.map((name) => `${name}.png`), severity: 'warn' as const }),
    fix: 'Run vidimus shots --update-baseline, or add the new pages to shots.exclude.',
  };
};
