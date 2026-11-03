---
"vidimus": patch
---

Answer methods other than GET and HEAD with `405 Method Not Allowed` and an `Allow: GET, HEAD` header (RFC 9110 §15.5.6) instead of serving the file body.
