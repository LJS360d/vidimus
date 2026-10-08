import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { MotionOptions } from '../config/types.ts';
import { UsageError } from '../core/errors.ts';
import type { Page } from '../core/peer-types.ts';
import type { Audit, AuditContext, Finding } from '../core/types.ts';
import {
  displayPath,
  inParallelTabs,
  navigate,
  onePagePerTemplate,
  pathOf,
  slug,
  viewport,
} from '../core/util.ts';

interface Frame {
  shot: Buffer;
  delay: number;
}

// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const diffPngsInPage = async (beforeSrc: string, afterSrc: string, tolerance: number) => {
  const decode = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = src;
    });
  const [before, after] = await Promise.all([decode(beforeSrc), decode(afterSrc)]);
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const pixels = (img: HTMLImageElement) => {
    const ctx = new OffscreenCanvas(width, height).getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const a = pixels(before);
  const b = pixels(after);
  const a32 = new Uint32Array(a.buffer);
  const b32 = new Uint32Array(b.buffer);

  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const image = ctx.createImageData(width, height);
  const d = image.data;
  let changed = 0;

  for (let i = 0; i < d.length; i += 4) {
    const identical = a32[i >> 2] === b32[i >> 2];
    const delta = identical
      ? 0
      : Math.max(
          Math.abs((a[i] ?? 0) - (b[i] ?? 0)),
          Math.abs((a[i + 1] ?? 0) - (b[i + 1] ?? 0)),
          Math.abs((a[i + 2] ?? 0) - (b[i + 2] ?? 0)),
          Math.abs((a[i + 3] ?? 0) - (b[i + 3] ?? 0)),
        );
    if (delta > tolerance) {
      changed += 1;
      d.set([255, 0, 0, 255], i);
    } else {
      const fadedGrey = 255 - (255 - ((b[i] ?? 0) + (b[i + 1] ?? 0) + (b[i + 2] ?? 0)) / 3) * 0.2;
      d.set([fadedGrey, fadedGrey, fadedGrey, 255], i);
    }
  }
  ctx.putImageData(image, 0, 0);

  const blob = await out.convertToBlob({ type: 'image/png' });
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return { changed, total: width * height, diffBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) };
};
/* node:coverage enable */

const gallery = (
  rows: { name: string; percent: string }[],
  baselineHref: string,
) => `<!doctype html>
<meta charset="utf-8"><title>screenshot diff</title>
<style>
 body{font:14px/1.5 system-ui;margin:2rem;background:#111;color:#eee}
 h2{font-size:1rem;margin:2rem 0 .5rem;font-weight:600}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;align-items:start}
 figure{margin:0}figcaption{opacity:.6;font-size:.75rem;margin-bottom:.25rem}
 img{width:100%;border:1px solid #333;background:#fff}
</style>
${rows
  .map(
    ({ name, percent }) => `<h2>${name} — ${percent}% changed</h2>
<div class="row">
${[
  ['baseline', baselineHref],
  ['current', 'current'],
  ['diff', 'diff'],
]
  .map(
    ([label, dir]) =>
      ` <figure><figcaption>${label}</figcaption><img src="${dir}/${name}.png"></figure>`,
  )
  .join('\n')}
</div>`,
  )
  .join('\n')}
`;

// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const waitForStylesFontsAndImages = async (budget: number) => {
  const deadline = new Promise((done) => setTimeout(done, budget));
  // Eager and sync: a lazy image never loads below the fold, and an async one can be left out
  // of the paint when the full-page screenshot grows the viewport.
  for (const img of document.images) {
    img.loading = 'eager';
    img.decoding = 'sync';
  }
  // decode() on an image whose request has not started yet rejects at once: wait for load first.
  const pendingImages = [...document.images]
    .filter((img) => !img.complete)
    .map((img) =>
      new Promise((done) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }).then(() => img.decode().catch(() => {})),
    );
  // Stylesheets a script added after load, as client-rendered pages do, may still be loading.
  const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
    .filter((link) => !link.sheet && !link.disabled)
    .map(
      (link) =>
        new Promise((done) => {
          link.addEventListener('load', done, { once: true });
          link.addEventListener('error', done, { once: true });
        }),
    );
  await Promise.race([Promise.all(sheets), deadline]);
  const fonts = Promise.all([...document.fonts].map((face) => face.load().catch(() => {})));
  await Promise.race([fonts.then(() => document.fonts.ready), deadline]);
  await Promise.race([Promise.all(pendingImages), deadline]);
};
/* node:coverage enable */

const FROZEN_FRAMES = 30;

const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

interface Instrumented {
  settled: () => boolean;
  lastRequest: number;
  glFailures: string[];
}

// Runs before any page script. Records WebGL contexts that fail and, with freeze, makes rAF
// scenes deterministic: seeded Math.random, a virtual clock, and no frames after the limit.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const instrument = (freeze: boolean, limit: number) => {
  const describe = (node: Element) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : node.classList[0] ? `.${node.classList[0]}` : '');
  const clock = performance.now.bind(performance);
  const state: Instrumented = { settled: () => true, lastRequest: 0, glFailures: [] };
  Object.defineProperty(window, '__vidimus', { value: state });

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    const context = (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    if (!context && /webgl/i.test(type)) state.glFailures.push(describe(this));
    return context;
  } as typeof getContext;

  const raf = window.requestAnimationFrame.bind(window);
  if (!freeze) {
    window.requestAnimationFrame = (callback) => {
      state.lastRequest = clock();
      return raf(callback);
    };
    return;
  }

  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Every call moves the clock a little, so busy-wait loops still end.
  let virtual = 0;
  performance.now = () => {
    virtual += 0.001;
    return virtual;
  };
  let frames = 0;
  let lastFrame = -1;
  window.requestAnimationFrame = (callback) => {
    state.lastRequest = clock();
    return raf((timestamp) => {
      if (timestamp !== lastFrame) {
        lastFrame = timestamp;
        frames += 1;
        virtual = Math.max(virtual, (frames * 1000) / 60);
      }
      if (frames <= limit) callback(virtual);
    });
  };
  state.settled = () => frames >= limit || clock() - state.lastRequest > 200;
};
/* node:coverage enable */

// Stops what freeze cannot reach from script: video frames and endless CSS animations.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const stillMedia = async () => {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) continue;
    animation.pause();
    animation.currentTime = 0;
  }
  await Promise.all(
    [...document.querySelectorAll('video')].map(async (video) => {
      video.pause();
      const settle = (event: string, start: () => void) =>
        new Promise((done) => {
          video.addEventListener(event, done, { once: true });
          setTimeout(done, 1000);
          start();
        });
      // The controls show the duration only once metadata is in, which preload="none" leaves
      // to chance; the poster stays up until playback.
      if (video.readyState < HTMLMediaElement.HAVE_METADATA && video.preload === 'none')
        await settle('loadedmetadata', () => {
          video.preload = 'metadata';
          video.load();
        });
      if (video.currentTime !== 0) await settle('seeked', () => (video.currentTime = 0));
    }),
  );
};
/* node:coverage enable */

// Paints masked elements a flat colour in place, so the layout stays as it is.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const maskElements = (selectors: string[], embeds: boolean) => {
  const invalid: string[] = [];
  const masked: Element[] = [];
  for (const selector of selectors) {
    try {
      masked.push(...document.querySelectorAll(selector));
    } catch {
      invalid.push(selector);
    }
  }
  if (embeds) {
    for (const frame of document.querySelectorAll('iframe[src]')) {
      try {
        const src = new URL(frame.getAttribute('src') ?? '', document.baseURI);
        if (src.origin !== location.origin) masked.push(frame);
      } catch {}
    }
  }
  // Through CSSOM, not a <style> element: a page's CSP can block injected stylesheets.
  for (const node of masked) {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
    node.style.setProperty('filter', 'brightness(0)', 'important');
    node.style.setProperty('background', '#000', 'important');
    node.style.setProperty('animation', 'none', 'important');
  }
  return invalid;
};
/* node:coverage enable */

// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
const movingElements = () => {
  const describe = (node: Element) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : node.classList[0] ? `.${node.classList[0]}` : '');
  const found = new Set<string>();
  for (const animation of document.getAnimations()) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (animation.playState === 'running' && target) found.add(describe(target));
  }
  for (const video of document.querySelectorAll('video'))
    if (!video.paused) found.add(describe(video));
  const state = (window as unknown as { __vidimus?: Instrumented }).__vidimus;
  if (state && performance.now() - state.lastRequest < 500) {
    for (const canvas of document.querySelectorAll('canvas')) found.add(describe(canvas));
  }
  return [...found].slice(0, 3);
};
/* node:coverage enable */

const captureMotion = async (page: Page, { interval, stableFrames, maxFrames }: MotionOptions) => {
  await page.evaluate(() => {
    for (const anim of document.getAnimations()) {
      if (anim.effect?.getComputedTiming().iterations === Infinity) anim.pause();
    }
  });
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

const asDataUrl = (file: string) =>
  `data:image/png;base64,${readFileSync(file).toString('base64')}`;

export const changedShotFix = (gallery: string) =>
  `Open ${gallery} to review; if the change is intended, run vidimus shots --update-baseline.`;

export const shots: Audit = {
  name: 'shots',
  description: 'screenshots match the recorded baseline within tolerance',
  async run({ config, root, origin, resolve, pageUrls, launchBrowser, importPeer, log }) {
    const {
      viewports,
      tolerance,
      maxDiff,
      sample,
      exclude,
      allLocales,
      concurrency,
      motion,
      maskEmbeds,
      freeze,
    } = config.shots;
    const updateBaseline = config.shots.updateBaseline;
    const out = resolve(config.outDir, config.shots.outDir);
    const shown = displayPath(root, out);
    const baselineDir = config.shots.baselineDir
      ? resolve(config.shots.baselineDir)
      : join(out, 'baseline');
    const shownBaseline = displayPath(root, baselineDir);
    const currentDir = join(out, 'current');
    const diffDir = join(out, 'diff');
    const motionDir = join(out, 'motion');
    const png = (dir: string, name: string) => join(dir, `${name}.png`);
    if ([out, currentDir, diffDir, motionDir].includes(baselineDir)) {
      throw new UsageError(
        `shots.baselineDir must not be ${shownBaseline}, where vidimus writes its own output`,
      );
    }

    const urls = onePagePerTemplate(
      pageUrls({ exclude, allLocales: allLocales || config.allLocales }),
      sample,
      origin,
    );
    const sizes = viewports.map((entry) => viewport(entry));
    const shotList = sizes.flatMap((size) =>
      urls.map((url) => ({ size, url, name: `${slug(url, origin)}@${size.width}x${size.height}` })),
    );

    for (const dir of [currentDir, diffDir, motionDir])
      rmSync(dir, { recursive: true, force: true });
    rmSync(join(out, 'diff.html'), { force: true });
    mkdirSync(currentDir, { recursive: true });

    const browser = await launchBrowser({
      headless: 'shell',
      protocolTimeout: config.shots.protocolTimeout,
      args: WEBGL_ARGS,
    });
    const changes: { name: string; ratio: number; percent: string }[] = [];
    const lines: string[] = [];
    const motionNotes = new Map<string, string>();
    let missingBaseline = 0;
    const failed = new Map<string, { path: string; error: string }>();

    const invalidMasks = new Set<string>();
    const glFailures = new Map<string, string[]>();

    // Instruments the next navigation only; the tab is reused for other shots.
    const open = async (page: Page, url: string, freeze: boolean) => {
      const { identifier } = await page.evaluateOnNewDocument(instrument, freeze, FROZEN_FRAMES);
      try {
        await navigate(page, url, config.render);
      } finally {
        await page.removeScriptToEvaluateOnNewDocument(identifier);
      }
      await page.evaluate(waitForStylesFontsAndImages, config.shots.settleTimeout);
      for (const selector of await page.evaluate(maskElements, config.shots.mask, maskEmbeds))
        invalidMasks.add(selector);
    };

    const capture = async (
      page: Page,
      size: ReturnType<typeof viewport>,
      url: string,
      name: string,
    ) => {
      await page.setViewport(size);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await open(page, url, freeze);
      if (freeze) {
        await page
          .waitForFunction(
            () => (window as unknown as { __vidimus?: Instrumented }).__vidimus?.settled() ?? true,
            { timeout: config.shots.settleTimeout, polling: 50 },
          )
          .catch(() => {});
        await page.evaluate(stillMedia);
      }
      const failures = await page.evaluate(
        () => (window as unknown as { __vidimus?: Instrumented }).__vidimus?.glFailures ?? [],
      );
      if (failures.length) glFailures.set(name, failures);
      // The full page, taken as one tall viewport: growing the viewport makes <picture> pick its
      // source again, so wait for images once more, and measure the page only once.
      // Content that arrives late can change the height again: measure until it holds still.
      let height = size.height;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const measured = Math.max(
          size.height,
          await page.evaluate(() => document.documentElement.scrollHeight),
        );
        if (measured === height) break;
        height = measured;
        await page.setViewport({ ...size, height });
        await page.evaluate(waitForStylesFontsAndImages, config.shots.settleTimeout);
      }
      await page.screenshot({
        path: png(currentDir, name) as `${string}.png`,
        captureBeyondViewport: false,
      });
      await page.setViewport(size);
      let note = '';
      if (motion) {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: '' }]);
        await open(page, url, false);
        const { frames, settled } = await captureMotion(page, motion);
        if (frames.length > 1) {
          const moving = settled ? [] : await page.evaluate(movingElements);
          const unsettled = moving.length
            ? ` (never settled: ${moving.join(', ')} ${moving.length > 1 ? 'animate' : 'animates'})`
            : ' (never settled)';
          note = `  ${frames.length} frames -> motion/${name}.gif${settled ? '' : unsettled}`;
          mkdirSync(motionDir, { recursive: true });
          await writeGif(importPeer, frames, join(motionDir, `${name}.gif`));
          motionNotes.set(name, note);
        }
      }
      if (updateBaseline) lines.push(`${name}.png${note}`);
    };

    try {
      await inParallelTabs(browser, concurrency, shotList, async (page, { size, url, name }) => {
        try {
          await capture(page, size, url, name);
        } catch (error) {
          failed.set(name, {
            path: pathOf(url, origin),
            error: error instanceof Error ? error.message : String(error),
          });
          lines.push(`${name}.png  failed`);
        }
      });

      if (!updateBaseline) {
        const names = shotList.map(({ name }) => name).filter((name) => !failed.has(name));
        const withBaseline = names.filter((name) => existsSync(png(baselineDir, name)));
        missingBaseline = names.length - withBaseline.length;
        for (const name of names.filter((name) => !withBaseline.includes(name))) {
          lines.push(`${name}.png  no baseline${motionNotes.get(name) ?? ''}`);
        }

        await inParallelTabs(browser, concurrency, withBaseline, async (blankPage, name) => {
          const { changed, total, diffBase64 } = await blankPage.evaluate(
            diffPngsInPage,
            asDataUrl(png(baselineDir, name)),
            asDataUrl(png(currentDir, name)),
            tolerance,
          );
          const ratio = changed / total;
          if (ratio === 0) {
            lines.push(`${name}.png  unchanged${motionNotes.get(name) ?? ''}`);
            return;
          }
          mkdirSync(diffDir, { recursive: true });
          writeFileSync(png(diffDir, name), Buffer.from(diffBase64, 'base64'));
          const percent = (ratio * 100).toFixed(2);
          changes.push({ name, ratio, percent });
          lines.push(
            `${name}.png  ${percent}% changed -> diff/${name}.png${motionNotes.get(name) ?? ''}`,
          );
        });
      }
    } finally {
      await browser.close();
    }

    lines.sort();
    changes.sort((a, b) => a.name.localeCompare(b.name));
    for (const line of lines) log(line);
    for (const selector of invalidMasks) log(`shots.mask: "${selector}" is not a valid selector`);
    for (const [name, canvases] of [...glFailures].sort(([a], [b]) => a.localeCompare(b)))
      log(`${name}: no WebGL context for ${canvases.join(', ')}, the shot shows it blank`);

    const failures: Finding[] = [...failed]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { path, error }]) => ({
        message: `failed to capture ${name}`,
        details: [error],
        where: [path],
        fix: `Check that ${path} loads in a browser, raise shots.settleTimeout or shots.protocolTimeout, or add it to shots.exclude.`,
      }));

    if (updateBaseline) {
      if (failures.length) {
        return {
          status: 'failed',
          summary: `baseline not updated: ${failures.length} screenshot(s) failed`,
          findings: failures,
        };
      }
      mkdirSync(baselineDir, { recursive: true });
      for (const file of readdirSync(baselineDir).filter((name) => name.endsWith('.png'))) {
        rmSync(join(baselineDir, file));
      }
      cpSync(currentDir, baselineDir, { recursive: true });
      return {
        summary: `baseline updated from ${shotList.length} screenshots in ${shownBaseline}`,
      };
    }

    if (changes.length) {
      writeFileSync(
        join(out, 'diff.html'),
        gallery(changes, relative(out, baselineDir).split(sep).join('/')),
      );
      log(`side-by-side gallery at ${shown}/diff.html`);
    }
    const findings: Finding[] = changes
      .filter(({ ratio }) => ratio > maxDiff)
      .map(({ name, percent }) => ({
        message: `${name}: ${percent}% changed > ${(maxDiff * 100).toFixed(2)}% allowed`,
        details: [`${shown}/diff/${name}.png`],
        fix: changedShotFix(`${shown}/diff.html`),
      }));
    const beyond = findings.length;
    findings.push(...failures);
    if (missingBaseline) {
      const none = missingBaseline === shotList.length - failed.size;
      findings.push({
        message: none
          ? `no baseline in ${shownBaseline}: nothing was compared`
          : `${missingBaseline} screenshot(s) have no baseline`,
        ...(!none && {
          details: shotList
            .map(({ name }) => name)
            .filter((name) => !failed.has(name) && !existsSync(png(baselineDir, name)))
            .map((name) => `${name}.png`),
          severity: 'warn' as const,
        }),
        fix: `Run vidimus shots --update-baseline, or add the new pages to shots.exclude.`,
      });
    }

    const scanned = `${urls.length} pages x ${sizes.length} viewports (${sizes
      .map(({ width, height }) => `${width}x${height}`)
      .join(', ')})`;
    return {
      summary: `${scanned}, ${
        beyond
          ? `${beyond} screenshot(s) changed beyond the allowed diff`
          : `${changes.length} changed within tolerance`
      }${missingBaseline ? `, ${missingBaseline} without baseline` : ''}${
        failures.length ? `, ${failures.length} failed` : ''
      }`,
      findings,
    };
  },
};
