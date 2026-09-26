---
"vidimus": patch
---

Browser audits (a11y, r12s, privacy, shots, lighthouse, links) now open pages under the `siteUrl` base path when serving the build. Before, client-side routers such as VitePress's rendered their 404 page, so these audits checked the wrong page. Reported paths and `exclude`/`sample` patterns stay relative to the base path.
