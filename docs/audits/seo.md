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
top-level `siteUrl`: without it the canonical and hreflang checks can only verify that URLs are
absolute, and sitemap URLs are matched to built pages by path alone.

With [`render.mode`](../how-it-works#client-rendered-sites) on, every check reads the DOM a
browser renders, so titles, descriptions and canonical links set by the app count.

## Run it

```sh
npx vidimus seo
```

## What it checks

Pages matched by the top-level `exclude` or by `seo.exclude` are skipped; by default that is
the 404 page (`/404.html` or `/404/`). Pages whose `<meta http-equiv="refresh">` names a target URL are treated
as redirect stubs and skipped too. The same problem on several pages is one finding listing
the pages.

### Every page

- **Language**: `<html>` has a `lang` attribute (`missing <html lang>`, error). An empty value
  is a warning (`empty <html lang> (language unknown)`), since WHATWG HTML treats it as valid
  and unknown. A non-empty value must be a well-formed BCP 47 tag (RFC 5646) with a 2-3 letter
  language such as `en`, `pt-BR` or `zh-Hant-TW` (`invalid <html lang> "english"`, error).
  Subtags are checked for shape, not against the IANA registry.
- **Title**: a `<title>` exists in `<head>` (an `<svg><title>` in the body is ignored;
  `missing <title>`, error) and is within `seo.titleLength`
  (`title outside 10-60 characters`, warning, with the length of each page as detail).
- **Description**: `<meta name="description">` exists and is not blank
  (`missing meta description`, error) and is within `seo.descriptionLength`
  (`meta description outside 50-160 characters`, warning).
- **noindex**: a `<meta name="robots">` or `<meta name="googlebot">` whose content lists
  `noindex` or `none` as a directive (other directives such as `max-image-preview:none` do not count) fails with `noindex in the production build`, unless the page path matches
  `seo.allowNoindex`. An `X-Robots-Tag: noindex` or `none` header counts too (agent-scoped values other than Googlebot are ignored), read from the `_headers` file
  (`security.file`) or, with `--origin`, from the live response; such a page is treated as noindex by
  the canonical, hreflang and sitemap checks. A noindex page still gets the language, title and description checks,
  but none of the checks below, and it is not counted as indexable.

### Indexable pages

- **Canonical** (`seo.canonical`): no `rel="canonical"` link is a warning
  (`no canonical link`); more than one is an error. The link can be a `<link>` in the HTML or a
  `Link` response header from `_headers` (or `--origin`), and the two count together. The href must be absolute
  (`canonical URL is not absolute`). This is deliberately stricter than RFC 6596, which allows a relative IRI and which Google accepts: an absolute canonical stays correct when the link is copied into feeds, sitemaps or scraped HTML, where the page's base URL is lost, so the check is kept as site policy. With `siteUrl` set, it must also be on that origin
  (`canonical points outside https://example.com`) and resolve to a page in the build
  (`canonical is not a built page`), with the base path of `siteUrl` taken into account. A
  canonical pointing at a redirect or a `noindex` page, or at a page whose own canonical points
  elsewhere (a chain), is an error (`canonical points to a redirect`,
  `canonical points to a noindex page`, `canonical points to a page with a different canonical`).
- **hreflang**: each `rel="alternate"` `hreflang="…"` link, in the HTML or a `Link` response header, must have a unique language per page
  (`duplicate hreflang "en"`) and a fully qualified `http://` or `https://` href (`hreflang URL is not absolute`), so protocol-relative `//host/path` is rejected. Targets on
  `siteUrl` must be built pages (`hreflang target is not a built page`) and must link back
  (`hreflang not reciprocated`, with `from → to` as detail). A target that is a redirect or has
  `noindex` is reported as `hreflang points to a redirect` or `hreflang points to a noindex page`. Targets on other origins are not
  followed. A page with hreflang links must list itself (`hreflang missing self-reference`), and
  each language code must be a well-formed BCP 47 tag such as `en` or `pt-BR`, or `x-default`
  (`invalid hreflang code "english"`). A set without `x-default` is a warning
  (`hreflang set has no x-default`). This check has no switch.
- **Headings** (`seo.h1`): `no <h1>` and `more than one <h1>` are warnings.
- **JSON-LD**: each `<script type="application/ld+json">` block must parse as JSON. An empty
  block or a syntax error (a trailing comma, an unescaped control character, an HTML comment)
  is an error (`invalid JSON-LD: <parse message>`). The schema.org content is not validated.
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
  (`robots.txt disallows everything for User-agent: *`), unless that group also has an `Allow` rule. No `Sitemap:` line is a warning. A `robots.txt` larger than 500 KiB (512,000 bytes) is a warning, because crawlers may ignore rules past their parsing limit. An indexable page that the `User-agent: *` group
  disallows, unless a `Googlebot` group exists, which then takes precedence is a warning
  (`indexable page disallowed by robots.txt`); the longest matching rule wins, `Allow`
  wins a tie, and `*` and `$` wildcards are supported (`$` anchors only at the end of a rule; elsewhere it is a literal character).
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
| `seo.titleLength` | `{ min: 10, max: 60 }` | warn when the title length (code points) is outside the range |
| `seo.descriptionLength` | `{ min: 50, max: 160 }` | warn when the description length (code points) is outside the range |
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

## Standards

### Robots Exclusion Protocol

[RFC 9309](https://www.rfc-editor.org/rfc/rfc9309)

- §2.1: consecutive `User-agent` lines form one group, and a rule line (`Allow` or `Disallow`) ends the group. §2.2.4: a `Sitemap:` line does not end a group, and neither do records that are not rules (`Crawl-delay`, `Host`, `Clean-param`), which crawlers ignore.
- §2.2: lines end in CR, LF or CRLF. A group whose only rule is an empty `Disallow:` still matches its agent, so an empty `Googlebot` group allows everything instead of falling back to `*`.
- §2.2.1: a page is matched against the `googlebot` group, else the `*` group. Other `googlebot-*` agents such as `Googlebot-Image` do not stand in for it. Agent names are case-insensitive.
- §2.2.2: the longest matching rule wins, and `Allow` wins a tie. Paths are case-sensitive. An empty `Disallow:` value allows everything and is ignored.
- §2.2.3: `*` matches any run of characters, a trailing `$` anchors the end of the rule, and any other `$` is a literal character. Wildcards are matched left to right without backtracking, so a rule with many `*` stays fast.
- A full-site `Disallow` (`/`, `/*` or `/*$`) in a group with no `Allow` rule is reported as blocking everything.

### Sitemaps protocol

[sitemaps.org protocol](https://www.sitemaps.org/protocol.html)

- Per-file limits on URLs and uncompressed bytes, the limit of 50,000 child sitemaps in an index, and the limit of under 2,048 characters per `<loc>` are checked.
- Index children and `Sitemap:` lines must be absolute and on the origin of `siteUrl`; relative ones are reported as not absolute.
- Every `<loc>` must be entity-escaped: an `&` must start a predefined XML entity or a numeric reference, so named HTML references such as `&copy;` are reported.
- `<lastmod>`, when present, must be a W3C Datetime: a date, a year and month, or a year, or a date followed by a time that carries a zone designator.

### XML 1.0

[XML 1.0](https://www.w3.org/TR/xml/)

- §4.6: the escapes accepted in sitemap `<loc>` values are the five predefined entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) and numeric references.
- §2.7: CDATA content in `<loc>` is taken literally, without entity decoding.

### Gzip

[RFC 1952](https://www.rfc-editor.org/rfc/rfc1952)

- A sitemap whose file name ends in `.gz` is decompressed before it is read. The file name decides, not the content.
- A `.gz` file that does not decompress is reported as `sitemap is not valid gzip`, and its URLs are not checked.

### Robots meta tag and X-Robots-Tag

[Google robots meta tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)

- Directive and `name` values are case-insensitive, and the `robots` and `googlebot` meta tags are merged.
- X-Robots-Tag: a directive without an agent prefix applies to all crawlers, and a `googlebot:` prefix applies to Googlebot. A `googlebot-news:` prefix only governs Google News, so it is ignored like another crawler's. Tokens after a prefix for another crawler (for example `bingbot:`) are ignored until a `googlebot:` prefix appears. Directives with a value, such as `max-snippet:50`, do not change this.

### rel=canonical

[RFC 6596](https://www.rfc-editor.org/rfc/rfc6596)

- A page specifies one canonical link relation. `<link>` tags and a `Link` header count together toward that single relation.
- The canonical target must be a built page on `siteUrl`, and canonical chains are reported, as described under Canonical above.

### Web Linking

[RFC 8288](https://www.rfc-editor.org/rfc/rfc8288)

- `Link` response headers from `_headers` (or `--origin`) are read for `rel="canonical"` and `rel="alternate"` with `hreflang`, and merged with the HTML `<link>` tags.
- `rel` is a space-separated list of tokens, and parameter values may be bare or quoted.

### hreflang

[Google hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)

- Each page lists itself in its hreflang set, and each target on `siteUrl` lists the page back.
- Language values are case-insensitive and unique per page. `x-default` is recommended, and a set without it is a warning.
- Alternate URLs must be fully qualified `http://` or `https://` URLs. Protocol-relative and root-relative hrefs are reported.

### BCP 47

[RFC 5646](https://www.rfc-editor.org/rfc/rfc5646) and [RFC 4647](https://www.rfc-editor.org/rfc/rfc4647), which together are [BCP 47](https://www.rfc-editor.org/info/bcp47)

- `<html lang>` and hreflang values must be well-formed under §2.1: language, extended language, script, region, variant, extension and private use (`x-…`) subtags, plus the grandfathered tags such as `en-GB-oed`.
- Matching is case-insensitive.

### WHATWG HTML: the lang attribute

[WHATWG lang attribute](https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes)

- A missing `lang` on `<html>` is an error. An empty `lang=""` is a warning, because it means the language is unknown.

### WHATWG character encoding

[WHATWG determining the character encoding](https://html.spec.whatwg.org/multipage/parsing.html#determining-the-character-encoding)

- A byte order mark decides the encoding first. Otherwise the first `<meta>` in the first 1024 bytes with a known `charset`, or `http-equiv` Content-Type charset, decides, and a page with neither is UTF-8.
- A `utf-16` declaration without a byte order mark is read as UTF-8.

### WHATWG named and numeric character references

[WHATWG named characters](https://html.spec.whatwg.org/multipage/named-characters.html)

- Named references are looked up case-sensitively, so `&Lt;` decodes to U+226A, not `<`.
- Legacy names without a `;` (for example `&copy 2024`) decode in text. In attribute values they are left alone when the next character is `=` or a letter or digit.
- Numeric references from 0x80 to 0x9F map through windows-1252, so `&#150;` is an en dash. `&#0;`, surrogates and values above U+10FFFF become U+FFFD.
- These rules apply to titles, descriptions and attribute values. Sitemap `<loc>` values follow XML instead: only the five predefined entities decode (names are case-sensitive), and numeric references are plain code points (`&#150;` is U+0096); CDATA is taken as written.

### JSON-LD 1.1

[JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)

- Each `<script type="application/ld+json">` block must parse as JSON. An empty block fails.
- The type is compared after trimming and lowercasing, so a type with parameters, such as `; charset=utf-8`, is not checked.

### Not checked

- robots.txt is not checked for UTF-8 validity (RFC 9309 §2.3). Invalid bytes are replaced silently when it is read.
- Rules are matched against the page path only, with no query-string matching. Both sides are normalised first (RFC 9309 §2.2.2): non-ASCII characters are percent-encoded as UTF-8 and percent-encoded unreserved characters (`%7E` → `~`) are decoded, so `Disallow: /café/` matches `/caf%C3%A9/`.
- A full-site `Disallow` is not reported when its group has any `Allow` rule, even one that does not cover `/`.
- `unavailable_after` is recognised but not evaluated. Only `noindex` and `none` change the result.
- robots.txt is not read when the site is served under a base path.
- Sitemaps are not parsed as XML, so well-formedness is not checked. `changefreq`, `priority`, extension namespaces and `xhtml:link` alternates are not read, and `<lastmod>` dates are not calendar-checked (`2026-02-31` passes).
- The same-origin rule for sitemap references and `<loc>` values applies only when `siteUrl` is set.
- Canonical hrefs must be absolute by policy, which is stricter than RFC 6596. Canonical targets are not checked for duplicate content.
- A hreflang target whose own canonical points elsewhere is not reported, unlike a canonical target. The canonical status of the `x-default` target is not checked.
- Language tags are checked for syntax, not against the IANA registry: `xx` passes. `es-419` also passes, though Google's hreflang documentation says it is unsupported.
- `Link` header extended parameters (`rel*`, `hreflang*`) are not decoded.
- Charset detection still matches a `<meta charset>` inside an HTML comment, and a UTF-8 byte order mark stays in the decoded text as U+FEFF.
- JSON-LD content is not validated: there are no `@context`, `@type` or schema.org checks.
- Open Graph tags are not checked here. The [assets](./assets) audit checks the required OGP properties.
