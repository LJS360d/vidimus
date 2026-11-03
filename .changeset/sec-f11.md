---
"vidimus": patch
---

Referrer-Policy checks now judge fallback lists by their last recognised token, so `unsafe-url, strict-origin` passes while `strict-origin, unsafe-url` is still flagged.
