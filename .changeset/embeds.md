---
"vidimus": minor
---

Iframes and embeds across audits. `csp` reports iframes whose URL the page's `frame-src` (meta CSP or `server.headers`) does not allow, warns about third-party iframes without `sandbox` (`csp.sandbox`), and checks inline blocks inside `<iframe srcdoc>`. `privacy` reports hosts loaded into an iframe as `third-party embed from <host>`, including requests made inside cross-origin frames, with a click-to-load facade as the fix. `html` validates `<iframe srcdoc>` markup.
