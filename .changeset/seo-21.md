---
"vidimus": patch
---

SEO audit counts `<title>` and meta description length in code points rather than UTF-16 code units, so emoji and other astral characters no longer count as two characters.
