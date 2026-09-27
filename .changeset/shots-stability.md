---
"vidimus": patch
---

Steadier screenshots and small fixes found on the docs showcase: `shots` masks through inline styles, which a strict CSP does not block; waits for lazy images to load and decodes them before painting; waits for stylesheets added after load; grows the viewport to the page height itself, waiting again for `<picture>` sources and for late content that changes the height; and loads video metadata so the controls look the same on every run. `r12s` no longer counts screen-reader-only elements (clipped with `clip` or `clip-path`) as tap targets. The built-in server sends `.vtt` captions as `text/vtt`.
