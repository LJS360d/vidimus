---
"vidimus": patch
---

CLI: `--timeout` and `--audit-timeout` now reject anything that is not a whole number of milliseconds as a usage error naming the flag (exit `2`), instead of a generic config error or a silently accepted fraction.
