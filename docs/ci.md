---
title: CI
description: Run vidimus in GitHub Actions, GitLab CI, Forgejo or any other CI, cache the browser and audit the deployed site.
---

# CI

In CI, run vidimus after the build and let its exit code gate the job:

```sh
npm ci
npm run build
npx vidimus
```

It exits `1` when an audit fails or errors and `2` on a usage or config error, so either stops
the pipeline. Warnings do not, unless you pass `--strict`. All codes: [CLI](./cli#exit-codes).

## GitHub Actions

On GitHub Actions (`GITHUB_ACTIONS=true`, Forgejo sets it too) the `github` reporter is added
automatically: findings become annotations on the pull request, and a summary table goes to
the job summary. Other CI systems can read JUnit or JSON:

```sh
npx vidimus -r pretty -r junit:reports/vidimus.xml -r json:reports/vidimus.json
```

`json` or `junit` without a file writes to stdout, and `pretty` moves to stderr.

The `github` reporter is added even when you pass `-r` or set `reporters`, so asking for a JUnit
file keeps the annotations:

```yaml
name: audit

on:
  pull_request:
  push:
    branches: [main]

jobs:
  vidimus:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npx vidimus all -r pretty -r junit:reports/vidimus.xml
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: vidimus
          path: |
            reports/
            .vidimus/
```

Each finding becomes a `::error` or `::warning` annotation titled `vidimus <audit>`, with the
pages, details and fix in its body, and a `file=` property when the finding names a file. The job
summary gets a table with every audit's status and summary. `.vidimus/` holds the Lighthouse
reports and the screenshot diffs, worth keeping when those audits run.

### Caching the browser

Puppeteer downloads Chrome into `~/.cache/puppeteer` when it is installed. Skip that download
during `npm ci`, cache the directory, and install the browser explicitly; on a cache hit the
install finds Chrome already there:

```yaml
jobs:
  vidimus:
    runs-on: ubuntu-latest
    env:
      PUPPETEER_SKIP_DOWNLOAD: 'true'
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: ~/.cache/puppeteer
          key: puppeteer-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx puppeteer browsers install chrome
      - run: npm run build
      - run: npx vidimus
```

The key follows the lockfile, so a puppeteer upgrade fetches the Chrome build it expects. This
repository's own workflows do the same in `.github/actions/setup/action.yml`, with pnpm and a
key on the installed puppeteer version.

The zero-dependency audits (`i18n`, `csp`, `seo`, `security`, `budget`, `assets`) need no
browser; a job that only runs those can skip this step and the browser peers entirely.

### Screenshot baseline

`shots` compares against a baseline that has to exist on the runner. Either commit it by
setting `shots.baselineDir` to a directory outside `.vidimus/`, or record it on `main` and
restore it on pull requests:

```yaml
      - uses: actions/cache@v4
        with:
          path: .vidimus/shots/baseline
          key: shots-baseline-${{ github.sha }}
          restore-keys: shots-baseline-
      - run: npx vidimus shots ${{ github.ref == 'refs/heads/main' && '--update-baseline' || '' }}
```

See [shots](./audits/shots#sharing-the-baseline).

### Auditing the deployed site

The build answers most questions, but response headers, redirects and CDN behaviour exist
only on the real host. After the deploy job, run the audits that depend on them against the
live URL with `--origin`. The page list still comes from the build, so rebuild first:

```yaml
jobs:
  # build and deploy jobs as before
  verify:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Audit the deployed site
        run: >-
          npx vidimus security links privacy
          --origin https://user.github.io/project
          --set severity.security=warn
```

This is what this repository's `.github/workflows/docs.yml` does after deploying the docs to
GitHub Pages. With `--origin`:

- no local server is started; `links` and `privacy` load pages from the deployed site
- `security` fetches each page's response headers instead of reading `_headers`, and also warns
  about `X-Powered-By` and a versioned `Server` header
- the base path is part of the origin: `https://user.github.io/project`, not
  `https://user.github.io`

`--set severity.security=warn` keeps the job green on a host that cannot set headers, such as
GitHub Pages, while still showing what is missing.

## GitLab CI

GitLab shows JUnit reports in merge requests and on the pipeline's Tests tab:

```yaml
vidimus:
  image: node:24
  variables:
    PUPPETEER_CACHE_DIR: $CI_PROJECT_DIR/.cache/puppeteer
  cache:
    key:
      files: [package-lock.json]
    paths: [.cache/puppeteer]
  script:
    - npm ci
    - npm run build
    - npx vidimus -r pretty -r junit:reports/vidimus.xml
  artifacts:
    when: always
    reports:
      junit: reports/vidimus.xml
    paths:
      - reports/
      - .vidimus/
```

GitLab only caches paths inside the project directory, hence `PUPPETEER_CACHE_DIR`. The
`node` images do not include the shared libraries Chrome needs; install them in the image or
use a system Chromium, see [below](#system-chromium-and-docker).

In JUnit, each audit is a test suite and each finding a test case: errors are failures, warnings
are recorded as output and do not fail the suite.

## Forgejo

Forgejo Actions sets `GITHUB_ACTIONS=true`, so the `github` reporter is added by default and
workflows written for GitHub Actions run largely unchanged. The reporter prints workflow
commands to the log; the summary table is written only when `GITHUB_STEP_SUMMARY` is set. Keep
a JUnit or JSON file as an artifact if your instance does not display annotations.

## Other CI

Any CI that runs Node 22.18 or later works: the exit code gates the job, and the reports go to
files.

```sh
npx vidimus -r pretty -r junit:reports/vidimus.xml -r json:reports/vidimus.json
```

- `pretty` is readable in a log; colours are dropped when the output is not a terminal
- `junit` for systems with a test report view (Jenkins, Azure Pipelines, CircleCI, Buildkite)
- `json` for your own scripts: `jq '.results[] | select(.status != "passed")' reports/vidimus.json`

Configuration from the environment helps when the same config runs in several places:
`VIDIMUS_SITE_URL`, `VIDIMUS_PORT`, `VIDIMUS_STRICT=true`, `VIDIMUS_CONFIG=ci/vidimus.config.ts`.
Unrelated `VIDIMUS_*` variables are ignored. See [Configuration](./configuration#environment-variables).

## System Chromium and Docker

Chrome runs with `--no-sandbox --disable-dev-shm-usage` by default (`browser.args`). Point
`browser.executablePath` at a system Chromium to skip puppeteer's download.

On a Debian-based image:

```sh
apt-get update && apt-get install -y chromium
PUPPETEER_SKIP_DOWNLOAD=true npm ci
VIDIMUS_BROWSER__EXECUTABLE_PATH=/usr/bin/chromium npx vidimus
```

or in the config:

```ts
export default defineConfig({
  browser: { executablePath: process.env.CHROME_PATH ?? '' },
});
```

An empty `executablePath` means puppeteer's own Chrome. Every browser audit (`a11y`, `r12s`,
`privacy`, `shots`, `lighthouse`) launches through the same settings. The Chromium version
should be one your puppeteer version supports.

`--no-sandbox` is needed when Chrome runs as root, which is the default in most containers,
and `--disable-dev-shm-usage` avoids crashes on Docker's small `/dev/shm`. Setting
`browser.args` replaces the list, so keep both flags when adding your own:

```ts
export default defineConfig({
  browser: { args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=en-US'] },
});
```

## Speeding up CI

- Run the zero-dependency audits on every push and the browser audits on pull requests only.
- `sample` on `shots`, `privacy` and `lighthouse` audits one page per template instead of every
  page.
- On small runners, lower `r12s.concurrency`, `privacy.concurrency` and `shots.concurrency`
  (default: half the cores, 2 to 8): the non-exclusive audits run at the same time.
- `links.checkExternal: false` keeps a pull request job independent of other sites; check
  external links in a scheduled job instead.
