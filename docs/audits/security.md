---
title: security
description: How the security audit checks response headers, clickjacking protection, unsafe CSP, mixed content, subresource integrity and security.txt.
---

# security: headers and safe loading

`security` checks the HTTP response headers your pages are served with and the markup that
decides what those pages load. A missing `Strict-Transport-Security` or clickjacking header is
invisible in the page and easy to lose in a hosting migration; an `http://` script or a CDN file
without `integrity` is one careless edit away. It is not in the default set.

## Needs

Nothing to install. It reads the build (`dist/`) and starts no server. The header checks need
a source of headers, see below; the HTML checks always run.

The HTML checks always read the shipped files, also with
[`render.mode`](../how-it-works#client-rendered-sites) on: they are about what the server sends.

## Run it

```sh
npx vidimus security                                  # headers from dist/_headers
npx vidimus security --origin https://preview.example.com  # headers from a live site
```

## Where headers come from

On an `http://` origin at localhost, 127.x or [::1] (including `server.command` runs), `strict-transport-security` is not checked, since browsers ignore HSTS there.

Static hosts set headers outside the HTML, so vidimus reads them from one of two places (the second also covers [host config files](#host-config-files)):

1. **A live origin**, when `--origin` (or the `origin` config key) is set. vidimus sends a
   `HEAD` request for every built page to the origin plus the page path, and retries with
   `GET` if the server answers with an error status (`4xx` or `5xx`). Redirects on the same origin (such as `/about` to
   `/about/`) are followed, up to 5; a redirect to another origin is not, and its own
   headers are checked. A request that fails or takes longer than 20 seconds is an error
   finding, `could not fetch headers`, with the reason as detail.
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

- `*` matches anything, including `/`. `:name` matches one path segment; `:name*`, `:name+` and
  `:name?` match anything, anything non-empty, and an optional segment.
- A trailing slash is optional: `/about` also matches `/about/`.
- Every rule that matches a path applies, in file order. When two rules set the same header,
  the values are joined with `, ` and repeated values are dropped. `X-Frame-Options`,
  `X-Content-Type-Options`, `Strict-Transport-Security` and `Referrer-Policy` take the last rule's value.
  Invalid JSON and unsupported patterns in host files are logged. A `vercel.json` header rule with `has` or `missing` is conditional on request properties, which vidimus does not evaluate, so it is skipped and logged the same way.
- An indented `! Name` removes a header that an earlier rule set for that path.

### Host config files

Headers are also read from the host config files below, in the project root and in the build.
Their rules are merged with `_headers` and use the same path matching. A JSON file that does not
parse is skipped and logged.

| File | Read from |
| --- | --- |
| `vercel.json` | `headers` (`source`, `headers[].key` and `value`) |
| `netlify.toml` | `[[headers]]` blocks with `for` and a `[headers.values]` table |
| `firebase.json` | `hosting.headers` (`hosting` may be an array of sites) |
| `staticwebapp.config.json` | `globalHeaders` and `routes[].headers` |

`netlify.toml` is not parsed as full TOML: only `for = "…"` and `key = "value"` lines of
`[[headers]]` and `[headers.values]` are understood. Values may be basic (`"…"`, escapes
decoded), literal (`'…'`) or multi-line (`"""…"""`, `'''…'''`) strings; a multi-line value is
folded to one header line.

Supported patterns are the catch-alls `/*`, `/**`, `/(.*)` and `**`, exact paths, and `*`
inside a path such as `/blog/*`. Patterns with regular expression syntax (`(`, `[`, `?`, `|`,
`{`) are ignored, such as `/blog/(?<slug>[^/]+)`.

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
| `strict-transport-security` | `max-age` of at least 31536000 seconds (a year); a missing `includeSubDomains` is a warning | `max-age=31536000; includeSubDomains` |
| `x-content-type-options` | exactly `nosniff` | `nosniff` |
| `referrer-policy` | anything whose last recognised token is not `unsafe-url` or `no-referrer-when-downgrade` (fallback lists are judged by that token) | `strict-origin-when-cross-origin` |
| `permissions-policy` | any value | `camera=(), microphone=(), geolocation=()` |

The other header checks:

- **Clickjacking** (`security.clickjacking`): a `Content-Security-Policy` header with a
  `frame-ancestors` directive, or `X-Frame-Options: DENY` or `SAMEORIGIN`. Without either:
  `no clickjacking protection: add CSP frame-ancestors or X-Frame-Options`. A `<meta>` CSP does
  not count, since browsers ignore `frame-ancestors` there. A `frame-ancestors` source list with a
  bare `*`, a scheme-only source (`https:`) or a scheme with a `*` host (`https://*`) allows any site to frame the page, so it does not
  count either: `no clickjacking protection: frame-ancestors allows any origin`.
- **Stack leaks** (live origin only): an `X-Powered-By` header (`x-powered-by header leaks the
  stack`) and a `Server` header disclosing a product version such as `nginx/1.25.3` (`server header leaks a version`)
  are warnings.

### HTML (always)

- **Missing CSP** (`security.csp`, `'warn'` by default, `'error'` or `false`): a page with no CSP in a header or `<meta>` (`no Content-Security-Policy (header or <meta>)`), or whose CSPs have neither `script-src` nor `default-src`, is reported with a starter policy. The no-CSP case is skipped when `security.require` already requires `content-security-policy`.
- **Unsafe CSP** (`security.unsafeInline`): the `script-src-elem`/`script-src` of every CSP, from headers and
  `<meta http-equiv="content-security-policy">`, falling back to `default-src`. `'unsafe-eval'`
  is a warning. `'unsafe-inline'` is a warning unless the same list has a nonce, a
  `sha256-`/`sha384-`/`sha512-` hash or `'strict-dynamic'`, in which case browsers ignore it. The [csp](./csp) audit
  checks that those hashes match your inline scripts. The same option warns when `script-src`
  (or `default-src`) allows `*`, `https:`, `http:`, `data:` or `blob:` (not with `'strict-dynamic'`), when a CSP that governs scripts has no
  `object-src` (and no `default-src`) or no `base-uri`, and when a `<meta>` CSP sets
  `frame-ancestors`, `report-uri` or `sandbox`, which browsers ignore there. It also warns on
  wildcard hosts and known script-gadget hosts (`ajax.googleapis.com`, `cdnjs.cloudflare.com`, `*.cloudfront.net`, …) in
  `script-src`, `'unsafe-hashes'`, `'unsafe-inline'`/`'unsafe-eval'` in `style-src`, `report-uri` without
  `report-to`, and a missing `form-action` on pages with a `<form>`.
- **Mixed content** (`security.mixedContent`): any `http://` or `ws://` URL in `<script src>`,
  `<img src|srcset>`, `<source src|srcset>`, `<iframe src>`, `<video src|poster>`,
  `<audio src>`, `<track src>`, `<input type="image" src>`, `<object data>`, `<embed src>`, and `<link href>` with `rel`
  `stylesheet`, `icon`, `apple-touch-icon`, `apple-touch-icon-precomposed`, `mask-icon`, `preload`,
  `modulepreload` or `manifest` (including `imagesrcset`),
  `<svg>` `<image href|xlink:href>`, `url(…)` and `@import` in inline `<style>` blocks, and
  `url(…)` in `style="…"` attributes. External CSS files are not scanned. Each URL is an error,
  `mixed content: http://…` (or `ws://…`). Plain `<a href="http://…">` links are not mixed content. A `<form action>` or `formaction` over `http://` is a navigation, not a subresource, so it is a warning instead: `form submits over http: http://…`.
- **Subresource integrity** (`security.sri`): a `<script src>` or `<link rel="stylesheet">` on
  another origin (not `siteUrl`) without an `integrity` attribute is a warning,
  `cross-origin <script> without integrity: https://…`. Protocol-relative `//cdn…` URLs count.
  A cross-origin one that has `integrity` but no `crossorigin` attribute is an error,
  `cross-origin <link> with integrity but no crossorigin: https://…`: the browser fetches it
  in no-cors mode, cannot run the integrity check, and blocks it. Fix: add `crossorigin="anonymous"`.
  The same check applies to a `<link rel="preload">` or `<link rel="modulepreload">` that carries
  `integrity`; preloads without `integrity` (for example fonts) are not flagged.

### security.txt (`security.securityTxt`)

[RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) asks every site to publish
`/.well-known/security.txt` so researchers know where to report a vulnerability. vidimus reads
it from the build:

- Without `.well-known/security.txt` or a root `security.txt`: `no /.well-known/security.txt`
  (warning).
- Only a root `security.txt`: `security.txt is not under /.well-known/` (warning). The root
  location is a legacy fallback.
- No `Contact` field, or one that is not a `mailto:`, `tel:` or `https://` URI (`security@example.com`
  without `mailto:`, or `http://`, `ftp://` or `javascript:` values): error.
- No `Expires` field, more than one, one that is not an RFC 3339 date-time (a date alone or a time without an offset), or one in the past
  (`security.txt expired on …`): error. An `Expires` more than a year away is a warning, since
  the RFC recommends reviewing the file at least yearly.
- A file that is not valid UTF-8: error (RFC 9116 §4).
- A PGP-signed file with no `Canonical` field: warning (RFC 9116 §2.3 recommends it).
- More than one `Preferred-Languages` field: error (RFC 9116 §2.5.6 allows one).

A PGP-signed file is read as is; the signature block is ignored. When `siteUrl` has a path
(`https://example.github.io/project/`), the check is skipped with a log line: the file belongs
at the origin root, which the build does not own.

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
| `security.csp` | `'warn'` | report pages without a CSP, or with one that does not restrict scripts; `'error'` or `false` |
| `security.clickjacking` | `true` | require `frame-ancestors` or `X-Frame-Options` |
| `security.unsafeInline` | `true` | warn on `'unsafe-inline'` without hashes or nonces, and on `'unsafe-eval'` |
| `security.mixedContent` | `true` | fail on resources loaded over `http://` |
| `security.sri` | `true` | warn on cross-origin scripts and stylesheets without `integrity` |
| `security.securityTxt` | `true` | check `/.well-known/security.txt`; warn when it is missing |
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

A recommended `dist/_headers` that passes every default header check. Adjust the CSP to what your
pages load. The CSP below only sets `frame-ancestors`, so the `security.csp` check still reports that it does not restrict scripts:

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

A `security.txt` that passes, in `public/.well-known/security.txt` (renew `Expires` before it
lapses):

```text
Contact: mailto:security@example.com
Expires: 2027-06-30T00:00:00Z
Preferred-Languages: en
Canonical: https://example.com/.well-known/security.txt
```

## Standards

Each standard below is one the audit checks against; the bullets list the cases it checks.

### Content Security Policy Level 3

[Content Security Policy Level 3](https://www.w3.org/TR/CSP3/) (W3C Working Draft)

- `<meta>` delivery: `frame-ancestors`, `report-uri` and `sandbox` in a `<meta>` policy are ignored by browsers, so they are warned about and never count.
- Duplicate directives: the first occurrence wins; later ones are ignored.
- Directive names and keywords match case-insensitively; nonce and hash values stay case-sensitive.
- Script fallback: `script-src-elem`, then `script-src`, then `default-src`. `object-src` falls back to `default-src`; `base-uri` and `form-action` do not, so each must be present.
- `'unsafe-inline'` is inert when a nonce or a `sha256`, `sha384` or `sha512` hash is in the list, so it is not reported then; `'unsafe-eval'` is always reported.
- `'unsafe-hashes'` in `script-src` is reported: it re-enables hash matching for inline event handlers and `javascript:` URLs.
- Broad source expressions (`*`, `https:`, `http:`, `data:`, `blob:`) in `script-src` are reported unless `'strict-dynamic'` is present.
- `frame-ancestors`: a bare `*`, a scheme-only source or `scheme://*` matches any origin, so it is not clickjacking protection.

### HTTP Strict Transport Security (RFC 6797)

[HTTP Strict Transport Security (RFC 6797)](https://www.rfc-editor.org/rfc/rfc6797)

- §6.1.1: `max-age` is required and, by default, must be at least 31536000 seconds. Only a directive named exactly `max-age` counts: `x-max-age=99999999; max-age=0` fails.
- §6.1.2: a policy without `includeSubDomains` is a warning (`strict-transport-security lacks includeSubDomains`), since one http subdomain can set cookies for the parent domain.
- §6.2: a quoted `max-age` value is accepted.
- §6.1: directive names match case-insensitively.
- §8.1: HSTS is not checked on loopback `http://` origins, where browsers ignore it.

### HSTS preload submission

[HSTS preload submission](https://hstspreload.org/)

- The default requirement plus the `includeSubDomains` warning cover the first two submission requirements: a one-year `max-age` and `includeSubDomains`. The `preload` directive is not checked (see Not checked).

### Security.txt (RFC 9116)

[Security.txt (RFC 9116)](https://www.rfc-editor.org/rfc/rfc9116)

- §3: `/.well-known/security.txt` is the location. A root-only file is warned about; when both exist, the `.well-known` file is read.
- `Contact` is required, may repeat, and must be a `mailto:`, `tel:` or `https://` URI.
- `Expires` is required, may appear once, and must be an RFC 3339 date-time with an offset.
- `Canonical` is warned about when the file is PGP-signed and has none (§2.3 recommends it).
- `Preferred-Languages` may appear at most once.
- §4: the file must be valid UTF-8.
- Field names match case-insensitively; `#` lines are comments; CRLF and LF line endings both parse.

### RFC 3339 date-time

[RFC 3339 date-time](https://www.rfc-editor.org/rfc/rfc3339)

- `Expires` needs an offset (`Z` or `±hh:mm`); a date alone or a local time fails. Fractional seconds and lower-case `t` and `z` are accepted.

### X-Frame-Options (RFC 7034)

[X-Frame-Options (RFC 7034)](https://www.rfc-editor.org/rfc/rfc7034)

- Only `DENY` and `SAMEORIGIN` count as clickjacking protection; other values, such as `ALLOW-FROM`, do not.

### X-Content-Type-Options (Fetch Standard) and [MIME Sniffing](https://mimesniff.spec.whatwg.org/)

[X-Content-Type-Options (Fetch Standard)](https://fetch.spec.whatwg.org/)

- `nosniff` is matched as the whole value, case-insensitively.

### Referrer Policy

[Referrer Policy](https://www.w3.org/TR/referrer-policy/) (W3C Candidate Recommendation)

- A comma-separated fallback list is judged by its last recognised token; unknown tokens are skipped.
- `unsafe-url` and `no-referrer-when-downgrade` fail when they are that effective token.

### Subresource Integrity

[Subresource Integrity](https://www.w3.org/TR/SRI/)

- A cross-origin `<script>` or stylesheet without `integrity` is warned about.
- With `integrity` but no `crossorigin`, the tag is an error: the browser fetches it in no-cors mode and cannot run the check.
- A cross-origin `<link rel="preload">` or `modulepreload` that carries `integrity` gets the same `crossorigin` error.

### Mixed Content

[Mixed Content](https://www.w3.org/TR/mixed-content/) (W3C Candidate Recommendation)

- `http://` and `ws://` subresources are errors; `https://` and `wss://` are not.
- A plain `<a href>` is navigation, not a subresource, so it is not flagged.

### HTTP field values (RFC 9110)

[HTTP field values (RFC 9110)](https://www.rfc-editor.org/rfc/rfc9110)

- Values of one header set by several matching rules are combined with `, `, and a repeated value is dropped.

### Netlify headers

[Netlify headers](https://docs.netlify.com/manage/routing/headers/)

- `_headers` path patterns, indented `Name: value` lines and `!` detach; `netlify.toml` `[[headers]]` blocks with `for` and `[headers.values]`.

### Vercel project configuration

[Vercel project configuration](https://vercel.com/docs/projects/project-configuration#headers)

- `headers` entries with a `source` and a `headers` list of `key` and `value` pairs.

### Firebase Hosting configuration

[Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config#headers)

- `hosting.headers`, with `hosting` allowed to be an array.

### Azure Static Web Apps configuration

[Azure Static Web Apps configuration](https://learn.microsoft.com/azure/static-web-apps/configuration)

- `globalHeaders` and `routes[].headers`.

### Not checked

- The HSTS `preload` directive and the rest of the hstspreload.org requirements.
- Permissions-Policy: only presence is checked. The value is not parsed as an [RFC 9651](https://www.rfc-editor.org/rfc/rfc9651) Structured Field dictionary, and its features are not checked against the [Permissions Policy](https://www.w3.org/TR/permissions-policy/) spec.
- `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`, `Cross-Origin-Resource-Policy` and `Origin-Agent-Cluster` are not required by default; add them under `security.require`.
- Trusted Types (`trusted-types`, `require-trusted-types-for`) is not checked.
- `upgrade-insecure-requests` and `block-all-mixed-content` are ignored: any `http://` URL is reported even where the policy would upgrade or block it.
- `report-to` is not matched to a `Reporting-Endpoints` header.
- Integrity hashes are not compared with the real file: cross-origin files are never downloaded.
- Mixed content does not scan `<use href>`, `<meta http-equiv="refresh">`, `<base href>`, external CSS files, or requests made by inline scripts (`fetch`, `new WebSocket`).
- SRI covers only `<script>`, stylesheets and `preload`/`modulepreload` links with `integrity`; icons and other resources are not checked.
- Under `'strict-dynamic'`, `script-src` source warnings are skipped and `'unsafe-inline'` counts as guarded. This audit does not check static script tags for a nonce; the [csp](./csp) audit does.
- Netlify's rule for combining one header from several matching rules is not verified against Netlify's documentation.
- Security.txt: the served `Content-Type`, the `https:` scheme of the file's URL, the `Encryption`, `Acknowledgments`, `Policy` and `Hiring` fields, and the PGP signature are not checked.
