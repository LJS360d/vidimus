---
"vidimus": patch
---

SEO audit: robots.txt lines may end in a bare CR, an empty `Googlebot` group overrides `*`, paths are compared after RFC 9309 percent-encoding normalisation, and rules with many `*` wildcards match in linear time; sitemap `<loc>` values decode XML (not HTML) references.
