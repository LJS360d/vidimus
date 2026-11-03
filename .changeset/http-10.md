---
"vidimus": patch
---

Answer requests whose path contains an encoded slash (`%2F`) with no file instead of resolving them as a path separator, since `%2F` is data and not `/` (RFC 3986 §2.2, §6.2.2.2).
