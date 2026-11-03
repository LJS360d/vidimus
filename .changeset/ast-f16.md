---
"vidimus": patch
---

The assets audit now warns when `_headers` or the host serves `apple-app-site-association` or `assetlinks.json` with a Content-Type other than `application/json`, since Android requires JSON and Apple expects it.
