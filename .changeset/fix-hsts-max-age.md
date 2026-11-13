---
"vidimus": patch
---

`security`: the default HSTS check counts only a directive named exactly `max-age`, so `x-max-age=…; max-age=0` fails.
