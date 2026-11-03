# vidimus

## 0.21.0

### Minor Changes

- 6a718ca: The privacy audit loads each page again with Global Privacy Control set and reports third-party requests that still fire (`privacy.gpc`, on by default).
- 6a718ca: The privacy audit also reports Cache Storage caches and service worker registrations written on load, and still present after rejecting consent (`privacy.cookies`).
- 6a718ca: The privacy audit warns when a third-party request sends the page path or query in its `Referer` header, which happens without a restrictive `Referrer-Policy`.
- 6a718ca: The privacy audit lists each cookie's attributes in its finding: whether it is a session cookie or its expiry date, and its `Secure`, `HttpOnly` and `SameSite` values.
- 6a718ca: CSP audit follows CSP3 more closely: a `nonce` or a hash matching `integrity` allows an external script or stylesheet; `'unsafe-inline'` is ignored next to `'strict-dynamic'`; a header splits into policies at every comma while a `<meta>` policy is never split; a source naming the site's own origin allows same-site URLs; only real event handler attributes (not `once=`) count as inline script; imports are followed past 1000 files; nonce-matched blocks are counted once.
- 6a718ca: Security audit: `<track src>` and `<input type="image" src>` over http are mixed content; `<form action>`/`formaction` over http is now a warning (`form submits over http: …`) instead of a mixed-content error; `http:` in `script-src` is not warned about next to `'strict-dynamic'`; security.txt `Expires` dates that do not exist (`2027-02-30`, `T24:00`) are rejected.
- 6a718ca: HSTS default now requires a `max-age` of at least 31536000 (one year); a policy without `includeSubDomains` gets its own warning, `strict-transport-security lacks includeSubDomains`. Values from 31536001 to 31999999 are no longer rejected.

### Patch Changes

- 6a718ca: Forms audit no longer marks a field invalid because of a visible `aria-describedby` hint, so it stops inferring `required` and reporting "shows an error without aria-invalid" for hint text (WAI-ARIA 1.2 describes aria-describedby as description, not error).
- 6a718ca: Forms audit matches field kinds on whole words, so "microphone", "headphones", "unzip" and product, company or file names are no longer treated as phone, postal or name fields, and stop getting the WCAG 1.3.5 missing-autocomplete warning (WCAG 1.3.5 covers only information about the user).
- 6a718ca: r12s overflow no longer names hidden or visually-hidden boxes past the viewport edge as the cause of sideways scrolling, so only perceivable content is listed (WCAG 1.4.10).
- 6a718ca: r12s viewport check now flags a `maximum-scale` below 2 that blocks 200% text zoom (WCAG 1.4.4), not only values up to 1.
- 6a718ca: r12s overflow no longer lists tables, images, SVG or canvas as the cause of sideways scrolling, since content that needs two-dimensional layout is exempt from reflow (WCAG 1.4.10).
- 6a718ca: Forms audit no longer treats `aria-required="true"` as a constraint, so an empty field with only that attribute is not reported as sent empty while required, per WHATWG HTML constraint validation (`required` only).
- 6a718ca: The html audit now also runs the `html-validate:a11y` preset by default, so ARIA and accessibility rules such as `aria-hidden-body` are checked alongside the standard rules.
- 6a718ca: Document that `a11y.standard` selects WCAG 2.0 (and, with `axe`, 2.1) success criteria and that WCAG 2.2 criteria are not checked, since pa11y 10 has no WCAG 2.2 level.
- 6a718ca: Link a11y technique fixes to the WCAG 2.2 Techniques pages (`/WAI/WCAG22/Techniques/`) instead of the WCAG 2.1 path, matching the current W3C Recommendation.
- 6a718ca: r12s target-size now checks the WCAG 2.5.8 24px spacing circle against neighbouring target boxes instead of centre-to-centre distance.
- 6a718ca: html: markup inside `textarea`, `title`, `xmp`, `iframe`, `noembed` and `noframes` is treated as text (WHATWG 13.2.5), so links, meta and seo audits no longer report elements that browsers do not render.
- 6a718ca: html: comments end at `<!-->`, `<!--->` and `--!>` as in WHATWG 13.2.5.43-45, so markup after such a comment is no longer hidden from the audits.
- 6a718ca: html: numeric character references follow WHATWG 13.2.5.80, so `&#150;` decodes to an en dash, C1 controls map through windows-1252, and NUL, surrogate and out-of-range values decode to U+FFFD.
- 6a718ca: html: named character references use the full WHATWG table (2231 names), are case-sensitive, and legacy names decode without `;` in text and outside attribute values per WHATWG 13.2.5.72-73.
- 6a718ca: Forms audit infers fractional `min` and `max` on number fields from the field's `step` (or to six decimals with `step="any"`) instead of rounding them to the next integer, per WHATWG HTML number state, which allows any floating-point bound.
- 6a718ca: Manifest audit derives the default `scope` from `start_url` per the Web App Manifest spec, so manifests outside the site root with no `scope` no longer fail with a false "outside scope" error.
- 6a718ca: The assets audit now requires `/.well-known/change-password` to answer with a 3xx redirect that has a `Location` header, instead of accepting any response below 400, so a page served there no longer passes.
- 6a718ca: Budget sizes now use a precompressed sibling only when its codec matches `budget.compression` (`.gz` for gzip, `.br` for brotli), so the "gzipped", "brotli" and "raw" labels always describe the bytes measured.
- 6a718ca: SVG images with only a `width` or only a `height` now get the other dimension from the viewBox aspect ratio instead of reporting the viewBox size, which ignored the given value.
- 6a718ca: The assets audit now measures ICO manifest icons from their file header, so their declared `sizes` are checked against the largest embedded image instead of going unchecked.
- 6a718ca: The assets audit now measures each apple-touch-icon file and warns when it is not 180x180, instead of only checking that the file exists.
- 6a718ca: The assets audit now warns when `_headers` or the host serves `apple-app-site-association` or `assetlinks.json` with a Content-Type other than `application/json`, since Android requires JSON and Apple expects it.
- 6a718ca: assets audit now warns when `_headers` serves `/ads.txt` with a Content-Type other than `text/plain`, instead of ignoring the served type.
- 6a718ca: The assets audit now warns when `apple-app-site-association` is only at the site root, since the `/.well-known/` location is the one Apple documents.
- 6a718ca: Web app manifests with a leading UTF-8 byte order mark are parsed instead of being reported as invalid JSON, since the Infra JSON parsing algorithm the Web App Manifest spec relies on strips the BOM.
- 6a718ca: Warn when a page lacks the OGP required `og:type` or `og:url` meta tags, per ogp.me.
- 6a718ca: Read Open Graph and Twitter card meta tags only from the document `<head>`, so tags placed in `<body>` are reported as missing.
- 6a718ca: Images whose `width` or `height` does not parse as a number (such as `100%` or `auto`) now warn as lacking dimensions, per the HTML rules for parsing dimension values; `100px` counts as 100.
- 6a718ca: Error when `twitter:image` is a relative URL and warn when `twitter:card` is not a known card type, per the X Cards documentation.
- 6a718ca: AVIF dimensions no longer come from an arbitrary `ispe` box when the primary item has none; the image is reported as unsized instead, per the AVIF/HEIF spec.
- 6a718ca: AVIF images with a 90 or 270 degree `irot` transform on the primary item are now reported with width and height swapped, matching how they display (HEIF, ISO/IEC 23008-12).
- 6a718ca: An invalid manifest `display` value is now a warning instead of an error, since the Web App Manifest spec makes browsers fall back to `browser` rather than reject the manifest.
- 6a718ca: Icon checks for favicon links and manifest icons now require the href to name an existing file, so an icon pointing at an `.html` page or directory `index.html` with the same path is reported as missing.
- 6a718ca: Serve `.htm` as HTML with charset detection and give the common extensions missing from the built-in server their registered media types (RFC 9110 §8.3), instead of `application/octet-stream`.
- 6a718ca: Answer requests whose path contains an encoded slash (`%2F`) with no file instead of resolving them as a path separator, since `%2F` is data and not `/` (RFC 3986 §2.2, §6.2.2.2).
- 6a718ca: Document that `links.checkFragments` accepts `href="#x"` on `<a id>` permalink anchors as a target for `#x` (linkinator behaviour, per WHATWG HTML id matching).
- 6a718ca: Links audit honours the first `<base href>` even when an earlier `<base>` has no href, per WHATWG HTML.
- 6a718ca: Links audit no longer reports a link as `ERR` when its `#fragment` has malformed percent-encoding, as browsers accept such links per WHATWG HTML; the page itself is still checked, so `/missing/#%E0%A4%A` reports `404`.
- 6a718ca: External-link skipping now matches the audit origin on a host boundary, so URLs that only start with the audit origin text (such as a longer port on the same host) are checked as external (per WHATWG URL origin comparison).
- 6a718ca: Sitemap route discovery without `siteUrl` no longer turns URLs on other hosts into local routes; the first sitemap URL's origin is used as the site, per the sitemaps.org protocol.
- 6a718ca: Links audit checks an internal route with a dot in its last segment, such as `/release-1.2`, for the not-found view, as route discovery already does.
- 6a718ca: The csp request scanner resolves local stylesheet, script and module references against the first `<base href>` and now checks `<input type="image">`, SVG `<image href>` and `<link rel="prefetch">` requests.
- 6a718ca: Honour `accept-encoding` q-values in the built-in server, so `gzip;q=0` (or `*;q=0`) is no longer answered with a gzipped body (RFC 9110 §12.5.3).
- 6a718ca: Answer methods other than GET and HEAD with `405 Method Not Allowed` and an `Allow: GET, HEAD` header (RFC 9110 §15.5.6) instead of serving the file body.
- 6a718ca: Send `Vary: Accept-Encoding` on every compressible response when `server.gzip` is on, and merge it with any `Vary` set in `server.headers` instead of overwriting it (RFC 9110 §12.5.5).
- 6a718ca: Treat an origin-form request target starting with `//` as a path instead of a host, so the built-in server serves the requested path rather than the index page (RFC 9112 §3.2.1).
- 6a718ca: Stop the built-in server's SPA fallback answering requests outside the `siteUrl` base path with a 200, so they get a `404` as the target does not exist (RFC 9110 §15.5.5).
- 6a718ca: Answer internal server failures with `500` instead of `400`, and open the file before committing a success status so an unreadable file gets a `500` rather than a truncated `200` (RFC 9110 §15.6.1).
- 6a718ca: Send `cache-control: no-cache` on the built-in server's trailing-slash `301`, so a browser does not keep a redirect that goes stale when the directory changes (RFC 9111 §4.2.2).
- 6a718ca: Serve `.ico` as `image/vnd.microsoft.icon`, `.wav` as `audio/wave` and `.json`/`.map` as `application/json` without a charset parameter, using the IANA-registered names (RFC 2361, RFC 8259 §11).
- 6a718ca: JUnit: findings of an errored audit are now written as `<error>` elements and counted as errors, so the suite counts match the XML body.
- 6a718ca: The GitHub step summary now escapes `|` in audit names and statuses too, and caps the table at 1 MiB so GitHub does not reject the step's summary.
- 6a718ca: Flush buffered stdout before exiting after a timed-out run instead of cutting it off, per Node.js process.exit docs.
- 6a718ca: Pretty footer counts only passed audits as passed instead of counting warned ones too, per the reporters doc.
- 6a718ca: Reports no longer include `user:password` credentials passed with `--origin`, in the `origin` field or the recorded config.
- 6a718ca: SARIF `artifactLocation.uri` values now percent-encode each path segment, so files with spaces or `#`, `?`, `%` in their names are located correctly per RFC 3986.
- 6a718ca: SARIF results without a file or page are now located at the served `index.html`, so GitHub code scanning displays site-wide findings (GitHub requires at least one location per result).
- 6a718ca: SARIF rules now carry the audit description as `shortDescription`, `fullDescription` and `help`, the text GitHub code scanning requires per rule.
- 6a718ca: SARIF results now carry a `partialFingerprints.primaryLocationLineHash`, so GitHub code scanning does not show duplicate alerts for direct API uploads.
- 6a718ca: SARIF locations are now relative to `GITHUB_WORKSPACE` when set (else the working directory), and `invocations[0].workingDirectory` declares that root, per the GitHub SARIF support docs.
- 6a718ca: CLI: `--timeout` and `--audit-timeout` now reject anything that is not a whole number of milliseconds as a usage error naming the flag (exit `2`), instead of a generic config error or a silently accepted fraction.
- 6a718ca: SARIF `$schema` now points at the OASIS SARIF 2.1.0 schema instead of the schemastore mirror, per the OASIS SARIF specification.
- 6a718ca: The HTML report now sets a Content-Security-Policy meta that blocks scripts and external resources, since the page needs only its inline style.
- 6a718ca: `netlify.toml` header values decode TOML escapes and may be multi-line strings, folded to one line.
- 6a718ca: HTML parsing: numeric character references without `;` decode; an unclosed comment or raw-text element runs to the end of the document; `<title>` text keeps markup-like text and non-breaking spaces; the `<meta>` charset prescan reads only `charset` and `http-equiv` content-type declarations and skips unknown labels; a UTF-8 BOM is dropped. Pathological unclosed tags and long `&` runs no longer take quadratic time.
- 6a718ca: Forms read the autofill field before a trailing `webauthn` token; the assets audit reports a cross-origin manifest `start_url` as such and rounds SVG sizes derived from `viewBox`; images are sized from their first 64 KiB; r12s compares target sizes unrounded; ads.txt publisher collection is linear.
- 6a718ca: Reporters: SARIF fingerprints count identical findings (`:1`, `:2`, …) and paths outside the repository get no location; JUnit keeps tabs and newlines in attributes; the GitHub step summary is cut at a row end and annotations resolve relative files against the root; `server.command` flag values such as `--api-token x` are redacted in the JSON report.
- 6a718ca: SEO audit: robots.txt lines may end in a bare CR, an empty `Googlebot` group overrides `*`, paths are compared after RFC 9309 percent-encoding normalisation, and rules with many `*` wildcards match in linear time; sitemap `<loc>` values decode XML (not HTML) references.
- 6a718ca: The built-in server answers `HEAD` without reading the file, matches file extensions case-insensitively, collapses leading slashes in directory redirects (`//about` no longer redirects to host `about`) and caches each HTML file's charset.
- 6a718ca: CSP audit no longer reports same-origin requests as blocked by `https:` or `wss:` source expressions on https sites, per CSP3 scheme-source semantics.
- 6a718ca: CSP audit now matches `ws:` and scheme-less host sources against `wss:` URLs on https sites (and `ws:` on http sites), per CSP3 scheme-part matching.
- 6a718ca: Referrer-Policy checks now judge fallback lists by their last recognised token, so `unsafe-url, strict-origin` passes while `strict-origin, unsafe-url` is still flagged.
- 6a718ca: HSTS default now accepts a quoted `max-age` value, as RFC 6797 §6.2 allows.
- 6a718ca: Mixed content audit now flags `ws://` resources on pages, since browsers block insecure WebSocket URLs from `https:` pages.
- 6a718ca: Subresource integrity check now covers cross-origin `<link rel="preload">` and `<link rel="modulepreload">` tags that carry `integrity`, flagging missing `crossorigin` per the HTML spec.
- 6a718ca: Header fetching now retries with GET when a HEAD request fails with any 4xx or 5xx status, not only 405, so static hosts that refuse HEAD no longer yield empty headers.
- 6a718ca: Skip Vercel `headers` rules gated by `has` or `missing`, which were applied unconditionally, and log them as unsupported.
- 6a718ca: security.txt is now checked for UTF-8 bytes, a Canonical field when PGP-signed, and at most one Preferred-Languages line, as RFC 9116 requires.
- 6a718ca: CSP audit now warns when `script-src` (or `default-src` governing scripts) allows `blob:`, which lets the page run scripts from any blob URL it creates.
- 6a718ca: Inline `<script data-type>` and `data-nonce` attributes are no longer mistaken for `type` and `nonce`, so real inline scripts are checked against the CSP.
- 6a718ca: Mixed content audit now scans `apple-touch-icon`, `apple-touch-icon-precomposed` and `mask-icon` link URLs for `http://` resources.
- 6a718ca: security.txt Expires must be an RFC 3339 date-time with an offset; date-only and offset-less values are now reported as errors.
- 6a718ca: security.txt Contact must be a mailto:, tel: or https:// URI; ftp:, javascript: and http: values now reported errors.
- 6a718ca: Clickjacking audit now treats `frame-ancestors` sources with a wildcard host (`https://*`) as allowing any origin, per CSP3 host-source matching.
- 6a718ca: CSP audit now accepts base64url hash sources (`'sha256-…'` with `-` and `_`) as matching the inline block, per CSP3 hash-source equivalence of base64 and base64url.
- 6a718ca: CSP audit under `'strict-dynamic'` now checks static `<script src>` tags against their `nonce` instead of allowing every script host, per CSP3 strict-dynamic (only scripts loaded by already-trusted code are exempt).
- 6a718ca: Fix `X-Robots-Tag` `noindex` being dropped when a Google directive with a value (such as `max-snippet:50`) precedes it, per the Google robots meta tag docs (rules without a user agent apply to all crawlers).
- 6a718ca: The `seo` audit now reports relative `Sitemap:` lines in `robots.txt` and relative sitemap index children as `sitemap reference is not an absolute URL` instead of silently ignoring them, per the sitemaps.org protocol.
- 6a718ca: A `.xml.gz` sitemap that is not valid gzip is now reported as a `sitemap is not valid gzip` finding instead of aborting the SEO audit, per the sitemaps.org gzip convention.
- 6a718ca: A sitemap `<loc>` with an unescaped `&` or a named HTML entity such as `&copy;` is now reported as a `sitemap <loc> is not entity-escaped` finding, per the sitemaps.org rule that all data values must be entity-escaped.
- 6a718ca: A sitemap `<loc>` wrapped in `<![CDATA[...]]>` is now read literally, so `&amp;` inside it is no longer decoded to `&`, per the XML rule that CDATA content is not entity-decoded.
- 6a718ca: The `seo` audit now flags sitemap `<loc>` values of 2,048 characters or more, `<lastmod>` values that are not W3C Datetime, and sitemap indexes listing more than 50,000 sitemaps, per sitemaps.org.
- 6a718ca: Warn when robots.txt is larger than 500 KiB, since RFC 9309 §2.5 crawlers may ignore rules past their parsing limit.
- 6a718ca: Fix robots.txt rules treating a mid-pattern `$` as an end anchor so such rules now match the literal character, per RFC 9309 §2.2.3 (`$` designates the end of the match pattern only when last).
- 6a718ca: SEO audit rejects protocol-relative `//host/path` hreflang hrefs as not absolute, since Google requires fully-qualified http(s) URLs for hreflang.
- 6a718ca: SEO audit docs now state that the requirement for an absolute canonical href is deliberate policy, stricter than RFC 6596, and why it is kept.
- 6a718ca: SEO audit reports an empty `<html lang="">` as a warning (language unknown) instead of an error saying the attribute is missing, per WHATWG HTML.
- 6a718ca: Sitemap references on another origin than `siteUrl` no longer read local files of the same path, per sitemaps.org (a sitemap index lists only sitemaps on the same site).
- 6a718ca: SEO audit reads `rel="canonical"` and `rel="alternate"` hreflang links from `Link` response headers, so a canonical sent in a header no longer reports `no canonical link`.
- 6a718ca: SEO audit counts `<title>` and meta description length in code points rather than UTF-16 code units, so emoji and other astral characters no longer count as two characters.
- 6a718ca: Stop flagging robots.txt as "disallows everything" when the same user-agent group also has an `Allow` rule, per RFC 9309 §2.2.2 (the most specific match wins and `Allow` wins ties).
- 6a718ca: Googlebot now obeys the `User-agent: *` group when robots.txt has no `Googlebot` group, instead of being matched to other `googlebot-*` crawlers such as `Googlebot-Image` (RFC 9309 §2.2.1).
- 6a718ca: Fix robots meta `none` matching inside other directives such as `max-image-preview:none`, so only standalone `noindex` and `none` tokens mark a page noindex, per the Google robots meta tag docs.
- 6a718ca: SEO audit now accepts well-formed BCP 47 `lang` and `hreflang` tags with private-use, variant, extlang and grandfathered subtags (e.g. `en-US-x-twain`, `ca-ES-valencia`, `en-GB-oed`) per RFC 5646 instead of rejecting them.
- 6a718ca: i18n placeholder check now reads only ICU argument names, so translations whose select or plural branch text differs from the reference no longer raise a false mismatched-placeholders warning.
- 6a718ca: seo: a `<meta charset="utf-16">` label without a BOM is decoded and served as UTF-8, per WHATWG 13.2.3.2, instead of as UTF-16.

## 0.20.0

### Minor Changes

- d18e6a2: Fix `:name*` header patterns, duplicate header joins and silent host-file errors in `security`; share one memoized header resolution (`core/headers`) across audits; `csp` checks every meta CSP and CSPs delivered through header files; `site-files` reads redirects from host config files.
- d18e6a2: `lighthouse` failures list audit values and ids with specific fixes; new `lighthouse.ignoreAudits`, `lighthouse.metrics` and `lighthouse.audits` assert per-metric and per-audit results.
- d18e6a2: `core/csp` is now the single policy model: inline blocks follow the `script-src-elem`/`style-src-elem` chains, comma-joined policies split safely, and `<script nonce>` matches `'nonce-…'` sources with a warning for a nonce shared by every page. `security` handles `'strict-dynamic'`, `script-src-elem` and uppercase keywords, adds CSP evaluator warnings (`http:`, bypass and wildcard hosts, `'unsafe-hashes'`, unsafe style sources, `report-uri` without `report-to`, missing `form-action`), and a new `security.csp` option (default `'warn'`) reports pages with no CSP or none restricting scripts.
- d18e6a2: Add an incremental per-page cache (`cache.enabled`, `cache.dir`, `--no-cache`), used first by the `html` audit.
- d18e6a2: Parse cache is bounded by size instead of 32 pages, and `tags(html, name)` skips building the full tag list on a cache miss.
- d18e6a2: core: audits that need no server start while routes are discovered, `lighthouse` only runs alone when `performance` is measured and can test pages in parallel with `lighthouse.concurrency`, `browser.maxPages` caps open pages across audits (default 4 x half the cores), timed-out audits are aborted through `context.signal` and listed as errored, and the CLI exits after a timed-out run
- d18e6a2: Findings can carry a stable `rule` id; baseline fingerprints use it instead of the message when set, and `ignore` rules accept a `rule` pattern. Findings without a `rule` fingerprint as before.
  
  `ignore` rules accept a `reason` string. A run of every audit now reports ignore rules that matched nothing on stderr, and `--strict` fails on them.
  
  Baseline: `baseline.fuzzy` ignores digits when matching accepted findings, `baseline.failOnStale` fails on entries that no longer occur, and reports carry `staleBaseline` and `detail.stale`. With `fuzzy` on, fingerprints change for every baseline entry containing digits: re-run `--accept-findings` after enabling it. Without it, fingerprints are unchanged.
  
  Verbose reports redact `browser.state` values and `KEY=value` assignments in `server.command` in the embedded config.
  
  The run report gains `schemaVersion: 1` and `totals`, and `vidimus/report.schema.json` describes it.
  
  `sarif`: locations are relative to the working directory with `uriBaseId: '%SRCROOT%'`, findings without a file point at their first page's built HTML, and errored audits appear as `toolExecutionNotifications`. The report gains `distDir`. No finding messages changed, so baseline fingerprints are unchanged.
- d18e6a2: shots: the gallery encodes names, byte-identical shots skip the browser diff, and each shot is diffed right after capture in the same tab. New `shots.maxDiffPixels`, `shots.css` and `shots.deviceScaleFactor`; size changes and the changed region are reported.

### Patch Changes

- d18e6a2: a11y: findings are merged in url order so details no longer depend on page completion order, and a page that fails to load reports `failed to audit /path` with the error in details (baseline fingerprints of load failures change)
  
  a11y: with `runner: 'axe'` the fix links the rule's help page (fix text of axe findings changes, so baseline fingerprints change)
  
  r12s: `target-size` and `font-size` findings are grouped by element selector instead of text snippet, with measurements and up to 5 samples in details (messages and fingerprints of these findings change)
  
  i18n: `.po` files parse `msgstr[n]` and `msgctxt`, and a blank default-locale msgstr falls back to the msgid so empty and untranslated entries are detected
  
  i18n: a missing or invalid translation file is a finding for that locale instead of erroring the whole audit
- d18e6a2: budget: check every srcset and picture source against `budget.image`, key srcset-only dimension findings on their url, count one font file per `@font-face`, require exact files for assets, brotli at quality 5; assets: accept `apple-touch-icon-precomposed`.
  
  Srcset-only dimension findings are keyed by url and fonts are counted per face, so their messages change: regenerate existing baselines.
- d18e6a2: config: validate value types and ranges, Lighthouse thresholds, and the forms.allowRequests, csp.ignore and forms.values patterns at load.
- d18e6a2: forms: dialogs are accepted and reported, repeated timeouts stop a form, collected cases survive a failed reopen, the summary counts failures, unchanged pages skip the reload and `forms.screenshots` can turn off pre-submit screenshots
- d18e6a2: Memoize local file resolution per run and reuse parsed anchors in the seo orphan pass.
- d18e6a2: html: validates the shipped file by default (`html.source: 'rendered'` validates the browser DOM), skips the iframe scan on pages without `srcdoc` and no longer points `srcdoc` problems at a page line
- d18e6a2: lighthouse: null scores log as `-`, runs stop after the first failure, partial runs and load failures are reported with tailored fixes, and stale reports are removed. Threshold findings now carry an `audit ids:` details line, so existing lighthouse baselines need regenerating (details are part of the baseline fingerprint).
- d18e6a2: privacy: a failing reject click or storage read fails one page, not the audit. shots: a missing sharp skips motion GIFs with a warning and keeps the screenshots.
- d18e6a2: Refactor the security, seo, csp, i18n, a11y, links, html and site-files audits onto shared finding-grouping and header-fetching helpers, and split the long security and seo audits into smaller modules. Behaviour is kept, with these exceptions: the i18n audit lists each locale's findings together (a locale's file error and its key problems are no longer separated from other locales'), CSP keyword checks (`'unsafe-inline'`, `'unsafe-eval'`, `'strict-dynamic'`, `'unsafe-hashes'`) match case-insensitively, and the order of sitemap and robots findings within one seo run can differ. Finding messages and details are unchanged, so baseline fingerprints stay valid.
- d18e6a2: internal: forms, shots, lighthouse, privacy, budget and assets are split into smaller modules with shared finding grouping and per-run memoised file measurements. No message or details change, so baseline fingerprints are unchanged; the only wording change is the fix text of a failing `lighthouse.audits` assertion, which now points at the audit and its `'off'` switch instead of a category threshold
- d18e6a2: Internal refactor of the core, config and reporters: `run.ts`, `headers.ts`, `load.ts`, `html.ts`, `profile.ts` and the SARIF reporter are split into smaller modules, duplicated helpers are shared, and code comments are removed. Behaviour changes: a browser tab that cannot be opened now fails the audit with that error instead of being swallowed, and the header parsers no longer share module state between host config files. `report.schema.json` is now checked against the report types by a test.
- d18e6a2: seo: a Googlebot robots.txt group overrides *; X-Robots-Tag ignores other agents' scoped directives and honours none.
- d18e6a2: `csp` groups identical inline script, style and attribute findings across pages with `where`, and `security` no longer reports a missing `strict-transport-security` on `http://` localhost origins and `server.command` runs.
  
  Grouped inline findings carry one message for all pages, so their baseline fingerprints change: regenerate existing baselines.
- d18e6a2: Crawl dotted route links, exclude skipped links from the links count, and run not-found view checks concurrently.

## 0.19.0

### Minor Changes

- 34b51f6: Breaking: `reporters` entries can be objects (`{ type: 'json', file: 'reports/run.json', verbose: false }`), and the separate `reports` field is gone: write the files as `reporters` entries with a `file`. `json`, `junit`, `sarif` and `html` now also write each audit's log, the findings hidden by ignore rules or the baseline, every page seen, the resolved config and run versions; `verbose: false` turns that off.

## 0.18.1

### Patch Changes

- 5b02ced: The security audit reads headers from a page whatever its HTTP status, so dedicated 404 pages (`/404.html`, `/not-found`, ...) no longer count as a failed fetch.

## 0.18.0

### Minor Changes

- 7b83ed8: The csp audit now finds requests the site can make but has not made yet. It scans the HTML, inline and bundled JavaScript (following imported chunks) and CSS for `fetch`, XHR, `WebSocket`, `EventSource`, `sendBeacon`, workers, images, fonts, stylesheets, media and form actions, and reports those the CSP blocks. URLs that only appear in code are warnings. Policies from `server.headers` are checked too. New options `csp.requests` and `csp.ignore`.

## 0.17.0

### Minor Changes

- 4ca3978: Cross-origin `<script>` and stylesheet links with `integrity` but no `crossorigin` attribute are now errors, since browsers block them.
- 4ca3978: The security mixed-content check now also finds http:// URLs in inline CSS, style attributes, imagesrcset and SVG images.
- 4ca3978: The forms audit abandons a case that never settles after `forms.caseTimeout` (default 30 s), reports it as a finding and carries on with the remaining cases.
- 4ca3978: The r12s audit now skips absolutely or fixed positioned screen-reader-only elements clipped with `clip: rect(1px, 1px, 1px, 1px)` and elements clipped with `clip-path: inset(100%)`.
- 4ca3978: The seo audit reports JSON-LD structured data blocks that do not parse as JSON, including empty blocks, on indexable pages.
- 4ca3978: The privacy audit now reports `localStorage`, `sessionStorage` and IndexedDB names written on page load, before any consent.
- 4ca3978: The privacy audit warns about `<link rel="preconnect">` and `<link rel="dns-prefetch">` hints to third-party hosts, since the browser contacts them before consent.
- 4ca3978: The privacy audit can click the consent banner reject button (`privacy.rejectSelector`) and report cookies, storage and third-party requests that remain after rejection.
- 4ca3978: Config files are now discovered in parent directories (up to the repository root), so running vidimus from a subdirectory still uses the project config.
- 4ca3978: The shots audit can capture every page and viewport in dark mode too with the new `shots.colorSchemes` option, writing `<name>.dark.png` baselines and leaving light baseline names unchanged.
- 4ca3978: `shots --update-baseline` now replaces only the baselines of the shots captured in that run instead of clearing the whole baseline directory.
- 4ca3978: The lighthouse audit applies `browser.state` (cookies, storage, script) to every Lighthouse run.
- 4ca3978: The new `routes.hash` option makes `routes.discover: 'crawl'` follow hash-router links such as `#/about` as routes audited in rendered mode.
- 4ca3978: Add an `html` reporter (and `reports: ['html']`) that writes a single self-contained HTML report.
- 4ca3978: HTML files in other encodings (a BOM or `<meta charset>` such as windows-1252, shift_jis or UTF-16) are decoded correctly by the audits and served with their detected charset.

### Patch Changes

- 4ca3978: Quote `{dist}` in `server.command` so a dist path containing spaces is passed as one argument.
- 4ca3978: The GitHub step summary keeps multi-line errored audit messages on one table row by rendering newlines as `<br>`.
- 4ca3978: The JUnit reporter now counts `failures` from the `<failure>` elements it renders, so the attribute matches them, including for audits that errored with a finding.
- 4ca3978: `profile diff --top` now rejects values that are not positive integers (such as `abc`, `-3` or `1.5`) with a usage error and exit code 2, instead of crashing or misbehaving.
- 4ca3978: A run whose `dist` holds no HTML file now stops up front with a usage error (exit `2`) instead of auditing zero pages and passing.
- 4ca3978: Fix `RangeError` crash when profiling runs with very large timing lists by replacing spread `Math.min`/`Math.max` calls with reductions.
- 4ca3978: Budget audit now shows exceeded sizes so they never read as equal to their limit, and prints sizes of 1 MB or more as one-decimal MB (e.g. "1.0 MB").
- 4ca3978: The security audit flags a `Server` header only when it discloses a product version (such as `nginx/1.18.0`), no longer warning on bare CDN names like `cloudflare` or `ECS (dcb/7F83)`.
- 4ca3978: The security audit no longer counts a `frame-ancestors` source list with a bare `*` or scheme-only source as clickjacking protection.
- 4ca3978: Forms audit tests a `type="tel"` field for meaning (semantic) instead of browser type validation, since browsers do not validate tel format.
- 4ca3978: Forms findings group cases by their own expectation, so a group mixing valid and invalid cases no longer takes its verdict from the first one.
- 4ca3978: The forms audit now refuses to clear its output folder unless it resolves to a subfolder of the output root, so a misconfigured `forms.outDir` can no longer delete the project or other user files.
- 4ca3978: The forms audit now sends `browser.state` cookies and stops waiting after `forms.timeout` when it fetches each page source.
- 4ca3978: The image-size audit swaps JPEG width and height for EXIF orientations 5 to 8, matching how browsers display rotated photos.
- 4ca3978: Read AVIF dimensions from the primary item's ispe box and recognise AVIF files whose major brand is mif1.
- 4ca3978: Command-mode audits no longer append the `siteUrl` base path to the server origin, fixing 404s on tools that serve `dist` at `/`.
- 4ca3978: The built-in server is audited through `127.0.0.1`, the address it listens on, so runs no longer fail where `localhost` resolves to `::1` first.
- 4ca3978: `--set` and env values starting with `[` now parse as a JSON array for `server.fallback`, so rules can be passed without a config file, instead of becoming a file name.
- 4ca3978: forms audit no longer sends a `minlength`-1 case for a field with `minlength=1`, which was a false error since browsers never apply `minlength` to an empty value.
- 4ca3978: A profiled run that fails before creating `.vidimus/` now still writes its `.gitignore`, so run artifacts stay out of git.
- 4ca3978: r12s no longer treats a whitespace-only first text node as text, so `font-size:0` inline-block layouts stop producing false small-text errors.
- 4ca3978: links audit skips rendered hrefs the URL parser rejects instead of failing the whole audit.

## 0.16.0

### Minor Changes

- 58f8a26: a11y audit waits for `render.waitFor` before running pa11y, so client-rendered content is tested.
- 58f8a26: Add `shots.antialiasing` to ignore anti-aliased edge pixels when comparing screenshots.
- 58f8a26: Add `a11y.runner` (`htmlcs` or `axe`) and `a11y.includeWarnings` to pick the pa11y runner and report pa11y warnings as `warn` findings.
- 58f8a26: budget audit can measure with brotli or no compression (`budget.compression`) and uses precompressed `.br`/`.gz` files next to assets by their size on disk.
- 58f8a26: The budget audit now counts preloaded and @font-face fonts in the page total in static mode.
- 58f8a26: budget counts one image candidate per `<img>`/`<picture>` instead of every `srcset` and `<source>` variant.
- 58f8a26: budget audit caps requests per rendered page and third-party requests (`budget.requests`, `budget.thirdParty`).
- 58f8a26: SEO audit now warns about indexable pages that robots.txt rules disallow for `User-agent: *` (or Googlebot).
- 58f8a26: `routes.discover: 'sitemap'` now follows `Sitemap:` lines in robots.txt and reads `.xml.gz` sitemaps.
- 58f8a26: Config validation now rejects invalid `server.fallbackStatus`, `a11y.standard` and `forms.stub` values, and a run with no audits selected warns on stderr.
- 58f8a26: The forms audit now discovers and probes form-associated custom elements as fields.
- 58f8a26: The i18n audit reads gettext PO locale files as well as JSON.
- 58f8a26: The security audit now also reads headers from vercel.json, netlify.toml, firebase.json and staticwebapp.config.json.
- 58f8a26: SEO audit now validates hreflang language codes, self-reference and x-default.
- 58f8a26: The html audit now also reads `.htmlvalidate.js`, `.htmlvalidate.cjs` and `.htmlvalidate.mjs` config files.
- 58f8a26: Add `lighthouse.preset` (`desktop`) and `lighthouse.runs` to score each page by the median of several Lighthouse runs.
- 58f8a26: Findings can carry an optional `line`; the `html` audit sets it and the GitHub reporter emits `line=` in annotations.
- 58f8a26: The assets audit now validates the web app manifest's `start_url`, `scope`, `display` and maskable icon, and warns when an icon's declared `sizes` differ from its measured size.
- 58f8a26: Check `og:image:alt`, `og:image:width`/`height` against the measured image, and a missing or unsupported `twitter:image` in the assets audit.
- 58f8a26: The assets audit flags an og:image in SVG or AVIF format, or heavier than 1 MB (error over 8 MB).
- 58f8a26: budget audit accepts per-route limit overrides (`budget.routes`, pattern to limits, first match wins).
- 58f8a26: The i18n audit now warns when a translation drops or adds a placeholder (`{name}`, `{{name}}`, ICU argument) compared with the default locale.
- 58f8a26: Added a `sarif` reporter that writes a SARIF 2.1.0 log for GitHub code scanning.
- 58f8a26: SEO audit now reads the page title from `<head>` only and reports invalid `<html lang>` codes.
- 58f8a26: The seo audit now reads gzipped `.xml.gz` sitemaps and reports sitemaps over the 50,000 URL or 50 MB limits.
- 58f8a26: Runs now print a stderr note counting stale baseline entries of the audits that ran, with a hint to re-run `--accept-findings` to prune them.
- 58f8a26: Add `timeout` and `auditTimeout` (`--timeout`, `--audit-timeout`) so a hung audit errors, or the whole run stops with exit code `2`, instead of hanging CI.
- 58f8a26: Add `shots.overrides` to set `tolerance` and `maxDiff` per page pattern and per viewport width.
- 58f8a26: Add opt-in `baseline.matchWhere` to match accepted findings by their page list too.
- 58f8a26: forms audit now probes contenteditable and role=textbox fields, select multiple, and checkbox groups.
- 58f8a26: The seo audit now treats an `X-Robots-Tag: noindex` response header (live or from `_headers`) as noindex.

### Patch Changes

- 58f8a26: `--accept-findings` now keeps the accepted baseline entries of audits that were skipped in the run, instead of dropping them.
- 58f8a26: SEO audit now flags robots.txt `Disallow: /*` and full blocks for named user agents, not only `Disallow: /` under `User-agent: *`.
- 58f8a26: A failing renderer close no longer skips closing the static server and the browsers, so a run can no longer hang after one.
- 58f8a26: r12s and a11y audits report a failing per-page setViewport as a finding and ignore failing page close instead of failing the whole audit.
- 58f8a26: A malformed or non-object `.htmlvalidate.json` now fails the html audit with an error naming the file, instead of a raw parse exception.
- 58f8a26: Lighthouse audit now runs categories that appear only in overrides and reports a null category score as unavailable instead of 0.
- 58f8a26: SEO audit now treats robots meta `content="none"` as noindex, as the robots spec defines it.
- 58f8a26: SEO audit now treats a meta refresh with a delay and bare URL (e.g. `content="0; /new/"`) as a redirect stub, skipping it like `url=` redirects.
- 58f8a26: SEO audit now reports hreflang targets and canonical links that point at a noindex page or redirect, and canonical chains.
- 58f8a26: SEO audit now reports robots.txt `Sitemap:` lines and sitemap index entries that point at a foreign origin or at a file missing from the build.
- 58f8a26: The SEO audit now skips its robots.txt checks when the site is served under a base path, since robots.txt only applies at the host root.
- 58f8a26: The i18n audit now ignores plural-suffix differences between locales and compares array items.
- 58f8a26: The forms audit now closes the browser context of a page that fails to open instead of leaking it.
- 58f8a26: Forms audit now re-finds each form by fingerprint when it reopens a page, so a form that mounts earlier on a later load no longer gets another form's cases; forms whose DOM order changed between loads may be named differently in `.vidimus/forms/` baselines.
- 58f8a26: A shot whose baseline cannot be compared is now reported as a finding for that shot instead of failing the whole shots audit.
- 58f8a26: `meta()` audits now match a `<meta>` tag by either its `name` or its `property` attribute.
- 58f8a26: Manifest icons are now checked by their measured pixel size when the file can be read, so a 192px icon no longer passes the 512px check by declaring `sizes: "512x512"`.
- 58f8a26: Budget audit no longer counts `nomodule` legacy scripts toward the JS total.
- 58f8a26: Accepted-baseline matching now ignores `:line:col` locations in finding details, so editing a file no longer reopens accepted findings; baselines whose details contain such locations need re-accepting once.
- 58f8a26: The shared browser is now released when opening its context fails, and every browser an audit launched is closed at the end of a run so Chrome never outlives vidimus.
- 58f8a26: Config validation now rejects `severity` keys that are not audit names and values that are not `error`, `warn` or `off`, instead of silently ignoring them.
- 58f8a26: Config validation no longer rejects CSS selectors in `forms.skip` as invalid regular expressions.
- 58f8a26: A reporter failing during one audit no longer closes the server and browser while other audits are still running.
- 58f8a26: Stop parallel workers from taking new items once one task has failed.
- 58f8a26: The budget audit now measures SVG, JSON, XML, text and wasm files gzipped instead of raw, so page totals may drop.
- 58f8a26: Security header check now reports a non-2xx response instead of auditing the error page's headers.
- 58f8a26: Forms audit no longer lets a failed screenshot setup or upload leak page handles or abort the form check.
- 58f8a26: Fix false "missing title" errors on pages that omit the optional head element.

## 0.15.0

### Minor Changes

- 05e05f7: The csp audit now reports `style=` attributes, `on*=` event handlers and `javascript:` hrefs that the page CSP blocks.
- 05e05f7: forms: the CSRF check now also covers POSTs sent by fetch/XHR from the submit handler, not only native form submits.
- 05e05f7: Add `forms.ignoreRequests` to leave matching URLs (analytics beacons) out of the requests the forms audit records.
- 05e05f7: Add `links.checkFragments`, `links.checkCss` and `links.warnRedirects` options that map to linkinator and report redirects as warnings.
- 05e05f7: security audit now flags `*`, `https:` and `data:` in script-src, missing object-src and base-uri, and frame-ancestors, report-uri and sandbox in a meta CSP.

### Patch Changes

- 05e05f7: forms: reload the form before every case so canary values from a blocked or not-submitted case no longer leak into the next one.
- 05e05f7: CSP parsing keeps the case of source paths and uses the first of duplicate directives, as the spec requires.
- 05e05f7: The dist root no longer resolves to a sibling `dist.html` outside the build directory.
- 05e05f7: A root href without the siteUrl base path no longer resolves to the build, so `links` reports it as broken.
- 05e05f7: With `links.checkExternal: false`, absolute links to `siteUrl` are checked against the build instead of being skipped.
- 05e05f7: csp audit now checks inline blocks against their effective directive (script-src/style-src, falling back to default-src), accepts sha384/sha512 hashes, and ignores non-JS script types.
- 05e05f7: forms: count only requests sent after submit, so background fetches no longer cause false "sent empty" errors.
- 05e05f7: Translated pages named by a bare locale or `.html` file (`/fr` and `fr.html`) are now left out of the default page list, like the `fr/` pages.
- 05e05f7: The csp audit now reads meta CSP tags regardless of attribute order, quoting or line breaks, so inline hashes on such pages are checked.
- 05e05f7: Page URLs now percent-encode `#`, `?` and `%` in filenames, so such pages are no longer cut at the fragment or query or left undecodable.
- 05e05f7: Page filenames for shots, lighthouse and forms no longer collide when URLs differ only by `/` versus `_` (such as `/a/b/` and `/a_b/`), so existing baselines for paths containing `_` or `%` may be renamed.

## 0.14.1

### Patch Changes

- 06875d2: forms: the HTML report embeds its screenshots as `data:` URIs instead of writing `.jpg` files beside it, so `.vidimus/forms/index.html` is one self-contained file. Fixes found auditing the docs site: a query-less `GET` the page or an embed makes while a case runs (a lazy model, map tiles) no longer counts as the form sending; a form without an `action` attribute is recognised as the same form on every page; `forms.skip` also applies to fields outside a `<form>`; and a form the page adds later no longer shifts which form an index points at.

## 0.14.0

### Minor Changes

- 7ce3aea: `browser.state`: seed `localStorage`, `sessionStorage`, cookies and a raw `script` into every page a browser audit opens, before the page's own scripts run. Dismiss consent banners, sign in or set feature flags for `a11y`, `r12s`, `shots`, `privacy`, `forms`, rendering and plugins.
- cbece6b: forms: write `forms/index.html`, one static report for every exercised form with a screenshot of the form, its fields and rules, findings, and each case with a pass/fail/info verdict. Failing cases include a screenshot of the form before submit, and requests show only fields that differ from the baseline.
- 35b4039: Add `reports` config: `json` / `junit` always written to `<outDir>/report.json` / `report.xml` alongside the terminal output.

## 0.13.1

### Patch Changes

- 59ef965: The pretty reporter's progress line no longer estimates the time left for each audit; it was unreliable.

## 0.13.0

### Minor Changes

- 185b15b: The pretty reporter shows progress while audits run: pages done out of the total and the time left for each running audit, redrawn in place on a terminal and printed every 30 seconds in logs. Custom reporters get the same through a new `onProgress` hook. `server.command` servers are now stopped also when the run is interrupted or crashes, and when they keep running after the command's shell has exited.

## 0.12.0

### Minor Changes

- cdc55f9: New `forms` audit: finds every form (native, formless, react-hook-form, Angular), fills each field with an accepted value and every boundary and violation of its declared or inferred rules, and submits it in a network sandbox so nothing reaches a server. Reports invalid values that get sent, missing validation, input rendered as HTML, passwords in URLs, double submits and accessibility gaps, and writes what each form would have sent to `.vidimus/forms/`.
- 8ccc0ba: `--profile` records where a run spends its time: every audit, page, browser call (`page.goto`, each `page.evaluate` by function), Node request, pool queueing, Lighthouse phase and forms step, plus CPU, heap, event loop and GC samples. Prints a summary with hints, writes a Chrome trace to `.vidimus/profile/` (Perfetto, speedscope), adds `profile` to the JSON report, and `--profile cpu` adds a Node CPU profile. `vidimus profile diff` compares two traces, `--serial` runs audits one at a time, and audits get `context.span()` for their own spans. The `forms` audit stops waiting as soon as a submit sends a request.

## 0.11.0

### Minor Changes

- e9759c5: `a11y` and `r12s` accept `sample`, like `privacy`, `shots` and `lighthouse`: pages matching a pattern are reduced to one per template. `a11y.concurrency` now defaults to half the cores instead of `1`.

## 0.10.0

### Minor Changes

- 6051c63: `server.command` (or `--serve`) serves the build with your host's own tool instead of the built-in server, such as `npx wrangler pages dev {dist} --port {port}`, so audits see production's headers, redirects and 404s. vidimus fills in `{port}` and `{dist}`, waits for the port to answer (`server.startTimeout`), writes the command's output to `server.log` in `outDir` and stops it at the end of the run. Audits treat it like `--origin`: `security` fetches the real response headers. The new Serving the build docs page lists what the built-in server does not replicate and recipes for Cloudflare Pages, Netlify, Vercel, Firebase Hosting, Azure Static Web Apps, nginx, Apache, Caddy and GitHub Pages.

## 0.9.0

### Minor Changes

- de89c68: `security` checks `/.well-known/security.txt` (RFC 9116): a warning when it is missing, errors for a missing or invalid `Contact` or `Expires` and for an expired file. Turn it off with `security.securityTxt: false`. `assets` warns when no page links a web app manifest.
  
  `assets` also detects from the pages whether the site needs `ads.txt` (ad tags), `/.well-known/change-password` (password fields), `apple-app-site-association` or `assetlinks.json` (links to an iOS or Android app), warns when the file is missing and checks it when present. Each is set with `'auto'` (default), `'on'` or `'off'`.

## 0.8.0

### Minor Changes

- d0891a6: Iframes and embeds across audits. `csp` reports iframes whose URL the page's `frame-src` (meta CSP or `server.headers`) does not allow, warns about third-party iframes without `sandbox` (`csp.sandbox`), and checks inline blocks inside `<iframe srcdoc>`. `privacy` reports hosts loaded into an iframe as `third-party embed from <host>`, including requests made inside cross-origin frames, with a click-to-load facade as the fix. `html` validates `<iframe srcdoc>` markup.
- 79f5a99: Per-path options for sites that mix static and client-rendered sections: `server.fallback` also takes `{ match, file }` rules, so several apps under one origin each answer their own routes; `render.include` renders only the pages whose path matches; and `lighthouse.overrides` sets other thresholds for the pages whose path matches, later rules winning.

### Patch Changes

- d0891a6: `r12s` now detects horizontal overflow at mobile widths: under mobile emulation the check measured a viewport that grew with the content, so overflow below 768px was never reported. Overflow findings no longer list elements clipped by a scrolling box or off the start edge of the page, and suggest `aspect-ratio` sizing when an iframe or video causes it.
- 79f5a99: Steadier screenshots and small fixes found on the docs showcase: `shots` masks through inline styles, which a strict CSP does not block; waits for lazy images to load and decodes them before painting; waits for stylesheets added after load; grows the viewport to the page height itself, waiting again for `<picture>` sources and for late content that changes the height; and loads video metadata so the controls look the same on every run. `r12s` no longer counts screen-reader-only elements (clipped with `clip` or `clip-path`) as tap targets. The built-in server sends `.vtt` captions as `text/vtt`.

## 0.7.0

### Minor Changes

- 5e1b4a7: `shots` handles pages that change on their own. `shots.freeze` (default on) seeds `Math.random`, drives `requestAnimationFrame` from a virtual clock and stops it after 30 frames, and stills videos and endless CSS animations before the screenshot. `shots.mask` paints CSS selectors flat black, and `shots.maskEmbeds` (default on) masks cross-origin iframes. WebGL runs on SwiftShader for the same output everywhere, a canvas whose WebGL context failed is logged, and a motion recording that never settles names the elements still moving.

## 0.6.0

### Minor Changes

- a0adeda: New `render` option for client-rendered sites. With `render.mode: 'on'`, or `'auto'` for a one-page build with a large script, `seo`, `html`, `csp` and `assets` read the DOM a browser renders instead of the shipped shell, `budget` measures the build files the browser requested (lazy chunks, fonts, models), and `links` checks the links in the rendered DOM. `links.notFound` reports internal links and hash routes that render the app's not-found view. `render.waitFor` (`'load'`, `'networkidle'`, milliseconds or a CSS selector) also sets when `r12s`, `privacy`, `shots` and the route crawl consider a page loaded.
- 6c731df: New `routes` option for client-rendered apps: the server audits (`a11y`, `links`, `r12s`, `privacy`, `shots`, `lighthouse`) also open `routes.paths`, the URLs of the build's sitemap (`routes.discover: 'sitemap'`), or the same-origin links found by crawling the rendered pages (`routes.discover: 'crawl'`, up to `routes.limit` new routes). Routes without a file need `server.fallback`, and the run stops with a usage error otherwise. When no routes are set and the build has one HTML page next to a large script, the pretty reporter prints a note suggesting them.

## 0.5.0

### Minor Changes

- 753f522: The built-in server gets `server.fallback` and `server.fallbackStatus`: page requests that match no file are answered with a build file such as `index.html` or `404.html`, as single-page app hosts do, while missing assets still 404. It also sends proper content types for `.wasm`, `.glb`, `.gltf`, `.bin`, `.ktx2`, `.hdr`, `.exr`, `.map`, `.ogg`, `.mp3`, `.wav`, `.ttf` and `.otf`.

## 0.4.1

### Patch Changes

- 9051d74: The output directory (`.vidimus` by default) now gets its own `.gitignore` containing `*` when a run first creates it, instead of `vidimus init` appending `.vidimus` to the project `.gitignore`.

## 0.4.0

### Minor Changes

- 277c353: New `shots.baselineDir` option to keep the screenshot baseline outside `.vidimus/` (for example to commit it); by default it stays in `.vidimus/shots/baseline/`. `--port 0` serves the build on a free port. Audit plugins get `builtPages()` in their context, and `launchBrowser()` without options now shares one browser process between audits running at the same time, each in its own browser context. `--update-baseline` now deletes only the PNG files in the baseline directory.
  
  Fixes:
  
  - The built-in server no longer crashes on malformed or NUL-byte paths, closes when a reporter fails to start, and reports a port in use as a usage error.
  - Invalid regular expressions in config patterns are rejected when the config loads.
  - `lighthouse` and `shots` report a page that fails as a finding instead of erroring the whole audit; a failed screenshot leaves the baseline untouched on `--update-baseline`.
  - `links` no longer rewrites hosts that only start with the `siteUrl` host (`example.com.au`).
  - `csp` checks uppercase tags, ignores commented-out blocks and no longer mistakes `data-src` for `src`.
  - The HTML parser reads attributes written without a space after a quoted value, decodes the common named entities and no longer throws on out-of-range code points.
  - `r12s` flags `user-scalable=0` and `maximum-scale` below 1; `seo` checks pages whose `meta refresh` only reloads; `i18n` handles keys named like `constructor`; `security` follows same-origin redirects with a timeout; srcset URLs containing commas are kept whole.
  - `--strict` marks the findings of a failed audit as errors, JUnit keeps characters outside the BMP, GitHub annotation paths are relative to the workspace, and two reporters writing to stdout are rejected.
  - `--set` keeps numbers in mixed lists (`shots.viewports=375,1280`) and accepts `false` for `security.require.*`; `vidimus all <name>` adds the named audits; `init` refuses to create a second config file in another format.
  - Built pages are read and parsed once per run instead of once per audit.

### Patch Changes

- 277c353: `vidimus init` appends `.vidimus` to an existing `.gitignore` in the working directory when it is not listed yet.

## 0.3.0

### Minor Changes

- 36c38d8: r12s: elements that are not rendered (`display: none`, such as closed menus and popups) are no longer checked for tap target and font size; inline links inside a sentence are exempt from the tap target check, as in WCAG 2.2 success criterion 2.5.8, and a target is measured in whole pixels, so a 23.9px wide target shown as 24px is not reported; and a viewport with `maximum-scale` above 1 (`maximum-scale=1.5`) is no longer reported as disabling pinch zoom.
- 36c38d8: - On GitHub Actions the `github` reporter is added even when `-r` or `reporters` is given, so asking for a JUnit or JSON file no longer drops the annotations; it writes to stderr when `json` or `junit` writes to stdout.
  - `ignore` rules are checked when the config loads: an unknown key (`{ adit: 'seo' }`), an empty rule, a non-string value or an invalid regular expression is a config error (exit code 2) instead of silently dropping findings or erroring the audit.
  - r12s: a page that fails to load is a `failed to load` finding instead of erroring the whole audit.
  - privacy and shots honour the top-level `allLocales` (`--all-locales`).
  - lighthouse: by default it audits one page per directory instead of every page, so `lighthouse.all: true` now means something; `sample` and `urls` work as before.
  - shots: no baseline at all fails the audit (nothing was compared), and screenshots without a baseline are a warning instead of a log line.
  - i18n: the fix for empty keys no longer suggests deleting them, which would be reported as missing.
- 36c38d8: seo: pages whose canonical link points at another built page are treated as duplicates by design. They are no longer reported as duplicate titles or descriptions, missing from the sitemap or orphans, and listing one in the sitemap is a warning (`non-canonical page in the sitemap`).

### Patch Changes

- 36c38d8: The built-in server redirects a directory URL without a trailing slash (`/docs`) to `/docs/`, as GitHub Pages, Netlify and most static hosts do, so relative links on directory index pages resolve the same way as in production instead of being reported as broken.

## 0.2.1

### Patch Changes

- 9092733: Browser audits (a11y, r12s, privacy, shots, lighthouse, links) now open pages under the `siteUrl` base path when serving the build. Before, client-side routers such as VitePress's rendered their 404 page, so these audits checked the wrong page. Reported paths and `exclude`/`sample` patterns stay relative to the base path.

## 0.2.0

### Minor Changes

- 6f18026: Every finding now says what to do about it: a `fix` field, printed as `→ …` by the pretty reporter and included in GitHub annotations and JUnit output. Plugin audits can set it too.

### Patch Changes

- 6f18026: Support sites deployed under a base path (e.g. GitHub Pages project sites): when `siteUrl` has a path, URLs under it are resolved against the build root, and the local server serves the build there too.
- 6f18026: Stop publishing `src/`: source maps now embed the TypeScript sources instead.

## 0.1.0

### Minor Changes

- 7804f72: First public release: `i18n`, `csp`, `a11y`, `links`, `r12s`, `seo`, `security`, `html`, `budget`, `assets`, `privacy`, `shots` and `lighthouse` audits, per-audit severity, ignore rules, a findings baseline and a JSON Schema for config files.
