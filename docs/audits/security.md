---
title: security
description: How the security audit checks response headers, clickjacking protection, unsafe CSP, mixed content and subresource integrity.
---

# security: headers and safe loading

`security` checks the HTTP response headers your pages are served with and the markup that
decides what those pages load. A missing `Strict-Transport-Security` or clickjacking header is
invisible in the page and easy to lose in a hosting migration; an `http://` script or a CDN file
without `integrity` is one careless edit away. It is not in the default set.

## Needs

Nothing to install. It reads the build (`dist/`) and starts no server. The header checks need
a source of headers, see below; the HTML checks always run.

## Run it

```sh
npx vidimus security                                  # headers from dist/_headers
npx vidimus security --origin https://preview.example.com  # headers from a live site
```

## Where headers come from

Static hosts set headers outside the HTML, so vidimus reads them from one of two places:

1. **A live origin**, when `--origin` (or the `origin` config key) is set. vidimus sends a
   `HEAD` request for every built page to the origin plus the page path, without following
   redirects, and retries with `GET` if the server answers `405`. A request that fails is an
   error finding, `could not fetch headers`, with the reason as detail.
2. **A headers file in the build**, `dist/_headers` by default (`security.file`), in the
   Netlify and Cloudflare Pages format. Put it in the folder your framework copies to the
   build as is (`public/` in most of them).

With neither, the log says `header checks skipped: no _headers in the build and no --origin to
fetch headers from`, the summary says `headers from nowhere (skipped)`, and only the HTML
checks run. The `server.headers` of the built-in static server are not used by this audit.

### The `_headers` format

A line starting at column 0 is a URL pattern; the indented lines below it are `Name: value`
headers for the paths it matches. Lines starting with `#` are comments.

```text
# every page
/*
  X-Content-Type-Options: nosniff

# one segment: /blog/hello/, not /blog/2024/hello/
/blog/:slug
  Cache-Control: public, max-age=600

# full URLs work too; only the path is used
https://example.com/admin/*
  ! X-Frame-Options
  Content-Security-Policy: frame-ancestors 'self' https://cms.example.com
```

- `*` matches anything, including `/`. `:name` matches one path segment.
- A trailing slash is optional: `/about` also matches `/about/`.
- Every rule that matches a path applies, in file order. When two rules set the same header,
  the values are joined with `, `.
- An indented `! Name` removes a header that an earlier rule set for that path.

### GitHub Pages and other hosts without custom headers

GitHub Pages cannot set custom response headers, and a `<meta http-equiv>` cannot replace HSTS,
`X-Content-Type-Options` or `frame-ancestors`. Put the site behind a CDN that can (Cloudflare,
for example) and audit it with `--origin`, or turn the header checks off and keep the HTML ones:

```ts
export default defineConfig({
  security: {
    require: {
      'strict-transport-security': false,
      'x-content-type-options': false,
      'referrer-policy': false,
      'permissions-policy': false,
    },
    clickjacking: false,
  },
});
```

## What it checks

### Headers (when a source exists)

**Required headers** (`security.require`) is a map of header name to a regular expression the
value must match (case-insensitive). A missing header fails with `missing <name> header`; a
value that does not match fails with `<name> header does not match <regex>` and shows the value.
`''` requires only presence, `false` turns a header off. For the four defaults the fix quotes a
recommended value:

| Header | Must match | Recommended |
| --- | --- | --- |
| `strict-transport-security` | `max-age` of at least 31000000 seconds (about a year) | `max-age=31536000; includeSubDomains` |
| `x-content-type-options` | exactly `nosniff` | `nosniff` |
| `referrer-policy` | anything except `unsafe-url` and `no-referrer-when-downgrade` | `strict-origin-when-cross-origin` |
| `permissions-policy` | any value | `camera=(), microphone=(), geolocation=()` |

The other header checks:

- **Clickjacking** (`security.clickjacking`): a `Content-Security-Policy` header with a
  `frame-ancestors` directive, or `X-Frame-Options: DENY` or `SAMEORIGIN`. Without either:
  `no clickjacking protection: add CSP frame-ancestors or X-Frame-Options`. A `<meta>` CSP does
  not count, since browsers ignore `frame-ancestors` there.
- **Stack leaks** (live origin only): an `X-Powered-By` header (`x-powered-by header leaks the
  stack`) and a `Server` header containing a version number (`server header leaks a version`)
  are warnings.

### HTML (always)

- **Unsafe CSP** (`security.unsafeInline`): the `script-src` of every CSP, from headers and
  `<meta http-equiv="content-security-policy">`, falling back to `default-src`. `'unsafe-eval'`
  is a warning. `'unsafe-inline'` is a warning unless the same list has a nonce or a
  `sha256-`/`sha384-`/`sha512-` hash, in which case browsers ignore it. The [csp](./csp) audit
  checks that those hashes match your inline scripts.
- **Mixed content** (`security.mixedContent`): any `http://` URL in `<script src>`,
  `<img src|srcset>`, `<source src|srcset>`, `<iframe src>`, `<video src|poster>`,
  `<audio src>`, `<object data>`, `<embed src>`, `<form action>`, and `<link href>` with `rel`
  `stylesheet`, `icon`, `preload`, `modulepreload` or `manifest`. Each URL is an error,
  `mixed content: http://…`. Plain `<a href="http://…">` links are not mixed content.
- **Subresource integrity** (`security.sri`): a `<script src>` or `<link rel="stylesheet">` on
  another origin (not `siteUrl`) without an `integrity` attribute is a warning,
  `cross-origin <script> without integrity: https://…`. Protocol-relative `//cdn…` URLs count.

## Example output

```
─── security ────────────────────────────────────────────────────

✖ missing strict-transport-security header
    on: / /about/ /blog/ +37 more
    → Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" to /* in _headers, or set security.require["strict-transport-security"] to false to skip.

✖ no clickjacking protection: add CSP frame-ancestors or X-Frame-Options
    on: / /about/ /blog/ +37 more
    → Send "Content-Security-Policy: frame-ancestors 'self'" (or X-Frame-Options: DENY) as a header; a <meta> CSP can't set frame-ancestors.

⚠ CSP allows 'unsafe-inline' scripts
    on: /contact/
    → Drop 'unsafe-inline' from script-src and allow inline scripts by 'sha256-…' hash or nonce, or move them to files.

⚠ cross-origin <script> without integrity: https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js
    on: /contact/
    → Add integrity="sha384-…" and crossorigin="anonymous", or self-host the file.

✖ security: 40 pages, headers from _headers, 4 problem(s) (0.1s)
```

With `--origin`, the fixes say "your host's header config" instead of `/* in _headers`.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `security.file` | `'_headers'` | headers file, relative to the build output |
| `security.require` | the four headers above | header name → regex its value must match; `''` requires presence, `false` skips |
| `security.clickjacking` | `true` | require `frame-ancestors` or `X-Frame-Options` |
| `security.unsafeInline` | `true` | warn on `'unsafe-inline'` without hashes or nonces, and on `'unsafe-eval'` |
| `security.mixedContent` | `true` | fail on resources loaded over `http://` |
| `security.sri` | `true` | warn on cross-origin scripts and stylesheets without `integrity` |
| `security.exclude` | `[]` | URL path patterns to skip |

Top-level keys used: `origin`, `siteUrl`, `exclude`. Objects merge deeply, so adding a key to
`security.require` keeps the defaults:

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.com',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'security'],
  security: {
    require: {
      'cross-origin-opener-policy': '^same-origin$',
      'permissions-policy': 'camera=\\(\\)',
    },
    exclude: ['^/embed/'],
  },
});
```

## Common fixes

A recommended `dist/_headers` that passes every default check. Adjust the CSP to what your
pages load:

```text
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: frame-ancestors 'self'
  X-Frame-Options: DENY
```

`X-Frame-Options` is redundant next to `frame-ancestors` in current browsers; keep it for old
ones or drop it. If a page must be embeddable, detach and replace the header for it:

```text
/embed/*
  ! X-Frame-Options
  ! Content-Security-Policy
  Content-Security-Policy: frame-ancestors https://partner.example.com
```

Add integrity to a CDN script, or better, self-host it:

```html
<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"
  integrity="sha384-…" crossorigin="anonymous" defer></script>
```

An integrity hash only works with a pinned version: the file behind `@3` changes with every
release. Generate it with
`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`.

For a live server, remove `X-Powered-By` in the framework (`app.disable('x-powered-by')` in
Express) and hide the version with `server_tokens off;` in nginx or `ServerTokens Prod` in
Apache. See [CI](../ci) for auditing a preview deployment with `--origin`.
