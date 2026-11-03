---
"vidimus": patch
---

The assets audit now requires `/.well-known/change-password` to answer with a 3xx redirect that has a `Location` header, instead of accepting any response below 400, so a page served there no longer passes.
