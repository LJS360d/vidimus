---
"vidimus": minor
---

core: audits that need no server start while routes are discovered, `lighthouse` only runs alone when `performance` is measured and can test pages in parallel with `lighthouse.concurrency`, `browser.maxPages` caps open pages across audits (default 4 x half the cores), timed-out audits are aborted through `context.signal` and listed as errored, and the CLI exits after a timed-out run
