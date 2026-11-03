---
"vidimus": patch
---

Stop the built-in server's SPA fallback answering requests outside the `siteUrl` base path with a 200, so they get a `404` as the target does not exist (RFC 9110 §15.5.5).
