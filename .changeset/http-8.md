---
"vidimus": patch
---

Send `cache-control: no-cache` on the built-in server's trailing-slash `301`, so a browser does not keep a redirect that goes stale when the directory changes (RFC 9111 §4.2.2).
