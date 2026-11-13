---
title: Serving the build
description: "What the built-in static server does and does not do, and how to serve the build with your host's own tool through server.command."
---

# Serving the build

The browser audits (`a11y`, `links`, `r12s`, `privacy`, `forms`, `shots`, `lighthouse`) open pages over
HTTP. What they find depends on what answers those requests: the same build can pass behind one
server and fail behind another, because redirects, rewrites, headers and 404 pages belong to the
host, not to the build.

vidimus has three ways to serve the build:

| | Set | Who answers |
| --- | --- | --- |
| built-in server (the default) | nothing | a small static server inside vidimus |
| your host's local tool | `server.command` or `--serve` | `wrangler pages dev`, `firebase emulators:start`, nginx… started and stopped by vidimus |
| a server already running | `origin` or `--origin` | a preview server or the deployed site |

## The built-in server

With no `server.command` and no `origin`, vidimus serves `distDir` itself on `127.0.0.1:<port>`.
It is a plain file server:

- maps `/about/` to `about/index.html`, and `/about` to `about`, `about/index.html` or
  `about.html`, whichever exists; `/about` redirects to `/about/` when it resolves to
  `about/index.html`, with `cache-control: no-cache` so browsers revalidate it after the directory changes
- answers anything else with `404 Not found`, or with `server.fallback`
- answers methods other than `GET` and `HEAD` with `405 Method Not Allowed` and `Allow: GET, HEAD`
- sets `content-type` from the file extension, gzips text responses (`server.gzip`) and sends `Vary: Accept-Encoding` on them, merged with any `vary` from `server.headers`
- sends the headers of the `server.headers` rules that match the request path

The details, `server.fallback` for single-page apps and base paths are in
[How it works](./how-it-works#serving-the-build).

It does **not** behave like any real host. It ignores:

- `_headers` and `_redirects` (Cloudflare Pages, Netlify), `vercel.json`, `firebase.json`,
  `netlify.toml`, `staticwebapp.config.json`, `.htaccess` and nginx configs: no header, redirect
  or rewrite rule from them is applied
- each host's URL policy: Cloudflare Pages redirects `/about.html` to `/about`, Vercel's
  `cleanUrls` and `trailingSlash` add or drop slashes, GitHub Pages serves `404.html` with a
  `404`; the built-in server does none of that unless `server.fallback` says so
- Brotli, caching headers, `ETag`, range requests, HTTPS and HSTS
- functions, middleware and edge logic

So a clean run on the built-in server says the build is sound; it does not say production will
send the same headers, redirects and status codes. To test those, serve the build with the tool
your host provides.

## Serving with the host's tool

`server.command` is a shell command that serves the build. vidimus starts it before the audits,
waits until the port answers, and stops it (and every process it started) at the end, also
when the run is interrupted with Ctrl+C or crashes, and also processes still running after the
command itself exited:

```ts
export default defineConfig({
  server: { command: 'npx wrangler pages dev {dist} --port {port}' },
});
```

Or on the command line: `npx vidimus --serve "npx wrangler pages dev {dist} --port {port}"`.

- `{port}` is replaced by `port` (default `4322`; `--port 0` picks a free one), and the command
  also gets it as the `PORT` environment variable
- `{dist}` is replaced by the absolute path of `distDir`, already shell-quoted, so do not wrap it in quotes yourself
- the command runs in `root`, through the shell
- the server must serve `dist` at `/` on `http://localhost:<port>`; the base path of `siteUrl` is not
  added to the audit origin; a tool that reads its port from its own
  config file needs `port` set to the same number
- `server.startTimeout` (default `60000` ms) is how long vidimus waits for the first response;
  a command that exits earlier, or never answers, stops the run with exit code `2` and the last
  lines of its output
- everything the command prints goes to `server.log` in `outDir`

Audits then treat the server like `--origin`: the `security` audit fetches the real response
headers of every page instead of reading `_headers`, `server.fallback` is not needed for
`routes`, and `links` reads links from the HTML the server sends rather than the rendered DOM.
`server.gzip`, `server.headers` and `server.fallback` do not change what the command serves;
`server.headers` is still read by the `csp` audit as the declared header policy.

### Cloudflare Pages

[`wrangler pages dev`](https://developers.cloudflare.com/pages/functions/local-development/)
runs the Pages runtime locally: `_headers`, `_redirects`, `_routes.json`, clean URLs and
`functions/`.

```ts
server: { command: 'npx wrangler pages dev {dist} --port {port}' },
```

For a Workers project with static assets, `npx wrangler dev --port {port}` reads
`wrangler.toml`/`wrangler.jsonc` instead.

### Netlify

[`netlify dev`](https://cli.netlify.com/commands/dev/) applies `netlify.toml`, `_headers` and
`_redirects`, and runs functions and edge functions. `#static` stops it from starting the
framework's dev server:

```ts
server: {
  command: "npx netlify dev --dir {dist} --port {port} --framework '#static' --offline --no-open",
},
```

### Vercel

[`vercel dev`](https://vercel.com/docs/cli/dev) applies `vercel.json` (headers, redirects,
rewrites, `cleanUrls`, `trailingSlash`) and runs functions and middleware. It needs a logged in
CLI and a linked project (`vercel link`, or `VERCEL_TOKEN` in CI). With a framework preset it
starts the framework's dev server instead of serving the build; set the project's framework to
Other (`"framework": null` in `vercel.json`) with `outputDirectory` pointing at the build:

```ts
server: { command: 'npx vercel dev --listen {port} --yes' },
```

### Firebase Hosting

The [Hosting emulator](https://firebase.google.com/docs/emulator-suite/use_hosting) applies
`firebase.json` headers, redirects, rewrites, `cleanUrls` and `trailingSlash`. It takes its port
from `firebase.json`, so set vidimus's `port` to match, and `hosting.public` to `distDir`:

```json
{
  "hosting": { "public": "dist" },
  "emulators": { "hosting": { "port": 4322 } }
}
```

```ts
server: { command: 'npx firebase-tools emulators:start --only hosting --project demo-site' },
```

A `demo-` project id runs without logging in.

### Azure Static Web Apps

The [SWA CLI](https://azure.github.io/static-web-apps-cli/) applies `staticwebapp.config.json`
routes, headers and fallbacks:

```ts
server: { command: 'npx @azure/static-web-apps-cli start {dist} --port {port}' },
```

### nginx

Run the nginx version and config you deploy, for example with Docker:

```ts
server: {
  command:
    'docker run --rm -p 127.0.0.1:{port}:80 -v {dist}:/usr/share/nginx/html:ro ' +
    '-v ./nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:1.27-alpine',
},
```

The config listens on port `80` inside the container; `-p` maps it to `{port}`.

### Apache

The same with the official `httpd` image. `.htaccess` files are only read when the config has
`AllowOverride` for the document root:

```ts
server: {
  command:
    'docker run --rm -p 127.0.0.1:{port}:80 -v {dist}:/usr/local/apache2/htdocs:ro ' +
    '-v ./httpd.conf:/usr/local/apache2/conf/httpd.conf:ro httpd:2.4',
},
```

### Caddy

A `Caddyfile` can read the port from the environment with `:{$PORT}`:

```ts
server: { command: 'caddy run --config Caddyfile --adapter caddyfile' },
```

### GitHub Pages

GitHub does not publish what serves Pages, and there is no local tool for it. Leave
`server.command` unset to use the built-in server, which already behaves much like Pages:
`/about` serves `about.html`, and a directory without a trailing slash redirects to one. Pages
answers every missing path, assets included, with the root `404.html` and a `404` status;
`server.fallback: '404.html'` with `server.fallbackStatus: 404` copies that for pages. Pages
sends a fixed set of headers you cannot change, so leave `server.headers` empty. If you prefer
another static server, set it as `server.command`. To check the real thing, audit the deployed
site with `--origin`; see [CI](./ci).

### Other hosts

For a host without a local tool (S3 and CloudFront, Render, a CDN in front of object storage),
deploy to a preview or staging URL and audit it with `--origin`. The page list still comes from
the build, so audit the same build you deployed.

## Standards

The built-in server follows these standards. Each case names its clause.

### HTTP Semantics

[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110)

- RFC 9110 §9.3.2: `HEAD` gets the same status and headers as `GET`, with no body.
- RFC 9110 §12.5.3: gzip is sent only when `Accept-Encoding` gives `gzip` or `x-gzip` a q-value above 0, or gives `*` one when no gzip entry is listed; `gzip;q=0` is refused.
- RFC 9110 §12.5.5: compressible responses carry `Vary: accept-encoding`, merged with a configured `vary`.
- RFC 9110 §10.2.2 and §15.4.2: the directory redirect is a `301` with an absolute-path `Location`, and keeps the query string.
- RFC 9110 §15.5.5: a path with no file and no fallback gets `404`. A missing file with a known asset extension (`.js`, `.css`, `.avif`, ...) gets `404` even when the request accepts `text/html`, so the fallback never hides a broken asset.
- RFC 9110 §15.6.1: a failure before any status is sent (for example a file that cannot be opened) gets `500`; a read error after `200` has started aborts the connection instead of ending the body normally.

### HTTP Caching

[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111)

- RFC 9111 §4.2.2: the directory `301` carries `cache-control: no-cache`, because a 301 is heuristically cacheable.

### HTTP/1.1 Message Syntax

[RFC 9112](https://www.rfc-editor.org/rfc/rfc9112)

- RFC 9112 §3.2.1: an origin-form target starting with `//` is a path, so `GET //contact.html` serves `/contact.html`, not host `contact.html`.

### URI

[RFC 3986](https://www.rfc-editor.org/rfc/rfc3986)

- RFC 3986 §2.2: `%2F` is data, not a separator, so `/a%2Fb.html` gets `404` and never reads `dist/a/b.html`.
- RFC 3986 §2.1: a malformed escape or a NUL byte in the path gets `404`; after decoding, a path that resolves outside `distDir` gets `404`.

### URL Standard

[URL Standard](https://url.spec.whatwg.org/)

- WHATWG URL: request targets are parsed with `new URL`, so dot segments are resolved before lookup (`/a/../about/` is looked up as `/about/`).

### HTML Standard

[HTML Standard](https://html.spec.whatwg.org/multipage/)

- WHATWG HTML §13.2.3.2: a byte order mark sets the charset (utf-8, utf-16le or utf-16be); otherwise the first `<meta charset>` (or `http-equiv` content type) sets it, and that charset goes into the served `Content-Type`.
- WHATWG HTML §13.2.3.2: a `<meta charset="utf-16">` without a byte order mark is read as utf-8.

### Encoding Standard

[Encoding Standard](https://encoding.spec.whatwg.org/)

- WHATWG Encoding: charset labels resolve through the WHATWG label table (`TextDecoder`) and are served by their encoding name (`latin1` is served as `windows-1252`); a label the table does not know is skipped, and with none the file is served as `utf-8`.

### MIME Sniffing

[MIME Sniffing](https://mimesniff.spec.whatwg.org/)

- WHATWG MIME Sniffing: an extension missing from the built-in table is sent as `application/octet-stream`, which browsers do not render as a document.

### IANA Media Types

[IANA media types](https://www.iana.org/assignments/media-types/)

- Each table entry uses a registered essence, for example `image/vnd.microsoft.icon` for `.ico`, `audio/wave` for `.wav`, `text/csv` for `.csv`, `text/calendar` for `.ics`, and `text/markdown` (RFC 7763) for `.md`.
- RFC 9239: `.js` and `.mjs` are `text/javascript`.
- RFC 8259 §11: `.json` and `.map` are `application/json`, with no charset parameter.
- Newer registered types: `.jxl` `image/jxl`, `.heic`/`.heif` `image/heic`/`image/heif`, `.m3u8` `application/vnd.apple.mpegurl`, `.mpd` `application/dash+xml`, `.jsonld` `application/ld+json`, `.geojson` `application/geo+json` (RFC 7946), `.xsl`/`.xslt` `application/xslt+xml`, `.m4v` `video/mp4`, `.opus` `audio/ogg` (RFC 7845), `.weba` `audio/webm`.

**Not checked**

- RFC 9110 §14.2 and §13: `Range` and conditional requests (`ETag`, `If-None-Match`) are ignored, and every hit is a `200` with no validators.
- Fetch Standard: no `Access-Control-Allow-Origin` is sent, so a font or module from another origin fails in a real browser under the built-in server.
- `X-Content-Type-Options` is not set by the built-in server; header rules are checked by the [security](./audits/security) audit.
- `/about/index` answers `200` as well as `/about`, with the same content and no canonical hint.
- `.xhtml` is served as `application/xhtml+xml` without charset detection; `.htm` is detected like `.html`.
- `.exr` is sent as `image/x-exr`, because IANA has no registered name for it; `.apng` is sent as the unregistered `image/apng` that browsers and the WHATWG MIME Sniffing table use.
