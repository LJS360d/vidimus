---
"vidimus": patch
---

SARIF locations are now relative to `GITHUB_WORKSPACE` when set (else the working directory), and `invocations[0].workingDirectory` declares that root, per the GitHub SARIF support docs.
