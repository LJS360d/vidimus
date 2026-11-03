---
"vidimus": patch
---

SVG images with only a `width` or only a `height` now get the other dimension from the viewBox aspect ratio instead of reporting the viewBox size, which ignored the given value.
