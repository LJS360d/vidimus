---
"vidimus": patch
---

The built-in server answers `HEAD` without reading the file, matches file extensions case-insensitively, collapses leading slashes in directory redirects (`//about` no longer redirects to host `about`) and caches each HTML file's charset.
