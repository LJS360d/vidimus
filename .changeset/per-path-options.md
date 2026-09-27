---
"vidimus": minor
---

Per-path options for sites that mix static and client-rendered sections: `server.fallback` also takes `{ match, file }` rules, so several apps under one origin each answer their own routes; `render.include` renders only the pages whose path matches; and `lighthouse.overrides` sets other thresholds for the pages whose path matches, later rules winning.
