---
'vidimus': minor
---

Parse cache is bounded by size instead of 32 pages, and `tags(html, name)` skips building the full tag list on a cache miss.
