---
"vidimus": patch
---

A sitemap `<loc>` with an unescaped `&` or a named HTML entity such as `&copy;` is now reported as a `sitemap <loc> is not entity-escaped` finding, per the sitemaps.org rule that all data values must be entity-escaped.
