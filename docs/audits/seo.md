---
title: seo
description: How the seo audit checks titles, descriptions, canonical and hreflang links, noindex, sitemaps, robots.txt and orphan pages.
---

# seo: search engine basics

`seo` reads every built page and the site-wide crawler files and reports what keeps a page
out of search results or makes it show up wrong: a missing title, a `noindex` left over from
staging, a canonical pointing at another domain, a sitemap full of stale URLs. It is not in the
default set.

## Needs

Nothing to install. It reads the build (`dist/`) and starts no server or browser. Set the
top-level `siteUrl`: without it the canonical, hreflang and sitemap checks can only verify that
URLs are absolute, not that they point at your site and at pages that exist.

With [`render.mode`](../how-it-works#client-rendered-sites) on, every check reads the DOM a
browser renders, so titles, descriptions and canonical links set by the app count.

## Run it

```sh
npx vidimus seo
```

## What it checks

Pages matched by the top-level `exclude` or by `seo.exclude` are skipped; by default that is
the 404 page (`/404.html` or `/404/`). Pages with a `<meta http-equiv="refresh">` are treated
as redirect stubs and skipped too. The same problem on several pages is one finding listing
the pages.

### Every page

- **Language**: `<html>` has a non-empty `lang` attribute (`missing <html lang>`, error) that
  is a valid BCP 47 code such as `en` or `pt-BR` (`invalid <html lang> "english"`, error).
- **Title**: a `<title>` exists in `<head>` (an `<svg><title>` in the body is ignored;
  `missing <title>`, error) and is within `seo.titleLength`
  (`title outside 10-60 characters`, warning, with the length of each page as detail).
- **Description**: `<meta name="description">` exists and is not blank
  (`missing meta description`, error) and is within `seo.descriptionLength`
  (`meta description outside 50-160 characters`, warning).
- **noindex**: a `<meta name="robots">` or `<meta name="googlebot">` whose content contains
  `noindex` fails with `noindex in the production build`, unless the page path matches
  `seo.allowNoindex`. An `X-Robots-Tag: noindex` header counts too, read from the `_headers` file
  (`security.file`) or, with `--origin`, from the live response; such a page is treated as noindex by
  the canonical, hreflang and sitemap checks. A noindex page still gets the language, title and description checks,
  but none of the checks below, and it is not counted as indexable.

### Indexable pages

- **Canonical** (`seo.canonical`): no `<link rel="canonical">` is a warning
  (`no canonical link`); more than one is an error. The href must be absolute
  (`canonical URL is not absolute`). With `siteUrl` set, it must also be on that origin
  (`canonical points outside https://example.com`) and resolve to a page in the build
  (`canonical is not a built page`), with the base path of `siteUrl` taken into account. A
  canonical pointing at a redirect or a `noindex` page, or at a page whose own canonical points
  elsewhere (a chain), is an error (`canonical points to a redirect`,
  `canonical points to a noindex page`, `canonical points to a page with a different canonical`).
- **hreflang**: each `<link rel="alternate" hreflang="…">` must have a unique language per page
  (`duplicate hreflang "en"`) and an absolute href (`hreflang URL is not absolute`). Targets on
  `siteUrl` must be built pages (`hreflang target is not a built page`) and must link back
  (`hreflang not reciprocated`, with `from → to` as detail). A target that is a redirect or has
  `noindex` is reported as `hreflang points to a redirect` or `hreflang points to a noindex page`. Targets on other origins are not
  followed. A page with hreflang links must list itself (`hreflang missing self-reference`), and
  each language code must be valid BCP 47 such as `en` or `pt-BR`, or `x-default`
  (`invalid hreflang code "english"`). A set without `x-default` is a warning
  (`hreflang set has no x-default`). This check has no switch.
- **Headings** (`seo.h1`): `no <h1>` and `more than one <h1>` are warnings.
- **Duplicates**: two or more indexable pages with the same title or description get
  `duplicate title "…"` or `duplicate meta description "…"` (warning). Pages that are all
  hreflang alternates of each other are exempt, so translations that keep an untranslated
  brand title do not trigger it.
- **Canonicalized copies**: a page whose canonical link points at a different built page on
  `siteUrl` is a duplicate by design (a mirror, a print version, another rendering of the same
  content). It is left out of the duplicate check, is not required in the sitemap and is not
  reported as an orphan; listing it in the sitemap is a warning
  (`non-canonical page in the sitemap`), since sitemaps should list canonical URLs only.

### Site-wide

- **robots.txt** (`seo.robots`): no `robots.txt` in the build root is a warning. A
  `Disallow: /` in a group that applies to `User-agent: *` is an error
  (`robots.txt disallows everything for User-agent: *`). No `Sitemap:` line is a warning. An indexable page that the `User-agent: *` group
  (or the `Googlebot` group when there is no `*` group) disallows is a warning
  (`indexable page disallowed by robots.txt`); the longest matching rule wins, `Allow`
  wins a tie, and `*` and `$` wildcards are supported.
- **Sitemap** (`seo.sitemap`): vidimus reads `/sitemap.xml`, `/sitemap-index.xml`,
  `/sitemap_index.xml` and every `Sitemap:` URL from `robots.txt` that exists in the build, and
  follows `<sitemap><loc>` entries of sitemap indexes. A `Sitemap:` line or index entry that points
  at another origin than `siteUrl` (`sitemap target outside …`) or at a file missing from the build
  (`sitemap target is missing from the build`) is an error. Every `<url><loc>` must be absolute, on
  `siteUrl` (when set), and a built page; a listed noindex page is an error
  (`noindex page in the sitemap`). If no sitemap is found at all you get a `no sitemap.xml`
  warning; otherwise every indexable page missing from it is a warning
  (`indexable page missing from the sitemap`). Gzipped sitemaps (`.xml.gz`) are read too. A sitemap with more than 50,000 URLs or over 50 MB uncompressed is an error (`sitemap exceeds the protocol limits`); split it and reference the parts from a sitemap index. `<![CDATA[…]]>` and entities in `<loc>` are
  handled.
- **Orphans** (`seo.orphans`): an indexable page that no other built page links to with an
  `<a href>` is a warning (`orphan page: no other page links to it`). Links from pages skipped by
  `seo.exclude`, such as the 404 page, still count; self-links do not. The home page `/` is never
  an orphan.

## Example output

```
─── seo ─────────────────────────────────────────────────────────

✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

✖ hreflang not reciprocated
    /en/pricing/ → /it/prezzi/
    on: /en/pricing/
    → Add a matching <link rel="alternate" hreflang> back to the linking page on each target page.

⚠ title outside 10-60 characters
    /blog/a-very-long-post/: 74
    on: /blog/a-very-long-post/
    → Rewrite the <title> to 10-60 characters, or adjust seo.titleLength.

⚠ robots.txt has no Sitemap line
    in: dist/robots.txt
    → Add a line like "Sitemap: https://example.com/sitemap.xml" to robots.txt.

⚠ orphan page: no other page links to it
    on: /legal/cookies/
    → Link to the page from navigation or another page, add it to seo.exclude if it is intentionally unlinked, or turn seo.orphans off.

✖ seo: 42 pages, 5 problem(s) (0.3s)
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `seo.exclude` | `['^/404(\\.html\|/)?$']` | URL path patterns to skip |
| `seo.allowNoindex` | `[]` | URL path patterns allowed to be `noindex` (search, thank-you pages) |
| `seo.titleLength` | `{ min: 10, max: 60 }` | warn when the title length is outside the range |
| `seo.descriptionLength` | `{ min: 50, max: 160 }` | warn when the description length is outside the range |
| `seo.canonical` | `true` | check canonical links |
| `seo.h1` | `true` | warn on zero or several `<h1>` |
| `seo.sitemap` | `true` | check the sitemap and that indexable pages are in it |
| `seo.robots` | `true` | check `robots.txt` |
| `seo.orphans` | `true` | warn about pages nothing links to |

Top-level keys used: `siteUrl`, `exclude`. The `robots.txt` file is still read for `Sitemap:`
lines when `seo.robots` is off.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.com',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo'],
  seo: {
    allowNoindex: ['^/(en|it)/search/$', '/thanks/$'],
    titleLength: { min: 10, max: 70 },
    orphans: false,
  },
});
```

## Common fixes

A complete `<head>` for a page with one translation:

```html
<html lang="en">
  <head>
    <title>Pricing and plans | Example</title>
    <meta name="description" content="Compare the Free, Team and Business plans and see what each includes.">
    <link rel="canonical" href="https://example.com/en/pricing/">
    <link rel="alternate" hreflang="en" href="https://example.com/en/pricing/">
    <link rel="alternate" hreflang="it" href="https://example.com/it/prezzi/">
    <link rel="alternate" hreflang="x-default" href="https://example.com/en/pricing/">
  </head>
</html>
```

The Italian page carries the same three `alternate` links and its own canonical,
`https://example.com/it/prezzi/`. Each page an hreflang link targets must link back to the page
that names it, or the pair fails with `hreflang not reciprocated`.

A `robots.txt` that allows crawling and points at the sitemap:

```text
User-agent: *
Disallow:

Sitemap: https://example.com/sitemap-index.xml
```

Keep a noindex page out of the sitemap and out of the findings: exclude it in the sitemap
generator (for `@astrojs/sitemap`, the `filter` option) and add its path to `seo.allowNoindex`.
For a page that should stay unlinked, such as a campaign landing page, add it to
`seo.exclude` instead of turning `seo.orphans` off.

Staging builds often add `noindex` on purpose. Audit a production build. See [Frameworks](../frameworks) for
per-framework notes and [Adopting](../adopting) for rolling out `seo` on a large site.
