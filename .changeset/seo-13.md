---
"vidimus": patch
---

A sitemap `<loc>` wrapped in `<![CDATA[...]]>` is now read literally, so `&amp;` inside it is no longer decoded to `&`, per the XML rule that CDATA content is not entity-decoded.
