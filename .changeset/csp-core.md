---
'vidimus': minor
---

`core/csp` is now the single policy model: inline blocks follow the `script-src-elem`/`style-src-elem` chains, comma-joined policies split safely, and `<script nonce>` matches `'nonce-…'` sources with a warning for a nonce shared by every page. `security` handles `'strict-dynamic'`, `script-src-elem` and uppercase keywords, adds CSP evaluator warnings (`http:`, bypass and wildcard hosts, `'unsafe-hashes'`, unsafe style sources, `report-uri` without `report-to`, missing `form-action`), and a new `security.csp` option (default `'warn'`) reports pages with no CSP or none restricting scripts.
