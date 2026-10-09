---
title: links
description: The links audit crawls the served build with linkinator and reports broken internal links, missing assets and dead external targets.
---

# links: broken links

`links` crawls the site with [linkinator](https://github.com/JustinBeckwith/linkinator) and reports every link, image, stylesheet, script and other reference that does not resolve. Internal breakage (a renamed page, a missing asset, a wrong base path) is checked against the build before it reaches production; external links are checked too, so you learn about dead targets before your visitors do.

## Needs

```sh
npm i -D linkinator
```

The audit loads pages over HTTP (`requires: 'server'`): vidimus serves the build locally, or uses `--origin`. It does not launch a browser.

## Run it

```sh
npx vidimus links
```

It is part of the default set.

## What it checks

linkinator starts from every built page of the default locale (every locale with `--all-locales`), follows the links it finds on pages of the audited origin, and checks each target it encounters: `<a href>`, `<img src>`, `srcset`, `<link href>`, `<script src>` and the other URL attributes linkinator understands. Links to pages that are not in the start list, such as translated pages, are still followed when a checked page links to them.

A target counts as broken when linkinator reports it `BROKEN`: an HTTP error status, or no response at all (a DNS failure, a refused connection, a timeout).

- **Internal links** are requested from the local server, so they are checked against the files in the build.
- **Absolute links to your own site** (`https://example.org/about/`) are rewritten onto the audit origin when `siteUrl` is set, so they are checked against the build too, not against the version currently in production. Without `siteUrl` they are checked as external links.
- **External links** are requested from the internet when `links.checkExternal` is `true` (the default). Their pages are not crawled further. With `checkExternal: false`, every URL outside the audit origin and `siteUrl` is skipped.
- **Skipped links**: any URL matching a pattern in `links.skip`. `mailto:` and `tel:` are skipped by default.

Each broken target is one finding, however many pages link to it. The message is the status code (or `ERR` when there was no response) and the URL; `on:` lists the pages that link to it, or `(root)` when a start page itself failed.

The fix depends on the status: for `404` and `410` it suggests fixing the link, for other `4xx` codes it suggests checking the link in a browser (many sites answer bots with `403` or `429`), and for `5xx` codes and failed requests it suggests a longer timeout or retries.

## Example output

```
─── links ───────────────────────────────────────────────────────

✖ 404 http://127.0.0.1:4322/blog/2024/hello-wrold/
    on: /blog/ /tags/astro/
    → Fix or remove the link on the pages listed, or add a pattern to links.skip if the target blocks bots.

✖ 403 https://www.linkedin.com/company/example/
    on: / /about/ /contact/ +31 more
    → Check the link in a browser; if it works there the target blocks bots, so add a pattern to links.skip.

✖ ERR https://api.old-partner.example/widget.js
    on: /partners/
    → Check the target is up, raise links.timeout or enable links.retry, or add a pattern to links.skip if it is flaky.

✖ links: 3 broken target(s) out of 2210 links checked (9.8s)
```

A passing run:

```
✔ links: 2210 links checked across 34 pages, none broken (8.1s)
```

Internal targets are shown on the audit origin (`http://127.0.0.1:4322/…`), since that is the URL that was requested.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `links.skip` | `['^mailto:', '^tel:']` | regular expressions; matching URLs are not checked |
| `links.checkExternal` | `true` | also check links to other sites |
| `links.timeout` | `20000` | ms per request |
| `links.retry` | `true` | retry `429` responses (after their `retry-after`), `5xx` responses and failed requests |
| `links.concurrency` | `25` | requests in flight at the same time |
| `links.checkFragments` | `false` | verify that `#fragment` links match an id on the target page |
| `links.checkCss` | `false` | also check URLs referenced from CSS |
| `links.warnRedirects` | `false` | report links that redirect, as warnings that name the final URL |
| `links.notFound.selector` | `''` | with rendering: a CSS selector of the app's not-found view |
| `links.notFound.text` | `''` | with rendering: a regular expression matched against the page text of the not-found view |
| `siteUrl` | `''` | top level: your production origin, so absolute self-links are checked against the build |

`links` has no `exclude` of its own. `links.skip` removes targets; to stop pages being used as start points, use the top-level `exclude`, which matches built file paths.

`links.skip` replaces the default list, so keep `^mailto:` and `^tel:` when you add patterns.

## Config example

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.org',
  links: {
    skip: ['^mailto:', '^tel:', '^https://(www\\.)?linkedin\\.com/', '^https://twitter\\.com/'],
    timeout: 30000,
  },
});
```

To check only the site itself, for example on a pull request where external flakiness should not block a merge:

```sh
npx vidimus links --set links.checkExternal=false
```

## Client-rendered links

linkinator reads HTML without running scripts, so on a client-rendered app it finds the shell's
`<script>` and `<link>` tags and nothing else. With
[`render.mode`](../how-it-works#client-rendered-sites) on, every audited page is rendered first
and the built-in server hands linkinator the rendered DOM of those pages, so nav and in-content
links, images and iframes added by scripts are checked, and findings list the page they are on.
With `--origin` there is no built-in server and the served HTML is read as usual.

An internal route the app does not know still answers `200` through `server.fallback` and shows
the app's not-found view. Set `links.notFound` to tell that view apart: every internal link
without a file in the build, and every hash route (`#/path`), is opened in the browser and
reported when the selector matches or the text appears.

```ts
export default defineConfig({
  server: { fallback: 'index.html' },
  render: { mode: 'on', waitFor: '#root > *' },
  links: { notFound: { selector: '[data-page="not-found"]' } },
});
```

```
✖ not-found view /docs/old-page
    on: / /docs/
    → Fix or remove the link on the pages listed, or add the route to the app router.
```

## Tips

- Sites such as LinkedIn, Instagram and some news sites refuse automated requests. Add them to `links.skip` rather than removing the links.
- If every internal link fails, check `siteUrl` and the base path: a site built for `https://example.org/docs/` is served under `/docs/` on the audit origin. See [Troubleshooting](../troubleshooting).
- External checks depend on the network of the machine running vidimus. In [CI](../ci), a scheduled run with `checkExternal: true` and pull request runs with it off is a common split.
