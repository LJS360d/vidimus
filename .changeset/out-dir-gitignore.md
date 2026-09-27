---
"vidimus": patch
---

The output directory (`.vidimus` by default) now gets its own `.gitignore` containing `*` when a run first creates it, instead of `vidimus init` appending `.vidimus` to the project `.gitignore`.
