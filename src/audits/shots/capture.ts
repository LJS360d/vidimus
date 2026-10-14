import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VidimusConfig } from '../../config/types.ts';
import type { Page } from '../../core/peer-types.ts';
import type { AuditContext } from '../../core/types.ts';
import { navigate, type viewport } from '../../core/util.ts';
import { captureMotion, tryWriteGif } from './motion.ts';
import {
  FROZEN_FRAMES,
  glFailuresOf,
  instrument,
  isSettled,
  maskElements,
  movingElements,
  pageHeight,
  stillMedia,
  waitForStylesFontsAndImages,
} from './page.ts';

type Size = ReturnType<typeof viewport> & { deviceScaleFactor: number };

export interface Shot {
  size: Size;
  url: string;
  scheme: string;
  name: string;
}

export interface Captured {
  note: string;
  glFailures: string[];
  invalidMasks: string[];
  motionSkipped?: string;
}

export interface CaptureEnv {
  config: VidimusConfig;
  currentDir: string;
  motionDir: string;
  importPeer: AuditContext['importPeer'];
}

export const pngPath = (dir: string, name: string) => join(dir, `${name}.png`) as `${string}.png`;

const HEIGHT_ATTEMPTS = 3;

const features = (motion: string, scheme: string) => [
  { name: 'prefers-reduced-motion', value: motion },
  { name: 'prefers-color-scheme', value: scheme },
];

const openInstrumented = async (
  { config }: CaptureEnv,
  page: Page,
  url: string,
  freeze: boolean,
  invalidMasks: Set<string>,
) => {
  const { css, maskEmbeds, mask, settleTimeout } = config.shots;
  const { identifier } = await page.evaluateOnNewDocument(instrument, freeze, FROZEN_FRAMES);
  try {
    await navigate(page, url, config.render);
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(identifier);
  }
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate(waitForStylesFontsAndImages, settleTimeout);
  for (const selector of await page.evaluate(maskElements, mask, maskEmbeds))
    invalidMasks.add(selector);
};

// The full page, taken as one tall viewport: growing the viewport makes <picture> pick its
// source again, so wait for images once more. Content that arrives late can change the height
// again: measure until it holds still.
const fitViewportToPage = async (page: Page, size: Size, settleTimeout: number) => {
  let height = size.height;
  for (let attempt = 0; attempt < HEIGHT_ATTEMPTS; attempt += 1) {
    const measured = Math.max(size.height, await page.evaluate(pageHeight));
    if (measured === height) break;
    height = measured;
    await page.setViewport({ ...size, height });
    await page.evaluate(waitForStylesFontsAndImages, settleTimeout);
  }
};

const motionNote = async (
  env: CaptureEnv,
  page: Page,
  { url, name, scheme }: Shot,
  invalidMasks: Set<string>,
) => {
  const { motion } = env.config.shots;
  if (!motion) return {};
  await page.emulateMediaFeatures(features('', scheme));
  await openInstrumented(env, page, url, false, invalidMasks);
  const { frames, settled } = await captureMotion(page, motion);
  if (frames.length <= 1) return {};
  const moving = settled ? [] : await page.evaluate(movingElements);
  const unsettled = moving.length
    ? ` (never settled: ${moving.join(', ')} ${moving.length > 1 ? 'animate' : 'animates'})`
    : ' (never settled)';
  mkdirSync(env.motionDir, { recursive: true });
  const problem = await tryWriteGif(env.importPeer, frames, join(env.motionDir, `${name}.gif`));
  if (problem) return { motionSkipped: problem };
  return {
    note: `  ${frames.length} frames -> motion/${name}.gif${settled ? '' : unsettled}`,
  };
};

export const captureShot = async (env: CaptureEnv, page: Page, shot: Shot): Promise<Captured> => {
  const { settleTimeout, freeze } = env.config.shots;
  const { size, url, name } = shot;
  const invalidMasks = new Set<string>();
  await page.setViewport(size);
  await page.emulateMediaFeatures(features('reduce', shot.scheme));
  await openInstrumented(env, page, url, freeze, invalidMasks);
  if (freeze) {
    await page.waitForFunction(isSettled, { timeout: settleTimeout, polling: 50 }).catch(() => {});
    await page.evaluate(stillMedia);
  }
  const glFailures = await page.evaluate(glFailuresOf);
  await fitViewportToPage(page, size, settleTimeout);
  await page.screenshot({ path: pngPath(env.currentDir, name), captureBeyondViewport: false });
  await page.setViewport(size);
  const { note = '', motionSkipped } = await motionNote(env, page, shot, invalidMasks);
  return { note, glFailures, invalidMasks: [...invalidMasks], motionSkipped };
};
