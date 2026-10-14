import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Page } from '../../core/peer-types.ts';
import { pngPath } from './capture.ts';
import { diffPngsInPage } from './diff.ts';

export interface Limits {
  tolerance: number;
  maxDiff: number;
  maxDiffPixels: number;
}

export interface Change extends Omit<Limits, 'tolerance'> {
  name: string;
  ratio: number;
  percent: string;
  changed: number;
  sizeChange?: string;
  region?: string;
}

export type Comparison =
  | { kind: 'unchanged' }
  | { kind: 'changed'; change: Change }
  | { kind: 'failed'; error: string };

export interface CompareDirs {
  baselineDir: string;
  currentDir: string;
  diffDir: string;
}

const asDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

export const overLimit = ({ ratio, maxDiff, changed, maxDiffPixels }: Change) =>
  ratio > maxDiff || (maxDiffPixels > 0 && changed > maxDiffPixels);

export const compareShot = async (
  page: Page,
  name: string,
  limits: Limits,
  antialiasing: boolean,
  { baselineDir, currentDir, diffDir }: CompareDirs,
): Promise<Comparison> => {
  try {
    const baseline = readFileSync(pngPath(baselineDir, name));
    const current = readFileSync(pngPath(currentDir, name));
    if (baseline.equals(current)) return { kind: 'unchanged' };
    await page.goto('about:blank');
    const { changed, total, before, after, region, diffBase64 } = await page.evaluate(
      diffPngsInPage,
      asDataUrl(baseline),
      asDataUrl(current),
      limits.tolerance,
      antialiasing,
    );
    const ratio = changed / total;
    const sizeChange =
      before[0] === after[0] && before[1] === after[1]
        ? undefined
        : `${before.join('x')} -> ${after.join('x')}`;
    if (ratio === 0 && !sizeChange) return { kind: 'unchanged' };
    mkdirSync(diffDir, { recursive: true });
    writeFileSync(pngPath(diffDir, name), Buffer.from(diffBase64, 'base64'));
    return {
      kind: 'changed',
      change: {
        name,
        ratio,
        percent: (ratio * 100).toFixed(2),
        changed,
        maxDiff: limits.maxDiff,
        maxDiffPixels: limits.maxDiffPixels,
        sizeChange,
        region: region && `x=${region[0]}..${region[2]}, y=${region[1]}..${region[3]}`,
      },
    };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
};
