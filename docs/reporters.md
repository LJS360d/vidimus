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

A reporter is `name`, `name:file` or [an object](#object-form). The file path is relative to the working directory, its
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

## Object form

The same reporter as an object, for options the short form has no room for:

```ts
export default defineConfig({
  reporters: [
    'pretty',
    { type: 'junit', file: 'reports/junit.xml' },
    { type: 'json', file: 'reports/run.json', verbose: false },
  ],
});
```

| Option | Default | |
| --- | --- | --- |
| `type` | required | `pretty`, `github`, `json`, `junit`, `sarif` or `html` |
| `file` | stdout | where `json`, `junit`, `sarif` and `html` write, relative to the working directory |
| `verbose` | `true` | see [Verbose](#verbose) |

Objects can be mixed with names and [custom reporters](#custom-reporters). On the command line
only `-r name[:file]` exists, and `-r` replaces the config's list.

## Verbose

`json`, `junit`, `sarif` and `html` write everything the run knows, not only the audits and their
findings: per audit its log and the findings that ignore rules or the baseline hid, and for the
run its versions, audits, served directory, notes, every page seen and the resolved config.
Set `verbose: false` in the object form for just the audits and findings.
The embedded config redacts secrets: `browser.state` cookie, `localStorage` and `sessionStorage` values and `script` become `<redacted>` (keys and cookie names stay), and `KEY=value` assignments in `server.command` become `KEY=<redacted>`.

| Format | What verbose adds |
| --- | --- |
| `json` | a `detail` object |
| `html` | a Run section, and collapsible logs and hidden findings |
| `junit` | a `<system-out>` for each audit with log lines or hidden findings |
| `sarif` | run timing in `invocations`, per-rule `properties`, hidden findings with `suppressions` |

`pretty` and `github` ignore `verbose`.

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

A SARIF 2.1.0 log for GitHub code scanning. Each audit is a rule, carrying its description as the rule's short, full and help text, and each finding a result:
errors are `error`, warnings `warning`. The message holds the finding, its details, pages and
fix. A finding with a `file` gets a location, with `region.startLine` when it has a `line`.

```sh
npx vidimus -r sarif:vidimus.sarif
```

Upload it with `github/codeql-action/upload-sarif`.

## `html`

A single self-contained HTML page for sharing as a CI artifact: no scripts, no external assets,
a Content-Security-Policy meta that forbids anything but inline styles, light and dark themes. It lists the audits (failed and errored first) with status, summary and
duration, and each finding in a collapsible block with its details, pages and fix. All text is
escaped.

```sh
npx vidimus -r html:vidimus.html
```

## `json`

The whole run report, written once at the end, pretty-printed:

```json
{
  "schemaVersion": 1,
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
| `schemaVersion` | `1`; bumped when the shape changes incompatibly. The JSON Schema ships as `vidimus/report.schema.json` |
| `totals` | `errors`, `warnings`, `suppressed` counts and `audits` with the number of `passed`, `warned`, `failed`, `errored` and `skipped` audits |
| `staleBaseline` | baseline entries that no longer occur |
| `ok` | `false` when any audit failed or errored; the exit code is `1` then |
| `origin` | the audit origin without any `user:password` credentials, `''` when no selected audit needed a server |
| `startedAt` | ISO 8601 timestamp |
| `distDir` | absolute path of the served build output, `''` when no selected audit needed it |
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
variable the table is skipped. Pipes in the cells are escaped, and the text is cut short when it would exceed the 1 MiB that GitHub allows per step summary.

## `junit`

JUnit XML, for CI systems that show test reports. The mapping:

| JUnit | vidimus |
| --- | --- |
| `<testsuites name="vidimus">` | the run, with totals and duration in seconds |
| `<testsuite name="…" package="vidimus" id="…" timestamp="…" hostname="…">` | one audit, starting with an empty `<properties/>` and ending with `<system-out>` and `<system-err/>` |
| `<testcase classname="vidimus.<audit>" name="<message>" time="0.000">` | one finding, with `file` when the finding has one |
| `<failure message="…" type="failure">` | an error-level finding of a failed audit; the body has details, `on:` pages and `fix:` |
| `<error message="…" type="error">` | an error-level finding of an errored audit; the body has details, `on:` pages and `fix:` |
| `<system-out>warning: …</system-out>` | a warning; it does not count as a failure |

An audit without findings has a single test case named after its summary: empty when it passed
or warned, with `<skipped>`, `<error>` or `<failure>` otherwise.

## Custom reporters

`reporters` in the config also accepts reporter objects, next to names and `{ type }` options:

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

### SARIF locations

`sarif` writes every location as a path relative to the repository root with `uriBaseId: '%SRCROOT%'`
(declared in `originalUriBaseIds`, and repeated as `invocations[0].workingDirectory`). The root is `$GITHUB_WORKSPACE`
when set, otherwise the working directory, the same root `github` annotations use, which is what GitHub code scanning expects. Each path segment is
percent-encoded as an RFC 3986 URI reference, so `dist/my page/a#b.html` is written as
`dist/my%20page/a%23b.html`. A finding without
a `file` is placed on the built HTML file of its first page in `where` (`/blog/` becomes
`dist/blog/index.html`). A site-wide finding with no `where` is placed on the built `index.html` at the root of the served
directory, since GitHub code scanning shows no result without a location. Only a run with no served directory leaves such a result without one. Errored audits are listed as
`toolExecutionNotifications` in `invocations`, also when not verbose.

## Standards

Each reporter's output follows the standards below. The bullets name what the code checks or
writes; the clause is given where it is known.

### OASIS SARIF 2.1.0

Spec: [OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)

- §3.1: the log is written as UTF-8 JSON.
- `$schema` points at the OASIS 2.1.0 schema, `version` is `"2.1.0"`, and each run has `tool.driver.name`.
- §3.4.3 and §3.10.1: `artifactLocation.uri` is an RFC 3986 reference (see RFC 3986 below).
- `ruleId` always equals a `rules[].id`, and `level` is `error` or `warning` only.
- `region.startLine` is written only when a finding has both a file and a line, so it is never 0.
- `invocations[].executionSuccessful` is always set, from the run's `ok`.
- Hidden findings in verbose output carry `suppressions` with `kind: "external"` and a justification.
- `originalUriBaseIds` and `invocations[].workingDirectory.uri` are file URIs with a trailing slash.

### GitHub code scanning SARIF

Spec: [GitHub code scanning SARIF](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)

- Every rule has non-empty `shortDescription`, `fullDescription` and `help` text, taken from the audit description, then the run summary, then the audit name.
- Every result has `partialFingerprints.primaryLocationLineHash`: a SHA-256 of the audit, URI and message, then `:n`, where n counts results with the same hash, so identical findings stay distinct alerts (§3.27.17: a fingerprint identifies one result).
- A file outside the repository root (a `../` path) gets no `locations`, since it cannot be shown relative to `%SRCROOT%`.
- Relative URIs are rooted at `GITHUB_WORKSPACE`, or the working directory when it is unset, with `uriBaseId` `%SRCROOT%`.

### JUnit XML (Ant de facto schema)

Spec: [JUnit XML (Ant de facto schema)](https://github.com/windyroad/JUnit-Schema) (de facto; JUnit has no formal spec)

- `tests`, `failures`, `errors` and `skipped` on each `testsuite` and on `testsuites` equal the matching child counts; an errored audit's findings count as `errors`, not `failures`.
- `time` is decimal seconds with three decimals, on both `testsuites` and `testsuite`.
- A warning is a `<system-out>` line and does not count as a failure.
- Each `testsuite` has the attributes and children Ant's `JUnit.xsd` requires: `package`, `id`, `timestamp` (UTC, without a zone, as its pattern requires), `hostname`, a leading `<properties/>`, and trailing `<system-out>` and `<system-err/>`. Each `testcase` has `time`, and each `<failure>` and `<error>` a `type`.
- Beyond the XSD, the output uses the extensions [Jenkins, GitLab and Testmo read](https://github.com/testmoapp/junitxml): totals on `<testsuites>`, `skipped` counts and `<skipped>`, `file` on `testcase`, and a `<system-out>` inside a warning's `testcase`.

### XML 1.0 (Fifth Edition)

Spec: [XML 1.0 (Fifth Edition)](https://www.w3.org/TR/xml/#charsets)

- Attribute and text values escape `& < > " '`, and characters outside the `Char` production (most C0 controls, U+FFFE, U+FFFF, lone surrogates) are removed.
- No CDATA sections are written, so a `]]>` in a message cannot end one early.

### GitHub workflow commands

Spec: [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)

- Annotations are `::error` or `::warning` with `title`, and `file` and `line` when the finding has them.
- Message text escapes `%`, CR and LF; property values also escape `:` and `,`.
- `file` uses forward slashes and is relative to `GITHUB_WORKSPACE`, or the working directory when it is unset.

### GitHub job summary

Spec: [GitHub job summary](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#adding-a-job-summary)

- Table cells escape `|` and turn line breaks into `<br>`.
- The summary is kept under the 1 MiB per-step limit, as described in [GitHub](#github) above.

### JSON Schema draft-07

Spec: [JSON Schema draft-07](https://json-schema.org/draft-07/schema)

- `report.schema.json` declares draft-07 and fixes `schemaVersion` to the constant `1`.

### RFC 3339 and ISO 8601

Spec: [RFC 3339 and ISO 8601](https://www.rfc-editor.org/rfc/rfc3339)

- `startedAt` is the `toISOString()` form of the run start, and the SARIF `startTimeUtc` repeats it.

### RFC 3986

Spec: [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986)

- §2.4: each path segment of a SARIF `uri` is percent-encoded, with `/` kept as the separator.
- §4.2: SARIF `uri` values are relative references, resolved against `uriBaseId`.

### WHATWG HTML

Spec: [WHATWG HTML](https://html.spec.whatwg.org/)

- The HTML report has a doctype, `<meta charset>` as the first element in `head`, and `details` and `summary` nested validly.
- Report text is escaped for `& < > " '`, and the page has no script.

### CSP Level 3

Spec: [CSP Level 3](https://www.w3.org/TR/CSP3/)

- The HTML report sends `default-src 'none'; style-src 'unsafe-inline'`, so no script or external resource can load.

### ECMA-48

Spec: [ECMA-48](https://ecma-international.org/publications-and-standards/standards/ecma-48/)

- The pretty reporter's line redraw (`\r` then `ESC [ 2 K`) is written only on a live terminal when `CI` is unset.

### NO_COLOR

Spec: [NO_COLOR](https://no-color.org/)

- Colour is dropped when `NO_COLOR` is set, through `styleText` on the target stream.

### FORCE_COLOR and isTTY

Spec: [FORCE_COLOR and isTTY](https://nodejs.org/api/util.html#utilstyletextformat-text-options)

- The colour decision is made per stream by `styleText`, so output piped to a file has no colour.

## Not checked

- Output is not validated against `report.schema.json` or any SARIF or JUnit schema at run time.
- The JUnit output is not validated against an XSD at run time; the extensions listed under JUnit XML make it fail a strict Ant `JUnit.xsd` check.
- GitHub's SARIF upload limits (10 MB gzipped, 25,000 results) are not checked.
- The HTML report always says `lang="en"`, since there is no locale config to read a language from.
- Object-form options are not type-checked: `verbose` is used by truthiness, and only an unknown `type` is rejected.
