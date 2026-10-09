---
title: Adopting
description: Bring vidimus to an existing site without blocking CI, using severity, ignore rules and the findings baseline, then tighten.
---

# Adopting on an existing site

A site that has never been audited will have findings, often hundreds. Fixing all of them
before merging the CI job is rarely an option. vidimus has three tools for the meantime, from
coarse to fine:

| Tool | Scope | Use it for |
| --- | --- | --- |
| `severity` | a whole audit | an audit you are not ready to enforce |
| `ignore` | findings matching a pattern | findings that are intended and will stay |
| the findings baseline | the exact findings of today | debt you plan to pay down |

## The severity ladder

Each audit sits on one of three rungs:

| `severity` | Runs with `npx vidimus` and `all` | Findings | Fails the run |
| --- | --- | --- | --- |
| `off` | no | | no |
| `warn` | yes | shown as warnings `⚠` | only with `--strict` |
| `error` (default) | yes | shown as errors `✖` | yes |

An audit set to `off` still runs when named: `npx vidimus lighthouse`. That makes `off` a good
place for audits you run by hand while you work on them.

Move audits up one rung at a time:

```ts
export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'budget'],
  severity: { a11y: 'warn', budget: 'warn', lighthouse: 'off' },
});
```

Try a change of rung without editing the config: `npx vidimus --set severity.a11y=error`.

`--strict` fails on every warning, whatever its origin. Leave it off while audits sit at
`warn`; turn it on when the warnings are gone and should stay gone.

## Ignore rules

`ignore` is for findings that are correct but intended: an orphan landing page reached only
from ads, a widget you embed from a vendor, a page kept small on purpose.

```ts
export default defineConfig({
  ignore: [
    { audit: 'seo', message: '^orphan page', where: '^/landing/' },
    { audit: 'a11y|r12s', where: '^/embed/' },
    { audit: 'links', message: 'linkedin\\.com' },
  ],
});
```

- `audit` must match the whole audit name; `message` and `where` match anywhere unless
  anchored.
- A rule with `where` removes only the matching pages from a finding; the finding stays for its
  other pages.
- A rule without `where` removes whole findings.

Keep rules narrow. A key left out matches everything, so `{ audit: 'seo' }` silences the whole
audit. A misspelled key (`{ adit: 'seo' }`) or an empty rule is a config error, so a typo cannot
silence every audit by accident. Prefer an audit's own options when
they exist: `seo.allowNoindex`, `links.skip`, `privacy.allow`, `a11y.ignore`, per-audit
`exclude`. They say what is intended in the audit's own terms.

Ignored findings are counted in the summary line (`2 ignored or accepted`) so they do not
vanish entirely.

## The findings baseline

The baseline records today's findings and hides them on later runs. New findings still fail.

```sh
npx vidimus all --accept-findings    # writes vidimus.baseline.json; commit it
```

From then on:

- a finding already in the baseline is hidden and counted as `accepted`
- a new finding is reported and fails the audit as usual
- a finding that has been fixed stays in the baseline until you shrink it; the run prints a
  note on stderr counting these stale entries, for the audits that ran, and exits as usual

`--accept-findings` records only the audits that ran in that invocation, and keeps the entries
of every other audit. You can build the baseline audit by audit:

```sh
npx vidimus seo --accept-findings
npx vidimus a11y links --accept-findings
```

The file lives at `baseline.file` (default `vidimus.baseline.json`, relative to `root`). Its
format is described in [Configuration](./configuration#the-baseline-file).

### What a baseline entry matches

A finding matches by audit, message, file and details, not by page list. The page list can grow
or shrink without the finding counting as new: a missing `<h1>` on five pages that is now on six
stays accepted. The same finding in another file, or with different details, is new. Some
findings list each affected page in their details (several `seo` checks show `page: value`
lines); a new page there changes the details, and the whole finding is reported again.

Set `baseline.matchWhere` to also match the page list: the same finding on a different set of
pages is then new. Re-run `--accept-findings` with it on to record the page lists.

Messages and details that contain measurements change with them. A `budget` finding such as
`html 104 kB gzipped > 100 kB budget` becomes a new finding at `105 kB`, and a `lighthouse`
score finding at every score change. For those audits prefer `severity: 'warn'`, or raise the
threshold to today's value and lower it over time, over accepting findings.

### Shrinking the baseline

After fixing findings, re-run the same audits with `--accept-findings`:

```sh
npx vidimus seo --accept-findings
git diff vidimus.baseline.json
```

The fixed findings disappear from the file. Review the diff before committing: the run also
accepts any new finding that appeared since, and during that run no finding fails. A diff that
only removes lines is a pure improvement.

A baseline that only shrinks is the goal. In code review, treat added lines in
`vidimus.baseline.json` like a new `ignore` rule: something that needs a reason.

When an audit's entries are gone, the audit is clean; remove its `severity` override if it had
one.

## Suggested rollout

Audits differ in how much noise they produce on a legacy site and how much work their fixes
take. An order that tends to work:

1. **`csp`, `i18n`, `security`, `assets`**: few findings, mostly configuration. `csp` is
   skipped until a page declares a meta CSP and `i18n` until it is configured, so they are safe
   to enable first.
2. **`links`**: broken links are cheap to fix and matter to readers. Put flaky or bot-blocking
   hosts in `links.skip`, or start with `links.checkExternal: false`.
3. **`seo`**: mostly template fixes, so one change fixes many pages. `seo.allowNoindex` for
   search and thank-you pages, the single checks (`h1`, `orphans`, `sitemap`) off until you get
   to them.
4. **`html`**: markup errors come from templates too; `html.rules` turns off rules you
   disagree with.
5. **`budget`**: start at `warn`, then set limits a little above today's heaviest page and
   lower them.
6. **`a11y`, `r12s`**: the most findings and the most work. Baseline them, and fix template by
   template.
7. **`privacy`**: each third-party request is a decision; `privacy.allow` records the ones you
   keep.
8. **`shots`, `lighthouse`**: record `shots` baselines once the pages are stable
   (`npx vidimus shots --update-baseline`). `lighthouse` is slow and varies between runs; start
   with `sample` and lower `lighthouse.thresholds`.

A config for week one of a large site might look like this:

```ts
export default defineConfig({
  siteUrl: 'https://example.org',
  audits: ['i18n', 'csp', 'security', 'assets', 'links', 'seo', 'a11y', 'r12s', 'budget'],
  severity: { budget: 'warn', a11y: 'warn', r12s: 'warn' },
  links: { checkExternal: false },
  seo: { orphans: false, allowNoindex: ['^/search/'] },
});
```

and in CI, with the baseline covering what is left:

```sh
npx vidimus --accept-findings   # once, locally; commit vidimus.baseline.json
npx vidimus                     # in CI: fails only on new findings
```

Each audit's options are on its page, starting from the [audits overview](./audits/).
