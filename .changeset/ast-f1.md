---
"vidimus": patch
---

Manifest audit derives the default `scope` from `start_url` per the Web App Manifest spec, so manifests outside the site root with no `scope` no longer fail with a false "outside scope" error.
