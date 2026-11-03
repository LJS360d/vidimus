---
"vidimus": patch
---

Fix robots meta `none` matching inside other directives such as `max-image-preview:none`, so only standalone `noindex` and `none` tokens mark a page noindex, per the Google robots meta tag docs.
