---
"vidimus": minor
---

`security` checks `/.well-known/security.txt` (RFC 9116): a warning when it is missing, errors for a missing or invalid `Contact` or `Expires` and for an expired file. Turn it off with `security.securityTxt: false`. `assets` warns when no page links a web app manifest.

`assets` also detects from the pages whether the site needs `ads.txt` (ad tags), `/.well-known/change-password` (password fields), `apple-app-site-association` or `assetlinks.json` (links to an iOS or Android app), warns when the file is missing and checks it when present. Each is set with `'auto'` (default), `'on'` or `'off'`.
