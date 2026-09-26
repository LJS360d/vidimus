---
title: lighthouse
description: How the lighthouse audit runs Google Lighthouse on your pages, compares category scores with thresholds and saves the reports.
---

# lighthouse: category scores

`lighthouse` runs [Lighthouse](https://developer.chrome.com/docs/lighthouse) on your pages and
fails when a category score drops below its threshold. The other audits check specific,
deterministic rules; Lighthouse adds lab performance metrics and Google's own view of
accessibility, best practices and SEO, with an HTML report per page to dig into. It is not in the
default set.

## Needs

- `lighthouse` 12 or later and `puppeteer`: `npm i -D lighthouse puppeteer`. A missing one ends
  the audit with `!` and the install command.
- A server. vidimus serves `dist/` on `http://localhost:4322` (plus the base path of `siteUrl`)
  unless you pass `--origin` to
  audit a running site.

The audit runs alone, after every other audit in the run has finished, so parallel audits do
not skew the performance measurements.

## Run it

```sh
npx vidimus lighthouse
npx vidimus lighthouse --origin https://preview.example.com
```

## What it checks

### Which pages

1. If `lighthouse.urls` is set, exactly those paths, resolved against the audit origin
   (including its base path).
2. Otherwise every built page in every locale, minus the top-level `exclude` and
   `lighthouse.exclude`.
3. With `lighthouse.all: true`, all of those pages.
4. With `lighthouse.sample` patterns, each pattern keeps only the first page it matches, and
   pages that match no pattern are all kept: add a pattern per template (`'^/blog/.+'`) to
   audit one post instead of all of them.
5. Otherwise, by default, one page per directory: the home page, the first top-level page
   (`/about/`), the first page under `/blog/`, the first under `/docs/`, and so on. Pages in
   the same directory usually share a template, and Lighthouse takes several seconds per page.

Set `urls` when you know exactly which pages matter, `sample` when the directory heuristic
groups pages that use different templates, and `all` to audit everything.

### Scores

Lighthouse runs only the categories named in `lighthouse.thresholds`. For each page and
category, the score (0 to 100) is compared with the threshold multiplied by 100:

- A score below it fails with `<path> <category> <score> (want <min>)`. The detail lists up to
  three failing Lighthouse audits in that category, heaviest weight first, which is where the
  points went.
- A threshold of `0` never fails; the score is still logged.
- On pages Lighthouse reports as not crawlable (`noindex`), the SEO score is not checked and is
  shown as `-`.
- A page Lighthouse cannot load fails with `failed to load <path>` and Lighthouse's error code.
  If no page produces a report at all, the audit fails with `no page produced a report`.

Every page's scores are printed in the log, and its HTML report is written to
`.vidimus/lighthouse/<page>.html`, where `<page>` is the path with `/` replaced by `_`
(`index` for the home page). Open the report for the full list of opportunities and
diagnostics.

Scores measured against the local static server reflect your build on your machine, not your
production CDN. They vary between runs and machines, especially performance; leave headroom in
CI or audit a deployed preview with `--origin`.

## Example output

```
─── lighthouse ──────────────────────────────────────────────────

index  performance 98  accessibility 100  best-practices 100  seo 100
blog  performance 94  accessibility 100  best-practices 100  seo 100
blog_hello-world  performance 71  accessibility 96  best-practices 100  seo 100
search (noindex)  performance 92  accessibility 100  best-practices 100  seo -

✖ /blog/hello-world/ performance 71 (want 90)
    Largest Contentful Paint
    Total Blocking Time
    Cumulative Layout Shift
    on: /blog/hello-world/
    → Open .vidimus/lighthouse/blog_hello-world.html and fix the audits listed first, or lower lighthouse.thresholds.performance if the target is too strict.

✖ /blog/hello-world/ accessibility 96 (want 100)
    Image elements do not have `[alt]` attributes
    on: /blog/hello-world/
    → Open .vidimus/lighthouse/blog_hello-world.html and fix the audits listed first, or lower lighthouse.thresholds.accessibility if the target is too strict.

✖ lighthouse: 2 problem(s) across 4 pages, reports in .vidimus/lighthouse/ (41.8s)
```

A clean run ends with `✔ lighthouse: 4 pages meet every threshold, reports in .vidimus/lighthouse/`.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `lighthouse.thresholds` | `{ performance: 0.9, accessibility: 1, 'best-practices': 0.9, seo: 1 }` | minimum score per category, 0 to 1 |
| `lighthouse.sample` | `[]` | URL path patterns: audit only the first page matching each, and every page that matches none |
| `lighthouse.all` | `false` | audit every page, ignoring `sample` and the one-per-directory default |
| `lighthouse.urls` | `[]` | fixed list of paths to audit instead of the built pages |
| `lighthouse.exclude` | `[]` | URL path patterns to skip |
| `lighthouse.outDir` | `'lighthouse'` | report folder inside the top-level `outDir` (`.vidimus`) |

Objects merge deeply, so setting one threshold keeps the others. Setting a category to `0`
stops it from failing but Lighthouse still runs it.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'lighthouse'],
  lighthouse: {
    sample: ['^/blog/.+', '^/docs/.+'],
    thresholds: { performance: 0.8, seo: 0.9 },
  },
});
```

Override a threshold for one run, or in CI:

```sh
npx vidimus lighthouse --set lighthouse.thresholds.performance=0.75
VIDIMUS_LIGHTHOUSE__THRESHOLDS__BEST_PRACTICES=0.8 npx vidimus lighthouse
```

Audit a fixed set of paths:

```ts
lighthouse: { urls: ['/', '/pricing/', '/blog/hello-world/'] }
```

## Common fixes

- **Performance**: the detail names the metrics that cost the most. For Largest Contentful Paint,
  preload or inline the hero image and give it `fetchpriority="high"`; for Cumulative Layout
  Shift, add `width` and `height` to images (the [budget](./budget) audit finds the ones
  without); for Total Blocking Time, split or defer the scripts `budget` lists as largest.

```html
<img src="/img/hero.avif" alt="" width="1600" height="900" fetchpriority="high">
```

- **Accessibility**: Lighthouse runs a subset of axe rules. The [a11y](./a11y) audit runs pa11y
  against WCAG and names the element; fix there first.
- **Best practices**: usually console errors, deprecated APIs, or images served at the wrong
  aspect ratio or resolution. The report lists the exact resource.
- **SEO**: missing descriptions, `lang`, or link text. The [seo](./seo) audit checks these
  site-wide without a browser.

Lighthouse needs Chrome. vidimus launches it through puppeteer, with `browser.args` and
`browser.executablePath` from the config; see [Troubleshooting](../troubleshooting) for
sandboxed CI runners.
