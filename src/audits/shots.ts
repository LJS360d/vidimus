import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { UsageError } from '../core/errors.ts';
import type { Audit, Finding } from '../core/types.ts';
import {
  displayPath,
  inParallelTabs,
  onePagePerTemplate,
  pathOf,
  regex,
  slug,
  viewport,
} from '../core/util.ts';
import { type CaptureEnv, captureShot, pngPath, type Shot } from './shots/capture.ts';
import { type Change, type CompareDirs, compareShot, type Limits } from './shots/compare.ts';
import {
  changeFindings,
  compareFailureFindings,
  failureFindings,
  missingBaselineFinding,
  motionFinding,
} from './shots/findings.ts';
import { gallery } from './shots/gallery.ts';
import { WEBGL_ARGS } from './shots/page.ts';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const summaryOf = (parts: {
  pages: number;
  sizes: string[];
  changes: number;
  beyond: number;
  missing: number;
  failed: number;
}) => {
  const { pages, sizes, changes, beyond, missing, failed } = parts;
  const scanned = `${pages} pages x ${sizes.length} viewports (${sizes.join(', ')})`;
  const diff = beyond
    ? `${beyond} screenshot(s) changed beyond the allowed diff`
    : `${changes} changed within tolerance`;
  return `${scanned}, ${diff}${missing ? `, ${missing} without baseline` : ''}${
    failed ? `, ${failed} failed` : ''
  }`;
};

export const shots: Audit = {
  name: 'shots',
  description: 'screenshots match the recorded baseline within tolerance',
  async run({ config, root, origin, resolve, pageUrls, launchBrowser, importPeer, log }) {
    const {
      viewports,
      colorSchemes,
      tolerance,
      maxDiff,
      maxDiffPixels,
      deviceScaleFactor,
      antialiasing,
      overrides,
      sample,
      exclude,
      allLocales,
      concurrency,
      updateBaseline,
    } = config.shots;
    const out = resolve(config.outDir, config.shots.outDir);
    const shown = displayPath(root, out);
    const baselineDir = config.shots.baselineDir
      ? resolve(config.shots.baselineDir)
      : join(out, 'baseline');
    const shownBaseline = displayPath(root, baselineDir);
    const currentDir = join(out, 'current');
    const diffDir = join(out, 'diff');
    const motionDir = join(out, 'motion');
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
    const sizes = viewports.map((entry) => ({ ...viewport(entry), deviceScaleFactor }));
    const shotList: Shot[] = sizes.flatMap((size) =>
      colorSchemes.flatMap((scheme) =>
        urls.map((url) => ({
          size,
          url,
          scheme,
          name: `${slug(url, origin)}@${size.width}x${size.height}${scheme === 'dark' ? '.dark' : ''}`,
        })),
      ),
    );

    for (const dir of [currentDir, diffDir, motionDir])
      rmSync(dir, { recursive: true, force: true });
    rmSync(join(out, 'diff.html'), { force: true });
    mkdirSync(currentDir, { recursive: true });

    const limitsFor = ({ url, size }: Shot): Limits => {
      const rule = overrides.find(
        ({ match, viewport }) =>
          (match === undefined || regex(match).test(pathOf(url, origin))) &&
          (viewport === undefined || viewport === size.width),
      );
      return {
        tolerance: rule?.tolerance ?? tolerance,
        maxDiff: rule?.maxDiff ?? maxDiff,
        maxDiffPixels: rule?.maxDiffPixels ?? maxDiffPixels,
      };
    };
    const env: CaptureEnv = { config, currentDir, motionDir, importPeer };
    const dirs: CompareDirs = { baselineDir, currentDir, diffDir };

    const changes: Change[] = [];
    const lines: string[] = [];
    const motionSkipped = new Map<string, string>();
    const missing = new Set<string>();
    const failed = new Map<string, { path: string; error: string }>();
    const diffFailed = new Map<string, string>();
    const invalidMasks = new Set<string>();
    const glFailures = new Map<string, string[]>();

    const browser = await launchBrowser({
      headless: 'shell',
      protocolTimeout: config.shots.protocolTimeout,
      args: WEBGL_ARGS,
    });
    try {
      await inParallelTabs(browser, concurrency, shotList, async (page, shot) => {
        const { name, url } = shot;
        let captured: Awaited<ReturnType<typeof captureShot>>;
        try {
          captured = await captureShot(env, page, shot);
        } catch (error) {
          failed.set(name, { path: pathOf(url, origin), error: errorText(error) });
          lines.push(`${name}.png  failed`);
          return;
        }
        const { note, glFailures: gl, invalidMasks: masks, motionSkipped: skipped } = captured;
        for (const selector of masks) invalidMasks.add(selector);
        if (gl.length) glFailures.set(name, gl);
        if (skipped) motionSkipped.set(name, skipped);
        if (updateBaseline) {
          lines.push(`${name}.png${note}`);
          return;
        }
        if (!existsSync(pngPath(baselineDir, name))) {
          missing.add(name);
          lines.push(`${name}.png  no baseline${note}`);
          return;
        }
        const result = await compareShot(page, name, limitsFor(shot), antialiasing, dirs);
        if (result.kind === 'failed') {
          diffFailed.set(name, result.error);
          lines.push(`${name}.png  failed to compare`);
        } else if (result.kind === 'changed') {
          changes.push(result.change);
          lines.push(`${name}.png  ${result.change.percent}% changed -> diff/${name}.png${note}`);
        } else lines.push(`${name}.png  unchanged${note}`);
      });
    } finally {
      await browser.close();
    }

    lines.sort();
    changes.sort((a, b) => a.name.localeCompare(b.name));
    for (const line of lines) log(line);
    for (const [name, problem] of motionSkipped) log(`motion skipped for ${name}: ${problem}`);
    for (const selector of invalidMasks) log(`shots.mask: "${selector}" is not a valid selector`);
    for (const [name, canvases] of [...glFailures].sort(([a], [b]) => a.localeCompare(b)))
      log(`${name}: no WebGL context for ${canvases.join(', ')}, the shot shows it blank`);

    const failures = failureFindings(failed);

    if (updateBaseline) {
      if (failures.length) {
        return {
          status: 'failed',
          summary: `baseline not updated: ${failures.length} screenshot(s) failed`,
          findings: failures,
        };
      }
      mkdirSync(baselineDir, { recursive: true });
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
    const findings: Finding[] = changeFindings(changes, shown);
    const beyond = findings.length;
    findings.push(...failures);
    if (motionSkipped.size) findings.push(motionFinding(motionSkipped));
    findings.push(...compareFailureFindings(diffFailed, shownBaseline));
    if (missing.size)
      findings.push(
        missingBaselineFinding(
          shotList.map(({ name }) => name).filter((name) => missing.has(name)),
          shotList.length - failed.size,
          shownBaseline,
        ),
      );

    return {
      summary: summaryOf({
        pages: urls.length,
        sizes: sizes.map(({ width, height }) => `${width}x${height}`),
        changes: changes.length,
        beyond,
        missing: missing.size,
        failed: failures.length,
      }),
      findings,
    };
  },
};
