---
"vidimus": patch
---

The built-in server redirects a directory URL without a trailing slash (`/docs`) to `/docs/`, as GitHub Pages, Netlify and most static hosts do, so relative links on directory index pages resolve the same way as in production instead of being reported as broken.
