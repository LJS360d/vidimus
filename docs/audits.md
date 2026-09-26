---
title: Audits
description: What each of the thirteen vidimus audits checks, what it needs installed, and its options.
---

# Audits

| Audit | Checks | Needs | Default |
| --- | --- | --- | --- |
| `i18n` | every locale file has exactly the default locale's keys, none blank (no build needed) | — | yes |
| `csp` | every inline `<script>`/`<style>` is allowed by a hash in the meta CSP | — | yes |
| `a11y` | WCAG violations found by pa11y (default locale only) | `pa11y`, `puppeteer` | yes |
| `links` | broken internal links, assets and external targets | `linkinator` | yes |
| `r12s` | horizontal overflow, small tap targets, small text, missing or locked viewport meta | `puppeteer` | yes |
| `seo` | lang, title, description, `noindex`, canonical, hreflang, sitemap, robots.txt, orphan pages | — | |
| `security` | security headers, clickjacking protection, unsafe CSP, mixed content, SRI | — | |
| `html` | invalid markup found by html-validate | `html-validate` | |
| `budget` | HTML, CSS, JS and total page weight, image size and format, image dimensions | — | |
| `assets` | favicon, web manifest, Open Graph image, 404 page | — | |
| `privacy` | third-party requests and cookies on page load | `puppeteer` | |
| `shots` | screenshots against a recorded baseline | `puppeteer`, `sharp` (motion GIFs) | |
| `lighthouse` | Lighthouse category scores against thresholds | `lighthouse`, `puppeteer` | |

Run the default set with `npx vidimus`, everything with `npx vidimus all`, or name audits:
`npx vidimus seo budget`. Every finding says what to do about it (`→ …` in the terminal).

The tools behind the browser audits are optional peer dependencies, so you install only what
you use, at the versions you want:

```sh
npm i -D puppeteer pa11y linkinator    # the default set
npm i -D html-validate                 # html
npm i -D sharp lighthouse              # shots, lighthouse
```

A missing peer fails only its own audit, and the message says what to install.

## Options

Every audit has an `exclude` list of URL path patterns. Other options:

### `i18n`

| Key | Default | |
| --- | --- | --- |
| `i18n.files` | `''` | path template for translation files, e.g. `src/i18n/{locale}.json` |

Also needs the top-level `locales` and `defaultLocale`.

### `csp`

| Key | Default | |
| --- | --- | --- |
| `csp.exclude` | `[]` | built file paths to skip (`^admin/`) |

Skipped when no page declares a `<meta http-equiv="content-security-policy">`.

### `a11y`

| Key | Default | |
| --- | --- | --- |
| `standard` | `WCAG2AA` | `WCAG2A`, `WCAG2AA` or `WCAG2AAA` |
| `ignore` | `[]` | pa11y issue codes to ignore |
| `hideElements` | `''` | CSS selector of elements pa11y skips |
| `timeout` / `concurrency` | `60000` / `1` | |

### `links`

| Key | Default | |
| --- | --- | --- |
| `skip` | `['^mailto:', '^tel:']` | link patterns not to check |
| `checkExternal` | `true` | also check links to other sites |
| `timeout` / `retry` / `concurrency` | `20000` / `true` / `25` | |

Set the top-level `siteUrl` so absolute links to your own site are checked against the build.

### `r12s`

| Key | Default | |
| --- | --- | --- |
| `viewports` | `[320, 375, 768]` | widths in px |
| `minTarget` / `minFont` | `24` / `12` | minimum tap target and font size in px |
| `timeout` / `concurrency` | `60000` / half the cores | |

### `seo`

Checks every page for `<html lang>`, a `<title>` and meta description (present, within length,
not duplicated except between hreflang alternates), a single absolute canonical on `siteUrl`
pointing at a built page, absolute and reciprocal `hreflang` alternates, and one `<h1>`. It fails
on a `noindex` left in the build. Site-wide, it follows `sitemap.xml` and sitemap indexes (every
URL a built page on `siteUrl`, every indexable page listed, no noindex pages), checks
`robots.txt` (no `Disallow: /` for `*`, a `Sitemap:` line) and warns about orphan pages that no
other page links to. Meta refresh redirect stubs are skipped.

| Key | Default | |
| --- | --- | --- |
| `allowNoindex` | `[]` | URL paths allowed to be `noindex` (search, thank-you pages) |
| `titleLength` / `descriptionLength` | `{min:10,max:60}` / `{min:50,max:160}` | warn outside the range |
| `canonical`, `h1`, `sitemap`, `robots`, `orphans` | `true` | turn single checks off |
| `exclude` | `['^/404(\\.html\|/)?$']` | |

### `security`

Headers come from the live site when `--origin` is given, otherwise from `dist/_headers`
(Netlify and Cloudflare Pages format, with `*` splats, `:placeholders` and `! Name` detaches).
With neither, the header checks are skipped and the HTML checks still run.

| Key | Default | |
| --- | --- | --- |
| `file` | `_headers` | headers file in the build |
| `require` | HSTS ≥ 1 year, `nosniff`, a safe `Referrer-Policy`, `Permissions-Policy` | header → regex its value must match; `''` only requires presence, `false` turns one off |
| `clickjacking` | `true` | require a CSP `frame-ancestors` header or `X-Frame-Options` |
| `unsafeInline` | `true` | warn on `'unsafe-inline'` (without hashes or nonces) or `'unsafe-eval'` in `script-src` |
| `mixedContent` | `true` | fail on resources loaded over `http://` |
| `sri` | `true` | warn on cross-origin scripts and stylesheets without `integrity` |

On a live origin it also warns about `X-Powered-By` and a versioned `Server` header.

### `html`

Validates every page with [html-validate](https://html-validate.org). The same problem on many
pages is reported once, with up to three example locations. Rules at severity `warn` only warn.

| Key | Default | |
| --- | --- | --- |
| `extends` | `['html-validate:standard']` | presets; a `.htmlvalidate.json` in the project root replaces them |
| `rules` | `{}` | html-validate rules, applied on top (`{ "no-inline-style": "off" }`) |

### `budget`

Only local files count, each once per page. HTML, CSS and JS are measured gzipped, images raw.
`0` turns a budget off.

| Key | Default | |
| --- | --- | --- |
| `html` / `css` / `js` | `100_000` / `100_000` / `250_000` | max gzipped bytes per page (JS includes `modulepreload`) |
| `page` | `2_000_000` | max total per page |
| `image` | `500_000` | max bytes of any image in `img`, `srcset` or `<source>` |
| `legacyImage` | `100_000` | warn when a PNG/JPEG/GIF this large has no AVIF/WebP `<source>` |
| `dimensions` | `true` | warn on `<img>` without `width` and `height` (layout shift) |

### `assets`

| Key | Default | |
| --- | --- | --- |
| `favicon` | `true` | `<link rel="icon">` or `/favicon.ico` exists, icon links resolve, warn without `apple-touch-icon` |
| `manifest` | `true` | a linked manifest exists, is valid JSON with a name and icons that exist, warn without a 512px icon |
| `openGraph` | `true` | warn without `og:title`, `og:image`, `twitter:card`; fail on a relative or missing `og:image` or an `og:url` off `siteUrl` |
| `ogImage` | `{ width: 1200, height: 630 }` | warn below this size |
| `notFound` | `true` | warn without `404.html` |

### `privacy`

Loads each page in a fresh browser context and fails on any request to a host other than the
site's own (the audit origin or `siteUrl`), with hints for common services: Google Fonts, YouTube,
analytics, public CDNs. Cookies set on load are reported too: first-party ones as warnings,
third-party ones as failures. Useful for GDPR: nothing should leave the visitor's browser before
consent.

| Key | Default | |
| --- | --- | --- |
| `allow` | `[]` | regexes matched against the full request URL |
| `sample` / `allLocales` | `[]` / `false` | which pages to load, like `shots` |
| `cookies` | `true` | report cookies set on load |
| `wait` | `1500` | ms to wait after `load` for late trackers |
| `concurrency` / `timeout` | half the cores / `60000` | |

### `shots`

Takes full-page screenshots and compares them with `.vidimus/shots/baseline/`. Record or
refresh the baseline with `npx vidimus shots --update-baseline`; differences go to
`.vidimus/shots/diff.html`.

| Key | Default | |
| --- | --- | --- |
| `viewports` | `[{ width: 375, height: 667 }, 1280]` | |
| `sample` | `[]` | URL patterns: screenshot one page per matching template |
| `tolerance` / `maxDiff` | `12` / `0.002` | per-pixel colour tolerance, allowed share of changed pixels |
| `motion` | `{ interval: 100, stableFrames: 5, maxFrames: 60 }` | record animations as GIFs, `false` to skip |

### `lighthouse`

| Key | Default | |
| --- | --- | --- |
| `thresholds` | `{ performance: 0.9, accessibility: 1, 'best-practices': 0.9, seo: 1 }` | minimum score per category |
| `sample` / `all` / `urls` | `[]` / `false` / `[]` | which pages: one per template, all, or a fixed list |

HTML reports are written to `.vidimus/lighthouse/`.
