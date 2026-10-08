---
title: forms
description: The forms audit finds every form, fills it with valid and invalid values for each rule it can see or infer, and submits it in a network sandbox so nothing reaches a server.
---

# forms: form validation, sandboxed

`forms` finds every form on your pages, fills it with a value that passes and with every boundary and violation of the rules each field has, and presses the real submit button. A **network sandbox** in the browser stops whatever the form tries to send: nothing reaches a server, so no email is sent, no account created, no order placed. The audit records what each form would have sent, and reports gaps such as a form that sends a required field empty, accepts an invalid email, renders input as HTML or sends a password in the URL.

## Needs

```sh
npm i -D puppeteer
```

The audit loads pages over HTTP (`requires: 'server'`). It does not run by default: name it, or add it to `audits`.

## Run it

```sh
npx vidimus forms
```

It refuses to run against a remote `--origin` unless `forms.allowRemote` is `true`: it presses submit buttons, and with a live site behind the page even a sandboxed run is a risk you should choose to take.

## What it checks

### Finding forms

On each page (one per template with `forms.sample`), after `load` and `render.waitFor`:

- every `<form>`, including those inside open shadow roots;
- **formless forms**: fields outside any `<form>` (common in React and Vue apps) are grouped under their nearest ancestor that holds a button;
- each field: `input`, `select`, `textarea` and form-associated custom elements. Hidden inputs are listed but not filled. Disabled, read-only, invisible and `aria-hidden` fields are left alone, which also keeps honeypot fields empty.

Forms matching a `forms.skip` selector, or inside `[data-vidimus-skip]`, are not touched.

### Form ids

Every form gets a stable id, used in findings and report file names:

| Source | Id |
| --- | --- |
| `id` attribute | `contact-form` |
| `name` attribute | `name:newsletter` |
| `<form>` in the served HTML | `<page>_form_L<line>`, the line of its opening tag, e.g. `contact_form_L42` |
| rendered by script, or formless | `<page>_form_<n>`, its position among the page's forms |

`<page>` is the URL path with `/` as `_` (`/` is `index`). The same form on many pages (a footer newsletter) is recognised by its method, action and fields, exercised once, and reported with every page it is on.

### Rules

The audit reads the rules each field declares:

- HTML attributes: `required`, `minlength`, `maxlength`, `min`, `max`, `step`, `pattern`, `type`;
- **react-hook-form**: the rules passed to `register()` (`required`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `validate`), read from the form's control;
- **Angular**: field names from `formControlName`, and each control's state from the `ng-valid`/`ng-invalid` classes, in production builds too;
- the field's meaning from its type, `autocomplete` token, name and label: a `type="text"` field labelled "Email" is tested as an email.

Then it **infers rules the page does not declare** (Angular `Validators`, Zod or Yup schemas, hand-written checks) by changing one field at a time and reading back whether it was marked invalid:

- `required`: the empty value is rejected;
- `min` and `max` for numbers, and `minLength` and `maxLength` for free text: found by binary search between a rejected and an accepted value.

Inferred rules are listed under `inferred` in the report and get the same cases as declared ones. Findings about them say "rule inferred from the page".

### Values

Every field first gets one value it accepts. The audit tries, in order: `forms.values`, the field's `autocomplete` token, its type and meaning, a value generated from its `pattern`, and, if the page still rejects it, a list of alternatives until one passes. Then one field at a time changes while the others keep their accepted value:

| Field | Cases |
| --- | --- |
| text | empty, only spaces (when required), `minlength`-1, exactly `maxlength`, 10 000 characters (when there is no limit), unicode, an HTML snippet |
| email, url, tel (by type or meaning) | malformed values: `vidimus`, `vidimus@`, `@example.com`, `vidimus@@example.com`, `example`, `http://`, `javascript:alert(1)` |
| `pattern` | a mutation of the accepted value that the pattern rejects |
| number, date | empty, `min`-1, `max`+1, a value off `step` |
| select, radio | every option; no choice for radio groups |
| checkbox | unchecked |
| file | no file (an accepted case uploads a 1x1 PNG) |
| confirmation fields ("Confirm password") | a value that does not match the original |

Plus the whole form: all accepted values, all empty, and a double click on submit. Text values are typed, the last character with real key events, so frameworks see user input and the browser applies `minlength`. If the browser refuses a value (typing past `maxlength`), the case is marked as not testing anything.

For every case the report records each field's state in three layers: the **browser** (`validity`), the **framework** (react-hook-form errors, Angular classes) and the **UI** (`aria-invalid`, error classes such as `is-invalid` or `Mui-error`, and visible error text, such as `[role=alert]` or `.error` right after the field). Then the outcome of pressing submit: `blocked:native` (browser validation), `blocked:script` (the submit handler stopped it), `sent` or `navigated` (a request left the form and the sandbox stopped it), `none` or `not-submitted`.

### The sandbox

Every page loads in a fresh browser context (no cookies, not logged in), with service workers bypassed. While the page loads it behaves like a normal visit: documents, static files and data `GET` requests go through. Once the audit starts filling the form, only `GET` requests for static files (scripts, styles, images, fonts, media) go through. Everything else is recorded and stopped: `fetch` and XHR (`GET` included, since a `GET` can unsubscribe someone), beacons, `EventSource`, and native form submissions, which get an empty `204` so the page stays put. `WebSocket` is replaced with a stub that never connects, `window.open` does nothing, and `target="_blank"` forms submit in place, so no request escapes through a new window.

`forms.allowRequests` lets named URLs through (a "username taken?" check against a test API). `forms.stub: 'ok'` answers stopped `fetch`/XHR requests with `200 {}`, so pages that wait for a success response can show their next step.

Requests sent from inside web workers are outside the sandbox; pages that start workers get a finding.

### Findings

| Finding | Severity |
| --- | --- |
| `<field> sent empty while required`, `shorter than minlength`, `not matching pattern`, `not a valid email`, `below min`, `above max`, `off step`, `not matching <field>`: a value breaking a rule left the form | error |
| `<field> value is rendered as HTML`: the HTML snippet typed into the field became an element on the page | error |
| `password sent in the URL` | error |
| `data sent over plain HTTP` (not to localhost) | error |
| `<field> accepts an invalid email/url/tel`: the field means an email but nothing checks it | warn |
| `<field> accepts only spaces as a required value` | warn |
| `<field> has no length limit`: 10 000 characters were sent | warn |
| `<field> accepts javascript: URLs` | warn |
| `empty form was sent` (no field is required) | warn |
| `double click on submit sent 2 requests` | warn |
| `POST form without a CSRF token` (native same-origin POST, no hidden token field) | warn |
| `valid input sent nothing`: the form never sent even its accepted values, so the "sent" checks prove nothing for it | warn |
| `<field> looks like a password but is type="text"` | warn |
| `personal-data field(s) without autocomplete` (WCAG 1.3.5) | warn |
| `<fields> shows an error without aria-invalid` | warn |
| `script errors while filling or submitting` | warn |
| `page starts web workers, whose requests the sandbox cannot see` | warn |
| `<n> cases not run` (`forms.maxCases` reached) | warn |
| `failed to load <page>`, `could not be exercised` | error |

Errors from the sandbox stopping the page's own request (`Failed to fetch`) are not reported.

### Report files

`.vidimus/forms/<id>.json` per form holds its fields with declared and inferred rules, every case with the values, each layer's state, the outcome and the requests the form tried to make (method, URL, parsed body), and per field the values the form `accepted` and `rejected`. `.vidimus/forms/index.json` lists the forms.

## Example output

An Angular reactive form with `Validators.required`, `Validators.email`, `Validators.minLength(3)` and `Validators.min(18)`, none of them visible in the HTML:

```text
⚠ index_form_1: username accepts only spaces as a required value
    username=spaces: "   "
      → POST /api/profile  {"email":"vidimus@example.com","username":"   ","age":18}
    on: /
    → Trim before validating, or add pattern=".*\S.*", so blank input counts as missing.

⚠ index_form_1: double click on submit sent 2 requests
    POST /api/profile  {"email":"vidimus@example.com","username":"vidimus","age":18}
    POST /api/profile  {"email":"vidimus@example.com","username":"vidimus","age":18}
    on: /
    → Disable the submit button, or ignore submits, while a request is in flight.

⚠ index_form_1: email, username, age shows an error without aria-invalid
    on: /
    → Set aria-invalid="true" on the field while it is invalid and point aria-describedby at the error text.
```

## Options

| Key | Default | Description |
| --- | --- | --- |
| `forms.concurrency` | half the cores (2 to 8) | pages, then forms, handled at the same time |
| `forms.timeout` | `60000` | ms to wait for a page's `load` event |
| `forms.settle` | `500` | ms to wait for a request after pressing submit |
| `forms.exclude` | `[]` | URL path patterns to skip |
| `forms.sample` | `[]` | URL path patterns: load one page per matching template |
| `forms.skip` | `[]` | CSS selectors of forms not to touch, e.g. `[role=search]` |
| `forms.maxCases` | `200` | cases per form |
| `forms.values` | `{}` | regex on a field's name, id or label → a value it accepts |
| `forms.allowRequests` | `[]` | URL patterns the sandbox lets through |
| `forms.stub` | `'abort'` | `'ok'` answers stopped `fetch`/XHR requests with `200 {}` |
| `forms.allowRemote` | `false` | allow auditing a non-local `--origin` |
| `forms.outDir` | `'forms'` | report directory inside `outDir` |

## Config example

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'forms'],
  forms: {
    sample: ['^/products/[^/]+/$'],
    skip: ['[role=search]'],
    values: { coupon: 'WELCOME10', 'vat|tax id': 'IT12345678901' },
  },
});
```

## Tips

- "valid input sent nothing" means the audit could not find values your form accepts. Give it one in `forms.values`, or, if the form needs an API answer first, use `forms.stub: 'ok'` or `forms.allowRequests`.
- Client-side validation is for users. The server must check the same rules anyway: anyone can send a request without your form.
- Each case runs on a freshly loaded page unless the browser blocked the submit, so a form with many fields takes a while. `forms.sample` and `forms.skip` keep big sites fast.
