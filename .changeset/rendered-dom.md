---
"vidimus": minor
---

New `render` option for client-rendered sites. With `render.mode: 'on'`, or `'auto'` for a one-page build with a large script, `seo`, `html`, `csp` and `assets` read the DOM a browser renders instead of the shipped shell, `budget` measures the build files the browser requested (lazy chunks, fonts, models), and `links` checks the links in the rendered DOM. `links.notFound` reports internal links and hash routes that render the app's not-found view. `render.waitFor` (`'load'`, `'networkidle'`, milliseconds or a CSS selector) also sets when `r12s`, `privacy`, `shots` and the route crawl consider a page loaded.
