---
"vidimus": minor
---

The csp audit now finds requests the site can make but has not made yet. It scans the HTML, inline and bundled JavaScript (following imported chunks) and CSS for `fetch`, XHR, `WebSocket`, `EventSource`, `sendBeacon`, workers, images, fonts, stylesheets, media and form actions, and reports those the CSP blocks. URLs that only appear in code are warnings. Policies from `server.headers` are checked too. New options `csp.requests` and `csp.ignore`.
