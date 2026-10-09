---
title: Showcase
description: A WebGL scene, the first YouTube video, art-directed images, a live in-page audit and a script-filled table, audited in eight site generators.
script: showcase/showcase.js
style: showcase/showcase.css
csp: "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://www.openstreetmap.org https://stackblitz.com; base-uri 'none'; form-action 'none'"
---

# Showcase

Most tools show you a screenshot of a clean report on a hello-world page. This page is the
opposite: it is built to be hard to audit. A WebGL scene, iframes from three hosts, video with
captions, art-directed images in three formats and a table that does not exist until a script
writes it. Eight site generators build it, from VitePress to mdBook to a client-rendered Angular
app, and vidimus audits every one of them on every push to `main`. Then it runs again, live, in
your browser, on the page you are reading.

<link rel="stylesheet" href="/showcase/showcase.css">

## Audit this page, live

No recording, no screenshot. Press the button and a pocket edition of vidimus runs inside this
tab: nine of its checks, rewritten to read this page's DOM and the browser's Performance API as
they are right now. It fetches every internal link on the page to see if it is broken, lists
every host your browser has talked to, weighs every file it downloaded and looks for anything
sticking out of the viewport.

<div class="showcase-live">
<div class="showcase-live-bar">
<button type="button" data-live-audit="">Audit this page, live</button>
<span data-live-status="" role="status"></span>
</div>
<pre data-live-output="" tabindex="0">$ vidimus --live
Waiting for you. Whatever it prints is what this page really has, theme and all.</pre>
</div>

Try to make it complain:

- Scroll down to the OpenStreetMap iframe [under Embeds](#embeds) and run it again. The map
  is lazy-loaded, so `privacy` fails as soon as the browser fetches it. The full audit reports
  the same iframe, and this site accepts it on purpose.
- Play the zoo video, then run it again. `privacy` catches `youtube-nocookie.com` the moment
  the facade lets it in, and not a moment before.
- Shrink the window to phone width and run it again: `r12s` measures the page at whatever size
  it is.
- Open this page in [another flavor](./flavors) and compare. Each theme brings its own markup,
  scripts and weight, and the live audit reads all of it.

The real vidimus does much more than this: it serves the build, drives headless Chromium over
every page, and runs axe-core, html-validate, Lighthouse and pixel diffs across every page and
viewport. The live audit is a taste of it, running where there is no server and no Node.js.

## A three.js scene

<figure>
<div class="showcase-scene" id="showcase-scene" role="img" aria-label="The pages of these docs as a rotating graph of coloured dots, one per page, joined by a line for every link between two pages.">
<img src="/showcase/poster.svg" width="800" height="450" alt="">
</div>
<figcaption>Every page of these docs, coloured by section, with a line per link between two pages. Drag it to spin it. The graph is written as <code>graph.glb</code> when the docs are built.</figcaption>
</figure>

The scene loads [three.js](https://threejs.org) from this site, not from a CDN, and only when
it is about to scroll into view: until then the page shows the poster. It reads its model from a `.glb` file, spins only while it is on
screen, renders a single frame under `prefers-reduced-motion: reduce`, and leaves the static
SVG poster in place when WebGL is not available. The whole block is one `role="img"` with a
text alternative, and the script is an external module, so a strict CSP needs `script-src
'self'` and nothing else.

What vidimus reports here:

- `budget` measures what the browser fetched, because `render.include` covers this page. The
  page's script is 12 kB: three.js, 530 kB of it, is a separate chunk the script imports only
  when the scene nears the viewport, so it is not part of the load and the web fonts lead.

  ```
  ✖ page 383 kB total > 300 kB budget
      84 kB /assets/inter-roman-symbols.CQZtw9ew.woff2
      80 kB /assets/inter-italic-latin.Duvr4T3O.woff2
      73 kB /assets/inter-roman-latin.q5rAVC0E.woff2
  ```

  That is with the page budget lowered to 300 kB to make it speak; the default is 2 MB.
- `shots` freezes the scene: `requestAnimationFrame` stops after 30 frames of a virtual clock,
  so two runs capture the same frame.

  ```
  hugo_showcase@375x800.png  unchanged
  react_showcase@1280x800.png  0.01% changed -> diff/react_showcase@1280x800.png
  ```

- `lighthouse` scores this page 74 to 99 on performance depending on the flavor, about as
  well as the text pages now that three.js waits for the scene. It keeps its own threshold in
  `docs/vidimus.config.ts`, for the video, embeds and WebGL:
  `overrides: [{ match: 'showcase', thresholds: { performance: 0.75 } }]`.
- `csp`, on the flavors with a strict meta CSP, finds nothing: the page's policy allows
  `script-src 'self'` and the script is a file.

## Embeds

April 23, 2005: nineteen seconds of Jawed Karim in front of the elephants at the San Diego Zoo,
the first video ever uploaded to YouTube. Here it sits behind a click-to-load facade: until you
press play, the page shows a thumbnail served from this site and loads nothing from YouTube.

<button type="button" class="showcase-facade" data-embed="https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?autoplay=1" data-title="Video: Me at the zoo, the first video on YouTube (2005)">
<img src="/showcase/zoo.webp" width="480" height="270" alt="">
<span>▶ Play “Me at the zoo”, the first video on YouTube (loads youtube-nocookie.com)</span>
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

Vidimus is Latin for “we have seen”, so here is someone who has seen everything: a responsive
image in AVIF, WebP and JPEG, each at two widths, and the browser picks one.

<div class="showcase-gallery">
<figure>
<picture class="showcase-picture">
<source type="image/avif" srcset="/showcase/owl-480.avif 480w, /showcase/owl-960.avif 960w" sizes="(max-width: 48rem) 100vw, 48rem">
<source type="image/webp" srcset="/showcase/owl-480.webp 480w, /showcase/owl-960.webp 960w" sizes="(max-width: 48rem) 100vw, 48rem">
<img src="/showcase/owl-960.jpg" srcset="/showcase/owl-480.jpg 480w, /showcase/owl-960.jpg 960w" sizes="(max-width: 48rem) 100vw, 48rem" width="960" height="640" alt="A Eurasian eagle-owl in close-up, one orange eye fixed on the camera." loading="lazy" decoding="async">
</picture>
<figcaption>Eurasian eagle-owl by DomenicBlair, <a href="https://commons.wikimedia.org/wiki/File:Eurasian_Eagle_Owl_Bubo_Bubo_Bird_Up_Close.jpg">CC0, via Wikimedia Commons</a>.</figcaption>
</figure>
<figure>
<picture class="showcase-picture">
<source media="(max-width: 40rem)" type="image/avif" srcset="/showcase/tiger-crop-480.avif" width="480" height="480">
<source media="(max-width: 40rem)" type="image/webp" srcset="/showcase/tiger-crop-480.webp" width="480" height="480">
<source media="(max-width: 40rem)" srcset="/showcase/tiger-crop-480.jpg" width="480" height="480">
<source type="image/avif" srcset="/showcase/tiger-640.avif 640w, /showcase/tiger-1024.avif 1024w" sizes="(max-width: 48rem) 100vw, 48rem">
<source type="image/webp" srcset="/showcase/tiger-640.webp 640w, /showcase/tiger-1024.webp 1024w" sizes="(max-width: 48rem) 100vw, 48rem">
<img src="/showcase/tiger-1024.jpg" srcset="/showcase/tiger-640.jpg 640w, /showcase/tiger-1024.jpg 1024w" sizes="(max-width: 48rem) 100vw, 48rem" width="1024" height="818" alt="Henri Rousseau's painting Surprised!: a tiger crouching in the tall grass of a jungle during a storm, teeth bared." loading="lazy" decoding="async">
</picture>
<figcaption>Henri Rousseau, <cite>Surprised!</cite>, 1891, National Gallery, London. <a href="https://commons.wikimedia.org/wiki/File:Surprised-Rousseau.jpg">Public domain</a>. On a narrow screen the page swaps in a square crop of the tiger: art direction, with a different image per breakpoint.</figcaption>
</figure>
</div>

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

- `budget` checks the image budget and legacy formats: every `<picture>` has AVIF and WebP
  sources, so the JPEG fallbacks are not reported, and every `<img>` has `width` and `height`.
- `shots` captures the page at 375 and 1280 px wide, so the square crop of the tiger and the
  whole painting each have a baseline of their own.
- `shots` also pauses the video on its first frame and loads its metadata, so the controls look
  the same in every run. It waits for lazy images, which it switches to eager loading.
- The captions are a `.vtt` file, which the built-in server sends as `text/vtt`, as a host
  would.

## A form with rules the markup does not show

Tell us what you think. Only the name and email rules are in the HTML: the 1 to 5 rating, the
20-character minimum on the message and the blank-name check live in the page's script, as they
would in an app validating with Zod or Angular `Validators`.

<form class="showcase-form" id="showcase-feedback" data-feedback="">
<label for="feedback-author">Name</label>
<input id="feedback-author" name="author" type="text" autocomplete="name" maxlength="100" required aria-describedby="feedback-author-error">
<p class="field-error" id="feedback-author-error"></p>
<label for="feedback-email">Email</label>
<input id="feedback-email" name="email" type="email" autocomplete="email" required>
<label for="feedback-rating">Rating, 1 to 5</label>
<input id="feedback-rating" name="rating" type="number" inputmode="numeric" required aria-describedby="feedback-rating-error">
<p class="field-error" id="feedback-rating-error"></p>
<label for="feedback-message">Message</label>
<textarea id="feedback-message" name="message" rows="4" required aria-describedby="feedback-message-error"></textarea>
<p class="field-error" id="feedback-message-error"></p>
<button type="submit">Send feedback</button>
<p data-feedback-status="" role="status"></p>
</form>

GitHub Pages has no backend: the form posts to the site, which answers `405`, and nothing is
stored.

What vidimus reports here:

- `forms` finds this form in all eight flavors, from the static HTML of Hugo to the page React
  and Angular render in the browser, recognises it as one form and exercises it once. Every
  request it makes is stopped in a network sandbox, so even a site with a real backend would
  receive nothing.
- It reads `required` and `type="email"` from the markup, then probes each field with values
  around the one it accepts and watches `aria-invalid` and the error text: it infers `min=1`,
  `max=5` on the rating and `minlength=20` on the message by binary search, and tests their
  boundaries like declared ones.
- The message needs 20 characters, longer than any value vidimus makes up, so the config gives
  it one: `forms: { values: { '^message$': '…' } }`.
- A double click sends one request: the script disables the button while it is in flight.
- The message has no length limit, which `forms` reports; this site accepts it on purpose,
  scoped to this page in `docs/vidimus.config.ts`:

  ```
  ⚠ showcase-feedback: message has no length limit
      message=long: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…(10000 chars)" → POST /vidimus/showcase/feedback
      on: /angular/showcase /astro/showcase/ /eleventy/showcase/ +5 more
      → Add maxlength (and enforce the same limit on the server).
  ```

- `.vidimus/forms/index.html` holds every case with its verdict and, for each failure, a
  screenshot of the form right before submit, embedded in the file.

## A table filled by a script

The rows below are not in the HTML file: a script fetches them from `results.json` and adds
them. They are a summary of the audit run over these docs, and so are these numbers:

<dl class="showcase-stats" data-stats="">
<div><dt>pages audited</dt><dd data-stat="pages">217</dd></div>
<div><dt>links followed</dt><dd data-stat="links">650</dd></div>
<div><dt>audits run</dt><dd data-stat="audits">11</dd></div>
<div><dt>audits passed</dt><dd data-stat="passed">11</dd></div>
</dl>

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
