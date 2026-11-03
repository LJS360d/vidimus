---
"vidimus": patch
---

Web app manifests with a leading UTF-8 byte order mark are parsed instead of being reported as invalid JSON, since the Infra JSON parsing algorithm the Web App Manifest spec relies on strips the BOM.
