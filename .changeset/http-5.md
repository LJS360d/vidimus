---
"vidimus": patch
---

Treat an origin-form request target starting with `//` as a path instead of a host, so the built-in server serves the requested path rather than the index page (RFC 9112 §3.2.1).
