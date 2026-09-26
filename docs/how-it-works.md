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
the HTML files in `distDir`.

Audits run concurrently. Audits marked `exclusive` (the built-in `lighthouse`) run afterwards,
one at a time, so their measurements are not disturbed by the others.

## Serving the build

When at least one selected audit requires `server` and no `origin` is set, vidimus starts a
static server on `127.0.0.1` at `port` (default `4322`) and stops it at the end of the run. The
audit origin is `http://localhost:<port>` followed by the base path of `siteUrl`.

The server:

- maps `/about/` to `about/index.html`, and `/about` to `about`, `about/index.html` or
  `about.html`, whichever exists
- answers anything else with a plain `404 Not found`; it does not serve your `404.html`
- sets `content-type` from the file extension and gzips text, JSON, XML, SVG and manifests when
  the client accepts it (`server.gzip`)
- adds the headers of every `server.headers` rule whose `match` regex matches the request path

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

| Exit code | Meaning |
| --- | --- |
| `0` | every audit passed, warned or was skipped |
| `1` | at least one audit failed or errored |
| `2` | bad usage or config, no build output, or an unexpected error |

`--strict` (`strict: true`) turns warnings into failures.
