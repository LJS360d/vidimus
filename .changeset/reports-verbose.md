---
"vidimus": minor
---

Breaking: `reporters` entries can be objects (`{ type: 'json', file: 'reports/run.json', verbose: false }`), and the separate `reports` field is gone: write the files as `reporters` entries with a `file`. `json`, `junit`, `sarif` and `html` now also write each audit's log, the findings hidden by ignore rules or the baseline, every page seen, the resolved config and run versions; `verbose: false` turns that off.
