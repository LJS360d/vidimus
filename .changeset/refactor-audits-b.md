---
"vidimus": patch
---

internal: forms, shots, lighthouse, privacy, budget and assets are split into smaller modules with shared finding grouping and per-run memoised file measurements. No message or details change, so baseline fingerprints are unchanged; the only wording change is the fix text of a failing `lighthouse.audits` assertion, which now points at the audit and its `'off'` switch instead of a category threshold
