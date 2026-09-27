---
title: Audits
description: The thirteen built-in audits, how to run them, what they need installed and how their results are reported.
---

# Audits

vidimus ships thirteen audits. Five run by default; the rest you turn on in `audits` or name on the command line.

| Audit | Checks | Needs | Default |
| --- | --- | --- | --- |
| [`i18n`](./i18n) | every locale file has exactly the default locale's keys, none blank (no build needed) | | yes |
| [`csp`](./csp) | every inline `<script>`/`<style>` is allowed by a hash in the meta CSP, and iframes are allowed by `frame-src` and sandboxed | | yes |
| [`a11y`](./a11y) | WCAG violations found by pa11y (default locale only) | `pa11y`, `puppeteer` | yes |
| [`links`](./links) | broken internal links, assets and external targets | `linkinator` | yes |
| [`r12s`](./r12s) | horizontal overflow, small tap targets, small text, missing or locked viewport meta | `puppeteer` | yes |
| [`seo`](./seo) | lang, title, description, `noindex`, canonical, hreflang, sitemap, robots.txt, orphan pages | | |
| [`security`](./security) | security headers, clickjacking protection, unsafe CSP, mixed content, SRI, `security.txt` | | |
| [`html`](./html) | invalid markup found by html-validate | `html-validate` | |
| [`budget`](./budget) | HTML, CSS, JS and total page weight, image size and format, image dimensions | | |
| [`assets`](./assets) | favicon, web manifest, Open Graph image, 404 page; ads.txt, change-password and app links when the pages show the site needs them | | |
| [`privacy`](./privacy) | third-party requests and cookies on page load | `puppeteer` | |
| [`shots`](./shots) | screenshots against a recorded baseline | `puppeteer`, `sharp` (motion GIFs) | |
| [`lighthouse`](./lighthouse) | Lighthouse category scores against thresholds | `lighthouse`, `puppeteer` | |

`npx vidimus list` prints the same list for your configuration: `*` marks the audits that run by default, `-` those turned off with `severity`.

## Running audits

```sh
npx vidimus              # the audits in config.audits (default: i18n csp a11y links r12s)
npx vidimus all          # every audit, including plugins
npx vidimus seo budget   # only these
```

Change the default set in the config:

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'security', 'budget'],
});
```

Every finding says what to do about it (`→ …` in the terminal). See [CLI](../cli) for the flags and [Reporters](../reporters) for other output formats.

## Peer dependencies

The tools behind the browser audits are optional peer dependencies, so you install only what you use, at the versions you want:

```sh
npm i -D puppeteer pa11y linkinator    # the default set
npm i -D html-validate                 # html
npm i -D sharp lighthouse              # shots, lighthouse
```

A missing peer fails only its own audit, and the message says what to install:

```
─── a11y ────────────────────────────────────────────────────────

! a11y: "pa11y" is not installed. Add it as a dev dependency: npm i -D pa11y (0.1s)
```

The other audits in the run still execute and report normally. The browser audits launch Puppeteer with `browser.args` (default `['--no-sandbox', '--disable-dev-shm-usage']`) and, when set, `browser.executablePath`, so you can point them at a system Chrome.

## What each audit reads

Each audit declares what it needs, and vidimus prepares only that:

| Needs | Audits | What happens |
| --- | --- | --- |
| source | `i18n` | reads files in the project; no build required |
| build | `csp`, `seo`, `security`, `html`, `budget`, `assets` | reads the HTML files in `distDir` (default `dist`) |
| server | `a11y`, `links`, `r12s`, `privacy`, `shots`, `lighthouse` | loads pages over HTTP |

If any selected audit needs the build and `distDir` does not exist, the run stops with `no build output at <dir>. Run the build first.` For server audits vidimus serves `distDir` on `http://localhost:4322` (`port`), with the base path of `siteUrl` if it has one, unless you pass `--origin` to audit a server that is already running. See [How it works](../how-it-works).

Audits run in parallel, except `lighthouse`, which runs alone after the others.

## Locales

When `locales` and `defaultLocale` are set, pages under a translated locale's directory (`fr/…`) are left out of `a11y` and of the pages `links` starts crawling from. `--all-locales` (or `allLocales: true`) includes them. `r12s` always checks every locale, `lighthouse` picks its pages from every locale, and the audits that read the build (`csp`, `seo`, `security`, `html`, `budget`, `assets`) read every page. `privacy` and `shots` follow `--all-locales` too, and have their own `privacy.allLocales` and `shots.allLocales` keys to include translations for just that audit.

## Options every audit shares

The top-level `exclude` removes built files from every audit. Its patterns are regular expressions matched against file paths in the build (`^admin/`, which matches `admin/index.html`).

Most audits also have their own `exclude` list. For every audit except `csp` its patterns match URL paths (`^/admin/`); `csp.exclude` matches built file paths like the top-level key. `i18n` and `links` have no `exclude` of their own.

Three more controls apply to any audit, including plugins, and are described in [Severity, ignores and the findings baseline](../configuration#severity-ignores-and-the-findings-baseline):

- `severity.<audit>`: `error` (default), `warn` to turn every finding into a warning, or `off` to leave the audit out of the default set and of `all`.
- `ignore`: rules that drop findings by audit, message or page.
- the findings baseline (`--accept-findings`): hide today's findings and fail only on new ones.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  exclude: ['^drafts/'],
  severity: { r12s: 'warn' },
  ignore: [{ audit: 'a11y', where: '^/embed/' }],
  r12s: { exclude: ['^/legacy/'] },
});
```

## Results

Each audit ends with one status line: a symbol, the audit name, a summary and the duration.

| Status | Symbol | Meaning |
| --- | --- | --- |
| passed | `✔` | no findings |
| warned | `⚠` | findings, but none that fail: all are warnings, or the audit has `severity: 'warn'` |
| failed | `✖` | at least one finding at error severity, or any finding with `--strict` |
| skipped | `○` | the audit had nothing to check, e.g. `i18n` without `i18n.files`, or `csp` when no page has a meta CSP or a third-party iframe |
| errored | `!` | the audit could not run: a missing peer, a missing translation file, a page `r12s` could not load |

Findings are printed above the status line. Each has a message, optional detail lines, `in:` for the file it concerns, `on:` for the pages (the first three, then `+N more`) and `→` with the fix:

```
─── links ───────────────────────────────────────────────────────

✖ 404 https://example.org/blog/old-post/
    on: /blog/ /blog/page/2/ /tags/astro/ +1 more
    → Fix or remove the link on the pages listed, or add a pattern to links.skip if the target blocks bots.

✖ links: 1 broken target(s) out of 1841 links checked (6.3s)
```

When findings were dropped by `ignore` or hidden by the baseline, the summary says how many: `, 4 ignored or accepted`.

The run ends with a line such as `vidimus: 4/5 passed — failed: links`. Skipped audits are not counted. The exit code is `1` when any audit failed or errored, `0` otherwise, so warnings and skips do not fail CI unless you pass `--strict`. See [CI](../ci).

To write your own audit, see [Plugins](../plugins).
