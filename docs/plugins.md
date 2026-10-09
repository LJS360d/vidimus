---
title: Custom audits and API
description: Write your own audits and reporters, the audit context and finding shape, and run vidimus from JavaScript.
---

# Custom audits and API

A custom audit is an object with a name, a description and an async `run` function. Add it to
`plugins` and it behaves like a built-in one: it shows up in `npx vidimus list`, runs with
`all` or by name, and its findings go through `severity`, `ignore`, the baseline and every
reporter.

```ts
import { defineConfig, type Audit } from 'vidimus';

const noLoremIpsum: Audit = {
  name: 'lorem',
  description: 'no placeholder copy in the build',
  requires: 'server',
  async run({ pageUrls }) {
    const findings = [];
    for (const url of pageUrls()) {
      if ((await (await fetch(url)).text()).includes('Lorem ipsum')) {
        findings.push({
          message: 'placeholder copy',
          where: [new URL(url).pathname],
          fix: 'Replace the Lorem ipsum text before publishing.',
        });
      }
    }
    return { summary: `${findings.length} page(s) with placeholder copy`, findings };
  },
};

export default defineConfig({
  plugins: [noLoremIpsum],
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'lorem'],
});
```

A plugin with the same name as a built-in audit replaces it.

## The `Audit` object

| Field | |
| --- | --- |
| `name` | what the CLI, `severity`, `ignore` and reports call it |
| `description` | one line, shown by `npx vidimus list` |
| `requires` | `source`, `dist` or `server` (default) |
| `exclusive` | `true` to run alone, after the other audits |
| `run(context)` | returns `{ summary, findings?, status? }` |

`requires` is `source` (no build), `dist` (reads files) or `server` (the default: the build is
served over HTTP). It decides what the run prepares: the build must exist unless every selected
audit is `source`, and the static server starts only when some audit is `server` and no
`--origin` is given.

Audits run concurrently. Set `exclusive: true` for work that should not share the machine,
such as timing measurements; the built-in `lighthouse` does.

## The run context

`run` receives an `AuditContext`:

| Field | |
| --- | --- |
| `config` | the resolved `VidimusConfig`, every key filled in |
| `root` | absolute project root |
| `dist` | absolute path of the build output (`distDir` resolved from `root`) |
| `origin` | where the build is served, without a trailing slash, base path included (`http://127.0.0.1:4322/project`) |
| `resolve(...segments)` | resolves a path from `root` |
| `pageUrls(query?)` | absolute URLs of the built pages under `origin` |
| `builtPages(exclude?)` | the built HTML files as `{ file, rel, path, html }`, minus files matching `exclude` |
| `log(line?)` | adds lines to the audit's log; multi-line strings are split |
| `span(name, fn, attrs?)` | times `fn` as a named span in [`--profile`](./profiling) runs; just calls `fn` otherwise |
| `importPeer(name)` | imports an optional dependency, with an install hint if it is missing |
| `launchBrowser(options?)` | launches puppeteer with the `browser` config |

`pageUrls()` lists every HTML file in the build, minus the top-level `exclude`, and minus
translated pages unless `allLocales` is set. `index.html` becomes a trailing slash. It takes an
optional query:

| Query | |
| --- | --- |
| `exclude` | URL path patterns to leave out, matched without the base path (`^/drafts/`) |
| `allLocales` | include translated pages; defaults to the `allLocales` config |

It throws `<dist> has no HTML pages. Rebuild.` when nothing is left, which makes the audit
error.

`importPeer('name')` caches the module. When the package is not installed it throws a
`MissingPeerError`: the audit errors with `"name" is not installed. Add it as a dev dependency:
npm i -D name`, and the other audits carry on.

`builtPages()` reads each file once per run and shares it between audits. `exclude` patterns
match the path relative to `dist` (`blog/index.html`); the top-level `exclude` is not applied, so
pass `config.exclude` to honour it.

`launchBrowser(options)` needs `puppeteer` installed. It passes puppeteer's `LaunchOptions`
through, uses `browser.executablePath` when set, and appends `options.args` to `browser.args`.
Without options, audits running at the same time share one browser process, each in its own
browser context (separate cookies and storage); `close()` releases your share and the browser
closes when the last audit is done. Pass options to get a browser of
your own. Either way, close it yourself, in a `finally`.

The run gives no audit-specific config section to plugins: unknown keys are a config error.
Take options through a function instead:

```ts
const maxTitle = (max: number): Audit => ({
  name: 'title-length',
  description: `titles up to ${max} characters`,
  requires: 'dist',
  async run() {
    /* ... */
    return { summary: 'ok' };
  },
});

export default defineConfig({ plugins: [maxTitle(55)] });
```

## Findings

| Field | |
| --- | --- |
| `message` | what is wrong, one line; also what `ignore.message` and the baseline match |
| `where` | URL paths the problem was found on; what `ignore.where` matches |
| `file` | a file the problem is in; shown as `in:`, used for annotations and the baseline |
| `details` | extra lines, shown under the message |
| `fix` | what to do, shown as `→ …` |
| `severity` | `'warn'` for a warning; anything else is an error |

Group identical problems into one finding with many pages in `where`, as the built-in audits
do: the output stays short, and an `ignore` rule with `where` can drop single pages. Keep
changing numbers out of `message` and `details` when you can, because the baseline matches
them exactly; see [Adopting on an existing site](./adopting#what-a-baseline-entry-matches).

Built-in audits write `where` paths without the base path. `new URL(url).pathname`, as in the
first example, includes it when `siteUrl` has one; `url.slice(origin.length)` does not.

## Status rules

An audit passes with no findings, warns when every finding is a warning, and fails otherwise,
unless it returns a `status`. In full, after ignore rules and the baseline:

| Returned | Findings left | Status |
| --- | --- | --- |
| `status: 'skipped'` or `'passed'` | any | that status; findings are still reported |
| no status | none | `passed` |
| no status | only warnings | `warned` (`failed` with `--strict`) |
| no status | at least one error | `failed` |
| `status: 'failed'` | any | `failed` |
| `run` throws | | `errored`, with the error message as summary |

With `severity: 'warn'` for the audit, every finding becomes a warning and a `failed` result
becomes `warned`, unless `--strict` is set. Return `skipped` when there is nothing to check, so
an unconfigured audit does not look like a pass.

Plugin audits get `severity`, `ignore` and the findings baseline for free.

## Reading the build

A `dist` audit reads files and needs no server or browser:

```ts
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Audit, type Finding } from 'vidimus';

const noDevUrls: Audit = {
  name: 'dev-urls',
  description: 'no localhost or staging URLs in the build',
  requires: 'dist',
  async run({ dist, log }) {
    const pattern = /https?:\/\/(localhost|127\.0\.0\.1|staging\.example\.org)[^"'\s)]*/g;
    const byUrl = new Map<string, Finding & { where: string[] }>();
    const files = globSync('**/*', { cwd: dist }).filter((file) => /\.(html|js|css|xml)$/.test(file));
    for (const file of files) {
      const text = readFileSync(join(dist, file), 'utf8');
      for (const [url] of text.matchAll(pattern)) {
        const finding = byUrl.get(url) ?? {
          message: `development URL ${url}`,
          where: [],
          fix: 'Build with the production environment, or replace the hard-coded URL.',
        };
        const path = `/${file.replace(/(^|\/)index\.html$/, '$1')}`;
        if (!finding.where.includes(path)) finding.where.push(path);
        byUrl.set(url, finding);
      }
    }
    log(`${files.length} files scanned`);
    const findings = [...byUrl.values()];
    return {
      summary: findings.length ? `${findings.length} development URL(s)` : 'none found',
      findings,
    };
  },
};

export default defineConfig({ plugins: [noDevUrls], audits: ['seo', 'dev-urls'] });
```

## Using the server and the browser

A `server` audit gets `origin` and `pageUrls()`, and can drive Chrome through
`launchBrowser`:

```ts
import { defineConfig, type Audit, type Finding } from 'vidimus';

const noConsoleErrors: Audit = {
  name: 'console',
  description: 'no console errors on page load',
  async run({ origin, pageUrls, launchBrowser }) {
    const browser = await launchBrowser();
    const findings: Finding[] = [];
    try {
      for (const url of pageUrls({ exclude: ['^/embed/'] })) {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto(url, { waitUntil: 'networkidle0' });
        await page.close();
        if (errors.length) {
          findings.push({
            message: 'console errors on load',
            where: [url.slice(origin.length) || '/'],
            details: errors,
            fix: 'Open the page with the browser console and fix the errors listed.',
          });
        }
      }
    } finally {
      await browser.close();
    }
    return { summary: `${findings.length} page(s) with console errors`, findings };
  },
};

export default defineConfig({ plugins: [noConsoleErrors] });
```

## Custom reporters

`reporters` also accepts objects with `onStart`, `onProgress`, `onAuditEnd` and `onEnd` hooks. See
[Reporters](./reporters#custom-reporters).

## Programmatic use

Programmatic use: `import { run } from 'vidimus'` and `await run({ audits: ['links'] })`.

```ts
import { run } from 'vidimus';

const report = await run({
  cwd: '/path/to/site',
  audits: ['seo', 'links'],
  set: ['links.checkExternal=false'],
  overrides: { siteUrl: 'https://example.org' },
  reporters: [],
});
if (!report.ok) process.exitCode = 1;
```

`run` loads the config as the CLI does, selects the audits, runs them and resolves with the
`RunReport` (the shape of the [JSON reporter](./reporters#json)). It does not set the exit
code. Its options:

| Option | |
| --- | --- |
| `audits` | names or `['all']`; empty means the config's `audits` |
| `cwd` | where the config is searched and relative paths resolve; default `process.cwd()` |
| `configFile` | a config file path, or `false` for none |
| `env` | environment for `VIDIMUS_*` variables and config functions; default `process.env` |
| `set` | `key.path=value` strings, as with `--set` |
| `overrides` | a partial config applied last, like CLI flags |
| `config` | a complete `VidimusConfig`, skipping loading altogether |
| `reporters` | `Reporter` objects; default: the config's `reporters`, or `pretty` (plus `github` on GitHub Actions) |
| `profile` | `'spans'` or `'cpu'` to [profile](./profiling) the run, as `--profile` |
| `serial` | `true` to run audits one at a time, as `--serial` |

Pass `reporters: []` for a silent run. Usage and config problems reject with a `UsageError`;
audit failures and errors are in the report, not thrown.

The lower-level pieces are exported too, for tools that need their own flow:

```ts
import { auditRegistry, createReporters, loadConfig, runAudits, selectAudits } from 'vidimus';

const { config } = await loadConfig({ configFile: 'vidimus.config.ts' });
const audits = selectAudits(auditRegistry(config), ['seo'], config);
const reporters = createReporters(['pretty', 'json:report.json'], { cwd: process.cwd(), env: process.env });
const report = await runAudits(config, audits, reporters);
```

## Exports

| Export | |
| --- | --- |
| `defineConfig` | returns the config or config function unchanged, typed |
| `run`, `runAudits`, `selectAudits`, `auditRegistry` | run audits, see above |
| `loadConfig`, `defaults(cwd)`, `CONFIG_FILES`, `DEFAULT_AUDITS` | config loading, every default, the file names searched, the default audit list |
| `createReporters`, `REPORTERS` | build reporters from names, the built-in names |
| `builtinAudits`, and each audit: `i18n`, `csp`, `a11y`, `links`, `r12s`, `seo`, `security`, `html`, `budget`, `assets`, `privacy`, `forms`, `shots`, `lighthouse` | the built-in `Audit` objects, to wrap or reuse |
| `UsageError`, `MissingPeerError` | error classes; `MissingPeerError` has a `peer` field |
| `diffProfiles(before, after, top?)` | the lines `vidimus profile diff` prints |

Types: `Audit`, `AuditContext`, `AuditOutcome`, `AuditRequirement`, `AuditResult`,
`AuditStatus`, `Finding`, `PageQuery`, `RunReport`, `Severity`, `RunOptions`, `ProfileOptions`,
`ProfileLevel`, `ProfileSummary`, `AuditProfile`, `PoolStats`, `Row`, `Reporter`,
`RunInfo`, `VidimusConfig`, `UserConfig`, `ConfigInput`, `ConfigEnv`, `AuditSeverity`,
`IgnoreRule`, `HeaderRule`, `Pattern`, `Range`, `ViewportSize`, `LoadConfigOptions`,
`LoadedConfig`, `AcceptedFinding`, `BaselineFile`, and puppeteer's `Browser`, `Page` and
`LaunchOptions`. The puppeteer types resolve to `any` when puppeteer is not installed, so the
published types compile without it.
