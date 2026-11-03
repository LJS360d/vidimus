---
"vidimus": minor
---

Security audit: `<track src>` and `<input type="image" src>` over http are mixed content; `<form action>`/`formaction` over http is now a warning (`form submits over http: …`) instead of a mixed-content error; `http:` in `script-src` is not warned about next to `'strict-dynamic'`; security.txt `Expires` dates that do not exist (`2027-02-30`, `T24:00`) are rejected.
