---
title: Getting started
description: Install vidimus, run it on your build, configure it and adopt it on an existing site.
---

# Getting started

vidimus runs on Node 22.18 or later and checks the output of your build: Astro, Eleventy,
Hugo, Next.js static export, VitePress, plain HTML, anything that produces a folder of pages.

```sh
npm i -D vidimus
npm run build && npx vidimus
```

By default it serves `dist/` locally and runs `i18n`, `csp`, `a11y`, `links` and `r12s`. Those
browser audits need their tools installed next to vidimus:

```sh
npm i -D puppeteer pa11y linkinator
```

Every finding tells you what to do:

```
✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

⚠ no <h1>
    on: /en/ /fr/ /it/ +1 more
    → Add one <h1> heading describing the page, or turn seo.h1 off.
```

`✖` fails the run, `⚠` is a warning. Exit code `0` means nothing failed.

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

## Existing sites

A site that has never been audited will have findings. Record them once and fail only on new
ones, then pay the debt down:

```sh
npx vidimus all --accept-findings    # writes vidimus.baseline.json; commit it
```

## In CI

```yaml
- run: npm ci
- run: npm run build
- run: npx vidimus
```

On GitHub Actions findings become annotations on the pull request. More in
[CLI and CI](./cli).
