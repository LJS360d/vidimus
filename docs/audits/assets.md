---
title: assets
description: How the assets audit checks favicons, the web app manifest, Open Graph tags, the 404 page, and the ads.txt and well-known files a site needs.
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
  The href must name the file itself; an `.html` page or a directory `index.html` with the same
  path does not count. `rel="shortcut icon"` counts as `icon`.
- If no page has a `<link rel="icon">` and there is no `/favicon.ico` in the build root:
  `no favicon: add <link rel="icon"> or /favicon.ico` (error).
- If no page has a `<link rel="apple-touch-icon">` and there is no `/apple-touch-icon.png`:
  `no <link rel="apple-touch-icon"> on any page` (warning).
- Each apple-touch-icon file, the `/apple-touch-icon.png` in the build root or a local file named by
  a `<link rel="apple-touch-icon">` (or `-precomposed`), is measured from its image header. An image
  that is not 180x180 gets `apple-touch-icon /touch.png is 120x120, not 180x180` (warning). Files
  whose size cannot be read are not reported.

### Web app manifest (`assets.manifest`)

If no page links a manifest: `no <link rel="manifest"> on any page` (warning). Browsers need one
to install the site and to pick its name, icons and theme color. The checks below run for each
manifest a page links with `<link rel="manifest">`, and each finding lists the pages that link it.

- The file exists (`manifest /site.webmanifest not found`) and parses as a JSON object
  (`manifest /site.webmanifest is not valid JSON`).
- It has a `name` or `short_name` (`manifest … has no name or short_name`).
- It has a non-empty `icons` array (`manifest … has no icons`), and each icon `src`, resolved
  relative to the manifest, exists in the build as that exact file (`manifest icon /icons/512.png
  not found`).
- At least one icon is 512 pixels or larger on its shorter side, from its measured size or,
  when the file cannot be measured, its declared `sizes` (`"any"` counts): otherwise
  `manifest … has no icon of at least 512x512` (warning).
- It has a `start_url` (`manifest … has no start_url`, warning) that resolves inside `scope`
  (default: the directory of `start_url`) and exists in the build (`manifest … start_url /x/ is outside
  scope /app/`, `manifest start_url /x/ not found`, errors).
- `display`, when set, is `fullscreen`, `standalone`, `minimal-ui` or `browser`
  (`manifest … display "huge" is not valid`, warning; browsers fall back to `browser`).
- At least one icon has `"purpose": "maskable"` (`manifest … has no maskable icon`, warning).
- An icon's declared `sizes` match its measured size (`manifest icon /i.png declares 192x192 but is
  512x512`, warning). An ICO icon is measured by its largest embedded image.

### Open Graph and Twitter cards (`assets.openGraph`)

Pages with `<meta name="robots" content="noindex">` are skipped, since they are not meant to
be shared.

- `og:title`, `og:type`, `og:image`, `og:url` and `twitter:card` are present and not empty in the
  document `<head>`; each missing one is a warning such as `missing <meta property="og:image">`.
  Tags placed in `<body>` do not count. vidimus accepts the key in either the `property` or the
  `name` attribute.
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
- `twitter:image`, when set, is an absolute URL (`twitter:image "/og.png" is not an absolute URL`, error),
  exists in the build and is not SVG or AVIF (`twitter:image /gone.png not found`, error). Without it,
  `twitter:card` falls back to `og:image`.
- `twitter:card` is one of the known card types (`twitter:card "big_card" is not a known card type`, warning).
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
  When `_headers` sets a `/ads.txt` type other than `text/plain`, the audit warns that it is
  served as that type.
- **change-password** ([W3C](https://w3c.github.io/webappsec-change-password-url/)): lets
  password managers send users straight to the page where they change their password. It
  counts when the build has the path as a file or folder, or a redirect rule (wildcards included) in `_redirects`, `vercel.json`, `netlify.toml`, `firebase.json` or `staticwebapp.config.json` covers it. With `origin` set, the audit requests the URL without following redirects instead, and counts only a 3xx response with a `Location` header; a page served at that URL does not count.
  The fix suggests the first page with an `autocomplete="new-password"` field as target. A
  redirect only the server knows about is invisible in the build: set the option to `'off'`.
- **apple-app-site-association**: `.well-known/` (a file only at the root gets a warning, since that location is legacy), a JSON object with an
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
| `assets.openGraph` | `true` | check `og:title`, `og:type`, `og:image`, `og:url` and `twitter:card` |
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

## Standards

Each standard below is one the checks rely on. The clause in parentheses names the part of the
spec the check follows; checks marked "vidimus rule" are not from the spec.

### W3C Web App Manifest

[W3C Web App Manifest](https://www.w3.org/TR/appmanifest/)

- `scope` defaults to `start_url` with its filename, query and fragment removed; an explicit
  `scope` is resolved against the manifest URL (scope default, resolution against the manifest).
- `start_url` must be inside `scope` (scope). A `start_url` on another origin than `siteUrl` is
  ignored by browsers (start URL processing), so it is its own error: `manifest … start_url … is
  not same-origin, so browsers ignore it`.
- A missing `start_url` is a warning (vidimus rule); the spec falls back to the document URL.
- `display` is one of `fullscreen`, `standalone`, `minimal-ui` or `browser` (display modes); other
  values warn, since browsers fall back to `browser` (display default).
- `purpose` is a token list and the `maskable` token is looked for (purpose tokens; the default is
  `any`).
- `sizes` is a list of `WxH` tokens or `any`, and `any` counts as large enough (vidimus rule).
- An ICO icon is measured by its largest embedded image, where a 0 dimension means 256 (vidimus rule).
- The 512 px icon requirement and the declared-versus-measured `sizes` check are vidimus rules.

### HTML link relations: `icon` and `apple-touch-icon`

[HTML link relations: `icon` and `apple-touch-icon`](https://html.spec.whatwg.org/multipage/links.html#rel-icon)

- `rel` is a space-separated token list, compared case-insensitively (rel token list), and the
  `href` resolves against the page URL (icon href resolution).

### Apple touch icon

[Apple touch icon](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)

- The image is 180x180 pixels, and `/apple-touch-icon.png` in the build root is the default
  location. `apple-touch-icon-precomposed` links are read the same way (vidimus rule).

### Open Graph Protocol

[Open Graph Protocol](https://ogp.me/)

- `og:title`, `og:type`, `og:image` and `og:url` are the four required properties of every page.
- `og:image:alt` should be given whenever `og:image` is.
- `og:image:width` and `og:image:height` are optional; when given, they are checked against the
  measured image (vidimus rule).

### Twitter/X Cards

[Twitter/X Cards](https://developer.x.com/en/docs/twitter-for-websites/cards/overview/markup)

- `twitter:card` is required and must be `summary`, `summary_large_image`, `app` or `player`.
- `twitter:image` must be an absolute URL (vidimus rule for the absolute form; SVG and AVIF are
  rejected as for `og:image`).

### Well-known URIs

[Well-known URIs](https://www.rfc-editor.org/rfc/rfc8615)

- The change-password, app association and `assetlinks.json` paths sit under the `/.well-known/`
  prefix.

### Change-password URL

[Change-password URL](https://wicg.github.io/change-password-url/)

- `/.well-known/change-password` is expected to redirect to the password change page. With
  `origin` set, the live response must be a 3xx with a `Location` header.

### Apple App Site Association

[Apple App Site Association](https://developer.apple.com/documentation/xcode/supporting-associated-domains)

- The file is `/.well-known/apple-app-site-association`, a JSON object with an `applinks`,
  `webcredentials`, `appclips` or `activitycontinuation` object section.
- Its Content-Type is expected to be `application/json`.

### Android Digital Asset Links

[Android Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started)

- `assetlinks.json` is a non-empty array of statements, each with a `relation` array and a
  `target` object.
- Its Content-Type is expected to be `application/json`.

### IAB Tech Lab ads.txt

[IAB Tech Lab ads.txt](https://iabtechlab.com/ads-txt/)

- A record is `domain, account ID, DIRECT|RESELLER` with an optional certification ID; the relation
  is compared case-insensitively, `#` starts a comment, and `KEY=value` variable lines are skipped.
- `app-ads.txt` uses the same record rules.
- Its Content-Type is expected to be `text/plain`.
- For each AdSense `ca-pub-` ID found, a `google.com, pub-…` record is required (vidimus rule,
  from Google's AdSense setup, not the IAB spec).

### PNG

[PNG](https://www.w3.org/TR/png-3/)

- Width and height are read from the `IHDR` chunk, the first chunk after the signature.

### GIF

[GIF](https://www.w3.org/Graphics/GIF/spec-gif89a.txt)

- The size is the logical screen width and height, not the size of any frame.

### JPEG (ITU-T T.81)

[JPEG (ITU-T T.81)](https://www.w3.org/Graphics/JPEG/itu-t81.pdf)

- The size comes from the first start-of-frame marker; the DHT, JPG and DAC markers are not
  start-of-frame markers.
- EXIF Orientation values 5 to 8 (CIPA DC-008,
  [standards index](https://www.cipa.jp/e/std/std-sec.html)) swap the reported width and
  height.

### WebP

[WebP](https://developers.google.com/speed/webp/docs/riff_container)

- Dimensions come from the `VP8 `, `VP8L` or `VP8X` chunk, whichever the file has.

### AVIF and HEIF

[AVIF and HEIF](https://aomediacodec.github.io/av1-avif/)

- The size is the `ispe` property of the primary item; an `irot` of 90 or 270 degrees swaps the
  two sides.
- Without a primary-item `ispe`, the size is read only when the file has a single `ispe` box
  (vidimus rule).

### SVG

[SVG](https://www.w3.org/TR/SVG2/)

- `width` and `height` are used when both are unitless or in `px`; otherwise the `viewBox` size is
  used, and a single attribute takes the other side from the `viewBox` aspect ratio.

## Not checked

- Manifest: `theme_color`, `background_color`, `display_override` and `shortcuts` are not
  validated; `related_applications` is read only to match the app association checks.
- Manifest: no 192x192 icon is required; only one icon at least 512 px on its shorter side.
- Manifest: the served Content-Type is not checked.
- favicon.ico is only checked for existence, not measured. The `sizes` and `type` attributes of
  icon links are not validated, and the apple-touch-icon file type is not checked.
- Open Graph: the value of `og:type`, `og:image:type` and `og:image:secure_url` are not checked.
  Only SVG and AVIF are rejected as `og:image` formats, so WebP and GIF pass.
- Twitter: the 300x157 minimum for `summary_large_image` is not checked, and `twitter:image:alt`
  and `twitter:site` are not checked.
- Social checks skip pages with `noindex`, on purpose: social crawlers ignore `noindex` for link
  previews.
- `og:image` and `twitter:image` file lookups accept a page path, so `/og` resolves to `og.html`
  or `og/index.html`.
- Images in other formats (for example HEIC or JPEG XL) get no size. EXIF orientation is read only
  for JPEG, not for PNG or WebP. AVIF `imir` mirroring is not applied, only `irot`.
- SVG lengths in units other than `px` (for example `em` or `%`) fall back to the `viewBox`.
- The change-password check accepts a build file or folder at the path, although the spec asks
  for a redirect.
- Apple app site association: only the build is searched, so a redirect rule does not count, and
  the `appID` format is not validated.
- Android Digital Asset Links: the `target` namespace, `package_name` and certificate fingerprints
  are not validated, and a redirect rule does not count.
- ads.txt: the Google certification ID is not validated, and account IDs are compared
  case-insensitively; the IAB case rule was not checked.
- The Content-Type of `ads.txt`, the app association files and `assetlinks.json` is checked only
  when `_headers` has a rule for the path or `origin` is set.
