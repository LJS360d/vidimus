---
"vidimus": minor
---

New `routes` option for client-rendered apps: the server audits (`a11y`, `links`, `r12s`, `privacy`, `shots`, `lighthouse`) also open `routes.paths`, the URLs of the build's sitemap (`routes.discover: 'sitemap'`), or the same-origin links found by crawling the rendered pages (`routes.discover: 'crawl'`, with `routes.limit`, `routes.waitFor` and `routes.timeout`). Routes without a file need `server.fallback`, and the run stops with a usage error otherwise. When no routes are set and the build has one HTML page next to a large script, the pretty reporter prints a note suggesting them.
