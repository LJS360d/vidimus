---
"vidimus": patch
---

Fix `X-Robots-Tag` `noindex` being dropped when a Google directive with a value (such as `max-snippet:50`) precedes it, per the Google robots meta tag docs (rules without a user agent apply to all crawlers).
