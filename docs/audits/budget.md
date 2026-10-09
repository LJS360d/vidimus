---
title: budget
description: How the budget audit measures page weight, image size and format, and missing image dimensions against per-page limits.
---

# budget: page weight and images

`budget` adds up what each built page references and fails when a page, its HTML, CSS or
JavaScript, or a single image grows past a limit. It also warns about large PNG, JPEG and GIF
files served without a modern alternative, and about images without dimensions that shift the
layout while they load. Weight creeps up one dependency or hero image at a time; a budget in CI
catches the commit that crosses the line. It is not in the default set.

## Needs

Nothing to install. It reads the build (`dist/`) and starts no server or browser, so it
measures files, not network transfers.

## Run it

```sh
npx vidimus budget
```

## What it checks

Pages matched by the top-level `exclude` or `budget.exclude` are skipped.

### What counts

Only files in the build count; URLs on other origins are ignored, and absolute URLs on
`siteUrl` are resolved to the build. Each file counts once per page, however often the page
references it. SVG, JSON, XML, text and WebAssembly files are measured gzipped, as servers
compress them (set `budget.compression` to `brotli` or `none` to change that); a `.br` or `.gz` file next to the asset in the build, such as `app.js.br`, is used instead and counts by its size on disk; other files (PNG, JPEG, WebP, AVIF, GIF, fonts, video, audio) are measured raw.

| Kind | Files | Measured |
| --- | --- | --- |
| `html` | the page itself | gzipped |
| `css` | `<link rel="stylesheet">` | gzipped |
| `js` | `<script src>` and `<link rel="modulepreload">` | gzipped |
| images | one per `<img>`: its `src`, else its first `srcset` candidate | gzipped for SVG, raw bytes otherwise |
| `page` | all of the above | sum of the sizes above |

Not counted: iframes and what they load (Lighthouse counts them), CSS background images, `<video>`/`<audio>` sources, and anything a script
or stylesheet loads, unless [`render.mode`](../how-it-works#client-rendered-sites) is on. With
rendering, `html` is still the shipped file, and the other kinds are the build files the browser
requested while rendering: stylesheets, scripts (lazy chunks included) and images by request
type, while fonts, media and `fetch` requests (models, data) count toward `page` only. In static mode fonts count toward `page` only (raw bytes): `<link rel="preload" as="font">` and `url()` in `@font-face` rules of linked stylesheets, resolved against the build directory. Each `<img>`, including the fallback of a `<picture>`, counts once, so `<source>` and `srcset` variants add nothing to the page total.

### Checks

- **Per-page budgets** (`budget.html`, `budget.css`, `budget.js`, `budget.page`): a page over a
  limit fails with `<kind> <size> gzipped > <limit> budget` (or `total` for `page`), listing the
  three largest files of that kind as detail.
- **Image size** (`budget.image`): any referenced image over the limit fails with
  `image <path> <size> > <limit> budget`, once per image, listing every page that uses it.
- **Legacy formats** (`budget.legacyImage`): an `<img>` whose `src` or `srcset` has a `.png`,
  `.jpg`, `.jpeg` or `.gif` file larger than the limit warns with
  `image <path> is <size>: serve AVIF or WebP`, unless the `<img>` sits inside a `<picture>` with
  a `<source>` that has `type="image/avif"` or `type="image/webp"`, or `.avif` or `.webp` files
  in its `srcset`.
- **Dimensions** (`budget.dimensions`): an `<img>` without both `width` and `height` warns with
  `<img src="…"> has no width and height (layout shift)`. Images with a `data:` URL and images
  with `aspect-ratio` in their inline `style` are exempt. When vidimus can read the image's
  intrinsic size (PNG, JPEG, GIF, WebP, AVIF, and SVG with `width`/`height` or `viewBox`), the
  fix includes the exact attributes to add.

- **Request counts** (`budget.requests`, `budget.thirdParty`): with
  [`render.mode`](../how-it-works#client-rendered-sites) on, a page that makes more `http(s)` requests
  than the limit, or more requests to origins other than the site's, fails. Static mode has no
  requests to count, so both are skipped. Request sizes are unknown, so there is no third-party byte
  limit.

- **Per-route limits** (`budget.routes`): a map of page-path pattern to limits (`html`, `css`, `js`,
  `image`, `page`, `requests`, `thirdParty`) that replace the global ones for matching pages. The first matching pattern wins;
  other pages keep the global limits.

```ts
budget: { routes: { '^/docs/': { page: 4_000_000 }, '^/$': { js: 100_000 } } }
```

Sizes are shown in decimal units: `B` below 1000 bytes, `kB`, then `MB`. A limit of `0` turns
that check off. The summary names the heaviest page.

## Example output

```
─── budget ──────────────────────────────────────────────────────

✖ js 312 kB gzipped > 250 kB budget
    188 kB /_astro/charts.B3kx9.js
    96 kB /_astro/client.Dq1fa.js
    28 kB /_astro/page.Ce72b.js
    in: dist/dashboard/index.html
    on: /dashboard/
    → Split or lazy-load the largest scripts listed above, drop unused dependencies, or raise budget.js.

✖ image /img/team.jpg 1.4 MB > 500 kB budget
    in: dist/img/team.jpg
    on: /about/ /it/chi-siamo/
    → Resize/compress it (e.g. with sharp or squoosh) and serve AVIF/WebP, or raise budget.image.

⚠ image /img/team.jpg is 1.4 MB: serve AVIF or WebP
    in: dist/img/team.jpg
    on: /about/ /it/chi-siamo/
    → Add a <picture> with a <source type="image/avif"> or <source type="image/webp"> before this <img>.

⚠ <img src="/img/logo.png"> has no width and height (layout shift)
    on: / /about/ /blog/ +12 more
    → Add width and height attributes matching the image's intrinsic size, e.g. width="240" height="64" (CSS can still resize it).

✖ budget: 15 page(s), heaviest /about/ 1.6 MB, 4 problem(s) (0.2s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `budget.compression` | `gzip` | `gzip`, `brotli` or `none`: how text files are compressed before measuring |
| `budget.html` | `100_000` | max gzipped bytes of a page's HTML |
| `budget.css` | `100_000` | max gzipped bytes of a page's stylesheets |
| `budget.js` | `250_000` | max gzipped bytes of a page's scripts, including `modulepreload` |
| `budget.page` | `2_000_000` | max total bytes per page |
| `budget.requests` | `0` | max network requests per page; rendered pages only |
| `budget.thirdParty` | `0` | max requests per page to origins other than the site's; rendered pages only |
| `budget.image` | `500_000` | max bytes of any image in `<img>`, `srcset` or `<source>` |
| `budget.legacyImage` | `100_000` | warn when a PNG/JPEG/GIF this large has no AVIF/WebP `<source>` |
| `budget.dimensions` | `true` | warn on `<img>` without `width` and `height` |
| `budget.exclude` | `[]` | URL path patterns to skip |

`0` turns any of the byte limits off.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'budget'],
  budget: {
    js: 150_000,
    page: 1_000_000,
    legacyImage: 0,
    exclude: ['^/playground/'],
  },
});
```

From the command line: `npx vidimus budget --set budget.js=150000`.

## Common fixes

Add the intrinsic size to every `<img>`. The browser reserves the space from the ratio, and CSS
can still scale it:

```html
<img src="/img/logo.png" alt="Example" width="240" height="64">
```

```css
img {
  max-width: 100%;
  height: auto;
}
```

When the size is not known at build time (images from a CMS), set a ratio instead:

```html
<img src="/uploads/cover.jpg" alt="" style="aspect-ratio: 16 / 9; width: 100%">
```

Serve a modern format with a fallback. `budget` is satisfied as soon as the `<picture>` has an
AVIF or WebP `<source>`:

```html
<picture>
  <source type="image/avif" srcset="/img/team.avif">
  <source type="image/webp" srcset="/img/team.webp">
  <img src="/img/team.jpg" alt="The team" width="1600" height="900">
</picture>
```

Most frameworks generate this for you: `<Picture>` in `astro:assets`, `@11ty/eleventy-img`,
Hugo image processing. Convert existing files with sharp:

```sh
node -e "require('sharp')('public/img/team.jpg').avif().toFile('public/img/team.avif')"
```

For JavaScript over budget, the three largest files in the finding are where to start: import
heavy libraries (charts, editors, maps) dynamically on the pages that need them, and check for
duplicates of the same dependency. For HTML over budget, look for inlined SVG sprites, large
inline JSON (hydration state) and long lists that could be paginated.
