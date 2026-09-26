---
title: Frameworks
description: Build command, distDir, base path and _headers placement for Astro, VitePress, Hugo, Eleventy, Next.js, SvelteKit and Jekyll.
---

# Frameworks

vidimus reads the folder of HTML your generator writes, so the setup per generator comes down
to four questions:

| | Set |
| --- | --- |
| where does the build go? | `distDir` |
| what is the production URL, with any base path? | `siteUrl`, the same value as the generator's own setting |
| where do static files go, for `_headers`? | the generator's public or static folder |
| is there a preview server? | optional: `--origin` to audit it instead of the built-in server |

The `security` audit reads response headers from `_headers` at the root of the build (Netlify
and Cloudflare Pages format, `security.file`). Every generator below copies a static folder
into the build as is; put `_headers` there. The built-in server does not send those headers;
use `server.headers` for headers the browser audits should see.

When the site lives under a path, the generator has to build with that prefix and `siteUrl`
has to include it. See [How it works](./how-it-works#base-paths).

| Generator | Build | `distDir` | Base path setting | Static folder |
| --- | --- | --- | --- | --- |
| Astro | `astro build` | `dist` | `site`, `base` | `public/` |
| VitePress | `vitepress build docs` | `docs/.vitepress/dist` | `base` | `docs/public/` |
| Hugo | `hugo` | `public` | `baseURL` | `static/` |
| Eleventy | `npx @11ty/eleventy` | `_site` | `pathPrefix` | passthrough copy |
| Next.js | `next build` with `output: 'export'` | `out` | `basePath` | `public/` |
| SvelteKit | `vite build` with `adapter-static` | `build` | `kit.paths.base` | `static/` |
| Jekyll | `jekyll build` | `_site` | `url`, `baseurl` | any folder, plus `include` |

## Astro

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://user.github.io',
  base: '/project',
});
```

```ts
// vidimus.config.ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  distDir: 'dist',
  siteUrl: 'https://user.github.io/project',
});
```

- `public/_headers` ends up in `dist/_headers`.
- Hashed assets are written to `_astro/`. A cache header for them on the built-in server:
  `server.headers: [{ match: '/_astro/', headers: { 'cache-control': 'public, max-age=31536000, immutable' } }]`.
  Without `^`, the rule also matches under a base path.
- With Astro's i18n routing and the default locale unprefixed, translations live under
  `/<locale>/`, which is what `locales` and `defaultLocale` expect.
- `astro preview` serves the build on port 4321: `npx vidimus --origin http://localhost:4321/project`.

## VitePress

VitePress builds into `.vitepress/dist` inside the docs folder. Keep the vidimus config next to
it, and `root` becomes the docs folder, as in this repository's own `docs/vidimus.config.json`:

```json
{
  "$schema": "../node_modules/vidimus/schema.json",
  "distDir": ".vitepress/dist",
  "siteUrl": "https://user.github.io/project"
}
```

```sh
npx vitepress build docs && npx vidimus -c docs/vidimus.config.json
```

Or keep it at the project root with `distDir: 'docs/.vitepress/dist'`.

- `base: '/project/'` in `.vitepress/config` sets the base path; `sitemap.hostname` makes
  VitePress write `sitemap.xml`.
- `docs/public/_headers` ends up in the build.
- Pages are written as `guide.html`. With `cleanUrls` they are linked as `/guide`, which the
  built-in server resolves to `guide.html`; your host has to do the same.
- `vitepress preview docs` serves the build on port 4173.

## Hugo

```toml
# hugo.toml
baseURL = 'https://user.github.io/project/'
enableRobotsTXT = true
```

```ts
export default defineConfig({
  distDir: 'public',
  siteUrl: 'https://user.github.io/project',
});
```

- `static/_headers` ends up in `public/_headers`.
- Hugo does not empty `public/` before building, so pages you deleted stay there and are
  audited. Build with `hugo --cleanDestinationDir`, or delete `public/` first.
- Hugo writes `robots.txt` only with `enableRobotsTXT`; the `seo` audit checks it.
- In a multilingual site, the default language is at the root unless
  `defaultContentLanguageInSubdir` is set; set `locales` and `defaultLocale` to the language
  codes used in the paths.
- Audit the built folder, not `hugo server`: the development server renders differently and
  injects its live reload script.

## Eleventy

```ts
// eleventy.config.js
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'src/_headers': '_headers' });
}

export const config = {
  dir: { input: 'src' },
  pathPrefix: '/project/',
};
```

```ts
export default defineConfig({
  distDir: '_site',
  siteUrl: 'https://user.github.io/project',
});
```

- Eleventy only copies files it is told to; the passthrough copy puts `_headers` at the root of
  `_site`.
- `pathPrefix` applies only to URLs passed through the `url` filter or rewritten by the HTML
  `<base>` plugin. A hard-coded `/about/` stays unprefixed and breaks under the base path, and
  `links` reports it.

## Next.js static export

```ts
// next.config.mjs
export default {
  output: 'export',
  basePath: '/project',
  trailingSlash: true,
  images: { unoptimized: true },
};
```

```ts
export default defineConfig({
  distDir: 'out',
  siteUrl: 'https://user.github.io/project',
});
```

- `next build` writes the static site to `out/`, with `public/_headers` copied in.
- `trailingSlash: true` writes `about/index.html`; without it pages are `about.html`. Both are
  served.
- The default image loader needs a server; `images.unoptimized` is required for `next/image`
  in an export.

## SvelteKit with adapter-static

```ts
// svelte.config.js
import adapter from '@sveltejs/adapter-static';

export default {
  kit: {
    adapter: adapter(),
    paths: { base: '/project' },
  },
};
```

```ts
// src/routes/+layout.js
export const prerender = true;
export const trailingSlash = 'always';
```

```ts
export default defineConfig({
  distDir: 'build',
  siteUrl: 'https://user.github.io/project',
});
```

- adapter-static writes to `build/` by default (`pages` option); `static/_headers` is copied in.
- Every route has to be prerendered; `prerender = true` in the root layout does that.
- `trailingSlash = 'always'` writes `about/index.html`, the default `'never'` writes
  `about.html`.
- A `fallback` page for SPA mode is an empty shell without content; add its file to the
  top-level `exclude`, unless it is `404.html`.
- `vite preview` serves the build on port 4173.

## Jekyll

```yaml
# _config.yml
url: https://user.github.io
baseurl: /project
include:
  - _headers
```

```ts
export default defineConfig({
  distDir: '_site',
  siteUrl: 'https://user.github.io/project',
});
```

- `bundle exec jekyll build` writes `_site/`.
- Jekyll skips files whose name starts with `_`; `include` makes it copy `_headers`.
- Links need `relative_url` or `absolute_url` to get the `baseurl` prefix; hard-coded root
  paths break under the base path.
- GitHub Pages does not read `_headers`, so the header checks cannot pass on a site hosted
  there. Set `severity: { security: 'warn' }` to keep the other findings visible without
  failing.

## Plain HTML

Point `distDir` at the folder you publish:

```ts
export default defineConfig({
  distDir: 'site',
  siteUrl: 'https://example.org',
});
```

- Every `**/*.html` under `distDir` is a page. Publishing from the project root
  (`distDir: '.'`) also picks up HTML inside `node_modules/` and vidimus' own reports in
  `.vidimus/`; keep the pages in their own folder, or add `exclude: ['^node_modules/', '^\\.vidimus/']`.
- Put `_headers` in that folder if your host reads it.
- There is no build step, so the `no build output` error means `distDir` points to the wrong
  place.

## Other generators

Anything that writes a folder of HTML works: set `distDir` to that folder and `siteUrl` to the
production URL. If the generator has a preview server that behaves like production, audit it
with `--origin`; otherwise let vidimus serve the folder.
