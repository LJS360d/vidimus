---
'vidimus': patch
---

`csp` groups identical inline script, style and attribute findings across pages with `where`, and `security` no longer reports a missing `strict-transport-security` on `http://` localhost origins and `server.command` runs.

Grouped inline findings carry one message for all pages, so their baseline fingerprints change: regenerate existing baselines.
