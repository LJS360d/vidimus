---
title: Troubleshooting
description: Answers for missing peers, Chrome in containers, base path 404s, siteUrl mismatches, timeouts, flaky links and exit codes.
---

# Troubleshooting

## An audit says a package is not installed

```
! a11y: "pa11y" is not installed. Add it as a dev dependency: npm i -D pa11y
```

The browser audits use tools you install next to vidimus; they are optional peer dependencies,
so npm does not install them for you. A missing peer errors only the audit that needs it; the
others still run, and the run exits `1`.

| Audit | Install |
| --- | --- |
| `a11y` | `puppeteer`, `pa11y` |
| `links` | `linkinator` |
| `r12s`, `privacy` | `puppeteer` |
| `html` | `html-validate` |
| `shots` | `puppeteer`, and `sharp` for motion GIFs |
| `lighthouse` | `lighthouse`, `puppeteer` |

If you do not want an audit, take it out of `audits` or set its severity to `off` instead of
installing its peer. `npx vidimus csp seo budget` runs without any peer installed.

## Chrome does not start

With the peers installed, an audit can still error when Chrome cannot launch; its summary is
puppeteer's error message.

- **Could not find Chrome**: puppeteer's browser download was skipped
  (`PUPPETEER_SKIP_DOWNLOAD`, `--ignore-scripts`, a package manager that blocks install
  scripts) or the cache path differs.
  Run `npx puppeteer browsers install chrome`, or set `browser.executablePath` to a Chrome or
  Chromium already on the machine.
- **Missing shared libraries** (`error while loading shared libraries: libnss3.so` and
  similar): the system lacks Chrome's dependencies, common in slim container images. Install a
  distribution Chromium, which pulls them in, and point `browser.executablePath` at it; see
  [CI](./ci#system-chromium-and-docker).
- **No usable sandbox**: Chrome refuses to run as root with its sandbox. vidimus passes
  `--no-sandbox --disable-dev-shm-usage` by default through `browser.args`. If you set
  `browser.args`, the list replaces the defaults: include both flags again.

## The build is not found

```
vidimus: no build output at /path/to/site/dist. Run the build first.
```

Every audit except `i18n` needs the build. Run it first, and set `distDir` to where your
generator writes; [Frameworks](./frameworks) lists the usual directories. `distDir` resolves
from `root`, which is the config file's directory, not necessarily the working directory: with
`-c docs/vidimus.config.json`, `distDir: 'dist'` means `docs/dist`. `npx vidimus config` shows
the resolved `root` and `distDir`.

`<dist> has no HTML pages. Rebuild.` means the directory exists but, after the top-level
`exclude`, holds no `.html` file.

## Pages or assets 404 under a base path

A site built for `https://user.github.io/project/` links to `/project/…`. If `siteUrl` does not
include `/project`, the built-in server does not know about the prefix and every link and asset
looks broken to `links`, `a11y` and the other browser audits.

Set `siteUrl: 'https://user.github.io/project'`. The build is then served under `/project`, and
paths without the prefix still resolve. With `--origin`, include the path too:
`--origin http://localhost:4173/project`. Details in
[How it works](./how-it-works#base-paths).

`server.headers` rules match the request path with the base path, so `^/_astro/` does not
match `/project/_astro/…`. Drop the `^` or include the prefix.

## Canonical, sitemap or Open Graph findings mention another origin

```
✖ canonical points outside https://example.org
✖ sitemap URL outside https://example.org
✖ og:url origin https://www.example.org differs from siteUrl https://example.org
```

These checks compare the origin (scheme, host and port) with `siteUrl`. The usual causes:

- `www.` in one and not the other, or `http` against `https`
- a generator setting (`site`, `baseURL`, `url`) that differs from `siteUrl`, or a preview
  build made with a staging URL
- `siteUrl` left empty: the origin checks are skipped, and absolute links to your own site are
  checked against the live site instead of the build

Set the generator and `siteUrl` from the same value. A config function can read it from the
environment: `siteUrl: env.SITE_URL ?? 'https://example.org'`.

## Only one page is audited

A client-rendered app builds one `index.html`, and the page list is the HTML files in
`distDir`, so every server audit checks the home route only. The pretty reporter says so at
the start:

```
vidimus: dist has one HTML page and a 412 kB script: looks like a client-rendered app; set routes.paths or routes.discover to audit its routes
```

Set `routes` to list the other routes, read them from a sitemap, or crawl them, and
`server.fallback` so the built-in server answers them with `index.html`. See
[Frameworks](./frameworks#client-rendered-apps).

## seo says there is no title, but the app sets one

`seo`, `html`, `csp` and `assets` read the built HTML file, and in a client-rendered app that is
the shell before any script runs: no `<title>`, no description, no `<h1>`. Set
`render.mode: 'on'` (or `'auto'`) so they read the DOM a browser renders, with
`render.waitFor` set to something that appears once the app has rendered. See
[How it works](./how-it-works#client-rendered-sites).

Search engines that do not run JavaScript see the shell too; prerendering fixes both.

## shots differ on every run

Something on the page changes on its own. Open `.vidimus/shots/diff.html` and look at where the
red is:

- a canvas or WebGL scene: keep `shots.freeze` on, or make the scene render one frame under
  `prefers-reduced-motion: reduce`, which the main screenshot uses;
- an embedded map, video player or widget: `shots.maskEmbeds` masks cross-origin iframes;
  add anything else to `shots.mask`;
- content a script fetches after load: set `render.waitFor` to a selector that appears once it
  is in, or to `'networkidle'`;
- the text of the page itself, across machines: fonts render differently on each OS, so record
  the baseline on the same kind of machine that compares it.

See [shots](./audits/shots#canvas-webgl-video-gifs-and-embeds).

## Timeouts and slow runs

The non-exclusive audits run at the same time, and each browser audit opens several tabs.
On a small CI runner that can mean many pages loading at once.

| Audit | Page timeout | Parallel tabs |
| --- | --- | --- |
| `a11y` | `a11y.timeout`, `60000` | `a11y.concurrency`, `1` |
| `r12s` | `r12s.timeout`, `60000` | `r12s.concurrency`, half the cores |
| `privacy` | `privacy.timeout`, `60000` | `privacy.concurrency`, half the cores |
| `links` | `links.timeout`, `20000` per request | `links.concurrency`, `25` |
| `shots` | `shots.settleTimeout`, `10000`; `shots.protocolTimeout`, `600000` | `shots.concurrency`, half the cores |

Half the cores means between 2 and 8. When pages time out:

- lower the concurrency of the browser audits, or run them in separate steps
  (`npx vidimus a11y`, then `npx vidimus r12s`)
- raise the audit's timeout
- use `sample` (`shots`, `privacy`, `lighthouse`) to open one page per template
- leave heavy sections out with the audit's `exclude`

In `a11y`, `privacy` and `r12s` a page that fails to load becomes a finding (`failed to
audit …`, `failed to load …`) and the other pages are still checked.

## External links fail intermittently

A broken link finding is `<status> <url>`, or `ERR <url>` when there was no response. The fix
line depends on the status:

- `404` / `410`: the target is gone. Fix or remove the link.
- other `4xx` (often `403` or `429`): the target blocks bots. If it works in a browser, add a
  pattern to `links.skip`.
- `5xx` or `ERR`: the target was down or slow. Raise `links.timeout`, keep `links.retry` on, or
  skip it.

For pull request builds that should not depend on other sites, set `links.checkExternal: false`
and check external links in a scheduled job. `links.skip` patterns are regular expressions
matched against the link URL: `'^https://(www\\.)?linkedin\\.com/'`.

## A config typo fails the run

```
vidimus: /path/to/site/vidimus.config.ts: unknown config key "seo.titleLenght"
```

Unknown keys in a config file or `--set` stop the run with exit code `2`; that is intended.
`npx vidimus config --no-config` lists every valid key. `ignore` rules are checked too: an
unknown key, an empty rule `{}`, a value that is not a string or an invalid regular expression
also exits `2`. Two places are not checked:

- `VIDIMUS_*` variables that do not name a key are ignored
- entries of other arrays, such as `server.headers` rules: a misspelled key there is not reported

Values in a config file are not type-checked when loaded. Use the `$schema` in JSON configs or
`defineConfig` in TS configs to catch those in the editor.

## Findings disappear or will not go away

- The summary line counts hidden findings: `3 ignored or accepted`. They come from `ignore`
  rules or the baseline file.
- `--set 'ignore=[]'` runs without ignore rules, `--set baseline.file=` without the baseline,
  and `--set 'severity={}'` with every audit back at `error`.
- A baseline entry matches audit, message, file and details. A finding whose message contains a
  number (a size, a score) comes back when the number changes. See
  [Adopting on an existing site](./adopting#what-a-baseline-entry-matches).

## Lighthouse says robots.txt is not valid

Lighthouse fetches `robots.txt` from inside the page, so a Content-Security-Policy without
`connect-src` (for example `default-src 'none'`) blocks the request and the SEO category loses
the `robots-txt` audit, even when the file is fine. The [`seo`](./audits/seo) audit reads the
file from the build and is not affected. Add `connect-src 'self'` to the policy, or accept the
lower score with `lighthouse.thresholds.seo`.

## The port is in use

The built-in server listens on `127.0.0.1:4322`. When another process holds the port, the run
stops with Node's `EADDRINUSE` error and exit code `2`. Pick another with `--port 5000` or
`VIDIMUS_PORT=5000`.

## Exit codes

The full table is in [CLI](./cli#exit-codes). An audit that errors, from a missing peer or a
browser that did not start, exits `1` like a failure; a problem before the audits start, such as
config, a missing build or a port in use, exits `2`. Warnings exit `0` unless `--strict` is set.
A skipped audit (`○`) is not a failure: `csp` without a meta CSP, or `i18n` without
`i18n.files`, `locales` and `defaultLocale`.
