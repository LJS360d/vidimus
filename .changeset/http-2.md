---
"vidimus": patch
---

Honour `accept-encoding` q-values in the built-in server, so `gzip;q=0` (or `*;q=0`) is no longer answered with a gzipped body (RFC 9110 §12.5.3).
