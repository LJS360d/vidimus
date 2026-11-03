---
"vidimus": patch
---

Fix robots.txt rules treating a mid-pattern `$` as an end anchor so such rules now match the literal character, per RFC 9309 §2.2.3 (`$` designates the end of the match pattern only when last).
