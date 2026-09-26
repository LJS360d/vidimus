# vidimus

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
