---
"vidimus": patch
---

Clickjacking audit now treats `frame-ancestors` sources with a wildcard host (`https://*`) as allowing any origin, per CSP3 host-source matching.
