---
title: Frameworks
description: distDir, base path and _headers per generator, from Astro to Jekyll, and the setup for client-rendered React, Angular, Vue and SvelteKit apps.
---

# Frameworks

vidimus reads the folder of HTML your generator writes, so the setup per generator comes down
to four questions:

| | Set |
| --- | --- |
| where does the build go? | `distDir` |
| what is the production URL, with any base path? | `siteUrl`, the same value as the generator's own setting |
| where do static files go, for `_headers`? | the generator's public or static folder |
| how does the host serve it? | optional: `server.command` to serve it with the host's tool, see [Serving the build](./serving) |

The `security` audit reads response headers from `_headers` at the root of the build (Netlify
and Cloudflare Pages format, `security.file`). Every generator below copies a static folder
into the build as is; put `_headers` there. The built-in server does not send those headers;
use `server.headers` for headers the browser audits should see, or serve the build with
`wrangler pages dev` or `netlify dev` through [`server.command`](./serving), which do.

When the site lives under a path, the generator has to build with that prefix and `siteUrl`
has to include it. See [How it works](./how-it-works#base-paths).

A single-page app with client-side routing (React Router, Angular Router, Vue Router) builds
one `index.html` and relies on the host to answer deep URLs with it. See
[Client-rendered apps](#client-rendered-apps) below.

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
  top-level `exclude`, unless it is `404.html`. Point `server.fallback` at it so routes that
  are not prerendered load it, as they do on the host.
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

## Client-rendered apps

A React, Angular, Vue or Solid app built without prerendering is one `index.html`, an empty
`<div id="root">`, and scripts. Three settings make vidimus audit it like the site it becomes
in the browser:

- `server.fallback`: answer every page path with `index.html`, as the host does.
- `routes`: the pages to audit, since the build has only one file. List them, read them from a
  sitemap, or crawl the rendered links.
- `render`: read the rendered DOM in the `dist` audits and in `links`, and wait for the app in
  every browser audit.

```ts
export default defineConfig({
  distDir: 'dist',
  siteUrl: 'https://example.com',
  server: { fallback: 'index.html' },
  routes: { discover: 'crawl' },
  render: { mode: 'on', waitFor: '#root > *' },
  links: { notFound: { selector: '[data-page="not-found"]' } },
});
```

`render.waitFor` is a CSS selector that exists once the app has rendered, `'networkidle'` for
apps that fetch before they render, or a number of milliseconds. `links.notFound` identifies the
app's own not-found view, which the fallback answers with `200`. See
[How it works](./how-it-works#client-rendered-sites) for what each audit then reads.

### React with Vite

- `vite build` writes `dist/`; with a base path, build with `--base /project/` and set `siteUrl`
  with the same path.
- React Router's `createBrowserRouter` needs the fallback. `createHashRouter` does not, but its
  routes all share one URL, so the server audits see only the first; `links.notFound` still opens
  every `#/` link.
- React 19 hoists `<title>`, `<meta>` and `<link>` rendered in a component into `<head>`, so
  `seo` sees one title per route with `render` on.
- `public/_headers` is copied into `dist/`.

### Angular

- `ng build` writes `dist/<project>/browser/`; set `outputPath` to `{ "base": "dist", "browser":
  "" }` in `angular.json` to drop the `browser/` level, or point `distDir` at it.
- `--base-href /project/` for a base path, with `siteUrl` to match.
- Keep SSR and prerendering off if you want the pure client-rendered build; turn on
  `outputMode: "static"` with prerendered routes to get HTML per route instead, and drop
  `server.fallback` and `routes`.
- Component styles are inserted as `<style>` elements at runtime. With a strict CSP they are
  blocked, and `csp` with `render` on reports each of them. Keep styles in the global
  stylesheet, or allow them with `autoCsp` and a nonce from a server. Also turn off
  `inlineCritical`: it adds an inline `<style>` and an `onload` handler to `index.html`.
- `Title` and `Meta` set the head per route; `seo` reads them with `render` on.

### Vue with Vite

- `vite build` writes `dist/`; `base` in `vite.config.ts` sets the base path.
- Vue Router's `createWebHistory` needs the fallback; `createWebHashHistory` does not, with the
  same limits as a hash router in React.
- `@unhead/vue` sets titles and meta tags at runtime, visible with `render` on.

### SvelteKit SPA mode

- adapter-static with `fallback: '200.html'` (or `'index.html'`) and no prerendered routes.
- Set `server.fallback` to the same file, and exclude it from the page list when it is not
  `index.html`: `exclude: ['^200\\.html$']`.
- With some routes prerendered and the rest client-rendered, the prerendered ones are files and
  need no `routes` entry; list or crawl the others.

### Hosts

The fallback in vidimus stands in for the host's rewrite. Match what yours does:

| Host | Rewrite | `server.fallbackStatus` |
| --- | --- | --- |
| Netlify | `/* /index.html 200` in `_redirects` | `200` |
| Vercel | `"rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]` in `vercel.json` | `200` |
| Cloudflare Pages | automatic when there is no `404.html` | `200` |
| GitHub Pages | none: deep links get `404.html`, with a `404` status | `404`, with `server.fallback: '404.html'` |

On GitHub Pages, deep links need a file: copy `index.html` to every route (`about.html`,
`docs/index.html`) after the build, and each is served with a `200`. The other workaround, a
`404.html` that redirects into the app, leaves a `404` status on every deep link for search
engines and link checkers, and for vidimus with `fallbackStatus: 404`.

### Prerender if you can

vidimus renders your app before auditing it; many crawlers, link previews and feed readers do
not, and see the empty shell. A green `seo` run on a client-rendered app says the titles and
descriptions are right once JavaScript has run, not that search engines will read them.
Prerendering at build time gives every route its own HTML file, which vidimus, and everyone
else, reads without a browser: `vite-ssg` or Vike for Vite apps, Angular's
`outputMode: "static"`, SvelteKit's `prerender = true`, React Router's `prerender` option.

The React and Angular flavors of these docs are client-rendered on purpose, audited in the same
run as the others; see [Eight flavors](./flavors).

## Other generators

Anything that writes a folder of HTML works: set `distDir` to that folder and `siteUrl` to the
production URL. If the generator has a preview server that behaves like production, audit it
with `--origin`; otherwise let vidimus serve the folder.
