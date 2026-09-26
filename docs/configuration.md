---
title: Configuration
description: Config files, environment variables, JSON Schema, severity, ignore rules and the findings baseline.
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

Every key with its default: `npx vidimus config --no-config`. Patterns are regular expression
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
- Findings baseline: `npx vidimus --accept-findings` writes every current finding to
  `vidimus.baseline.json` (`baseline.file`). Later runs hide those findings and fail only on new
  ones, so a legacy site can adopt an audit today and pay the debt down over time. Commit the
  file; re-run with `--accept-findings` after fixing things to shrink it. A finding matches by
  audit, message, file and details, not by page list.

Hidden findings are counted in each audit's summary line.
