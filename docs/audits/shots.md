---
title: shots
description: The shots audit takes full-page screenshots at several viewports and compares them pixel by pixel with a recorded baseline.
---

# shots: visual regression

`shots` takes a full-page screenshot of each page at each viewport and compares it with the screenshot recorded last time you accepted the site's look. A CSS change that shifts a layout on a page you did not open, a font that stopped loading, an image that went missing: they show up as a percentage of changed pixels and a diff image, before the change is published.

It can also record the page's animations as GIFs, so you can review motion without opening a browser.

## Needs

```sh
npm i -D puppeteer
npm i -D sharp    # only to write motion GIFs
```

The audit loads pages over HTTP (`requires: 'server'`): vidimus serves the build locally, or uses `--origin`. `sharp` is loaded only when a page actually animates; set `shots.motion` to `false` to never need it. The audit is not in the default set.

## Run it

Record a baseline first, then compare against it:

```sh
npx vidimus shots --update-baseline   # record the current screenshots as the baseline
npx vidimus shots                     # compare with the baseline
```

`--update-baseline` is the same as `--set shots.updateBaseline=true`.

## What it checks

### Which pages

Every built page that is not excluded, in the default locale unless `shots.allLocales` or the top-level `allLocales` (`--all-locales`) is `true`. With `shots.sample`, pages whose URL path matches a pattern are reduced to the first matching page per pattern; pages that match no pattern are all captured. On a large site, sample every repeating template:

```ts
shots: { sample: ['^/blog/[^/]+/$', '^/tags/[^/]+/$', '^/docs/.+'] }
```

### Capturing

For each page and each entry in `shots.viewports`, vidimus:

1. sets the viewport (a number is a width with a height of 800px; widths below 768px are emulated as a mobile device with touch),
2. turns on `prefers-reduced-motion: reduce`, so sites that respect it render without animation,
3. loads the page (ready at [`render.waitFor`](../how-it-works#client-rendered-sites), the `load` event by default), forces lazy images to load, and waits for web fonts and images up to `shots.settleTimeout`,
4. with `shots.freeze`, waits for animation-frame loops to stop and stills videos and endless CSS animations, see [Canvas, WebGL, video, gifs and embeds](#canvas-webgl-video-gifs-and-embeds),
5. masks `shots.mask` elements and, with `shots.maskEmbeds`, cross-origin iframes,
6. takes a full-page PNG screenshot into `.vidimus/shots/current/`.

A screenshot that fails (the page does not load, or the browser times out) is a failing finding, `failed to capture <name>`, with the browser error as detail; the other screenshots are still taken.

Screenshots are named after the URL path and viewport: `index@375x667.png`, `blog_first-post@1280x800.png`.

### Comparing

Each current screenshot is compared with the file of the same name in the baseline directory, `.vidimus/shots/baseline/` unless `shots.baselineDir` is set. A pixel counts as changed when any colour channel or alpha differs by more than `shots.tolerance` (0 to 255). When the two images differ in size, the comparison covers the larger of both, so a page that grew taller counts the new area as changed.

- No changed pixels: the screenshot is logged as `unchanged`.
- Some changed pixels: a diff image is written to `.vidimus/shots/diff/`, with changed pixels in red over a faded grey copy of the current screenshot, and the page is added to the side-by-side gallery `.vidimus/shots/diff.html` (baseline, current, diff).
- More than `shots.maxDiff` of the pixels changed (default `0.002`, which is 0.2%): the screenshot is a failing finding.

Screenshots with no baseline, such as new pages, are listed as `no baseline` and reported as a warning (`2 screenshot(s) have no baseline`). With no baseline at all nothing was compared, and the audit fails (`no baseline in .vidimus/shots/baseline: nothing was compared`): record one with `--update-baseline`. In CI, see [Sharing the baseline](#sharing-the-baseline).

`--update-baseline` skips the comparison, deletes the PNG files in the baseline directory and copies the current screenshots in, so baselines of pages that no longer exist are removed. Other files in that directory are left alone. If any screenshot fails, the baseline is left as it was.

### Sharing the baseline

By default the baseline lives inside `.vidimus/`, which ignores itself with its own `.gitignore`, so it stays on the machine that recorded it. To compare in CI, either:

- restore `.vidimus/shots/baseline/` from a cache or artifact of an earlier run (see [CI](../ci)), or
- commit it: point `shots.baselineDir` at a directory outside `.vidimus/`, such as `'shots-baseline'` (relative to `root`), and commit that directory after `--update-baseline`.

### Motion

Unless `shots.motion` is `false`, each page is then reloaded with reduced motion off. Animations that repeat forever are paused, and vidimus takes a viewport screenshot every `motion.interval` ms until `motion.stableFrames` consecutive frames are identical or `motion.maxFrames` frames were taken. If anything moved, the frames are written as `.vidimus/shots/motion/<name>.gif` with their real timing, and the log line notes the frame count, or `(never settled)` when it hit `maxFrames`, naming up to three elements that were still moving when it can tell: `(never settled: canvas#scene animates)`. Freezing does not apply to this pass; masks do. Motion GIFs are for review only; they are not compared with anything.

### Canvas, WebGL, video, gifs and embeds

Pages that keep changing on their own would diff on every run. Four things keep the main screenshot stable:

- **Reduced motion.** The main screenshot is taken with `prefers-reduced-motion: reduce`. A scene that honours it, by rendering one frame instead of starting its loop, is stable without anything else; this is the best fix when you own the code.
- **`shots.freeze`** (default `true`) runs a script before the page's own scripts. It seeds `Math.random`, replaces `performance.now()` and the `requestAnimationFrame` timestamps with a virtual clock that advances 1/60 s per frame, and stops calling `requestAnimationFrame` callbacks after 30 frames. A three.js or canvas scene that animates by time or by random numbers then stops on the same frame every run. Before the screenshot, videos are paused at their first frame and CSS animations that repeat forever are paused at their start. This is best effort: `Date.now()`, timers, workers, WebAssembly and anything streamed from the network are not controlled.
- **`shots.mask`** is a list of CSS selectors, painted flat black in place before the screenshot, the same in the baseline and the current screenshot, so they never diff. Use it for maps, ads, live counters, GIFs and anything else freezing cannot reach. An invalid selector is logged and skipped.
- **`shots.maskEmbeds`** (default `true`) masks every `<iframe>` whose `src` is on another origin (YouTube, maps, CodePen): they load late and change content. Same-origin iframes are captured.

WebGL in headless Chrome renders in software. vidimus starts the `shots` browser with `--use-angle=swiftshader --enable-unsafe-swiftshader`, so WebGL works the same way on every machine and in CI, though not pixel-identical to a real GPU: record the baseline on the same kind of machine that compares it, and raise `shots.tolerance` if antialiasing still differs. A canvas whose WebGL context could not be created is logged, `index@1280x800: no WebGL context for canvas#scene, the shot shows it blank`, instead of silently comparing an empty box.

```ts
export default defineConfig({
  shots: { mask: ['.map', '[data-live]', 'img[src$=".gif"]'] },
});
```

## Example output

```
─── shots ───────────────────────────────────────────────────────

about@1280x800.png  unchanged
about@375x667.png  unchanged
blog@1280x800.png  0.08% changed -> diff/blog@1280x800.png
index@1280x800.png  4.61% changed -> diff/index@1280x800.png  23 frames -> motion/index@1280x800.gif
index@375x667.png  3.92% changed -> diff/index@375x667.png  23 frames -> motion/index@375x667.gif
pricing@1280x800.png  no baseline
pricing@375x667.png  no baseline
side-by-side gallery at .vidimus/shots/diff.html

✖ index@1280x800: 4.61% changed > 0.20% allowed
    .vidimus/shots/diff/index@1280x800.png
    → Open .vidimus/shots/diff.html to review; if the change is intended, run vidimus shots --update-baseline.

✖ index@375x667: 3.92% changed > 0.20% allowed
    .vidimus/shots/diff/index@375x667.png
    → Open .vidimus/shots/diff.html to review; if the change is intended, run vidimus shots --update-baseline.

⚠ 2 screenshot(s) have no baseline
    pricing@1280x800.png
    pricing@375x667.png
    → Run vidimus shots --update-baseline, or add the new pages to shots.exclude.

✖ shots: 4 pages x 2 viewports (375x667, 1280x800), 2 screenshot(s) changed beyond the allowed diff, 2 without baseline (31.5s)
```

`blog@1280x800` changed by less than `maxDiff`, so it is in the gallery but not a finding. A passing run, and a baseline update:

```
✔ shots: 4 pages x 2 viewports (375x667, 1280x800), 1 changed within tolerance (28.0s)
✔ shots: baseline updated from 8 screenshots in .vidimus/shots/baseline (27.4s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `shots.viewports` | `[{ width: 375, height: 667 }, 1280]` | a width in px (height 800) or `{ width, height }` |
| `shots.sample` | `[]` | URL path patterns: screenshot one page per matching template |
| `shots.allLocales` | `false` | also capture pages of translated locales |
| `shots.tolerance` | `12` | per-channel colour difference (0 to 255) a pixel may have and still count as unchanged |
| `shots.maxDiff` | `0.002` | share of changed pixels allowed before a screenshot fails |
| `shots.freeze` | `true` | stop animation-frame loops, seed `Math.random`, still videos and endless CSS animations before the screenshot |
| `shots.mask` | `[]` | CSS selectors painted flat black before the screenshot |
| `shots.maskEmbeds` | `true` | also mask cross-origin iframes |
| `shots.motion` | `{ interval: 100, stableFrames: 5, maxFrames: 60 }` | record animations as GIFs, `false` to skip |
| `shots.settleTimeout` | `10000` | ms to wait for fonts and images before the screenshot |
| `shots.protocolTimeout` | `600000` | ms the browser may take for one operation, such as a very tall screenshot |
| `shots.concurrency` | half the cores (2 to 8) | browser tabs used at the same time |
| `shots.outDir` | `'shots'` | directory inside `outDir` (default `.vidimus`) |
| `shots.baselineDir` | `''` | baseline directory relative to `root`; empty means `baseline` inside `shots.outDir` |
| `shots.updateBaseline` | `false` | record instead of compare; set by `--update-baseline` |
| `shots.exclude` | `[]` | URL path patterns to skip |

## Config example

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'shots'],
  shots: {
    viewports: [{ width: 375, height: 667 }, 768, 1440],
    sample: ['^/blog/[^/]+/$'],
    exclude: ['^/changelog/'],
    maxDiff: 0.005,
    motion: false,
  },
});
```

## Tips

- Screenshots depend on the fonts and rendering of the machine that takes them. Record the baseline on the same kind of machine that compares it, for example in the same CI container, or anti-aliasing differences alone can exceed `maxDiff`.
- Content that changes on every build (dates, random images, a "latest posts" list) changes pixels too. Exclude those pages, sample a stable page of the template, or raise `maxDiff` for the whole audit.
- The gallery `diff.html` references the PNGs by relative path, so keep the `current` and `diff` directories next to it, and the baseline directory where it was, when you upload it as a CI artifact.
