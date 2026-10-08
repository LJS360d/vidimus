---
"vidimus": minor
---

The pretty reporter shows progress while audits run: pages done out of the total and the time left for each running audit, redrawn in place on a terminal and printed every 30 seconds in logs. Custom reporters get the same through a new `onProgress` hook. `server.command` servers are now stopped also when the run is interrupted or crashes, and when they keep running after the command's shell has exited.
