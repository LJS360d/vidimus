---
"vidimus": minor
---

New `forms` audit: finds every form (native, formless, react-hook-form, Angular), fills each field with an accepted value and every boundary and violation of its declared or inferred rules, and submits it in a network sandbox so nothing reaches a server. Reports invalid values that get sent, missing validation, input rendered as HTML, passwords in URLs, double submits and accessibility gaps, and writes what each form would have sent to `.vidimus/forms/`.
