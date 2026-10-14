import type { MotionOptions } from '../../config/types.ts';
import type { Page } from '../../core/peer-types.ts';
import type { AuditContext } from '../../core/types.ts';

export interface Frame {
  shot: Buffer;
  delay: number;
}

const pauseEndless = () => {
  for (const anim of document.getAnimations()) {
    if (anim.effect?.getComputedTiming().iterations === Infinity) anim.pause();
  }
};

export const captureMotion = async (
  page: Page,
  { interval, stableFrames, maxFrames }: MotionOptions,
) => {
  await page.evaluate(pauseEndless);
  const frames: Frame[] = [];
  let streak = 0;
  let last = performance.now();
  while (frames.length < maxFrames && streak < stableFrames - 1) {
    const shot = Buffer.from(await page.screenshot({ optimizeForSpeed: true }));
    const now = performance.now();
    const prev = frames.at(-1);
    if (prev?.shot.equals(shot)) {
      streak += 1;
      prev.delay += now - last;
    } else {
      streak = 0;
      if (prev) prev.delay += now - last;
      frames.push({ shot, delay: 0 });
    }
    last = now;
    await new Promise((done) => setTimeout(done, interval));
  }
  return { frames, settled: streak >= stableFrames - 1 };
};

const writeGif = async (importPeer: AuditContext['importPeer'], frames: Frame[], file: string) => {
  const { default: sharp } = await importPeer<typeof import('sharp')>('sharp');
  await sharp(
    frames.map(({ shot }) => shot),
    { join: { animated: true } },
  )
    .gif({ delay: frames.map(({ delay }) => Math.max(20, Math.round(delay))), loop: 0 })
    .toFile(file);
};

export const tryWriteGif = async (
  importPeer: AuditContext['importPeer'],
  frames: Frame[],
  file: string,
) => {
  try {
    await writeGif(importPeer, frames, file);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
