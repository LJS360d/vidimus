---
title: How it works
description: The run pipeline from config to exit code, how the build is served under a base path, and which pages each audit sees.
---

# How it works

A run goes through the same steps every time:

1. Load and merge the config from its sources.
2. Select the audits to run.
3. Serve the build locally, or use the server given by `--origin`.
4. Run the audits, each one reading the source, the build or the server.
5. Filter each audit's findings through `ignore` and the findings baseline, then apply
   `severity` and `--strict`.
6. Hand every result to the reporters.
7. Exit with `0`, `1` or `2`.

## Config

The config is built from defaults, one config file, `VIDIMUS_*` environment variables,
`--set` and CLI flags, in that order of precedence. Objects merge deeply and arrays replace.
The details are in [Configuration](./configuration).

Paths resolve from `root`. `root` defaults to the directory of the config file, or the working
directory when there is none, so `npx vidimus -c docs/vidimus.config.json` with
`"distDir": ".vitepress/dist"` reads `docs/.vitepress/dist`. A relative `root` in a config file
resolves from the config file's directory; `--root`, `--set root=` and `VIDIMUS_ROOT` resolve
from the working directory. `distDir`, `outDir`, `baseline.file` and `i18n.files` are relative
to `root`. Reporter file targets (`-r junit:reports/vidimus.xml`) are relative to the working
directory.

`npx vidimus config` prints the result, with the file it came from on stderr.

## Selecting audits

| Command | Runs |
| --- | --- |
| `npx vidimus` | the `audits` list, minus audits with `severity: 'off'` |
| `npx vidimus all` | every built-in and plugin audit, minus audits with `severity: 'off'` |
| `npx vidimus seo budget` | exactly those, whatever their severity |

The default `audits` list is `i18n`, `csp`, `a11y`, `links` and `r12s`. An unknown name is a
usage error that lists the known ones. Plugin audits from `plugins` join the registry next to
the built-in ones; a plugin with a built-in's name replaces it.

## What each audit reads

Every audit declares what it `requires`:

| `requires` | Needs | Built-in audits |
| --- | --- | --- |
| `source` | the project only, no build | `i18n` |
| `dist` | the build output in `distDir` | `csp`, `seo`, `security`, `html`, `budget`, `assets` |
| `server` (the default) | the build over HTTP | `a11y`, `links`, `r12s`, `privacy`, `shots`, `lighthouse` |

If any selected audit needs `dist` or `server` and `distDir` does not exist, the run stops
before any audit starts:

```
vidimus: no build output at /path/to/site/dist. Run the build first.
```

Server audits need the build too, even with `--origin`: the list of pages to open comes from
the HTML files in `distDir`, plus any [`routes`](#client-rendered-routes).

Audits run concurrently. Audits marked `exclusive` (the built-in `lighthouse`) run afterwards,
one at a time, so their measurements are not disturbed by the others.

## Serving the build

When at least one selected audit requires `server` and no `origin` is set, vidimus starts a
static server on `127.0.0.1` at `port` (default `4322`) and stops it at the end of the run. The
audit origin is `http://localhost:<port>` followed by the base path of `siteUrl`.

The server:

- maps `/about/` to `about/index.html`, and `/about` to `about`, `about/index.html` or
  `about.html`, whichever exists
- answers anything else with a plain `404 Not found`, unless `server.fallback` is set
- sets `content-type` from the file extension and gzips text, JSON, XML, SVG and manifests when
  the client accepts it (`server.gzip`)
- adds the headers of every `server.headers` rule whose `match` regex matches the request path

`server.fallback` names a build file, relative to `distDir`, that answers page requests no
file matches: paths without an extension, or requests that accept `text/html`. Missing assets
such as `/assets/app.js` still get a `404`. Set it to match your host:

| Host | `server.fallback` | `server.fallbackStatus` |
| --- | --- | --- |
| Netlify, Vercel, Cloudflare Pages rewrite to `index.html` | `'index.html'` | `200` |
| GitHub Pages | `'404.html'` | `404` |

A `404` status is what `links` and the Lighthouse SEO check see, so keep it when the host sends
it.

`server.headers` is the only source of response headers. The server does not read `_headers`;
that file is read by the [`security` audit](./audits/security).

```ts
export default defineConfig({
  server: {
    headers: [{ match: '/_astro/', headers: { 'cache-control': 'public, max-age=31536000, immutable' } }],
  },
});
```

With `--origin <url>` no server is started. Server audits open pages under that origin
instead, which can be a preview server (`astro preview`, `vite preview`) or the deployed site.
The `security` audit then fetches the headers of every page from the origin instead of reading
`_headers`.

## Base paths

A site published under a path, such as a GitHub Pages project site at
`https://user.github.io/project/`, links to `/project/about/` and loads `/project/assets/…`.
Set the path in `siteUrl`:

```ts
export default defineConfig({ siteUrl: 'https://user.github.io/project' });
```

Then:

- the audit origin becomes `http://localhost:4322/project`, and pages are opened there
- the server answers both `/project/about/` and `/about/`, so a build written with the prefix
  and a build written without it both load
- absolute links to `https://user.github.io/project/…` are rewritten onto the audit origin by
  the `links` audit, so they are checked against the build instead of the live site
- URL path patterns (`exclude`, `sample`, `allowNoindex`) and the paths in findings are
  written without the base path: `/about/`, not `/project/about/`

`server.headers` rules match the full request path, base path included: `^/_astro/` does not
match `/project/_astro/app.js`; `/_astro/` does.

With `--origin`, give the base path as part of the URL: `--origin http://localhost:4173/project`.

## Which pages are audited

The page list is every `**/*.html` file in `distDir`, sorted, minus files matching the
top-level `exclude`. `exclude` matches built file paths relative to `distDir`
(`admin/index.html`), so `^admin/` drops the whole section. `about/index.html` becomes the URL
`<origin>/about/`, and `about.html` becomes `<origin>/about.html`.

When `distDir` has no HTML file left, the server audits error with
`<dist> has no HTML pages. Rebuild.` and the `dist` audits are skipped.

### Client-rendered routes

A single-page app builds one `index.html` and renders its routes in the browser, so the page
list above has one entry and every server audit checks the home route only. `routes` adds the
other routes to the list of the server audits (`a11y`, `links`, `r12s`, `privacy`, `shots`,
`lighthouse`); the `dist` audits keep reading files.

```ts
export default defineConfig({
  server: { fallback: 'index.html' },
  routes: { paths: ['/pricing', '/docs/seo'], discover: 'sitemap' },
});
```

- `routes.paths` lists paths relative to the `siteUrl` base path, each starting with `/`.
- `routes.discover: 'sitemap'` adds the URLs of `sitemap.xml`, `sitemap-index.xml` or
  `sitemap_index.xml` in `distDir`, following sitemap indexes. URLs on another origin than
  `siteUrl` are skipped.
- `routes.discover: 'crawl'` opens the built pages and `routes.paths` in the browser, waits for
  `render.waitFor`, and follows same-origin `<a href>` links in the rendered DOM, breadth
  first, until `routes.limit` new routes are found. Links to files with an extension other
  than `.html` are not routes.

A route that matches a built file is already in the list and is dropped. The rest have no
file, so the built-in server answers them through
[`server.fallback`](#serving-the-build); without it, the run stops:

```
vidimus: routes /pricing /docs/seo have no file in dist; set server.fallback (e.g. 'index.html') so the built-in server answers them, or drop them from routes
```

The top-level `exclude` and the locale rules below apply to routes as to built pages, with the
route path minus its leading `/` in place of the file path, and so do per-audit `exclude` and
`sample`.

When no `routes` are set and `distDir` has one HTML page (not counting `404.html`) next to a
script of 100 kB or more, the pretty reporter prints a note at the start:

```
vidimus: dist has one HTML page and a 412 kB script: looks like a client-rendered app; set routes.paths or routes.discover to audit its routes
```

### Client-rendered sites

The `dist` audits read the HTML files as shipped. For a React, Angular or Vue app that is a
shell, `<div id="root"></div>` and scripts, so `seo` misses the title a router sets and `csp`
never sees styles injected at runtime. With `render.mode: 'on'` they read the DOM a browser
renders instead:

```ts
export default defineConfig({
  server: { fallback: 'index.html' },
  render: { mode: 'on', waitFor: '#root > *' },
});
```

Each built page is opened once per run in the shared browser, waits for `render.waitFor`, and
its serialized DOM is shared by every audit that
asks for it. Rendering needs the server, so the built-in one starts even when only `dist`
audits run. `render.mode: 'auto'` renders when the build looks client-rendered: one HTML page,
not counting `404.html`, next to a script of 100 kB or more.

| Audit | Reads |
| --- | --- |
| `seo`, `html`, `csp`, `assets` | the rendered DOM |
| `security` | the shipped HTML: meta CSP, mixed content and SRI are about what the server sends |
| `budget` | the shipped HTML size, and the files the browser requested for the rest |
| `links` | the rendered links of every page, see [links](./audits/links#client-rendered-links) |

Only built files are rendered for the `dist` audits; [`routes`](#client-rendered-routes)
without a file reach the server audits only. A page that fails to render within
`render.timeout` is read from its file, with a line in the audit log.

`render.waitFor` also decides when `r12s`, `privacy` and `shots` consider a page loaded, whether
or not `render.mode` is on: the `load` event fires before most apps fetch data and render.

### Locales

With `locales` and `defaultLocale` set, a page is a translation when its path starts with
`<locale>/` for any locale other than the default. Translations usually share templates with
the default locale, so the browser audits skip them unless asked:

| Audit | Pages |
| --- | --- |
| `a11y`, `links` | default locale only, all with `--all-locales` / `allLocales: true` |
| `privacy`, `shots` | default locale only, all with `--all-locales` / `allLocales: true` or `privacy.allLocales` / `shots.allLocales` |
| `r12s`, `lighthouse` | every locale |
| `csp`, `seo`, `security`, `html`, `budget`, `assets` | every built page, read from `distDir` |

`links` starts from the default-locale pages and follows links recursively, so translated
pages reachable by a link are still checked.

For a site whose default locale also lives under a prefix (`/en/`, `/fr/`, `/it/`), set
`locales: ['en', 'fr', 'it']` and `defaultLocale: 'en'`: pages under `fr/` and `it/` are
translations, everything else, including a root `index.html`, counts as the default locale.

### Per-audit filters

Each audit has its own `exclude`, matched against URL paths (`/admin/`) after the top-level
`exclude` has been applied. `csp.exclude` is the exception: it matches built file paths, like
the top-level `exclude`. Some audits also have `sample`: one page per matching URL pattern,
useful when hundreds of pages share a template.

## Findings

Each audit returns a summary and a list of findings. A finding has a message, and optionally
the pages it was found on, a file, detail lines, a fix and a severity.

Before anything is reported:

1. `ignore` rules drop findings, or drop pages from findings.
2. Findings recorded in the baseline file are hidden, unless the run is recording the baseline
   (`--accept-findings`).
3. `severity: 'warn'` turns every remaining finding of that audit into a warning.
4. The audit gets a status: `passed`, `warned`, `failed`, `skipped` or `errored`.

The number of hidden findings is shown in each audit's summary line
(`3 ignored or accepted`). The rules for each step are in
[Configuration](./configuration#severity-ignores-and-the-findings-baseline); the status rules are
in [Custom audits and API](./plugins#status-rules).

An audit that throws is `errored`, with the error message as its summary; the stack goes to its
log. A missing peer dependency errors only the audit that needs it.

## Reporters and exit code

Reporters receive a start event, each audit result as it finishes, and the full report at the
end. Without `-r` or `reporters`, the `pretty` reporter prints to the terminal, plus the
`github` reporter on GitHub Actions. See [Reporters](./reporters).

The run exits `0` when every audit passed, warned or was skipped, `1` when one failed or errored,
and `2` on bad usage or config; details in [CLI](./cli#exit-codes). `--strict` (`strict: true`)
turns warnings into failures.
