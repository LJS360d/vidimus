---
'vidimus': patch
---

Internal refactor of the core, config and reporters: `run.ts`, `headers.ts`, `load.ts`, `html.ts`, `profile.ts` and the SARIF reporter are split into smaller modules, duplicated helpers are shared, and code comments are removed. Behaviour changes: a browser tab that cannot be opened now fails the audit with that error instead of being swallowed, and the header parsers no longer share module state between host config files. `report.schema.json` is now checked against the report types by a test.
