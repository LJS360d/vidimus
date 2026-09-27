---
title: Eight flavors
description: Why these docs are built by six static site generators and two client-rendered apps from one source, and what auditing all of them with vidimus finds.
---

# Eight flavors of the same docs

These docs are more complicated than they need to be, on purpose. The same markdown is built
by six static site generators and two client-rendered apps, deployed side by side under one
GitHub Pages origin, linked to each other page by page, and audited by vidimus as a single
site. A docs site for a tool that audits static sites is the cheapest real test bed it can
have, and one generator only tests one generator's habits.

| Flavor | Path | Engine | Theme | URL style |
| --- | --- | --- | --- | --- |
| VitePress | `/vidimus/` | Vue, Vite | default theme, extended | clean: `/vidimus/cli` |
| Starlight | `/vidimus/astro/` | Astro | Starlight, with component overrides | directory: `/vidimus/astro/cli/` |
| Hugo | `/vidimus/hugo/` | Go templates | handwritten, no JavaScript | directory: `/vidimus/hugo/cli/` |
| Eleventy | `/vidimus/eleventy/` | Nunjucks, markdown-it | handwritten, no JavaScript | directory: `/vidimus/eleventy/cli/` |
| Zola | `/vidimus/zola/` | Tera, Rust | handwritten, no JavaScript | directory: `/vidimus/zola/cli/` |
| mdBook | `/vidimus/mdbook/` | Handlebars, Rust | default theme, post-processed | files: `/vidimus/mdbook/cli.html` |
| React | `/vidimus/react/` | React 19, React Router, Vite | handwritten, rendered in the browser | clean: `/vidimus/react/cli` |
| Angular | `/vidimus/angular/` | Angular, zoneless, standalone | handwritten, rendered in the browser | clean: `/vidimus/angular/cli` |

VitePress is the primary flavor: every other flavor's pages declare a canonical link to the
matching VitePress page, and only VitePress pages are in the sitemap.

## How it is built

The markdown in `docs/` is written once, in a subset every engine understands: CommonMark,
GFM tables, fenced code, one `# ` heading per page, and relative links without the `.md`
extension (`./cli`, `../configuration#anchor`). `docs/nav.json` is the sidebar for all of them,
and `docs/flavors.ts` knows every flavor's base path and URL style.

`node scripts/docs.ts build` then:

1. syncs the markdown into each engine's content directory, rewriting relative links to the
   engine's own URLs, converting frontmatter (YAML for most, TOML for Zola, none for mdBook),
   and precomputing each page's canonical URL, edit link and links to the same page in the
   other flavors;
2. builds VitePress into `docs/dist/`, and every other engine into `docs/dist/<flavor>/`;
3. post-processes mdBook's output, which has no per-page hooks, to add the canonical link, the
   page description and the flavor bar.

The React and Angular flavors get no markdown: the sync step renders every page to HTML with
`marked` and writes them as one JSON module that the app imports. Each app is one
`index.html`; it looks the page up by URL, sets the title, description and canonical link, and
puts the HTML in the page. Nothing is prerendered. vidimus audits that build as a host with
rewrites would serve it, one `index.html` per app answering every route. GitHub Pages has no
rewrites, so just before deploying, `node scripts/docs.ts pages-copies` gives every route a
copy of that `index.html` (`react/cli.html`, `react/audits/index.html`), which Pages serves
with a `200`.

The [showcase](./showcase) page is the one page with heavy content: a three.js scene bundled
from npm, embeds, video and a table a script fills. Its assets are generated at build time into
`docs/public/showcase/`.

```sh
pnpm run build          # vidimus itself
pnpm run docs:build     # all eight flavors into docs/dist
pnpm run docs:audit     # vidimus on docs/dist, as one site
```

Hugo, Zola and mdBook are pinned in `mise.toml`; `mise install` gets them.

## What gets exercised

Eight builds produce eight sets of habits in the same output, and every audit sees all of them
at once:

- `links` follows the flavor bar from every page to the same page in the seven other flavors,
  so a URL-style mismatch between generators shows up as a broken link.
- `seo` checks eight ways of writing titles, descriptions and canonicals, and has to recognise
  that seven of the eight copies of each page point their canonical at the VitePress one.
- `html` validates markup from Vue's renderer, Astro, three handwritten template languages and
  mdBook's Handlebars theme.
- `csp` checks the handwritten Hugo, Eleventy and Zola themes, which ship a strict meta
  Content-Security-Policy with no inline scripts or styles.
- `budget`, `a11y`, `r12s`, `privacy` and `lighthouse` see single-page-app hydration, islands,
  and plain HTML with no JavaScript at all.
- The React and Angular flavors have one HTML file each. `routes` lists their pages from
  `nav.json`, `server.fallback` answers them with the app's `index.html`, and
  `render.include` renders them, so every audit covers the same pages in them as in the other
  six: the server audits open 26 routes per app, the `dist` audits and `links` read the
  rendered DOM, and `links.notFound` checks that no link leads to the app's not-found view.

Anything vidimus gets wrong about one of these generators shows up here first. The flavor
bar at the top of every page links to the same page in the other seven.

## What it found

Setting this up found gaps in vidimus itself, each fixed with a test:

- `seo` reported every mirrored page as a duplicate title and description and as missing from
  the sitemap, although each one declares a canonical link to the original. Pages canonical to
  another built page are now treated as duplicates by design.
- The built-in server answered `/audits` with `audits/index.html` instead of redirecting to
  `/audits/` like GitHub Pages does, so relative links on directory index pages were reported
  as broken. It now redirects.
- `r12s` checked the font size of elements that are not rendered (mdBook's closed theme menu),
  flagged links inside sentences as small tap targets, which WCAG 2.5.8 exempts, failed a
  target it printed as 24px wide because it was 23.9px, and read `maximum-scale=1.5` as zoom
  disabled.

And problems in the generators' own output, handled in the build or with scoped `ignore` rules
in `docs/vidimus.config.ts`:

- Starlight's code blocks put `<div>` elements inside `<code>` and `<button>`, which is invalid
  HTML (`html`, ignored under `/astro/`).
- mdBook's default theme has two `<h1>` per page, no Open Graph tags, a sidebar `<iframe>`
  without a title and an unlabelled search field (fixed by post-processing), a search form
  without a submit button (`a11y`, ignored) and ARIA attributes on a `<label>`, a small icon
  link and a deprecated `unload` listener (Lighthouse, ignored).
- Zola's `get_url` emits absolute production URLs, so a local audit loaded the stylesheet from
  the live site; the Zola templates use root-relative paths instead. It also always writes a
  `404.html` that GitHub Pages never serves from a subdirectory, and treats double curly braces in code
  blocks as template syntax.
- A strict meta CSP (`default-src 'none'`) makes Lighthouse report `robots.txt` as invalid;
  see [troubleshooting](./troubleshooting#lighthouse-says-robotstxt-is-not-valid).

Adding the client-rendered flavors and the showcase found more, again fixed in vidimus with a
test:

- `server.fallback` was one file for the whole site; two apps under one origin need one each,
  so it also takes `{ match, file }` rules. `render` rendered every page or none, and now takes
  `render.include`; `lighthouse` gained per-path `overrides`.
- `r12s` counted a screen-reader-only skip link (`clip: rect(0 0 0 0)`) as a tap target, once
  the longer flavor bar put a real link next to it.
- `shots` masked embeds with an injected stylesheet, which a strict CSP blocks, so the map on
  the showcase was captured unmasked in three flavors. It also took some screenshots before a
  lazy `<picture>` had painted, before a video's controls had their duration, or before a
  script-filled table had its final height.
- The built-in server sent `.vtt` captions as `application/octet-stream`.

And in the apps: Angular inlines a large JSON import as an object literal, which costs 400 ms
of blocking time under Lighthouse's throttling, so the Angular flavor gets its pages from a
`JSON.parse` module instead. Angular's own startup is still a ~500 ms task (React's is
~190 ms), and the Angular pages have a lower Lighthouse performance threshold for it.
