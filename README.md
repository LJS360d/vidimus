# vidimus

[![npm](https://img.shields.io/npm/v/vidimus)](https://www.npmjs.com/package/vidimus)
[![node](https://img.shields.io/node/v/vidimus)](https://nodejs.org)
[![ci](https://github.com/LJS360d/vidimus/actions/workflows/ci.yml/badge.svg)](https://github.com/LJS360d/vidimus/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-ljs360d.github.io%2Fvidimus-1e3a5f)](https://ljs360d.github.io/vidimus/)
[![license](https://img.shields.io/npm/l/vidimus)](https://github.com/LJS360d/vidimus/blob/main/LICENSE)

*Vidimus*, "we have seen": checks a static website's build before it goes public, and tells you
how to fix what it finds.

```sh
npm i -D vidimus
npm run build && npx vidimus
```

```
✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

⚠ no <h1>
    on: /en/ /fr/ /it/ +1 more
    → Add one <h1> heading describing the page, or turn seo.h1 off.
```

## Audits

| | |
| --- | --- |
| `i18n` `csp` `seo` `security` `budget` `assets` | read the build, no extra dependencies |
| `a11y` `links` `r12s` `privacy` `html` `shots` `lighthouse` | run the tools you install next to vidimus (puppeteer, pa11y, linkinator, html-validate, lighthouse, sharp) |

`i18n`, `csp`, `a11y`, `links` and `r12s` run by default; `npx vidimus all` runs everything,
`npx vidimus seo budget` runs just those. The default set needs:

```sh
npm i -D puppeteer pa11y linkinator
```

What each audit checks and its options: [ljs360d.github.io/vidimus/audits](https://ljs360d.github.io/vidimus/audits/).

## Configure

```sh
npx vidimus init       # writes vidimus.config.ts
```

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.org',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'budget'],
  severity: { budget: 'warn' },
  ignore: [{ audit: 'seo', message: '^orphan page' }],
});
```

Adopting it on an existing site: `npx vidimus --accept-findings` records today's findings, and
later runs fail only on new ones.

## Docs

**[ljs360d.github.io/vidimus](https://ljs360d.github.io/vidimus/)**: [getting started](https://ljs360d.github.io/vidimus/getting-started),
[how it works](https://ljs360d.github.io/vidimus/how-it-works), [audits](https://ljs360d.github.io/vidimus/audits/),
[configuration](https://ljs360d.github.io/vidimus/configuration), [CLI](https://ljs360d.github.io/vidimus/cli),
[CI](https://ljs360d.github.io/vidimus/ci), [frameworks](https://ljs360d.github.io/vidimus/frameworks),
[custom audits and API](https://ljs360d.github.io/vidimus/plugins). Contributing: [CONTRIBUTING.md](https://github.com/LJS360d/vidimus/blob/main/CONTRIBUTING.md).

The docs are deliberately built six times from the same markdown, by VitePress, Starlight, Hugo,
Eleventy, Zola and mdBook, deployed side by side and audited by vidimus as one site, to dogfood
it against six generators' real output: [why](https://ljs360d.github.io/vidimus/flavors).

## License

MIT
