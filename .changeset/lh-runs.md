---
'vidimus': patch
---

lighthouse: null scores log as `-`, runs stop after the first failure, partial runs and load failures are reported with tailored fixes, and stale reports are removed. Threshold findings now carry an `audit ids:` details line, so existing lighthouse baselines need regenerating (details are part of the baseline fingerprint).
