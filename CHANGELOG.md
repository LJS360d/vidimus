# vidimus

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
