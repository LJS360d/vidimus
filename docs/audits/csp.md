---
title: csp
description: The csp audit checks that inline code is hashed in the page's CSP and that every request the site's HTML, CSS and JavaScript can make is allowed by it.
---

# csp: inline code against the CSP

A strict Content Security Policy blocks every inline `<script>` and `<style>` it does not explicitly allow. On a static site the usual way to allow them is a `sha256-…` hash per block in a `<meta http-equiv="content-security-policy">` tag. When a build changes an inline block, its hash changes, the browser silently refuses to run it, and the only trace is a console error. `csp` recomputes the hash of every inline block and checks it is listed in the page's policy.

## Needs

Nothing to install. The audit reads the HTML files in the build (`requires: 'dist'`); no server is started for it.

With [`render.mode`](../how-it-works#client-rendered-sites) on, it checks the DOM a browser
renders instead of the shipped HTML file.

## Run it

```sh
npx vidimus csp
```

It is part of the default set.

## What it checks

For every HTML file in the build that is not excluded:

1. It looks for a `<meta http-equiv="content-security-policy" content="…">` tag. Pages with no policy from any source (meta tag, served header or `server.headers`, see below) are skipped. Attribute order and quoting do not matter, and the tag may span several lines. Every such tag is read as one policy (a comma there does not split it, CSP3 §3.3); a `Content-Security-Policy` header value is split into policies at every comma (§2.2.3). A block must satisfy all of them.
2. For each block it picks the effective directive, `script-src` or `style-src`, falling back to `default-src`. Blocks are skipped when no directive restricts them, or when the directive allows `'unsafe-inline'` and lists no hashes or nonces.
3. For every other inline `<script>` and `<style>` element it computes the sha256, sha384 and sha512 of the element's content, exactly as the browser does (whitespace included), and reports each block whose hash is not listed in the effective directive.

Blocks that are not checked:

- `<script src="…">`: external scripts are covered by source lists, a matching nonce, or a hash source equal to every item of their `integrity` attribute (CSP3 §6.7.2.3), not by hashing the file.
- empty or whitespace-only blocks.
- script elements whose `type` is not JavaScript, such as `application/json`, `application/ld+json` and `text/x-template`, which browsers do not execute.

Everything else is checked, including `type="module"` and import maps. A `<script nonce>` or `<style nonce>` is allowed when the policy has the same `'nonce-…'` source; a nonce repeated on every page is a warning, since it must change per response. Inline code is checked against every enforced policy: meta tags, the header rules the `security` audit reads (`_headers`, `vercel.json`, `netlify.toml`, `firebase.json`, `staticwebapp.config.json`, or the `origin` response) and `server.headers`. A block must satisfy all of them.

Attributes are checked too, against the effective directive (`style-src-attr` then `style-src` for `style="…"`; `script-src-attr` then `script-src` for event handler attributes such as `onclick="…"` (the HTML, Pointer, Touch, Animation, Transition and Fullscreen handler names; `once=` is not one); `script-src-elem` then `script-src` for `javascript:` hrefs; each falling back to `default-src`). They are blocked unless the directive allows `'unsafe-inline'` with no hashes or nonces, or lists `'unsafe-hashes'` with the attribute's hash: `inline style= attribute blocked by CSP`.

An `<iframe srcdoc>` document inherits the policy of the page that embeds it, so the inline blocks in its markup are checked against the same policy: `inline <style> in <iframe srcdoc> has no CSP hash …`.

### Iframes

For every `<iframe src>` over `http(s)`, on every page:

- **Blocked embeds.** The policies that apply to the page are its meta CSP, the `Content-Security-Policy` header it is served with, and the `server.headers` rules that match its path. The frame directive in effect is `frame-src`, else `child-src`, else `default-src`; with none, frames are not restricted. An iframe whose URL that directive does not allow is a failing finding, `<iframe> from https://evil.example is blocked by frame-src`: the browser would show an empty box. `'self'` is the `siteUrl` origin and relative URLs; host sources with `*.` wildcards, schemes, ports and paths are matched as browsers do.
- **Sandbox.** An iframe from another origin than `siteUrl` without a `sandbox` attribute is a warning, `third-party <iframe> from https://www.youtube-nocookie.com without sandbox`. Turn it off with `csp.sandbox: false`.

`frame-ancestors`, which decides who may embed your site, cannot be set in a meta CSP; the [`security`](./security) audit checks it in headers.

### Requests the code can make

A policy can block a request that has not happened yet: a `fetch()` behind a button, a translations API loaded on language change, a font imported by a stylesheet. Checking only requests seen in a browser run misses them, so the audit reads the code instead. For every page with a policy (a meta CSP, a served `Content-Security-Policy` header or a `server.headers` rule), it scans:

- the page's HTML: `<img>`, `<input type="image">`, `<image href>`, `<source>`, `<video>`/`<audio>`/`<track>`, `<object>`, `<embed>`, `<script src>`, `<link>` (stylesheets, icons, manifest, preloads, prefetch), `<form action>` and `style=""` attributes, with relative URLs resolved against `<base href>`;
- inline and external JavaScript, following the `<script src>` files and the chunks they import (`import "./chunk.js"`, `import("…")`, `new Worker(…)`) inside the build;
- inline and external CSS, following `@import`: `url()` and `@font-face`.

Each target is checked against the directive in effect for its kind (`connect-src` for `fetch`, XHR, `WebSocket`, `EventSource` and `sendBeacon`; `img-src`, `font-src`, `media-src`, `worker-src`, `form-action`, …, each falling back as browsers do):

- **A literal in a request call** such as `fetch("https://api.example.com/x")` or `new WebSocket("wss://…")` that the policy blocks is a failing finding, `fetch() to https://api.example.com is blocked by connect-src`.
- **A URL that only appears in the code**, like `const API = "https://api.example.com"`, is a warning, `https://api.example.com appears in the code and would be blocked by connect-src`. It is reported because the code can use it; the directive is guessed from the file extension, else `connect-src`.

The scan is static. URLs built at run time (`fetch(base + path)`, with `base` not a literal URL anywhere) cannot be found, and under `'strict-dynamic'` scripts loaded by code (`import()`, `importScripts()`, `new Worker(…)`) are not checked. A `<script src>` tag is still checked, and passes only with a `'nonce-…'` source that matches its `nonce`. Without `'strict-dynamic'`, a `<script src>`, `<link rel="stylesheet">` or `<link rel="modulepreload">` whose `nonce` matches a `'nonce-…'` source passes wherever it loads from; otherwise its URL must match a source. XML namespaces such as `http://www.w3.org/2000/svg` are ignored; add other URLs to `csp.ignore`.

If no page in the build has a CSP or embeds a third-party iframe, the audit is skipped.

## Example output

```
─── csp ─────────────────────────────────────────────────────────

✖ inline <script> has no CSP hash 'sha256-grSKtzTyWzK3U3gH+Hy9nXsKrEMp4ip3zNEsMv5RHYM='
    document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light…
    in: dist/index.html
    → Add 'sha256-grSKtzTyWzK3U3gH+Hy9nXsKrEMp4ip3zNEsMv5RHYM=' to script-src in the CSP, or move the code to a file.

✖ inline <style> has no CSP hash 'sha256-egm7B1NCtsuIIqSmjXl7Ql5BDoP5oSS1hYO+v3RydGw='
    .hero{background:url(/img/hero.avif) center/cover}…
    in: dist/about/index.html
    → Add 'sha256-egm7B1NCtsuIIqSmjXl7Ql5BDoP5oSS1hYO+v3RydGw=' to style-src in the CSP, or move the code to a file.

✖ csp: 2 of 38 inline block(s) would be blocked. Add their hashes to the CSP. (0.1s)
```

The detail line is the first 80 characters of the trimmed block, always followed by `…`. A passing run:

```
✔ csp: 38 inline blocks across 12 pages, all hashed (0.1s)
```

When no page has a CSP or embeds an iframe:

```
○ csp: no page has a CSP or embeds an iframe (0.0s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `csp.exclude` | `[]` | built file paths to skip, e.g. `^admin/` |
| `csp.sandbox` | `true` | warn about third-party iframes without `sandbox` |
| `csp.requests` | `true` | check the requests the HTML, CSS and JavaScript can make against the CSP |
| `csp.ignore` | `[]` | full URLs (regular expressions) the request check skips, e.g. `^https://docs\\.example\\.com/` |

Unlike the other audits' `exclude`, `csp.exclude` matches file paths in the build (`admin/index.html`), the same as the top-level `exclude`, not URL paths.

## Config example

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  csp: { exclude: ['^admin/', '^preview/'] },
});
```

## Common fixes

Copy the hash from the finding into the policy, in `script-src` for scripts and `style-src` for styles:

```html
<meta
  http-equiv="content-security-policy"
  content="default-src 'self'; script-src 'self' 'sha256-grSKtzTyWzK3U3gH+Hy9nXsKrEMp4ip3zNEsMv5RHYM='; style-src 'self' 'sha256-egm7B1NCtsuIIqSmjXl7Ql5BDoP5oSS1hYO+v3RydGw='"
>
```

A hash is tied to the exact bytes of the block. Reformatting, a minifier change or an interpolated value (a build timestamp, a per-page title) produces a new hash on every build. For blocks like that, moving the code into a file served from `'self'` is more robust than chasing hashes.

If your framework generates the hashes itself, a finding usually means something changed the HTML after the hashes were computed, such as a post-processing step that minifies or injects code.

## Standards

### Content Security Policy Level 3

[Content Security Policy Level 3](https://www.w3.org/TR/CSP3/), a W3C Working Draft that every current browser ships.

- Hash sources: `sha256`, `sha384` and `sha512` are computed over the exact bytes of the block; `base64` and `base64url` spellings of the same digest are equal (§2.3.2).
- Nonce sources match the element's `nonce` attribute as an exact, case-sensitive string (§2.3.2).
- `'unsafe-inline'` is ignored when the source list has a hash, a nonce or `'strict-dynamic'` (§6.7.3.3); on its own it allows inline blocks and attributes.
- `'unsafe-hashes'` gates the hash check for `style=""`, `on*` handlers and `javascript:` hrefs, which look up `style-src-attr`, `script-src-attr` and `script-src-elem` before `style-src` and `script-src`.
- Fallback for fetch directives: `frame-src`, then `child-src`, then `default-src`; `worker-src`, then `child-src`, `script-src` and `default-src`; `script-src-elem` and `style-src-elem` fall back to `script-src` and `style-src`, then `default-src`; `form-action` has no `default-src` fallback.
- A repeated directive keeps its first occurrence; directive names and keywords are case-insensitive.
- `'none'` matches nothing; `*` matches only `http`, `https`, `ws` and `wss` URLs.
- Host sources: `*.example.com` matches subdomains but not `example.com`; a missing port means the scheme's default; a path ending in `/` is a prefix, any other path must match exactly.
- A host source without a scheme matches the page's scheme and its `ws`/`wss` counterpart.
- Scheme sources: `http:` also matches `https:` URLs and `ws:` also matches `wss:`; `http://host:80` also matches `https://host:443`.
- `'self'` matches the site's origin and its `ws`/`wss` counterpart. Same-site URLs are matched as the `siteUrl` origin, so a host source naming the site's own host allows them too.

**Not checked**

- Only the enforced header is read; `Content-Security-Policy-Report-Only` is ignored.
- `upgrade-insecure-requests` and `block-all-mixed-content` are not read. An external `http://` URL that the policy allows only as `https:` is reported as blocked, although the browser upgrades it.
- `require-trusted-types-for` and `trusted-types` are not checked.
- `<base href>` is not checked against `base-uri`.
- Keyword strength, such as `'unsafe-eval'` or `blob:` in `script-src`, is judged by the [`security`](./security) audit.
