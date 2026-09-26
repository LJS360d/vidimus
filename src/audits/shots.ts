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
  onePagePerTemplate,
  pathOf,
  slug,
  viewport,
} from '../core/util.ts';

interface Frame {
  shot: Buffer;
  delay: number;
}

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

const waitForFontsAndImages = async (budget: number) => {
  const deadline = new Promise((done) => setTimeout(done, budget));
  for (const img of document.images) img.loading = 'eager';
  const pendingImages = [...document.images]
    .filter((img) => !img.complete)
    .map((img) => img.decode().catch(() => {}));
  const fonts = Promise.all([...document.fonts].map((face) => face.load().catch(() => {})));
  await Promise.race([fonts.then(() => document.fonts.ready), deadline]);
  await Promise.race([Promise.all(pendingImages), deadline]);
};

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
    const { viewports, tolerance, maxDiff, sample, exclude, allLocales, concurrency, motion } =
      config.shots;
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
    });
    const changes: { name: string; ratio: number; percent: string }[] = [];
    const lines: string[] = [];
    const motionNotes = new Map<string, string>();
    let missingBaseline = 0;
    const failed = new Map<string, { path: string; error: string }>();

    const capture = async (
      page: Page,
      size: ReturnType<typeof viewport>,
      url: string,
      name: string,
    ) => {
      await page.setViewport(size);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(waitForFontsAndImages, config.shots.settleTimeout);
      await page.screenshot({
        path: png(currentDir, name) as `${string}.png`,
        fullPage: true,
        captureBeyondViewport: false,
      });
      let note = '';
      if (motion) {
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: '' }]);
        await page.reload({ waitUntil: 'load' });
        await page.evaluate(waitForFontsAndImages, config.shots.settleTimeout);
        const { frames, settled } = await captureMotion(page, motion);
        if (frames.length > 1) {
          note = `  ${frames.length} frames -> motion/${name}.gif${settled ? '' : ' (never settled)'}`;
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
