---
"vidimus": patch
---

SARIF `artifactLocation.uri` values now percent-encode each path segment, so files with spaces or `#`, `?`, `%` in their names are located correctly per RFC 3986.
