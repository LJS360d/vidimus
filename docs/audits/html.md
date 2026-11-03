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

It checks the shipped HTML files. With [`render.mode`](../how-it-works#client-rendered-sites)
on, `html.source: 'rendered'` checks the DOM a browser renders instead; the browser has already
fixed some markup errors there, and line numbers refer to the serialised DOM, so findings carry no `line`.

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

The markup in an `<iframe srcdoc="…">` is validated as its own document, usually a fragment,
and its example locations read `/path/ <iframe srcdoc>:line:column`. An `<iframe>` without
`title` fails `element-required-attributes`.

### Configuration sources

1. `html.extends`, the `html-validate:standard` and `html-validate:a11y` presets by default.
2. A `.htmlvalidate.json` (or `.htmlvalidate.js`, `.htmlvalidate.cjs`, `.htmlvalidate.mjs`, checked in that order) in the project root, if present, replaces `html.extends` completely:
   its `extends`, `rules` and other keys are used as is.
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
| `html.extends` | the standard and a11y presets | html-validate presets; ignored when a `.htmlvalidate.*` file exists |
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

## Standards

The rules come from html-validate. Each rule's text is on the [rules index](https://html-validate.org/rules/).

### html-validate rules

[html-validate](https://html-validate.org/rules/)

- `html-validate:standard` (on by default): element content models and nesting
  (`element-permitted-content`, `element-permitted-order`, `element-permitted-parent`, `close-order`).
- `no-dup-id`, `unrecognized-char-ref` and `no-raw-characters`: unique IDs and character references.
- `attribute-allowed-values`, `element-required-attributes` and `no-deprecated-attr`: allowed values,
  required attributes and deprecated attributes.
- `html-validate:a11y` (on by default): `empty-title`, `empty-heading`, `meta-refresh`,
  `hidden-focusable`, `multiple-labeled-controls` and `no-implicit-button-type`.

### HTML Living Standard

[HTML Living Standard](https://html.spec.whatwg.org/multipage/)

- File encoding: a byte-order mark decides first. Otherwise the first `<meta>` within the first
  1024 bytes (outside comments) whose `charset` attribute, or `content` charset with
  `http-equiv="content-type"`, names a known encoding decides; a `charset=` inside any other
  attribute does not count, and a BOM-less `utf-16` label is read as UTF-8 (13.2.3.2).
- `<iframe srcdoc>`: the value is decoded as an attribute value before validation (13.2.5.73 and
  13.2.5.80). Named references use the full table, and a legacy name without `;` decodes unless an
  `=` or an ASCII alphanumeric follows it. Numeric references in 0x80-0x9F use the windows-1252
  table, and NUL, surrogates and values above U+10FFFF become U+FFFD. The first duplicate
  `srcdoc` attribute is used (13.2.5.33).
- `<iframe srcdoc>` discovery: only iframes the tokenizer sees as elements are checked. Markup in
  comments and in the raw text of `<textarea>`, `<title>`, `<script>`, `<style>`, `<xmp>`,
  `<noembed>`, `<noframes>` and `<iframe>` is ignored (13.2.5).

### Encoding Standard

[Encoding Standard](https://encoding.spec.whatwg.org/)

- Charset labels are resolved by `TextDecoder`, which follows the label table. A label it does not
  know is skipped like the prescan does, and with no known label the page is decoded as UTF-8
  (browsers fall back to a locale default such as windows-1252; the host's `Content-Type` usually
  says UTF-8).

### WCAG 2.1

[WCAG 2.1](https://www.w3.org/TR/WCAG21/)

- `wcag/h37` (a11y preset): every `<img>` has an `alt` attribute (1.1.1 Non-text Content, technique
  H37). The other `wcag/*` rules in the a11y preset are listed on the [rules index](https://html-validate.org/rules/).

### WAI-ARIA 1.2

[WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)

- `no-abstract-role`: abstract roles are not used on elements.
- `aria-hidden-body`: `aria-hidden` is not set on `<body>`.

### Not checked

- Only `*.html` files are validated. `.htm` and `.xhtml` pages are skipped.
- Files are decoded from their bytes. The HTTP `Content-Type` charset is not read, although
  browsers prefer it over `<meta charset>`.
- `<noscript>` is parsed as markup, so an `<iframe srcdoc>` inside it is validated, although a
  browser with scripting on treats that text as raw.
- `<template>` content is skipped when looking for `<iframe srcdoc>`, so those documents are not
  validated.
- Contrast, focus order, reflow and accessible names are not evaluated. See [a11y](./a11y) and
  [r12s](./r12s).
