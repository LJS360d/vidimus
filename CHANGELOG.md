# vidimus

## 0.4.1

### Patch Changes

- 9051d74: The output directory (`.vidimus` by default) now gets its own `.gitignore` containing `*` when a run first creates it, instead of `vidimus init` appending `.vidimus` to the project `.gitignore`.

## 0.4.0

### Minor Changes

- 277c353: New `shots.baselineDir` option to keep the screenshot baseline outside `.vidimus/` (for example to commit it); by default it stays in `.vidimus/shots/baseline/`. `--port 0` serves the build on a free port. Audit plugins get `builtPages()` in their context, and `launchBrowser()` without options now shares one browser process between audits running at the same time, each in its own browser context. `--update-baseline` now deletes only the PNG files in the baseline directory.
  
  Fixes:
  
  - The built-in server no longer crashes on malformed or NUL-byte paths, closes when a reporter fails to start, and reports a port in use as a usage error.
  - Invalid regular expressions in config patterns are rejected when the config loads.
  - `lighthouse` and `shots` report a page that fails as a finding instead of erroring the whole audit; a failed screenshot leaves the baseline untouched on `--update-baseline`.
  - `links` no longer rewrites hosts that only start with the `siteUrl` host (`example.com.au`).
  - `csp` checks uppercase tags, ignores commented-out blocks and no longer mistakes `data-src` for `src`.
  - The HTML parser reads attributes written without a space after a quoted value, decodes the common named entities and no longer throws on out-of-range code points.
  - `r12s` flags `user-scalable=0` and `maximum-scale` below 1; `seo` checks pages whose `meta refresh` only reloads; `i18n` handles keys named like `constructor`; `security` follows same-origin redirects with a timeout; srcset URLs containing commas are kept whole.
  - `--strict` marks the findings of a failed audit as errors, JUnit keeps characters outside the BMP, GitHub annotation paths are relative to the workspace, and two reporters writing to stdout are rejected.
  - `--set` keeps numbers in mixed lists (`shots.viewports=375,1280`) and accepts `false` for `security.require.*`; `vidimus all <name>` adds the named audits; `init` refuses to create a second config file in another format.
  - Built pages are read and parsed once per run instead of once per audit.

### Patch Changes

- 277c353: `vidimus init` appends `.vidimus` to an existing `.gitignore` in the working directory when it is not listed yet.

## 0.3.0

### Minor Changes

- 36c38d8: r12s: elements that are not rendered (`display: none`, such as closed menus and popups) are no longer checked for tap target and font size; inline links inside a sentence are exempt from the tap target check, as in WCAG 2.2 success criterion 2.5.8, and a target is measured in whole pixels, so a 23.9px wide target shown as 24px is not reported; and a viewport with `maximum-scale` above 1 (`maximum-scale=1.5`) is no longer reported as disabling pinch zoom.
- 36c38d8: - On GitHub Actions the `github` reporter is added even when `-r` or `reporters` is given, so asking for a JUnit or JSON file no longer drops the annotations; it writes to stderr when `json` or `junit` writes to stdout.
  - `ignore` rules are checked when the config loads: an unknown key (`{ adit: 'seo' }`), an empty rule, a non-string value or an invalid regular expression is a config error (exit code 2) instead of silently dropping findings or erroring the audit.
  - r12s: a page that fails to load is a `failed to load` finding instead of erroring the whole audit.
  - privacy and shots honour the top-level `allLocales` (`--all-locales`).
  - lighthouse: by default it audits one page per directory instead of every page, so `lighthouse.all: true` now means something; `sample` and `urls` work as before.
  - shots: no baseline at all fails the audit (nothing was compared), and screenshots without a baseline are a warning instead of a log line.
  - i18n: the fix for empty keys no longer suggests deleting them, which would be reported as missing.
- 36c38d8: seo: pages whose canonical link points at another built page are treated as duplicates by design. They are no longer reported as duplicate titles or descriptions, missing from the sitemap or orphans, and listing one in the sitemap is a warning (`non-canonical page in the sitemap`).

### Patch Changes

- 36c38d8: The built-in server redirects a directory URL without a trailing slash (`/docs`) to `/docs/`, as GitHub Pages, Netlify and most static hosts do, so relative links on directory index pages resolve the same way as in production instead of being reported as broken.

## 0.2.1

### Patch Changes

- 9092733: Browser audits (a11y, r12s, privacy, shots, lighthouse, links) now open pages under the `siteUrl` base path when serving the build. Before, client-side routers such as VitePress's rendered their 404 page, so these audits checked the wrong page. Reported paths and `exclude`/`sample` patterns stay relative to the base path.

## 0.2.0

### Minor Changes

- 6f18026: Every finding now says what to do about it: a `fix` field, printed as `→ …` by the pretty reporter and included in GitHub annotations and JUnit output. Plugin audits can set it too.

### Patch Changes

- 6f18026: Support sites deployed under a base path (e.g. GitHub Pages project sites): when `siteUrl` has a path, URLs under it are resolved against the build root, and the local server serves the build there too.
- 6f18026: Stop publishing `src/`: source maps now embed the TypeScript sources instead.

## 0.1.0

### Minor Changes

- 7804f72: First public release: `i18n`, `csp`, `a11y`, `links`, `r12s`, `seo`, `security`, `html`, `budget`, `assets`, `privacy`, `shots` and `lighthouse` audits, per-audit severity, ignore rules, a findings baseline and a JSON Schema for config files.
