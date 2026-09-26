---
"vidimus": minor
---

- On GitHub Actions the `github` reporter is added even when `-r` or `reporters` is given, so asking for a JUnit or JSON file no longer drops the annotations; it writes to stderr when `json` or `junit` writes to stdout.
- `ignore` rules are checked when the config loads: an unknown key (`{ adit: 'seo' }`), an empty rule, a non-string value or an invalid regular expression is a config error (exit code 2) instead of silently dropping findings or erroring the audit.
- r12s: a page that fails to load is a `failed to load` finding instead of erroring the whole audit.
- privacy and shots honour the top-level `allLocales` (`--all-locales`).
- lighthouse: by default it audits one page per directory instead of every page, so `lighthouse.all: true` now means something; `sample` and `urls` work as before.
- shots: no baseline at all fails the audit (nothing was compared), and screenshots without a baseline are a warning instead of a log line.
- i18n: the fix for empty keys no longer suggests deleting them, which would be reported as missing.
