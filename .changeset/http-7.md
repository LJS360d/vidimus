---
"vidimus": patch
---

Answer internal server failures with `500` instead of `400`, and open the file before committing a success status so an unreadable file gets a `500` rather than a truncated `200` (RFC 9110 §15.6.1).
