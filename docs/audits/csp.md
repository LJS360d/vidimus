---
title: csp
description: The csp audit checks that every inline script and style in the build is allowed by a sha256 hash in the page's meta CSP.
---

# csp: inline code against the meta CSP

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

1. It looks for a `<meta http-equiv="content-security-policy" content="…">` tag. Pages without one are skipped. The tag must have `http-equiv` before `content`, both quoted. Only the first such tag on a page is read.
2. It collects every `sha256-…` source in that policy. Other hash algorithms and nonces are not read.
3. For every inline `<script>` and `<style>` element it computes the sha256 of the element's content, exactly as the browser does (whitespace included), and reports each block whose hash is not in the policy.

Blocks that are not checked:

- `<script src="…">`: external scripts are covered by source lists, not hashes.
- empty or whitespace-only blocks.
- JSON data blocks, `type="application/json"` and `type="application/ld+json"`, which browsers do not execute.

Everything else is checked, including `type="module"` and import maps. The audit does not check which directive a hash is in: a hash anywhere in the policy counts. It does not look at `style="…"` attributes, event handler attributes or CSP response headers; the [`security`](./security) audit covers headers.

An `<iframe srcdoc>` document inherits the policy of the page that embeds it, so the inline blocks in its markup are checked against the same hashes: `inline <style> in <iframe srcdoc> has no CSP hash …`.

### Iframes

For every `<iframe src>` over `http(s)`, on every page:

- **Blocked embeds.** The policies that apply to the page are its meta CSP and the `Content-Security-Policy` headers of the `server.headers` rules that match its path. The frame directive in effect is `frame-src`, else `child-src`, else `default-src`; with none, frames are not restricted. An iframe whose URL that directive does not allow is a failing finding, `<iframe> from https://evil.example is blocked by frame-src`: the browser would show an empty box. `'self'` is the `siteUrl` origin and relative URLs; host sources with `*.` wildcards, schemes, ports and paths are matched as browsers do.
- **Sandbox.** An iframe from another origin than `siteUrl` without a `sandbox` attribute is a warning, `third-party <iframe> from https://www.youtube-nocookie.com without sandbox`. Turn it off with `csp.sandbox: false`.

`frame-ancestors`, which decides who may embed your site, cannot be set in a meta CSP; the [`security`](./security) audit checks it in headers.

If no page in the build declares a meta CSP or embeds a third-party iframe, the audit is skipped.

## Example output

```
─── csp ─────────────────────────────────────────────────────────

✖ inline <script> has no CSP hash 'sha256-grSKtzTyWzK3U3gH+Hy9nXsKrEMp4ip3zNEsMv5RHYM='
    document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light…
    in: dist/index.html
    → Add 'sha256-grSKtzTyWzK3U3gH+Hy9nXsKrEMp4ip3zNEsMv5RHYM=' to script-src in the meta CSP, or move the code to a file.

✖ inline <style> has no CSP hash 'sha256-egm7B1NCtsuIIqSmjXl7Ql5BDoP5oSS1hYO+v3RydGw='
    .hero{background:url(/img/hero.avif) center/cover}…
    in: dist/about/index.html
    → Add 'sha256-egm7B1NCtsuIIqSmjXl7Ql5BDoP5oSS1hYO+v3RydGw=' to style-src in the meta CSP, or move the code to a file.

✖ csp: 2 of 38 inline block(s) would be blocked. Add their hashes to the CSP. (0.1s)
```

The detail line is the first 80 characters of the trimmed block, always followed by `…`. A passing run:

```
✔ csp: 38 inline blocks across 12 pages, all hashed (0.1s)
```

When no page has a meta CSP:

```
○ csp: no page declares a meta CSP or embeds an iframe (0.0s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `csp.exclude` | `[]` | built file paths to skip, e.g. `^admin/` |
| `csp.sandbox` | `true` | warn about third-party iframes without `sandbox` |

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
