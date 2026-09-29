---
title: Configuration
description: Config files, environment variables, JSON Schema, top-level keys, severity, ignore rules and the findings baseline.
---

# Configuration

Sources, lowest to highest precedence:

1. defaults
2. the first config file found in the working directory:
   `vidimus.config.{ts,mts,js,mjs,cjs,json}`, `.vidimusrc`, `.vidimusrc.json`, or the
   `"vidimus"` field of `package.json` (or the file given by `--config` / `VIDIMUS_CONFIG`)
3. environment variables: `VIDIMUS_<KEY>`, nesting with `__`
   (`VIDIMUS_SITE_URL`, `VIDIMUS_LIGHTHOUSE__THRESHOLDS__BEST_PRACTICES=0.8`)
4. `--set key.path=value`
5. CLI flags

Objects merge deeply, arrays replace. Values from env and `--set` are converted to the type
of the key they replace: numbers, booleans, comma lists or JSON arrays. Unknown keys in a
config file or `--set` are an error, so a typo fails loudly. `VIDIMUS_*` variables that don't
name a config key are ignored, since CI environments often define unrelated ones.

`--no-config` skips config files, including `VIDIMUS_CONFIG`; env, `--set` and flags still
apply. `npx vidimus config` prints the resolved config as JSON, and the file it was loaded
from on stderr (`source: (defaults only)` when there is none).

## Config files

`npx vidimus init` writes a starting point: `vidimus.config.ts` by default,
`vidimus.config.mjs` with `--format js`, `vidimus.config.json` with `--format json`. It refuses
to overwrite an existing file unless given `--force`.

`.vidimusrc` is read as JSON. A `package.json` counts only when it has a `"vidimus"` field.

JSON configs get autocompletion and validation from the bundled schema:

```json
{ "$schema": "./node_modules/vidimus/schema.json", "siteUrl": "https://example.org" }
```

The `$schema` key is dropped before the config is checked.

TS configs load natively on Node ≥ 22.18. A config can be a function, and can import data
straight from the project instead of duplicating it:

```ts
import { defineConfig } from 'vidimus';
import locales from './src/i18n/locales.json' with { type: 'json' };

export default defineConfig(({ env }) => ({
  siteUrl: env.SITE_URL ?? 'https://example.org',
  exclude: ['^admin/'],
  locales: locales.locales,
  defaultLocale: locales.defaultLocale,
  i18n: { files: 'src/i18n/{locale}.json' },
  server: {
    headers: [{ match: '^/_astro/', headers: { 'cache-control': 'public, max-age=31536000, immutable' } }],
  },
  lighthouse: { sample: ['/news/[^/]+/$'], thresholds: { seo: 0.9 } },
}));
```

The function receives `{ cwd, env }` (the working directory and the environment) and can be
async. `defineConfig` returns its argument unchanged; it exists for type checking. A module
config uses its default export, or the module namespace when there is none.

## Environment variables

The part after `VIDIMUS_` is matched against config keys ignoring case and underscores, so
`VIDIMUS_SITE_URL` sets `siteUrl` and `VIDIMUS_BROWSER__EXECUTABLE_PATH` sets
`browser.executablePath`. Inside open records (`severity`, `lighthouse.thresholds`,
`security.require`, `html.rules`) a new key is lowercased with `_` turned into `-`:
`VIDIMUS_SEVERITY__BUDGET=warn`, `VIDIMUS_LIGHTHOUSE__THRESHOLDS__BEST_PRACTICES=0.8`.

`VIDIMUS_CONFIG` names the config file, like `--config`.

## `--set`

`--set` takes a dotted path with the exact key names and is repeatable:

```sh
npx vidimus --set lighthouse.thresholds.seo=0.8 --set links.checkExternal=false
npx vidimus --set 'exclude=["^admin/","^drafts/"]' --set r12s.viewports=320,1280
```

Conversion follows the type of the default value:

| Current value | Accepted input |
| --- | --- |
| string | taken as is |
| number | any number; anything else is an error |
| boolean | `1`, `true`, `yes`, `on` / `0`, `false`, `no`, `off`, empty |
| array | a comma list (`a,b`), or a JSON array (`["a","b"]`) |
| object or new key | JSON, or the raw string when it is not JSON |

The same conversion applies to environment variables.

## Errors

A config problem stops the run with exit code `2` before any audit starts:

```
vidimus: /path/to/site/vidimus.config.ts: unknown config key "seo.titleLenght"
vidimus: --set links.timout=5000: unknown config key "links.timout"
vidimus: VIDIMUS_PORT: "abc" is not a number
vidimus: config file not found: /path/to/site/vidimus.config.json
```

Key names are checked; values in a config file are not. Use the JSON Schema or the types of
`defineConfig` to catch a string where a number belongs. `ignore` rules are checked in full
([below](#ignore-rules-in-detail)); entries of other arrays, such as `server.headers` rules, are
not.

## Top-level keys

Every key with its default: `npx vidimus config --no-config`. Patterns are regular expression
strings. The top-level `exclude` matches built file paths (`admin/index.html`); per-audit
`exclude` and `sample` match URL paths (`/admin/`).

| Key | Default | |
| --- | --- | --- |
| `root` | the config file's directory, or the working directory | where relative paths resolve from |
| `distDir` | `dist` | build output, relative to `root` |
| `outDir` | `.vidimus` | reports and screenshots, relative to `root` |
| `port` | `4322` | port the build is served on, by the built-in server or `server.command` |
| `origin` | `''` | audit this server instead of serving the build (`--origin`) |
| `siteUrl` | `''` | production URL, with the base path if there is one |
| `exclude` | `[]` | built file paths to leave out of every audit |
| `locales` / `defaultLocale` | `[]` / `''` | locale path prefixes and the default one |
| `allLocales` | `false` | include translated pages in `a11y`, `links`, `privacy` and `shots` |
| `routes.paths` | `[]` | extra page paths to audit, relative to the `siteUrl` base path |
| `routes.discover` | `'off'` | `'sitemap'` or `'crawl'`: find more pages, for client-rendered apps |
| `routes.limit` | `200` | most new routes `'crawl'` adds |
| `render.mode` | `'off'` | `'on'` or `'auto'`: `dist` audits read the DOM a browser renders, see [How it works](./how-it-works#client-rendered-sites) |
| `render.include` | `[]` | URL path patterns of the pages to render; empty renders every page |
| `render.waitFor` | `'load'` | when an opened page is ready: `'load'`, `'networkidle'`, milliseconds after load or a CSS selector |
| `render.timeout` | `30000` | milliseconds per rendered or crawled page |
| `render.concurrency` | half the cores, 2 to 8 | browser tabs rendering at once |
| `audits` | `['i18n', 'csp', 'a11y', 'links', 'r12s']` | what `npx vidimus` runs |
| `severity` | `{}` | per audit `error`, `warn` or `off` |
| `strict` | `false` | fail on warnings too |
| `ignore` | `[]` | rules that drop findings |
| `baseline.file` / `baseline.update` | `vidimus.baseline.json` / `false` | the findings baseline; `''` turns it off |
| `plugins` | `[]` | custom audits, see [Custom audits and API](./plugins) |
| `reporters` | `[]` | reporter names, `name:file` or objects, see [Reporters](./reporters) |
| `browser.args` | `['--no-sandbox', '--disable-dev-shm-usage']` | Chrome flags for every browser audit |
| `browser.executablePath` | `''` | a Chrome or Chromium to use instead of puppeteer's |
| `server.command` | `''` | serve the build with this shell command instead of the built-in server; `{port}` and `{dist}` are filled in (`--serve`), see [Serving the build](./serving) |
| `server.startTimeout` | `60000` | milliseconds to wait for `server.command` to answer |
| `server.gzip` | `true` | gzip text responses of the built-in server |
| `server.headers` | `[]` | `{ match, headers }` rules for the built-in server |
| `server.fallback` | `''` | build file served for page requests that match no file, for single-page apps, or `{ match, file }` rules per path |
| `server.fallbackStatus` | `200` | status sent with `server.fallback`: `200` or `404` |

The keys of each audit are documented on its page, starting from the [audits overview](./audits/).

`siteUrl` is your production URL. Canonical, sitemap and Open Graph checks compare against its
origin, and absolute links to your own site are checked against the build. A `siteUrl` with a
path (`https://user.github.io/project`) is a base path: the build is served, and its pages are
opened, under it. See [How it works](./how-it-works#base-paths).

`browser.args` is an array, so setting it replaces the defaults: keep `--no-sandbox` in the list
when Chrome runs as root in a container.

## Severity, ignores and the findings baseline

Adopt a noisy audit without blocking CI, then tighten it:

```ts
export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'budget'],
  severity: { budget: 'warn', lighthouse: 'off' },
  ignore: [
    { audit: 'seo', message: '^orphan page' },
    { audit: 'a11y|r12s', where: '^/embed/' },
  ],
});
```

- `severity`: per audit, `error` (default), `warn` (findings become warnings) or `off` (left
  out of the default set and of `all`; naming it on the command line still runs it).
- `ignore`: drop findings. Every key is an optional regular expression: `audit` matches the
  audit name, `message` the finding, `where` the pages. A rule with `where` removes only the
  matching pages from a finding and keeps the rest.
- Findings baseline: `npx vidimus --accept-findings` writes every current finding to
  `vidimus.baseline.json` (`baseline.file`). Later runs hide those findings and fail only on new
  ones, so a legacy site can adopt an audit today and pay the debt down over time. Commit the
  file; re-run with `--accept-findings` after fixing things to shrink it. A finding matches by
  audit, message, file and details, not by page list.

Hidden findings are counted in each audit's summary line.

### Ignore rules in detail

- `audit` must match the whole audit name: `seo` does not match `seo-extra`, and `a11y|r12s`
  matches both audits.
- `message` and `where` match anywhere in the text unless anchored with `^` and `$`.
- A key left out matches everything. A rule without `where` drops whole findings, and a rule
  with only `audit` drops every finding of that audit.
- A rule with `where` has no effect on a finding that lists no pages.
- Rules are checked when the config loads, and the run stops with exit code `2` on an unknown
  key (`ignore[0]: unknown key "adit"`), an empty rule `{}` (which would drop every finding of
  every audit), a value that is not a string or an invalid regular expression.

`--strict` applies to what is left after ignores and the baseline, and overrides
`severity: 'warn'`: a downgraded audit with findings still fails.

### The baseline file

```json
{
  "version": 1,
  "findings": [
    {
      "audit": "budget",
      "message": "image /img/hero.png 812 kB > 500 kB budget",
      "file": "dist/img/hero.png"
    },
    {
      "audit": "seo",
      "message": "no <h1>"
    }
  ]
}
```

Findings are sorted by audit and message. `file` is stored relative to `root`, so the file is
portable between machines. Ignored findings are not recorded.

`--accept-findings` rewrites the entries only of the audits that ran; entries of other audits,
and of audits that errored, are kept. That run records findings instead of reporting them:
each audit counts them as accepted and passes, unless it errors or fails on its own. A
missing baseline file is treated as empty; a file that is not valid JSON, or has no `findings`
array, is an error. Set `baseline.file` to `''` to turn the baseline off.

The workflow for an existing site is in [Adopting on an existing site](./adopting).
