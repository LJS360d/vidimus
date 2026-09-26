---
title: assets
description: How the assets audit checks favicons, the web app manifest, Open Graph and Twitter card tags, and the 404 page.
---

# assets: icons, manifest, social cards, 404

`assets` checks the files around your pages that browsers, phones and social networks look
for: the favicon, the Apple touch icon, the web app manifest and its icons, the Open Graph image
shown when someone shares a link, and the page served for missing URLs. These break quietly: a
renamed icon or a relative `og:image` looks fine in the browser and only shows up as a blank
tab icon or a card without a picture. It is not in the default set.

## Needs

Nothing to install. It reads the build (`dist/`) and starts no server or browser. Set the
top-level `siteUrl` so absolute `og:image` URLs on your site are checked against the build and
`og:url` is checked against your origin.

## Run it

```sh
npx vidimus assets
```

## What it checks

Pages matched by the top-level `exclude` or `assets.exclude` are skipped; by default that is
the 404 page. Each check can be turned off on its own.

### Favicon (`assets.favicon`)

- Every `<link rel="icon">` and `<link rel="apple-touch-icon">` on your site that points at a
  local file must resolve to a file in the build: `icon /favicon.svg not found` (error).
  `rel="shortcut icon"` counts as `icon`.
- If no page has a `<link rel="icon">` and there is no `/favicon.ico` in the build root:
  `no favicon: add <link rel="icon"> or /favicon.ico` (error).
- If no page has a `<link rel="apple-touch-icon">` and there is no `/apple-touch-icon.png`:
  `no <link rel="apple-touch-icon"> on any page` (warning).

### Web app manifest (`assets.manifest`)

A manifest is optional; these checks run for each one a page links with `<link rel="manifest">`,
and each finding lists the pages that link it.

- The file exists (`manifest /site.webmanifest not found`) and parses as a JSON object
  (`manifest /site.webmanifest is not valid JSON`).
- It has a `name` or `short_name` (`manifest … has no name or short_name`).
- It has a non-empty `icons` array (`manifest … has no icons`), and each icon `src`, resolved
  relative to the manifest, exists in the build (`manifest icon /icons/512.png not found`).
- At least one icon is 512 pixels or larger on its shorter side, from its declared `sizes`
  (`"any"` counts) or its measured size: otherwise
  `manifest … has no icon of at least 512x512` (warning).

### Open Graph and Twitter cards (`assets.openGraph`)

Pages with `<meta name="robots" content="noindex">` are skipped, since they are not meant to
be shared.

- `og:title`, `og:image` and `twitter:card` are present and not empty; each missing one is a
  warning such as `missing <meta property="og:image">`. vidimus accepts the key in either the
  `property` or the `name` attribute.
- `og:image` is an absolute URL (`og:image "/og.png" is not an absolute URL`, error). Social
  networks do not resolve relative URLs.
- An `og:image` on your site exists in the build (`og:image /og.png not found`, error) and,
  when its size can be read (PNG, JPEG, GIF, WebP, AVIF, SVG), is at least `assets.ogImage`:
  `og:image /og.png is 800x418, smaller than 1200x630` (warning).
- With `siteUrl` set, `og:url` is on the same origin:
  `og:url origin https://staging.example.com differs from siteUrl https://example.com` (error).

### 404 page (`assets.notFound`)

Without `404.html` or `404/index.html` in the build: `no 404 page (404.html or 404/index.html)`
(warning). Most static hosts serve that file for missing URLs.

## Example output

```
─── assets ──────────────────────────────────────────────────────

✖ og:image "/og/home.png" is not an absolute URL
    on: /
    → Use an absolute URL, e.g. <meta property="og:image" content="https://example.com/og/home.png">.

✖ manifest icon /icons/icon-512.png not found
    in: dist/site.webmanifest
    on: / /about/ /blog/ +9 more
    → Add /icons/icon-512.png to the build or fix its "src" in /site.webmanifest.

⚠ missing <meta name="twitter:card">
    on: /about/ /blog/ /contact/ +8 more
    → Add <meta name="twitter:card" content="summary_large_image"> to the <head>.

⚠ no <link rel="apple-touch-icon"> on any page
    → Add a 180x180 PNG and <link rel="apple-touch-icon" href="/apple-touch-icon.png">.

✖ assets: 4 problem(s) across 12 page(s) (0.1s)
```

A clean run ends with `✔ assets: 12 page(s), all assets in place`.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `assets.favicon` | `true` | check favicon and Apple touch icon links |
| `assets.manifest` | `true` | check linked web app manifests and their icons |
| `assets.openGraph` | `true` | check `og:title`, `og:image`, `twitter:card` and `og:url` |
| `assets.ogImage` | `{ width: 1200, height: 630 }` | warn when `og:image` is smaller than this |
| `assets.notFound` | `true` | warn without a 404 page |
| `assets.exclude` | `['^/404(\\.html\|/)?$']` | URL path patterns to skip |

Top-level keys used: `siteUrl`, `exclude`.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.com',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'assets'],
  assets: {
    manifest: false,
    ogImage: { width: 1200, height: 600 },
    exclude: ['^/404(\\.html|/)?$', '^/embed/'],
  },
});
```

Arrays replace, so repeat the 404 pattern when you add to `assets.exclude`.

## Common fixes

The head tags that pass every check:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">

<meta property="og:title" content="Pricing and plans">
<meta property="og:url" content="https://example.com/pricing/">
<meta property="og:image" content="https://example.com/og/pricing.png">
<meta name="twitter:card" content="summary_large_image">
```

Build the `og:image` and `og:url` from the same site URL your framework uses for canonical
links (`Astro.site` in Astro, `.Permalink` or `absURL` in Hugo) so they stay absolute.

A minimal `site.webmanifest`, with a 512px icon:

```json
{
  "name": "Example",
  "short_name": "Example",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Put the icons, the manifest, `favicon.ico` and `apple-touch-icon.png` (180x180) in the folder
your framework copies to the build as is, usually `public/` (`static/` in Hugo). Add a
`404.html` page there or as a route; see [Frameworks](../frameworks) for where each one expects
it.
