---
"vidimus": patch
---

Googlebot now obeys the `User-agent: *` group when robots.txt has no `Googlebot` group, instead of being matched to other `googlebot-*` crawlers such as `Googlebot-Image` (RFC 9309 §2.2.1).
