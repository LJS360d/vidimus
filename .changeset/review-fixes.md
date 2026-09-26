---
"vidimus": minor
---

New `shots.baselineDir` option to keep the screenshot baseline outside `.vidimus/` (for example to commit it); by default it stays in `.vidimus/shots/baseline/`. `--port 0` serves the build on a free port. Audit plugins get `builtPages()` in their context, and `launchBrowser()` without options now shares one browser process between audits running at the same time, each in its own browser context. `--update-baseline` now deletes only the PNG files in the baseline directory.

Fixes:

- The built-in server no longer crashes on malformed or NUL-byte paths, closes when a reporter fails to start, and reports a port in use as a usage error.
- Invalid regular expressions in config patterns are rejected when the config loads.
- `lighthouse` and `shots` report a page that fails as a finding instead of erroring the whole audit; a failed screenshot leaves the baseline untouched on `--update-baseline`.
- `links` no longer rewrites hosts that only start with the `siteUrl` host (`example.com.au`).
- `csp` checks uppercase tags, ignores commented-out blocks and no longer mistakes `data-src` for `src`.
- The HTML parser reads attributes written without a space after a quoted value, decodes the common named entities and no longer throws on out-of-range code points.
- `r12s` flags `user-scalable=0` and `maximum-scale` below 1; `seo` checks pages whose `meta refresh` only reloads; `i18n` handles keys named like `constructor`; `security` follows same-origin redirects with a timeout; srcset URLs containing commas are kept whole.
- `--strict` marks the findings of a failed audit as errors, JUnit keeps characters outside the BMP, GitHub annotation paths are relative to the workspace, and two reporters writing to stdout are rejected.
- `--set` keeps numbers in mixed lists (`shots.viewports=375,1280`) and accepts `false` for `security.require.*`; `vidimus all <name>` adds the named audits; `init` refuses to create a second config file in another format.
- Built pages are read and parsed once per run instead of once per audit.
