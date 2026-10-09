---
title: privacy
description: The privacy audit loads pages in a clean browser and reports every third-party request and cookie made before any user interaction.
---

# privacy: third-party requests and cookies

`privacy` loads each page in a fresh browser, as a first-time visitor who has not clicked anything, and records every request to another host and every cookie set on load. Loading a font from Google, a YouTube embed or an analytics script sends the visitor's IP address to a third party before they could consent, which matters for the GDPR: nothing should leave the visitor's browser before consent. This audit lists those requests so you can self-host them, put them behind a click, or document them.

It reports what the browser does; it is not legal advice, and a clean run does not by itself make a site compliant.

## Needs

```sh
npm i -D puppeteer
```

The audit loads pages over HTTP (`requires: 'server'`): vidimus serves the build locally, or uses `--origin`. It is not in the default set.

## Run it

```sh
npx vidimus privacy
```

To run it every time, add it to `audits`:

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'privacy'],
});
```

## What it checks

### Which pages

Every built page that is not excluded, in the default locale unless `privacy.allLocales` or the top-level `allLocales` (`--all-locales`) is `true`. With `privacy.sample`, pages whose URL path matches a pattern are reduced to the first matching page per pattern; pages that match no pattern are all loaded. Use it for templates that repeat, such as blog posts.

Each page gets its own browser context, so no cookies or cache carry over from one page to the next. vidimus waits for the `load` event, then `privacy.wait` ms more, for trackers that load late.

### Requests

Requests made by iframes count too, including cross-origin iframes the browser runs in their own process: a YouTube, Vimeo or map embed shows up with every host its player contacts. A host whose page was loaded into an `<iframe>` is reported as `third-party embed from <host>` with the detail `loaded in an <iframe> on page load`, and the fix points at a click-to-load facade: a static preview that loads the real iframe only on click, such as [lite-youtube-embed](https://github.com/paulirish/lite-youtube-embed). `youtube-nocookie.com` is still reported: it sets no cookies before playback, but the player and its scripts load all the same.

Every `http`, `https`, `ws` and `wss` request is classified. `data:` and `blob:` URLs are ignored.

- **first-party**: the host of the audit origin or of `siteUrl`. Ports are not compared, so a local server on `127.0.0.1:4322` is first-party.
- **allowed**: the full URL matches a pattern in `privacy.allow`.
- **third-party**: everything else. Each host is one failing finding, with up to three example URLs and every page that requested it.

Subdomains count as other hosts: with `siteUrl: 'https://example.org'`, a request to `cdn.example.org` is third-party unless you allow it.

For well-known services the finding adds a hint and a specific fix:

| Hosts | Hint |
| --- | --- |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Google Fonts: self-host the fonts |
| `google-analytics.com`, `googletagmanager.com`, `analytics.google.com` | Google Analytics / Tag Manager: tracking, needs consent before loading |
| `doubleclick.net`, `googlesyndication.com`, `googleadservices.com` | Google Ads / DoubleClick: advertising tracker, needs consent before loading |
| `connect.facebook.net`, `facebook.com`, `facebook.net` | Facebook / Meta pixel: tracking, needs consent before loading |
| `youtube.com`, `ytimg.com`, `googlevideo.com` | YouTube: embed from youtube-nocookie.com behind a click-to-load placeholder |
| `vimeo.com`, `vimeocdn.com` | Vimeo: use dnt=1 and a click-to-load placeholder |
| `maps.googleapis.com`, `maps.gstatic.com`, `maps.google.com` | Google Maps: use a static image or a click-to-load placeholder |
| `hotjar.com`, `hotjar.io` | Hotjar: session recording, needs consent |
| `static.cloudflareinsights.com`, `cloudflareinsights.com` | Cloudflare Web Analytics: disable the automatic beacon or disclose it |
| `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com` | public CDN: visitor IPs leak to the CDN, self-host the files |
| `platform.twitter.com`, `syndication.twitter.com`, `x.com`, `twimg.com` | Twitter / X widgets: use a static embed or click-to-load |
| `intercom.io`, `intercomcdn.com` | Intercom: chat widget, load on demand |
| `clarity.ms` | Microsoft Clarity: session recording, needs consent |
| `linkedin.com`, `licdn.com` | LinkedIn Insight: tracking, needs consent |
| `recaptcha.net`, `gstatic.com` | Google (reCAPTCHA / static assets) |

A host matches an entry when it equals it or is a subdomain of it (`www.youtube.com` matches `youtube.com`).

### Resource hints

After the wait, each loaded page's `<link rel="preconnect">` and `<link rel="dns-prefetch">` tags are checked. A hint opens a connection to its host before any request is made, so a third-party hint contacts that host before consent. Hrefs are resolved against the page, so `//host` takes the page's protocol. A hint whose host is first-party, or whose full URL matches `privacy.allow`, is ignored, the same as requests. Each third-party host is one warning, `third-party resource hint to <host>`, with the hint and an example URL and the pages it appears on. The fix is to remove the hint or add it only after consent.

### Cookies

With `privacy.cookies` on, every cookie present in the browser context after the wait is reported with its name and domain:

- A cookie on a first-party domain is a warning. It may be strictly necessary (a session, a language choice), in which case it belongs in your cookie notice rather than behind consent.
- A cookie on any other domain fails.

A script from a third party can set a cookie on your own domain (Google Analytics sets `_ga` this way), so such cookies show up as first-party warnings together with a failing request to the script's host.

### Client-side storage

With `privacy.cookies` on, the keys of `localStorage` and `sessionStorage` and the names of IndexedDB databases (`indexedDB.databases()`) present after the wait are reported, one warning per storage kind with the key or database names (the first 10, then `and N more`) and the pages. Only names are read, never values. Storage written by first-party or third-party scripts on load counts alike, because both land in your origin. Browsers without `indexedDB.databases()` report no databases. Defer the writes until the visitor consents, or document them in your privacy notice if they are strictly necessary. `privacy.allow` does not apply to storage.

### After rejecting consent

Set `privacy.rejectSelector` to the CSS selector of your consent banner's reject button to also check the state after a visitor refuses. After the initial checks, vidimus clicks the button, waits `privacy.wait` ms, and reports as failures:

- every third-party request made since the click (`privacy.allow` applies as above),
- every cookie present after the click, and every `localStorage`, `sessionStorage` and IndexedDB key present (with `privacy.cookies` on).

Items that were already present before the click are included, so a tracker that survives rejection is reported here as well as in the pre-consent findings. If the selector matches nothing on a page, a warning `reject button not found: <selector>` lists those pages. The check is off while the selector is empty.

### Load failures

A page that does not load within `privacy.timeout` becomes a failing finding (`failed to load /path/`) and the other pages are still checked.

## Example output

```
─── privacy ─────────────────────────────────────────────────────

✖ third-party request to fonts.googleapis.com
    Google Fonts: self-host the fonts
    https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap
    on: / /about/ /blog/ +9 more
    → Self-host the fonts (e.g. with fontsource) instead of loading them from Google.

✖ third-party request to www.youtube-nocookie.com
    https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ
    on: /talks/
    → Self-host the resource, load it only after consent, or add a pattern to privacy.allow if it is covered by your privacy policy.

⚠ cookie lang set on load (127.0.0.1)
    on: /
    → Set it only after consent, or add it to your cookie notice if it is strictly necessary.

✖ privacy: 12 pages, 2 third-party host(s), 1 cookie(s) (7.9s)
```

The privacy-enhanced `youtube-nocookie.com` domain is not in the table, so it gets the generic fix, but it is still a request to another host and fails like any other. A passing run:

```
✔ privacy: 12 pages, no third-party requests, cookies or storage writes (6.1s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `privacy.allow` | `[]` | regular expressions matched against the full request URL |
| `privacy.sample` | `[]` | URL path patterns: load one page per matching template |
| `privacy.allLocales` | `false` | also load pages of translated locales |
| `privacy.cookies` | `true` | report cookies and client-side storage written on load |
| `privacy.wait` | `1500` | ms to wait after `load` for late requests |
| `privacy.timeout` | `60000` | ms to wait for a page's `load` event |
| `privacy.rejectSelector` | `''` | CSS selector of the reject button to click, then check what remains |
| `privacy.concurrency` | half the cores (2 to 8) | pages loaded at the same time |
| `privacy.exclude` | `[]` | URL path patterns to skip |

## Config example

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.org',
  privacy: {
    allow: ['^https://static\\.example\\.org/', '^https://plausible\\.io/js/'],
    sample: ['^/blog/[^/]+/$', '^/tags/[^/]+/$'],
    wait: 3000,
  },
});
```

## Common fixes

Self-host fonts instead of linking Google Fonts, for example with [Fontsource](https://fontsource.org):

```sh
npm i @fontsource-variable/inter
```

```html
<!-- before -->
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">
```

Then import `@fontsource-variable/inter` from your CSS or layout, so the font files are bundled into the build.

Replace video and map embeds with a placeholder that loads the iframe only on click:

```html
<button type="button" class="embed" data-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ">
  <img src="/img/talk-poster.avif" alt="Play: Building static sites" width="1280" height="720">
</button>
```

A small script swaps the button for the iframe when clicked, so nothing is requested until the visitor asks for it.

Load analytics only after consent: render the snippet from your consent banner's callback rather than in the page `<head>`.
