---
title: html
description: How the html audit validates every built page with html-validate, groups repeated problems and lets you tune its rules.
---

# html: markup validation

`html` runs every built page through [html-validate](https://html-validate.org), an offline
HTML validator with rules for content models, duplicate IDs, deprecated attributes and basic
accessibility. Invalid markup is where rendering differences between browsers, broken screen
reader output and hydration mismatches start. It is not in the default set.

## Needs

- `html-validate` 9 or later: `npm i -D html-validate`. Without it the audit ends with `!` and
  `"html-validate" is not installed. Add it as a dev dependency: npm i -D html-validate`.
- The build (`dist/`). No server or browser is started.

With [`render.mode`](../how-it-works#client-rendered-sites) on, it checks the DOM a browser
renders instead of the shipped HTML file.

## Run it

```sh
npx vidimus html
```

## What it checks

Every `.html` file in the build, minus the top-level `exclude` and `html.exclude`, is validated
with the configured rules. With no pages left the audit is skipped (`no built HTML pages`).

- **Grouping**: messages are grouped by rule and message text, so a problem in a shared layout
  is one finding, not one per page. The finding lists every affected page in `on:` and up to
  three example locations as `path:line:column selector`, followed by the rule's documentation
  URL. When only one page is affected, the finding also names the file (`in:`).
- **Message**: `<rule-id>: <html-validate message>`, for example
  `no-dup-id: Duplicate ID "main"`. Messages that name a specific value (an ID, an element)
  form separate groups.
- **Severity**: rules html-validate reports as errors fail the audit; rules configured at
  severity `warn` (html-validate severity 1) are warnings.
- **Fixes**: common rules have a specific fix (`no-dup-id`, `close-order`,
  `element-permitted-content`, `element-permitted-order`, `attribute-allowed-values`,
  `no-deprecated-attr`, `element-required-attributes`, `void-style`, `no-implicit-close`,
  `no-raw-characters`, `wcag/h37`); the rest point at the rule's documentation. Every fix ends
  with how to turn the rule off.

### Configuration sources

1. `html.extends`, `['html-validate:standard']` by default.
2. A `.htmlvalidate.json` in the project root, if present, replaces `html.extends` completely:
   its `extends`, `rules` and other keys are used as is. Other html-validate config file names
   (`.htmlvalidate.js`, `.htmlvalidate.cjs`) are not read.
3. `html.rules` is merged on top of the rules from either source.

The resulting config is marked `root: true`, so html-validate does not look for further config
files next to the built pages.

## Example output

```
─── html ────────────────────────────────────────────────────────

✖ no-dup-id: Duplicate ID "menu"
    /:14:9 #menu
    /about/:14:9 #menu
    /blog/:14:9 #menu
    https://html-validate.org/rules/no-dup-id.html
    on: / /about/ /blog/ +21 more
    → Give each element a unique id (rename or remove the duplicate), or set html.rules["no-dup-id"] to "off" if it is intended.

✖ element-permitted-content: <div> element is not permitted as content under <p>
    /blog/hello/:88:5 article > p > div
    https://html-validate.org/rules/element-permitted-content.html
    in: dist/blog/hello/index.html
    on: /blog/hello/
    → Move the element into a parent that allows it (e.g. no <div> inside <p> or <a> inside <a>), or set html.rules["element-permitted-content"] to "off" if it is intended.

⚠ no-inline-style: Inline style is not allowed
    /contact/:40:12 form > div
    https://html-validate.org/rules/no-inline-style.html
    in: dist/contact/index.html
    on: /contact/
    → Fix the markup as described at https://html-validate.org/rules/no-inline-style.html, or set html.rules["no-inline-style"] to "off" if it is intended.

✖ html: 24 pages, 3 distinct problem(s) (1.2s)
```

A clean run ends with `✔ html: 24 pages, valid`.

## Options

| Key | Default | Description |
| --- | --- | --- |
| `html.extends` | `['html-validate:standard']` | html-validate presets; ignored when `.htmlvalidate.json` exists |
| `html.rules` | `{}` | html-validate rules applied on top, e.g. `{ 'no-inline-style': 'off' }` |
| `html.exclude` | `[]` | URL path patterns to skip |

Presets that ship with html-validate include `html-validate:recommended` (stricter, adds style
rules), `html-validate:standard`, `html-validate:a11y` and `html-validate:document`. See the
[html-validate presets](https://html-validate.org/rules/presets.html) for what each enables.

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'html'],
  html: {
    extends: ['html-validate:recommended'],
    rules: {
      'no-inline-style': 'warn',
      'no-trailing-whitespace': 'off',
      'void-style': ['error', { style: 'omit' }],
    },
    exclude: ['^/legacy/'],
  },
});
```

Rule values follow html-validate: `'off'`, `'warn'`, `'error'`, or `[severity, options]`.

## Common fixes

- **Duplicate IDs from a component used twice** (a menu rendered for mobile and desktop):
  derive the ID from a prop, or use a class and select with it.
- **Block elements inside `<p>`**: Markdown renderers wrap stray HTML in `<p>`. Leave a blank
  line around HTML blocks in Markdown, or use `<span>` for inline content.
- **`void-style`**: frameworks differ on `<br>` versus `<br/>`. Configure the rule to match your
  output instead of fighting the framework:

```ts
html: { rules: { 'void-style': ['error', { style: 'selfclose' }] } }
```

- **`wcag/h37`**: every `<img>` needs `alt`; use `alt=""` for decorative images.

```html
<img src="/img/divider.svg" alt="" width="600" height="8">
```

- **Third-party markup you cannot change** (an embedded widget): skip its pages with
  `html.exclude`, or turn the offending rule off. To accept today's problems and fail only on new
  ones, record a [findings baseline](../configuration#severity-ignores-and-the-findings-baseline).
