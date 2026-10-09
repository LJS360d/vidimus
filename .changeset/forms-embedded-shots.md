---
'vidimus': patch
---

forms: the HTML report embeds its screenshots as `data:` URIs instead of writing `.jpg` files beside it, so `.vidimus/forms/index.html` is one self-contained file. Fixes found auditing the docs site: a query-less `GET` the page or an embed makes while a case runs (a lazy model, map tiles) no longer counts as the form sending; a form without an `action` attribute is recognised as the same form on every page; `forms.skip` also applies to fields outside a `<form>`; and a form the page adds later no longer shifts which form an index points at.
