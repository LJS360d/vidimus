---
"vidimus": minor
---

HSTS default now requires a `max-age` of at least 31536000 (one year); a policy without `includeSubDomains` gets its own warning, `strict-transport-security lacks includeSubDomains`. Values from 31536001 to 31999999 are no longer rejected.
