---
"vidimus": patch
---

External-link skipping now matches the audit origin on a host boundary, so URLs that only start with the audit origin text (such as a longer port on the same host) are checked as external (per WHATWG URL origin comparison).
