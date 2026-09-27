# vidimus

## 0.9.0

### Minor Changes

- de89c68: `security` checks `/.well-known/security.txt` (RFC 9116): a warning when it is missing, errors for a missing or invalid `Contact` or `Expires` and for an expired file. Turn it off with `security.securityTxt: false`. `assets` warns when no page links a web app manifest.
  
  `assets` also detects from the pages whether the site needs `ads.txt` (ad tags), `/.well-known/change-password` (password fields), `apple-app-site-association` or `assetlinks.json` (links to an iOS or Android app), warns when the file is missing and checks it when present. Each is set with `'auto'` (default), `'on'` or `'off'`.

## 0.8.0

### Minor Changes

- d0891a6: Iframes and embeds across audits. `csp` reports iframes whose URL the page's `frame-src` (meta CSP or `server.headers`) does not allow, warns about third-party iframes without `sandbox` (`csp.sandbox`), and checks inline blocks inside `<iframe srcdoc>`. `privacy` reports hosts loaded into an iframe as `third-party embed from <host>`, including requests made inside cross-origin frames, with a click-to-load facade as the fix. `html` validates `<iframe srcdoc>` markup.
- 79f5a99: Per-path options for sites that mix static and client-rendered sections: `server.fallback` also takes `{ match, file }` rules, so several apps under one origin each answer their own routes; `render.include` renders only the pages whose path matches; and `lighthouse.overrides` sets other thresholds for the pages whose path matches, later rules winning.

### Patch Changes

- d0891a6: `r12s` now detects horizontal overflow at mobile widths: under mobile emulation the check measured a viewport that grew with the content, so overflow below 768px was never reported. Overflow findings no longer list elements clipped by a scrolling box or off the start edge of the page, and suggest `aspect-ratio` sizing when an iframe or video causes it.
- 79f5a99: Steadier screenshots and small fixes found on the docs showcase: `shots` masks through inline styles, which a strict CSP does not block; waits for lazy images to load and decodes them before painting; waits for stylesheets added after load; grows the viewport to the page height itself, waiting again for `<picture>` sources and for late content that changes the height; and loads video metadata so the controls look the same on every run. `r12s` no longer counts screen-reader-only elements (clipped with `clip` or `clip-path`) as tap targets. The built-in server sends `.vtt` captions as `text/vtt`.

## 0.7.0

### Minor Changes

- 5e1b4a7: `shots` handles pages that change on their own. `shots.freeze` (default on) seeds `Math.random`, drives `requestAnimationFrame` from a virtual clock and stops it after 30 frames, and stills videos and endless CSS animations before the screenshot. `shots.mask` paints CSS selectors flat black, and `shots.maskEmbeds` (default on) masks cross-origin iframes. WebGL runs on SwiftShader for the same output everywhere, a canvas whose WebGL context failed is logged, and a motion recording that never settles names the elements still moving.

## 0.6.0

### Minor Changes

- a0adeda: New `render` option for client-rendered sites. With `render.mode: 'on'`, or `'auto'` for a one-page build with a large script, `seo`, `html`, `csp` and `assets` read the DOM a browser renders instead of the shipped shell, `budget` measures the build files the browser requested (lazy chunks, fonts, models), and `links` checks the links in the rendered DOM. `links.notFound` reports internal links and hash routes that render the app's not-found view. `render.waitFor` (`'load'`, `'networkidle'`, milliseconds or a CSS selector) also sets when `r12s`, `privacy`, `shots` and the route crawl consider a page loaded.
- 6c731df: New `routes` option for client-rendered apps: the server audits (`a11y`, `links`, `r12s`, `privacy`, `shots`, `lighthouse`) also open `routes.paths`, the URLs of the build's sitemap (`routes.discover: 'sitemap'`), or the same-origin links found by crawling the rendered pages (`routes.discover: 'crawl'`, up to `routes.limit` new routes). Routes without a file need `server.fallback`, and the run stops with a usage error otherwise. When no routes are set and the build has one HTML page next to a large script, the pretty reporter prints a note suggesting them.

## 0.5.0

### Minor Changes

- 753f522: The built-in server gets `server.fallback` and `server.fallbackStatus`: page requests that match no file are answered with a build file such as `index.html` or `404.html`, as single-page app hosts do, while missing assets still 404. It also sends proper content types for `.wasm`, `.glb`, `.gltf`, `.bin`, `.ktx2`, `.hdr`, `.exr`, `.map`, `.ogg`, `.mp3`, `.wav`, `.ttf` and `.otf`.

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
