---
'vidimus': patch
---

Refactor the security, seo, csp, i18n, a11y, links, html and site-files audits onto shared finding-grouping and header-fetching helpers, and split the long security and seo audits into smaller modules. Behaviour is kept, with these exceptions: the i18n audit lists each locale's findings together (a locale's file error and its key problems are no longer separated from other locales'), CSP keyword checks (`'unsafe-inline'`, `'unsafe-eval'`, `'strict-dynamic'`, `'unsafe-hashes'`) match case-insensitively, and the order of sitemap and robots findings within one seo run can differ. Finding messages and details are unchanged, so baseline fingerprints stay valid.
