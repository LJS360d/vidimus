---
"vidimus": minor
---

Add `timeout` and `auditTimeout` (`--timeout`, `--audit-timeout`) so a hung audit errors, or the whole run stops with exit code `2`, instead of hanging CI.
