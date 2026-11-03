---
"vidimus": patch
---

CSP audit under `'strict-dynamic'` now checks static `<script src>` tags against their `nonce` instead of allowing every script host, per CSP3 strict-dynamic (only scripts loaded by already-trusted code are exempt).
