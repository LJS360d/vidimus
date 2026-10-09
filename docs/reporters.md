---
title: Reporters
description: The pretty, json, github, junit, sarif and html reporters, where each one writes, the JSON report shape and custom reporter objects.
---

# Reporters

A reporter receives the results of a run and writes them somewhere. Choose them with `-r` on
the command line or `reporters` in the config:

```sh
npx vidimus -r pretty -r junit:reports/vidimus.xml -r json:reports/vidimus.json
```

```ts
export default defineConfig({
  reporters: ['pretty', 'junit:reports/vidimus.xml'],
});
```

Without either, the reporter is `pretty`. Giving `-r` or `reporters` replaces it. On GitHub
Actions (`GITHUB_ACTIONS=true`) `github` is added to whatever list you give, so the
annotations stay when you add a JUnit file:

```sh
npx vidimus -r pretty -r junit:reports/vidimus.xml    # pretty, junit and, on Actions, github
```

To run without annotations on Actions, unset the variable for that step:
`GITHUB_ACTIONS= npx vidimus`.

An unknown name is an error: `unknown reporter "xml". Known: pretty, json, github, junit, sarif, html`.

## Targets

A reporter is `name` or `name:file`. The file path is relative to the working directory, its
directories are created, and an existing file is overwritten.

| Reporter | Writes to | `:file` |
| --- | --- | --- |
| `pretty` | stdout, or stderr when `json`, `junit`, `sarif` or `html` writes to stdout | only `pretty:stderr` is honoured |
| `json` | stdout | writes the report to the file instead |
| `junit` | stdout | writes the report to the file instead |
| `sarif` | stdout | writes the report to the file instead |
| `html` | stdout | writes the report to the file instead |
| `github` | stdout, or stderr when `json`, `junit`, `sarif` or `html` writes to stdout; and `$GITHUB_STEP_SUMMARY` | ignored |

`json`, `junit`, `sarif` or `html` without a file writes to stdout, and `pretty` moves to stderr. That keeps
stdout parsable:

```sh
npx vidimus -r pretty -r json > report.json
```

The `github` reporter moves to stderr in the same case, where the Actions runner still reads
its annotations, so `-r json > report.json` stays valid JSON on Actions too.

## Reports in `outDir`

`reports` in the config keeps file reports on every run, whatever the reporters are. Each
name is written into `outDir` (`.vidimus` by default), next to the terminal output:

```ts
export default defineConfig({
  reports: ['json', 'junit'], // .vidimus/report.json and .vidimus/report.xml
});
```

| Name | File |
| --- | --- |
| `json` | `<outDir>/report.json` |
| `junit` | `<outDir>/report.xml` |
| `sarif` | `<outDir>/report.sarif` |
| `html` | `<outDir>/report.html` |

`-r` does not replace `reports`, and `pretty` stays the default reporter. Any other name is an
error: `unknown report "pretty". Known: json, junit, sarif, html`.

## `pretty`

The terminal output. Before the audits it prints
`vidimus: serving dist on http://127.0.0.1:4322` when it serves the build, or
`vidimus: auditing <origin>` with `--origin`. Each audit is printed when it finishes: a heading, the audit's log lines, each
finding, and a summary line.

```
─── seo ────────────────────────────────────────────────────────

✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

✖ seo: 42 pages, 1 problem(s) (0.2s)
```

A finding shows its message, its detail lines, `in:` with its file relative to the working
directory, `on:` with up to three pages, and `→` with the fix. The last line of the run counts
the audits that passed, not counting skipped ones, and names those that warned or failed.

While audits run, a terminal shows one line, redrawn in place, with each running audit, how many
of its pages are done, and the time elapsed: `… shots 34/120 · a11y 12/40 (1m5s)`. When the output is not a terminal,
or `CI` is set, the same line is printed every 30 seconds instead.
Colours come from Node's `styleText`, which drops them when the stream is not a terminal or
`NO_COLOR` is set.

## `sarif`

A SARIF 2.1.0 log for GitHub code scanning. Each audit is a rule, each finding a result:
errors are `error`, warnings `warning`. The message holds the finding, its details, pages and
fix. A finding with a `file` gets a location, with `region.startLine` when it has a `line`.

```sh
npx vidimus -r sarif:vidimus.sarif
```

Upload it with `github/codeql-action/upload-sarif`.

## `html`

A single self-contained HTML page for sharing as a CI artifact: no scripts, no external assets,
light and dark themes. It lists the audits (failed and errored first) with status, summary and
duration, and each finding in a collapsible block with its details, pages and fix. All text is
escaped.

```sh
npx vidimus -r html:vidimus.html
```

## `json`

The whole run report, written once at the end, pretty-printed:

```json
{
  "ok": false,
  "origin": "http://127.0.0.1:4322",
  "startedAt": "2026-09-26T10:00:00.000Z",
  "durationMs": 10412,
  "results": [
    {
      "name": "links",
      "status": "failed",
      "summary": "1 broken target(s) out of 812 links checked",
      "findings": [
        {
          "message": "404 http://127.0.0.1:4322/old-page/",
          "where": ["/blog/", "/about/"],
          "fix": "Fix or remove the link on the pages listed, or add a pattern to links.skip if the target blocks bots."
        }
      ],
      "suppressed": 0,
      "log": [],
      "durationMs": 9403.52
    }
  ]
}
```

| Field | |
| --- | --- |
| `ok` | `false` when any audit failed or errored; the exit code is `1` then |
| `origin` | the audit origin, `''` when no selected audit needed a server |
| `startedAt` | ISO 8601 timestamp |
| `durationMs` | duration of the whole run |
| `results[]` | one entry per audit, in selection order, `exclusive` audits last |
| `profile` | with `--profile` only: the [profile summary](./profiling#in-the-json-report) |

Each result:

| Field | |
| --- | --- |
| `name` | audit name |
| `status` | `passed`, `warned`, `failed`, `skipped` or `errored` |
| `summary` | one line; for an errored audit, the error message |
| `findings` | what is left after ignore rules and the baseline |
| `suppressed` | findings hidden by ignore rules or the baseline |
| `log` | lines the audit logged, plus the stack trace of an unexpected error |
| `durationMs` | duration of the audit, fractional |

Each finding has `message`, and when set: `where` (URL paths, without the base path), `file`
(usually an absolute path), `details` (extra lines), `fix` and `severity` (`warn` or `error`).
A finding without `severity` is an error. With `severity: { <audit>: 'warn' }` in the config,
every finding of that audit carries `"severity": "warn"`.

## `github`

For GitHub Actions. Each finding becomes a workflow command, which GitHub shows as an
annotation on the run and, when it has a file, on that file:

```text
::error file=dist/pricing/index.html,title=vidimus budget::html 312 kB gzipped > 100 kB budget%0A...
::warning title=vidimus seo::no <h1>%0Aon: /en/ /fr/%0Afix: Add one <h1> heading ...
```

- warnings become `::warning`, everything else `::error`
- the title is `vidimus <audit>`
- the body is the message, the detail lines, `on:` with up to ten pages, and `fix:`
- `file` is the finding's file relative to the working directory, when it has one, plus `line` when the audit knows it (the `html` audit does for a problem on one page)
- an errored audit becomes one `::error` with its summary

At the end it appends a table (audit, status, summary) under a `### vidimus` heading to the
file named by `GITHUB_STEP_SUMMARY`, which GitHub shows on the run's summary page. Without that
variable the table is skipped.

## `junit`

JUnit XML, for CI systems that show test reports. The mapping:

| JUnit | vidimus |
| --- | --- |
| `<testsuites name="vidimus">` | the run, with totals and duration in seconds |
| `<testsuite name="…">` | one audit |
| `<testcase classname="vidimus.<audit>" name="<message>">` | one finding, with `file` when the finding has one |
| `<failure message="…">` | an error-level finding; the body has details, `on:` pages and `fix:` |
| `<system-out>warning: …</system-out>` | a warning; it does not count as a failure |

An audit without findings has a single test case named after its summary: empty when it passed
or warned, with `<skipped>`, `<error>` or `<failure>` otherwise.

## Custom reporters

`reporters` in the config also accepts objects, next to names:

```ts
import { defineConfig, type Reporter } from 'vidimus';

const notify: Reporter = {
  name: 'notify',
  async onEnd(report) {
    if (report.ok) return;
    const failed = report.results.filter(({ status }) => status === 'failed' || status === 'errored');
    await fetch(process.env.WEBHOOK_URL ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `vidimus: ${failed.map(({ name }) => name).join(', ')} failed` }),
    });
  },
};

export default defineConfig({
  reporters: ['pretty', notify],
});
```

Every hook is optional and may be async; hooks are awaited one reporter after the other.

| Hook | Called | Receives |
| --- | --- | --- |
| `onStart(info)` | once, before the first audit | `{ audits, origin, serving }` |
| `onProgress(running)` | as work starts, advances and ends; not awaited | `{ name, done, total, since }[]` |
| `onAuditEnd(result)` | as each audit finishes, in finishing order | an `AuditResult`, as in `results[]` above |
| `onEnd(report)` | once, after every audit | the `RunReport`, as in the JSON above |

In `onStart`, `audits` are the selected names, `origin` is `''` when no audit needs a server,
and `serving` is `distDir` when the built-in server is used and `undefined` otherwise.

`onProgress` gets every task still running: each running audit, and `routes` while
client-rendered routes are found. `total` is `0` until the task knows how many pages it works
through, `done` counts the finished ones, and `since` is when that count started, in ms since
the epoch. The last call, when the run ends or fails, gets an empty list.

Reporter objects can only be given in a config file or to [`run()`](./plugins#programmatic-use),
not on the command line, and `-r` replaces the config's list, objects included. An error thrown
by a hook ends the run with exit code `2`. The exit code is decided by the audits, not by
reporters.
