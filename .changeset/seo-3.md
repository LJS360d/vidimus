---
"vidimus": patch
---

Stop flagging robots.txt as "disallows everything" when the same user-agent group also has an `Allow` rule, per RFC 9309 §2.2.2 (the most specific match wins and `Allow` wins ties).
