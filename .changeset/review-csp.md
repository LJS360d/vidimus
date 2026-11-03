---
"vidimus": minor
---

CSP audit follows CSP3 more closely: a `nonce` or a hash matching `integrity` allows an external script or stylesheet; `'unsafe-inline'` is ignored next to `'strict-dynamic'`; a header splits into policies at every comma while a `<meta>` policy is never split; a source naming the site's own origin allows same-site URLs; only real event handler attributes (not `once=`) count as inline script; imports are followed past 1000 files; nonce-matched blocks are counted once.
