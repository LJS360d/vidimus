---
"vidimus": patch
---

Send `Vary: Accept-Encoding` on every compressible response when `server.gzip` is on, and merge it with any `Vary` set in `server.headers` instead of overwriting it (RFC 9110 §12.5.5).
