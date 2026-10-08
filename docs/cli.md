---
title: CLI
description: The vidimus commands and flags, how audits are selected, what gets printed where, and the exit codes.
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

`npx vidimus --version` prints the version, `npx vidimus --help` and
`npx vidimus <command> --help` list the options.

## `run`

`run` is the default command: `npx vidimus seo` and `npx vidimus run seo` are the same.

```sh
npx vidimus [run] [audits...] [options]
```

| Arguments | Runs |
| --- | --- |
| none | the `audits` list from config, minus audits with `severity: 'off'` |
| `all` | every built-in and plugin audit, minus audits with `severity: 'off'` |
| names | exactly those audits, even when their severity is `off` |

An unknown audit name is an error that lists the known ones.

| Flag | |
| --- | --- |
| `-c, --config <file>` / `--no-config` | pick a config file / ignore config files |
| `--set <key=value>` | override any config value, repeatable (`--set lighthouse.thresholds.seo=0.8`) |
| `--root`, `--dist`, `--out-dir` | project root, build output, report output |
| `--origin <url>` | audit a running server instead of serving the build, including any base path (`http://localhost:4173/project`) |
| `--site-url <url>` | production origin; absolute self-links are rewritten onto the audit origin |
| `--serve <command>` | serve the build with this command instead of the built-in server, see [Serving the build](./serving) |
| `--port <n>` | port the build is served on |
| `--all-locales` | include translated pages too |
| `--update-baseline` | `shots`: record the current screenshots as the baseline |
| `-r, --reporter <name[:file]>` | `pretty`, `json`, `github`, `junit`, repeatable |
| `--strict` | fail on warnings too |
| `--accept-findings` | write the current findings to the [baseline file](./configuration#severity-ignores-and-the-findings-baseline) |
| `--profile [level]` | record where the run spends its time: `spans` (default) or `cpu`, see [Profiling](./profiling) |
| `--serial` | run audits one at a time instead of in parallel |

Except `--profile` and `--serial`, which change how the run is measured and scheduled, each
flag sets a config key and wins over every other source:

| Flag | Config key |
| --- | --- |
| `--root` / `--dist` / `--out-dir` | `root` / `distDir` / `outDir` |
| `--origin` / `--site-url` / `--port` | `origin` / `siteUrl` / `port` |
| `--serve` | `server.command` |
| `--all-locales` | `allLocales: true` |
| `--update-baseline` | `shots.updateBaseline: true` |
| `--accept-findings` | `baseline.update: true` |
| `--strict` | `strict: true` |
| `-r` | `reporters` (replaces the list; `github` is still added on Actions) |

A relative `--root` resolves from the working directory; relative `--dist` and `--out-dir`
resolve from `root`. See [How it works](./how-it-works#config). `--port` accepts an
integer from 0 to 65535; `0` picks a free port. A port already in use exits `2`.

Any other key goes through `--set`, which uses the exact key path and is checked against the
known keys:

```sh
npx vidimus --set severity.budget=warn --set links.checkExternal=false
npx vidimus seo --set 'seo.allowNoindex=["^/search/"]'
```

## `list`

Prints every audit the config knows about, built-in and plugin, with its description:

```
* i18n        every locale defines exactly the keys of the default locale
* csp         inline <script> and <style> are hashed in the meta CSP, and iframes are allowed and sandboxed
  seo         titles, descriptions, canonical, hreflang, noindex, sitemap, robots.txt and orphan pages
  budget      page weight, image size and format, image dimensions (warn only)
- lighthouse  Lighthouse category scores meet their thresholds

* runs by default, - turned off by severity
```

`*` marks audits in the `audits` list, `-` audits with `severity: 'off'`, and
`(warn only)` audits with `severity: 'warn'`. `list` accepts `-c`, `--no-config` and `--set`.

## `config`

Prints the resolved config as JSON on stdout, and the file it came from on stderr:

```sh
npx vidimus config                          # what a run would use
npx vidimus config --no-config              # every key with its default
npx vidimus config --set port=5000 > resolved.json
```

Plugins and reporter objects are printed by name. `config` accepts `-c`, `--no-config` and
`--set`; the run flags such as `--dist` are not available here, use `--set distDir=…`.

## `profile diff`

```sh
npx vidimus profile diff before.trace.json after.trace.json
npx vidimus profile diff before.trace.json after.trace.json --top 30
```

Compares two traces written by `--profile`: self time per audit and span, largest changes
first. See [Profiling](./profiling#comparing-runs).

## `init`

```sh
npx vidimus init                 # vidimus.config.ts
npx vidimus init --format js     # vidimus.config.mjs
npx vidimus init --format json   # vidimus.config.json, with $schema
npx vidimus init --force         # overwrite an existing file
```

The file is written to the working directory with `distDir: 'dist'`, an empty `siteUrl` and an
empty `exclude`. Fill in `siteUrl` before the first run. `init` refuses to create a second
config file when one in another format already exists.

When a run first creates the output directory (`outDir`, `.vidimus` by default), it writes a
`.gitignore` containing `*` into it, so reports and screenshot baselines stay out of git with
no change to your own `.gitignore`; see [shots](./audits/shots#sharing-the-baseline) to commit a
baseline.

## Output

The `pretty` reporter prints each audit as it finishes: its log, its findings, and a summary
line with the status, the number of ignored or accepted findings and the duration. The last
line counts the audits that passed and names those that warned or failed:

```
✔ csp: 12 inline blocks across 40 pages, all hashed (0.1s)
⚠ budget: 40 page(s), heaviest /pricing/ 412 kB, 2 problem(s), 1 ignored or accepted (0.3s)
✖ links: 1 broken target(s) out of 812 links checked (9.4s)

vidimus: 2/3 passed — warnings: budget — failed: links
```

| Symbol | Status |
| --- | --- |
| `✔` | passed |
| `⚠` | warned: only warnings |
| `✖` | failed |
| `○` | skipped: nothing to check, or not configured |
| `!` | errored: the audit threw, or a peer dependency is missing |

Skipped audits are not counted in the last line.

`-r` replaces the default reporters (on GitHub Actions `github` is added back). `json` or `junit` without a file writes to stdout, and
`pretty` moves to stderr, so the output can be piped:

```sh
npx vidimus -r pretty -r json | jq '.results[] | select(.status == "failed") | .name'
```

Formats, targets and custom reporters are covered in [Reporters](./reporters).

## Exit codes

| Code | When |
| --- | --- |
| `0` | every audit passed, warned or was skipped, or `--help` / `--version`; warnings exit `0` unless `--strict` is set |
| `1` | at least one audit failed or errored, including a missing peer dependency or a browser that did not start |
| `2` | unknown flag, command, audit or reporter; unknown config key, unparsable value or invalid pattern; missing config file or build output; invalid baseline file; port in use; an unexpected error outside the audits |

Usage errors print one line starting with `vidimus:`; unexpected errors print a stack trace.

Running in CI, including GitHub Actions annotations and JUnit reports: [CI](./ci).
