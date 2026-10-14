---
"vidimus": minor
---

Findings can carry a stable `rule` id; baseline fingerprints use it instead of the message when set, and `ignore` rules accept a `rule` pattern. Findings without a `rule` fingerprint as before.

`ignore` rules accept a `reason` string. A run of every audit now reports ignore rules that matched nothing on stderr, and `--strict` fails on them.

Baseline: `baseline.fuzzy` ignores digits when matching accepted findings, `baseline.failOnStale` fails on entries that no longer occur, and reports carry `staleBaseline` and `detail.stale`. With `fuzzy` on, fingerprints change for every baseline entry containing digits: re-run `--accept-findings` after enabling it. Without it, fingerprints are unchanged.

Verbose reports redact `browser.state` values and `KEY=value` assignments in `server.command` in the embedded config.

The run report gains `schemaVersion: 1` and `totals`, and `vidimus/report.schema.json` describes it.

`sarif`: locations are relative to the working directory with `uriBaseId: '%SRCROOT%'`, findings without a file point at their first page's built HTML, and errored audits appear as `toolExecutionNotifications`. The report gains `distDir`. No finding messages changed, so baseline fingerprints are unchanged.
