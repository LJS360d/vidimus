---
"vidimus": minor
---

`--profile` records where a run spends its time: every audit, page, browser call (`page.goto`, each `page.evaluate` by function), Node request, pool queueing, Lighthouse phase and forms step, plus CPU, heap, event loop and GC samples. Prints a summary with hints, writes a Chrome trace to `.vidimus/profile/` (Perfetto, speedscope), adds `profile` to the JSON report, and `--profile cpu` adds a Node CPU profile. `vidimus profile diff` compares two traces, `--serial` runs audits one at a time, and audits get `context.span()` for their own spans. The `forms` audit stops waiting as soon as a submit sends a request.
