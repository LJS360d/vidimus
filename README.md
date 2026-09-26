# vidimus

*Vidimus*: "we have seen". Checks a public static website's build output before it ships.

```sh
pnpm add -D vidimus      # or: npm i -D vidimus
pnpm build && pnpm vidimus
```

| Audit | Fails on | Needs |
| --- | --- | --- |
| `i18n` | a locale missing, adding or blanking a default-locale key (no build needed) | — |
| `csp` | an inline `<script>`/`<style>` whose hash is missing from the meta CSP | — |
| `a11y` | a WCAG violation found by pa11y (default locale only) | `pa11y`, `puppeteer` |
| `links` | a broken internal link, asset or external target | `linkinator` |
| `r12s` | horizontal overflow, small targets, small text, missing/locked viewport meta | `puppeteer` |
| `seo` | missing lang/title/description, stray `noindex`, bad canonical/hreflang, sitemap and robots.txt problems | — |
| `security` | missing or weak security headers, no clickjacking protection, mixed content | — |
| `html` | invalid HTML found by html-validate | `html-validate` |
| `budget` | a page's HTML, CSS, JS or total weight over budget, an oversized image | — |
| `assets` | a missing favicon, broken manifest or icon, relative or missing `og:image` | — |
| `privacy` | a request to a third-party host or a third-party cookie on page load | `puppeteer` |
| `shots` | a screenshot differing from the baseline beyond `shots.maxDiff` | `puppeteer`, `sharp` (motion GIFs) |
| `lighthouse` | a category below its threshold | `lighthouse`, `puppeteer` |

`i18n`, `csp`, `a11y`, `links` and `r12s` run by default. The tools behind each audit are
optional peer dependencies: install only the ones you use, at the versions you want.

```sh
pnpm add -D puppeteer pa11y linkinator       # the default set
pnpm add -D html-validate                    # html
pnpm add -D sharp lighthouse                 # shots + lighthouse
```

Besides failures, audits report warnings (`⚠`) for advisory problems, such as a title that is
too long or an image without `width`/`height`. Warnings are shown but don't fail the run,
unless `--strict` is given.

A missing peer makes only its audit fail, with the install command in the message.

## CLI

```sh
vidimus                        # the audits in config.audits
vidimus all                    # every audit
vidimus links r12s             # just these
vidimus shots --update-baseline
vidimus --accept-findings      # record today's findings, fail only on new ones
vidimus list                   # available audits, * = default
vidimus config                 # print the resolved config
vidimus init [--format ts|js|json]
```

| Flag | |
| --- | --- |
| `-c, --config <file>` / `--no-config` | pick a config file / ignore config files |
| `--set <key=value>` | override any config value, repeatable (`--set lighthouse.thresholds.seo=0.8`) |
| `--root`, `--dist`, `--out-dir` | project root, build output, report output |
| `--origin <url>` | audit a running server instead of serving the build |
| `--site-url <url>` | production origin; absolute self-links are rewritten onto the audit origin |
| `--port <n>` | port of the built-in static server |
| `--all-locales` | include translated pages too |
| `-r, --reporter <name[:file]>` | `pretty`, `json`, `github`, `junit`, repeatable |
| `--strict` | fail on warnings too |
| `--accept-findings` | write the current findings to the baseline file (see below) |

Exit codes: `0` all passed, warned or skipped, `1` an audit failed or errored, `2` bad usage or
config.

## Configuration

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

JSON configs get autocompletion and validation from the bundled schema:

```json
{ "$schema": "./node_modules/vidimus/schema.json", "siteUrl": "https://example.org" }
```

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

Every key with its default: `vidimus config --no-config`. Patterns are regular expression
strings. The top-level `exclude` matches built file paths (`admin/index.html`); per-audit
`exclude` and `sample` match URL paths (`/admin/`).

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
- Findings baseline: `vidimus --accept-findings` writes every current finding to
  `vidimus.baseline.json` (`baseline.file`). Later runs hide those findings and fail only on new
  ones, so a legacy site can adopt an audit today and pay the debt down over time. Commit the
  file; re-run with `--accept-findings` after fixing things to shrink it. A finding matches by
  audit, message, file and details, not by page list.

Hidden findings are counted in each audit's summary line.

## Audit options

Every audit has an `exclude` list of URL path patterns. Other options:

### `seo`

Checks every page for `<html lang>`, a `<title>` and meta description (present, within length,
not duplicated except between hreflang alternates), a single absolute canonical on `siteUrl`
pointing at a built page, absolute and reciprocal `hreflang` alternates, and one `<h1>`. It fails
on a `noindex` left in the build. Site-wide, it follows `sitemap.xml` and sitemap indexes (every
URL a built page on `siteUrl`, every indexable page listed, no noindex pages), checks
`robots.txt` (no `Disallow: /` for `*`, a `Sitemap:` line) and warns about orphan pages that no
other page links to. Meta refresh redirect stubs are skipped.

| Key | Default | |
| --- | --- | --- |
| `allowNoindex` | `[]` | URL paths allowed to be `noindex` (search, thank-you pages) |
| `titleLength` / `descriptionLength` | `{min:10,max:60}` / `{min:50,max:160}` | warn outside the range |
| `canonical`, `h1`, `sitemap`, `robots`, `orphans` | `true` | turn single checks off |
| `exclude` | `['^/404(\\.html\|/)?$']` | |

### `security`

Headers come from the live site when `--origin` is given, otherwise from `dist/_headers`
(Netlify and Cloudflare Pages format, with `*` splats, `:placeholders` and `! Name` detaches).
With neither, the header checks are skipped and the HTML checks still run.

| Key | Default | |
| --- | --- | --- |
| `file` | `_headers` | headers file in the build |
| `require` | HSTS ≥ 1 year, `nosniff`, a safe `Referrer-Policy`, `Permissions-Policy` | header → regex its value must match; `''` only requires presence, `false` turns one off |
| `clickjacking` | `true` | require a CSP `frame-ancestors` header or `X-Frame-Options` |
| `unsafeInline` | `true` | warn on `'unsafe-inline'` (without hashes or nonces) or `'unsafe-eval'` in `script-src` |
| `mixedContent` | `true` | fail on resources loaded over `http://` |
| `sri` | `true` | warn on cross-origin scripts and stylesheets without `integrity` |

On a live origin it also warns about `X-Powered-By` and a versioned `Server` header.

### `html`

Validates every page with [html-validate](https://html-validate.org). The same problem on many
pages is reported once, with up to three example locations. Rules at severity `warn` only warn.

| Key | Default | |
| --- | --- | --- |
| `extends` | `['html-validate:standard']` | presets; a `.htmlvalidate.json` in the project root replaces them |
| `rules` | `{}` | html-validate rules, applied on top (`{ "no-inline-style": "off" }`) |

### `budget`

Only local files count, each once per page. HTML, CSS and JS are measured gzipped, images raw.
`0` turns a budget off.

| Key | Default | |
| --- | --- | --- |
| `html` / `css` / `js` | `100_000` / `100_000` / `250_000` | max gzipped bytes per page (JS includes `modulepreload`) |
| `page` | `2_000_000` | max total per page |
| `image` | `500_000` | max bytes of any image in `img`, `srcset` or `<source>` |
| `legacyImage` | `100_000` | warn when a PNG/JPEG/GIF this large has no AVIF/WebP `<source>` |
| `dimensions` | `true` | warn on `<img>` without `width` and `height` (layout shift) |

### `assets`

| Key | Default | |
| --- | --- | --- |
| `favicon` | `true` | `<link rel="icon">` or `/favicon.ico` exists, icon links resolve, warn without `apple-touch-icon` |
| `manifest` | `true` | a linked manifest exists, is valid JSON with a name and icons that exist, warn without a 512px icon |
| `openGraph` | `true` | warn without `og:title`, `og:image`, `twitter:card`; fail on a relative or missing `og:image` or an `og:url` off `siteUrl` |
| `ogImage` | `{ width: 1200, height: 630 }` | warn below this size |
| `notFound` | `true` | warn without `404.html` |

### `privacy`

Loads each page in a fresh browser context and fails on any request to a host other than the
site's own (the audit origin or `siteUrl`), with hints for common services: Google Fonts, YouTube,
analytics, public CDNs. Cookies set on load are reported too: first-party ones as warnings,
third-party ones as failures. Useful for GDPR: nothing should leave the visitor's browser before
consent.

| Key | Default | |
| --- | --- | --- |
| `allow` | `[]` | regexes matched against the full request URL |
| `sample` / `allLocales` | `[]` / `false` | which pages to load, like `shots` |
| `cookies` | `true` | report cookies set on load |
| `wait` | `1500` | ms to wait after `load` for late trackers |
| `concurrency` / `timeout` | half the cores / `60000` | |

## CI

When `GITHUB_ACTIONS=true` (GitHub and Forgejo Actions), the `github` reporter is added
automatically: findings become annotations, and a summary table goes to
`$GITHUB_STEP_SUMMARY`. Anything else can read JUnit or JSON:

```sh
vidimus -r pretty -r junit:reports/vidimus.xml -r json:reports/vidimus.json
```

`json` or `junit` without a file writes to stdout, and `pretty` moves to stderr.

```yaml
- run: pnpm build
- run: pnpm vidimus all -r pretty -r junit:reports/vidimus.xml
```

Chrome runs with `--no-sandbox --disable-dev-shm-usage` by default (`browser.args`). Point
`browser.executablePath` at a system Chromium to skip puppeteer's download.

## Custom audits and reporters

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
        findings.push({ message: 'placeholder copy', where: [new URL(url).pathname] });
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

`requires` is `source` (no build), `dist` (reads files) or `server` (the default: the build is
served over HTTP). An audit passes when it returns no findings, unless it sets `status`.
`reporters` also accepts objects with `onStart`, `onAuditEnd` and `onEnd` hooks.

An audit passes with no findings, warns when every finding has `severity: 'warn'`, and fails
otherwise, unless it sets `status`. Plugin audits get `severity` and `ignore` for free.

Programmatic use: `import { run } from 'vidimus'` and `await run({ audits: ['links'] })`.

## Contributing

```sh
pnpm install
pnpm run check        # lint, types, schema, knip, tests with coverage, build, publint, attw
pnpm run smoke        # pack, install in a scratch project without peers, run the CLI and tsc
pnpm changeset        # describe your change for the changelog
```

Change a config type → `pnpm run schema` to regenerate `schema.json`.

Releases are automatic: every push to `main` runs the checks, turns pending changesets into a
version bump and `CHANGELOG.md` entry, commits and tags that, and publishes to npm with
provenance. See `.changeset/README.md`.

To release by hand (needs `npm login`):

```sh
pnpm run bump         # apply pending changesets: version + CHANGELOG.md
git commit -am "chore(release): vX.Y.Z" && git push
pnpm run release      # smoke test, full check, publish to npm, push the tag
```

## License

MIT
