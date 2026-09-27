---
title: Showcase
description: A WebGL scene, embeds, video, responsive images and a script-filled table, and what vidimus reports on each, in every flavor of these docs.
script: showcase/showcase.js
csp: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.openstreetmap.org https://stackblitz.com; base-uri 'none'; form-action 'none'"
---

# Showcase

The other pages of these docs are text. This one carries the content that makes audits hard: a
WebGL scene, third-party embeds, video, responsive images and markup that only exists after a
script runs. It is built by every flavor like any other page, and audited with the rest of the
site, so each block below ends with what vidimus reports about it.

<link rel="stylesheet" href="/showcase/showcase.css">

## A three.js scene

<figure>
<div class="showcase-scene" id="showcase-scene" role="img" aria-label="The pages of these docs as a rotating graph of coloured dots, one per page, joined by a line for every link between two pages.">
<img src="/showcase/poster.svg" width="800" height="450" alt="">
</div>
<figcaption>The pages of these docs, coloured by section, with a line per link between two pages. The graph is written as <code>graph.glb</code> when the docs are built.</figcaption>
</figure>

The scene loads [three.js](https://threejs.org) from this site, bundled with the page's own
script, not from a CDN. It reads its model from a `.glb` file, spins only while it is on
screen, renders a single frame under `prefers-reduced-motion: reduce`, and leaves the static
SVG poster in place when WebGL is not available. The whole block is one `role="img"` with a
text alternative, and the script is an external module, so a strict CSP needs `script-src
'self'` and nothing else.

What vidimus reports here:

- `budget` measures what the browser fetched, because `render.include` covers this page: the
  three.js bundle is the heaviest file.

  ```
  ✖ page 331 kB total > 300 kB budget
      140 kB /showcase/showcase.js
      73 kB /assets/inter-roman-latin.q5rAVC0E.woff2
      43 kB /assets/chunks/framework.FK4MkOMX.js
  ```

  That is with the page budget lowered to 300 kB to make it speak; the default is 2 MB.
- `shots` freezes the scene: `requestAnimationFrame` stops after 30 frames of a virtual clock,
  so two runs capture the same frame.

  ```
  hugo_showcase@375x800.png  unchanged
  react_showcase@1280x800.png  0.01% changed -> diff/react_showcase@1280x800.png
  ```

- `lighthouse` scores this page lower than the text pages, 78 to 98 on performance depending on
  the flavor, so it has its own threshold in `docs/vidimus.config.ts`:
  `overrides: [{ match: 'showcase', thresholds: { performance: 0.75 } }]`.
- `csp`, on the flavors with a strict meta CSP, finds nothing: the page's policy allows
  `script-src 'self'` and the script is a file.

## Embeds

A YouTube video behind a click-to-load facade: until the button is pressed, the page loads an
image from this site and nothing from YouTube.

<button type="button" class="showcase-facade" data-embed="https://www.youtube-nocookie.com/embed/cCOL7MC4Pl0?autoplay=1" data-title="Video: Jake Archibald on the event loop, JSConf Asia 2018">
<img src="/showcase/facade.webp" width="960" height="540" alt="">
<span>Play video: Jake Archibald on the event loop, JSConf Asia 2018 (loads youtube-nocookie.com)</span>
</button>

An OpenStreetMap iframe, loaded lazily with a sandbox and no facade, so it is exactly the kind
of embed `privacy` exists to find:

<iframe class="showcase-frame" src="https://www.openstreetmap.org/export/embed.html?bbox=11.2400%2C43.7630%2C11.2700%2C43.7800&amp;layer=mapnik" title="Map of central Florence, OpenStreetMap" loading="lazy" sandbox="allow-scripts allow-same-origin"></iframe>

[View the map on openstreetmap.org](https://www.openstreetmap.org/#map=16/43.7715/11.2550).

A StackBlitz project, behind a facade too: it boots a whole development environment in the
browser.

<button type="button" class="showcase-facade" data-embed="https://stackblitz.com/edit/vitejs-vite?embed=1&amp;file=index.html" data-title="StackBlitz: a Vite starter project">
<img src="/showcase/facade.webp" width="960" height="540" alt="">
<span>Open the StackBlitz editor: a Vite starter project (loads stackblitz.com)</span>
</button>

What vidimus reports here:

- `privacy` sees no request to YouTube or StackBlitz: the facades load nothing until clicked.
  The map is reported, with the requests the iframe makes from inside:

  ```
  ✖ third-party embed from www.openstreetmap.org
      loaded in an <iframe> on page load
      https://www.openstreetmap.org/export/embed.html?bbox=11.2400%2C43.7630%2C11.2700%2C43.7800&layer=mapnik
      https://www.openstreetmap.org/assets/embed-8cbd447f….css
      https://www.openstreetmap.org/assets/embed-3c62483a….js
      on: /angular/showcase /astro/showcase/ /eleventy/showcase/ +5 more
      → Put the embed behind a click-to-load facade (a static preview that loads the iframe on click), or load it only after consent.
  ```

  It is accepted by an `ignore` rule scoped to this page, with a comment saying why.
- `csp` checks the iframe against each page's `frame-src`; the Hugo, Eleventy, Zola, React and
  Angular policies list `https://www.openstreetmap.org`, so it passes, and the `sandbox`
  attribute keeps the third-party iframe warning away.
- `shots` masks the map, a cross-origin iframe, as a black box, so tiles loading in a different
  order never count as a change.
- `a11y` and `html` require the `title` on the iframe.

## Video, images and a diagram

A self-hosted video with a poster and captions:

<video class="showcase-media" controls preload="none" width="640" height="360" poster="/showcase/clip-poster.webp">
<source src="/showcase/clip.webm" type="video/webm">
<track kind="captions" src="/showcase/clip.vtt" srclang="en" label="English" default>
</video>

A responsive image in AVIF, WebP and PNG, each at two widths:

<picture class="showcase-picture">
<source type="image/avif" srcset="/showcase/card-480.avif 480w, /showcase/card-960.avif 960w" sizes="(max-width: 48rem) 100vw, 48rem">
<source type="image/webp" srcset="/showcase/card-480.webp 480w, /showcase/card-960.webp 960w" sizes="(max-width: 48rem) 100vw, 48rem">
<img src="/showcase/card-960.png" srcset="/showcase/card-480.png 480w, /showcase/card-960.png 960w" sizes="(max-width: 48rem) 100vw, 48rem" width="960" height="504" alt="The vidimus social card: the name vidimus and the tagline We have seen." loading="lazy" decoding="async">
</picture>

An inline SVG diagram of a run:

<svg class="showcase-diagram" viewBox="0 0 640 120" width="640" height="120" role="img" aria-labelledby="showcase-diagram-title">
<title id="showcase-diagram-title">A vidimus run: the build is served, the audits read it, and their findings go to the reporters.</title>
<g fill="none" stroke="currentColor" stroke-width="2">
<rect x="8" y="30" width="130" height="60" rx="8"/>
<rect x="178" y="30" width="130" height="60" rx="8"/>
<rect x="348" y="30" width="130" height="60" rx="8"/>
<rect x="518" y="30" width="114" height="60" rx="8"/>
<path d="M138 60h40M308 60h40M478 60h40"/>
</g>
<g fill="currentColor" font-family="system-ui, sans-serif" font-size="16" text-anchor="middle">
<text x="73" y="66">build</text>
<text x="243" y="66">server</text>
<text x="413" y="66">audits</text>
<text x="575" y="66">findings</text>
</g>
</svg>

What vidimus reports here:

- `budget` checks the image budget and legacy formats: the `<picture>` has AVIF and WebP
  sources, so the PNG fallback is not reported, and every `<img>` has `width` and `height`.
- `shots` pauses the video on its first frame and loads its metadata, so the controls look the
  same in every run. It waits for lazy images, which it switches to eager loading.
- The captions are a `.vtt` file, which the built-in server sends as `text/vtt`, as a host
  would.

## A table filled by a script

The rows below are not in the HTML file: a script fetches them from `results.json` and adds
them. They are a summary of the audit run over these docs.

<table class="showcase-results">
<caption>Audit results for these docs</caption>
<thead><tr><th scope="col">Audit</th><th scope="col">Status</th><th scope="col">Summary</th></tr></thead>
<tbody data-results=""><tr><td colspan="3">The results are filled in by JavaScript.</td></tr></tbody>
</table>

What vidimus reports here:

- The table's rows exist only in the rendered DOM. `render.include` renders this page in every
  flavor, so `html` validates the rows and `seo` and `assets` read the page as a browser sees
  it. Without it they would read the empty `<tbody>` of the built file.
- In the React and Angular flavors every page is like this table: the built file is an empty
  shell, and the page exists only after the app runs. See [Client-rendered
  apps](./frameworks#client-rendered-apps).
