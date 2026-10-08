---
title: Getting started
description: Install vidimus, run it on your build, read its findings, configure it and adopt it on an existing site.
---

# Getting started

vidimus runs on Node 22.18 or later and checks the output of your build: Astro, Eleventy,
Hugo, Next.js static export, VitePress, plain HTML, anything that produces a folder of pages.

```sh
npm i -D vidimus puppeteer pa11y linkinator
npm run build && npx vidimus
```

By default it serves `dist/` locally and runs `i18n`, `csp`, `a11y`, `links` and `r12s`; the
last three use puppeteer, pa11y and linkinator, installed next to vidimus above.

The tools are optional peer dependencies, so you install only what the audits you run need. A
missing one fails only its own audit, with the command to install it. `npx vidimus csp seo
budget` runs without any of them.

If your generator writes somewhere else than `dist/`, pass `--dist`:

```sh
npx vidimus --dist _site
```

[Frameworks](./frameworks) lists the output folder and base path setting of the common
generators.

## Reading the output

Every finding tells you what to do:

```
✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

⚠ no <h1>
    on: /en/ /fr/ /it/ +1 more
    → Add one <h1> heading describing the page, or turn seo.h1 off.
```

`✖` fails the run, `⚠` is a warning. Exit code `0` means nothing failed; all codes are in
[CLI](./cli#exit-codes).

A finding is reported once, with the pages it was found on (`on:`), the file it is in when
there is one (`in:`), and the fix (`→`). Each audit ends with a summary line, and the run with
a count:

```
✖ seo: 42 pages, 2 problem(s) (0.2s)

vidimus: 4/5 passed — failed: seo
```

`○` marks an audit that was skipped because there was nothing to check: `i18n` until it is
configured, `csp` when no page declares a meta CSP. `!` marks an audit that errored, such as a
missing peer.

## Choosing audits

```sh
npx vidimus              # the default set, or config.audits
npx vidimus all          # every audit
npx vidimus seo budget   # just these
npx vidimus list         # what is available
```

The zero-dependency audits (`i18n`, `csp`, `seo`, `security`, `budget`, `assets`) read the
build directly; the others use the tools you install. What each one checks, and its options:
[Audits](./audits/).

```sh
npm i -D html-validate      # html
npm i -D sharp lighthouse   # shots, lighthouse
```

## Configure

```sh
npx vidimus init       # writes vidimus.config.ts
```

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  distDir: 'dist',
  siteUrl: 'https://example.org',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'budget'],
  severity: { budget: 'warn' },
});
```

Set `siteUrl` to your production origin: canonical, sitemap and Open Graph checks compare
against it, and absolute links to your own site are checked against the build. A `siteUrl`
with a path (`https://user.github.io/project`) is a base path: the build is served, and its
pages are opened, under it.

`npx vidimus init --format json` writes a JSON config with the bundled schema for editor
autocompletion instead. Config files, environment variables and `--set`:
[Configuration](./configuration). What happens during a run: [How it works](./how-it-works).

## Existing sites

A site that has never been audited will have findings. Record them once and fail only on new
ones, then pay the debt down:

```sh
npx vidimus all --accept-findings    # writes vidimus.baseline.json; commit it
```

`severity: 'warn'` and `ignore` rules give finer control. A step-by-step rollout:
[Adopting on an existing site](./adopting).

## In CI

```yaml
- run: npm ci
- run: npm run build
- run: npx vidimus
```

On GitHub Actions findings become annotations on the pull request. More in [CI](./ci), and
every command and flag in [CLI](./cli).

## Custom checks

Site-specific rules are a few lines of TypeScript: an object with a `run` function added to
`plugins`. See [Custom audits and API](./plugins). When something does not work as expected:
[Troubleshooting](./troubleshooting).
