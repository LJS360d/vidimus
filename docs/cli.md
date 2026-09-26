---
title: CLI and CI
description: vidimus commands, flags, exit codes and reporters, and how to run it in GitHub Actions or other CI.
---

# CLI

```sh
npx vidimus                          # the audits in config.audits
npx vidimus all                      # every audit
npx vidimus links r12s               # just these
npx vidimus shots --update-baseline  # record new baseline screenshots
npx vidimus --accept-findings        # record today's findings, fail only on new ones
npx vidimus list                     # available audits, * = default
npx vidimus config                   # print the resolved config
npx vidimus init [--format ts|js|json]
```

| Flag | |
| --- | --- |
| `-c, --config <file>` / `--no-config` | pick a config file / ignore config files |
| `--set <key=value>` | override any config value, repeatable (`--set lighthouse.thresholds.seo=0.8`) |
| `--root`, `--dist`, `--out-dir` | project root, build output, report output |
| `--origin <url>` | audit a running server instead of serving the build, including any base path (`http://localhost:4173/project`) |
| `--site-url <url>` | production origin; absolute self-links are rewritten onto the audit origin |
| `--port <n>` | port of the built-in static server |
| `--all-locales` | include translated pages too |
| `-r, --reporter <name[:file]>` | `pretty`, `json`, `github`, `junit`, repeatable |
| `--strict` | fail on warnings too |
| `--accept-findings` | write the current findings to the [baseline file](configuration.md#severity-ignores-and-the-findings-baseline) |

Exit codes: `0` all passed, warned or skipped, `1` an audit failed or errored, `2` bad usage or
config.

## CI

On GitHub Actions (`GITHUB_ACTIONS=true`, Forgejo sets it too) the `github` reporter is added
automatically: findings become annotations on the pull request, and a summary table goes to
the job summary. Other CI systems can read JUnit or JSON:

```sh
npx vidimus -r pretty -r junit:reports/vidimus.xml -r json:reports/vidimus.json
```

`json` or `junit` without a file writes to stdout, and `pretty` moves to stderr.

A GitHub Actions job:

```yaml
- uses: actions/checkout@v5
- uses: actions/setup-node@v5
  with:
    node-version: 24
    cache: npm
- run: npm ci
- run: npm run build
- run: npx vidimus all -r pretty -r junit:reports/vidimus.xml
```

Chrome runs with `--no-sandbox --disable-dev-shm-usage` by default (`browser.args`). Point
`browser.executablePath` at a system Chromium to skip puppeteer's download.
