---
"vidimus": minor
---

`server.command` (or `--serve`) serves the build with your host's own tool instead of the built-in server, such as `npx wrangler pages dev {dist} --port {port}`, so audits see production's headers, redirects and 404s. vidimus fills in `{port}` and `{dist}`, waits for the port to answer (`server.startTimeout`), writes the command's output to `server.log` in `outDir` and stops it at the end of the run. Audits treat it like `--origin`: `security` fetches the real response headers. The new Serving the build docs page lists what the built-in server does not replicate and recipes for Cloudflare Pages, Netlify, Vercel, Firebase Hosting, Azure Static Web Apps, nginx, Apache, Caddy and GitHub Pages.
