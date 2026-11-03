---
"vidimus": patch
---

seo: a `<meta charset="utf-16">` label without a BOM is decoded and served as UTF-8, per WHATWG 13.2.3.2, instead of as UTF-16.
