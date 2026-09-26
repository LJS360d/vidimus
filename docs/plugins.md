---
title: Custom audits
description: Write your own vidimus audits and reporters, and use vidimus from JavaScript.
---

# Custom audits and reporters

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

`requires` is `source` (no build), `dist` (reads files) or `server` (the default: the build is
served over HTTP).

A finding has a `message`, and optionally `where` (URL paths), `file`, `details` (extra lines),
`fix` (what to do, shown as `→ …`) and `severity: 'warn'`. An audit passes with no findings,
warns when every finding is a warning, and fails otherwise, unless it returns a `status`.
Plugin audits get `severity`, `ignore` and the findings baseline for free.

`reporters` also accepts objects with `onStart`, `onAuditEnd` and `onEnd` hooks.

Programmatic use: `import { run } from 'vidimus'` and `await run({ audits: ['links'] })`.
