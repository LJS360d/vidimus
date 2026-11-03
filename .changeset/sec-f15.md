---
"vidimus": patch
---

Header fetching now retries with GET when a HEAD request fails with any 4xx or 5xx status, not only 405, so static hosts that refuse HEAD no longer yield empty headers.
