# vidimus

[![npm](https://img.shields.io/npm/v/vidimus)](https://www.npmjs.com/package/vidimus)
[![node](https://img.shields.io/node/v/vidimus)](https://nodejs.org)
[![ci](https://github.com/LJS360d/vidimus/actions/workflows/ci.yml/badge.svg)](https://github.com/LJS360d/vidimus/actions/workflows/ci.yml)
[![docs](https://img.shields.io/badge/docs-ljs360d.github.io%2Fvidimus-1e3a5f)](https://ljs360d.github.io/vidimus/)
[![license](https://img.shields.io/npm/l/vidimus)](https://github.com/LJS360d/vidimus/blob/main/LICENSE)

*Vidimus*, "we have seen": checks a static website's build before it goes public, and tells you
how to fix what it finds.

```sh
npm i -D vidimus puppeteer pa11y linkinator
npm run build && npx vidimus
```

```
✖ noindex in the production build
    on: /en/search/ /fr/search/ /it/search/ +1 more
    → Remove the robots noindex meta tag, or add the path to seo.allowNoindex if it is intentional.

⚠ no <h1>
    on: /en/ /fr/ /it/ +1 more
    → Add one <h1> heading describing the page, or turn seo.h1 off.
```

## Audits

| | |
| --- | --- |
| `i18n` `csp` `seo` `security` `budget` `assets` | read the build, no extra dependencies |
| `a11y` `links` `r12s` `privacy` `forms` `html` `shots` `lighthouse` | run the tools you install next to vidimus (puppeteer, pa11y, linkinator, html-validate, lighthouse, sharp) |

`i18n`, `csp`, `a11y`, `links` and `r12s` run by default; `npx vidimus all` runs everything,
`npx vidimus seo budget` runs just those. The default set needs puppeteer, pa11y and
linkinator, installed above; the others are needed only by the audits that use them.

What each audit checks and its options: [ljs360d.github.io/vidimus/audits](https://ljs360d.github.io/vidimus/audits/).

## Configure

```sh
npx vidimus init       # writes vidimus.config.ts
```

```ts
import { defineConfig } from 'vidimus';

export default defineConfig({
  siteUrl: 'https://example.org',
  audits: ['i18n', 'csp', 'a11y', 'links', 'r12s', 'seo', 'budget'],
  severity: { budget: 'warn' },
  ignore: [{ audit: 'seo', message: '^orphan page' }],
});
```

Adopting it on an existing site: `npx vidimus --accept-findings` records today's findings, and
later runs fail only on new ones.

Client-rendered apps (React, Angular, Vue) work too: `server.fallback` answers their routes,
`routes` lists or crawls them, and `render` audits the DOM the browser builds instead of the
empty shell: [client-rendered apps](https://ljs360d.github.io/vidimus/frameworks#client-rendered-apps).

## Docs

**[ljs360d.github.io/vidimus](https://ljs360d.github.io/vidimus/)**: [getting started](https://ljs360d.github.io/vidimus/getting-started),
[how it works](https://ljs360d.github.io/vidimus/how-it-works), [audits](https://ljs360d.github.io/vidimus/audits/),
[configuration](https://ljs360d.github.io/vidimus/configuration), [CLI](https://ljs360d.github.io/vidimus/cli),
[CI](https://ljs360d.github.io/vidimus/ci), [frameworks](https://ljs360d.github.io/vidimus/frameworks),
[custom audits and API](https://ljs360d.github.io/vidimus/plugins). Contributing: [CONTRIBUTING.md](https://github.com/LJS360d/vidimus/blob/main/CONTRIBUTING.md).

The docs are deliberately built eight times from the same markdown, by VitePress, Starlight, Hugo,
Eleventy, Zola, mdBook and client-rendered React and Angular apps, deployed side by side and
audited by vidimus as one site, to dogfood it against eight builds' real output:
[why](https://ljs360d.github.io/vidimus/flavors).

## Standards

Each audit checks the build against published specs. The Standards section of each audit's page lists
the clauses it checks and what it leaves out.

| Audit | Standards |
| --- | --- |
| [`a11y`](https://ljs360d.github.io/vidimus/audits/a11y#standards) | [WCAG 2.1](https://www.w3.org/TR/WCAG21/) criteria via pa11y (HTML_CodeSniffer, axe-core); [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 2.5.8 is in `r12s`, [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) |
| [`r12s`](https://ljs360d.github.io/vidimus/audits/r12s#standards) | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 1.4.4 Resize Text, 1.4.10 Reflow, 2.5.8 Target Size (Minimum) |
| [`forms`](https://ljs360d.github.io/vidimus/audits/forms#standards) | [HTML: forms and constraint validation](https://html.spec.whatwg.org/multipage/input.html), [autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill), [WCAG 2.2](https://www.w3.org/TR/WCAG22/) 1.3.5, [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) |
| [`html`](https://ljs360d.github.io/vidimus/audits/html#standards) | [HTML Living Standard](https://html.spec.whatwg.org/multipage/) (parsing, [named character references](https://html.spec.whatwg.org/multipage/named-characters.html)), [Encoding](https://encoding.spec.whatwg.org/) |
| [`csp`](https://ljs360d.github.io/vidimus/audits/csp#standards) | [CSP Level 3](https://www.w3.org/TR/CSP3/) (W3C Working Draft) |
| [`security`](https://ljs360d.github.io/vidimus/audits/security#standards) | [RFC 6797](https://www.rfc-editor.org/rfc/rfc6797) HSTS and [HSTS preload](https://hstspreload.org/), [RFC 9116](https://www.rfc-editor.org/rfc/rfc9116) security.txt, [CSP Level 3](https://www.w3.org/TR/CSP3/), [RFC 7034](https://www.rfc-editor.org/rfc/rfc7034) X-Frame-Options, [Fetch](https://fetch.spec.whatwg.org/#x-content-type-options-header) nosniff, [Referrer Policy](https://www.w3.org/TR/referrer-policy/), [Permissions Policy](https://www.w3.org/TR/permissions-policy/) ([RFC 9651](https://www.rfc-editor.org/rfc/rfc9651) syntax), [SRI](https://www.w3.org/TR/SRI/), [Mixed Content](https://www.w3.org/TR/mixed-content/), [OWASP Secure Headers](https://owasp.org/projects/secure-headers-project) |
| [`seo`](https://ljs360d.github.io/vidimus/audits/seo#standards) | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309) robots.txt, [Sitemaps 0.9](https://www.sitemaps.org/protocol.html), [RFC 6596](https://www.rfc-editor.org/rfc/rfc6596) canonical, [BCP 47](https://www.rfc-editor.org/info/bcp47) language tags, [robots meta / X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag), [hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions), [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) |
| [`i18n`](https://ljs360d.github.io/vidimus/audits/i18n#standards) | [gettext PO](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html), [CLDR plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules), [BCP 47](https://www.rfc-editor.org/info/bcp47) |
| [`assets`](https://ljs360d.github.io/vidimus/audits/assets#standards) | [Web App Manifest](https://www.w3.org/TR/appmanifest/), [Open Graph](https://ogp.me/), [X Cards](https://web.archive.org/web/20250102034750/https://developer.x.com/en/docs/x-for-websites/cards/overview/markup) (archived), [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) well-known URIs, [change-password URL](https://w3c.github.io/webappsec-change-password-url/), [ads.txt 1.1](https://iabtechlab.com/ads-txt/), [associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains), [Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started) |
| [`budget`](https://ljs360d.github.io/vidimus/audits/budget#standards) | [gzip RFC 1952](https://www.rfc-editor.org/rfc/rfc1952), [Brotli RFC 7932](https://www.rfc-editor.org/rfc/rfc7932), image headers: [PNG](https://www.w3.org/TR/png-3/), [GIF89a](https://www.w3.org/Graphics/GIF/spec-gif89a.txt), [JPEG T.81](https://www.itu.int/rec/T-REC-T.81), [WebP RFC 9649](https://www.rfc-editor.org/rfc/rfc9649), [AVIF](https://aomediacodec.github.io/av1-avif/), [SVG 2](https://www.w3.org/TR/SVG2/) |
| [`links`](https://ljs360d.github.io/vidimus/audits/links#standards) | [URL Standard](https://url.spec.whatwg.org/), [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986), [HTML `<base>`](https://html.spec.whatwg.org/multipage/semantics.html#the-base-element) and [fragments](https://html.spec.whatwg.org/multipage/browsing-the-web.html#find-a-potential-indicated-element) |
| [`privacy`](https://ljs360d.github.io/vidimus/audits/privacy#standards) | [ePrivacy Directive Art. 5(3)](https://eur-lex.europa.eu/eli/dir/2002/58/oj), [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [Global Privacy Control](https://www.w3.org/TR/gpc/), [Referrer Policy](https://www.w3.org/TR/referrer-policy/) |
| [built-in server](https://ljs360d.github.io/vidimus/serving#standards) | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) HTTP semantics, [RFC 9239](https://www.rfc-editor.org/rfc/rfc9239) and IANA media types, [MIME Sniffing](https://mimesniff.spec.whatwg.org/), [Encoding](https://encoding.spec.whatwg.org/) |
| [reporters](https://ljs360d.github.io/vidimus/reporters#standards) | [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html), [JUnit XML](https://github.com/testmoapp/junitxml), [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands), [JSON Schema draft-07](https://json-schema.org/draft-07), [XML 1.0](https://www.w3.org/TR/xml/), [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339), [NO_COLOR](https://no-color.org/) |

## License

MIT
