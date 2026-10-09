---
title: assets
description: How the assets audit checks favicons, the web app manifest, Open Graph and Twitter card tags, the 404 page, and the ads.txt, change-password and app association files a site needs.
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

With [`render.mode`](../how-it-works#client-rendered-sites) on, it checks the DOM a browser
renders instead of the shipped HTML file.

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

If no page links a manifest: `no <link rel="manifest"> on any page` (warning). Browsers need one
to install the site and to pick its name, icons and theme color. The checks below run for each
manifest a page links with `<link rel="manifest">`, and each finding lists the pages that link it.

- The file exists (`manifest /site.webmanifest not found`) and parses as a JSON object
  (`manifest /site.webmanifest is not valid JSON`).
- It has a `name` or `short_name` (`manifest … has no name or short_name`).
- It has a non-empty `icons` array (`manifest … has no icons`), and each icon `src`, resolved
  relative to the manifest, exists in the build (`manifest icon /icons/512.png not found`).
- At least one icon is 512 pixels or larger on its shorter side, from its measured size or,
  when the file cannot be measured, its declared `sizes` (`"any"` counts): otherwise
  `manifest … has no icon of at least 512x512` (warning).
- It has a `start_url` (`manifest … has no start_url`, warning) that resolves inside `scope`
  (default: the manifest's directory) and exists in the build (`manifest … start_url /x/ is outside
  scope /app/`, `manifest start_url /x/ not found`, errors).
- `display`, when set, is `fullscreen`, `standalone`, `minimal-ui` or `browser`
  (`manifest … display "huge" is not valid`, error).
- At least one icon has `"purpose": "maskable"` (`manifest … has no maskable icon`, warning).
- An icon's declared `sizes` match its measured size (`manifest icon /i.png declares 192x192 but is
  512x512`, warning).

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
- That `og:image` is not SVG or AVIF, which social crawlers do not accept
  (`og:image /og.svg is SVG, which social crawlers do not accept`, error), and weighs at most
  1 MB (`og:image /og.png is 2.0 MB, over the 1 MB limit`, warning); over 8 MB it is an error.
- `og:image:alt` is present whenever `og:image` is set (`missing <meta property="og:image:alt"> for og:image`,
  warning), and `og:image:width` / `og:image:height`, when present, match the measured image
  (`og:image:height is 600 but /og.png is 630`, warning).
- `twitter:image`, when set, exists in the build and is not SVG or AVIF
  (`twitter:image /gone.png not found`, error). Without it, `twitter:card` falls back to `og:image`.
- With `siteUrl` set, `og:url` is on the same origin:
  `og:url origin https://staging.example.com differs from siteUrl https://example.com` (error).

### 404 page (`assets.notFound`)

Without `404.html` or `404/index.html` in the build: `no 404 page (404.html or 404/index.html)`
(warning). Most static hosts serve that file for missing URLs.

### Files the site turns out to need

Some root files only matter for some sites: `ads.txt` for sites that show ads, a
change-password URL for sites with accounts, app association files for sites with an app.
vidimus looks for signs in the pages and checks the file only when a sign is there, so you
don't need to know the file exists to be told you need it. Each option takes `'auto'`
(default: check when a sign is found), `'on'` (always check) or `'off'`. A missing file is a
warning listing the pages that gave the sign away; an invalid one is an error.

| Option | Sign in the pages | File |
| --- | --- | --- |
| `assets.adsTxt` | a publisher ad tag: AdSense, Google Publisher Tag, Amazon, Prebid, Xandr, Media.net, Ezoic, Mediavine, Raptive, Taboola, Outbrain, Criteo, PubMatic, Magnite, OpenX, Carbon | `/ads.txt` |
| `assets.changePassword` | an `<input type="password">` or `autocomplete="current-password"`/`"new-password"` | `/.well-known/change-password` |
| `assets.appleAppSiteAssociation` | `<meta name="apple-itunes-app">`, an `ios-app://` alternate link, or `"platform": "itunes"` in the manifest's `related_applications` | `/.well-known/apple-app-site-association` |
| `assets.assetLinks` | `<meta name="google-play-app">`, an `android-app://` alternate link, or `"platform": "play"` in `related_applications` | `/.well-known/assetlinks.json` |

- **ads.txt**: every record must read `<domain>, <account id>, DIRECT|RESELLER[, <cert id>]`
  (`ads.txt has malformed lines`, with the line numbers), and there must be at least one. An
  AdSense `ca-pub-…` ID found in a page must have its `google.com, pub-…` line:
  `ads.txt does not list AdSense publisher pub-…`. Advertiser pixels such as Google Ads
  conversion tracking don't count as ads. An `app-ads.txt` in the build is checked the same
  way; vidimus never asks for one, since no page can tell whether your app shows ads.
- **change-password** ([W3C](https://w3c.github.io/webappsec-change-password-url/)): lets
  password managers send users straight to the page where they change their password. It
  counts when the build has the path as a file or folder, or `_redirects` has a rule from it.
  The fix suggests the first page with an `autocomplete="new-password"` field as target. A
  redirect set up on the server instead is invisible in the build: set the option to `'off'`.
- **apple-app-site-association**: `.well-known/` or the root, a JSON object with an
  `applinks`, `webcredentials`, `appclips` or `activitycontinuation` section.
- **assetlinks.json**: a non-empty JSON array of statements with `relation` and `target`.

These files live at the origin root, so with a `siteUrl` path (`https://example.github.io/project/`)
the checks are skipped with a log line.

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
| `assets.manifest` | `true` | warn without a manifest, check linked ones and their icons |
| `assets.openGraph` | `true` | check `og:title`, `og:image`, `twitter:card` and `og:url` |
| `assets.ogImage` | `{ width: 1200, height: 630 }` | warn when `og:image` is smaller than this |
| `assets.notFound` | `true` | warn without a 404 page |
| `assets.adsTxt` | `'auto'` | check `/ads.txt` (and an existing `/app-ads.txt`) when a page shows ads |
| `assets.changePassword` | `'auto'` | check `/.well-known/change-password` when a page has a password field |
| `assets.appleAppSiteAssociation` | `'auto'` | check the iOS app association file when the site points at an iOS app |
| `assets.assetLinks` | `'auto'` | check `assetlinks.json` when the site points at an Android app |
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
