---
"vidimus": patch
---

Icon checks for favicon links and manifest icons now require the href to name an existing file, so an icon pointing at an `.html` page or directory `index.html` with the same path is reported as missing.
