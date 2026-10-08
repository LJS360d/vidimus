---
title: Profiling
description: Find out where a vidimus run spends its time, down to each browser call, page, form case and Lighthouse phase, and compare runs after a change.
---

# Profiling

`--profile` records where a run spends its time. Use it to work out why an audit is slow on your
site, or how much a config change (`sample`, `concurrency`, `exclude`) saves. It reports which
audit, which page, which browser call (`page.goto`, each `page.evaluate` by function), which
request, how long work waited for a free browser tab, and how busy Node was.

```sh
npx vidimus forms --profile        # spans: timings of every step
npx vidimus forms --profile cpu    # also a CPU profile of the Node process
npx vidimus all --profile --serial # one audit at a time, so they do not slow each other down
```

Profiling does not change findings or the exit code.

## What is timed

Every step is a **span** with a start, an end and a parent, so time adds up from the smallest
step to the whole run:

| Span | What |
| --- | --- |
| `audit <name>` | one audit, from start to finish |
| `serve`, `routes` | starting the built-in server, discovering routes |
| `pool` / `task` | an audit's parallel work and each item in it (a page, a form); each task records `waitMs`, how long it waited for a free worker |
| `navigate` | loading a page, with `page.goto` and the `render.waitFor` wait inside |
| `page.<method>` | every browser call: `page.goto`, `page.screenshot`, `page.evaluate <function>`, `page.keyboard.type`, `context.newPage`, `browser.launch`… |
| `fetch GET`/`POST` | requests made from Node (links, security, assets), with status and time to first byte |
| `render`, `render.wait` | rendering a client-rendered page, and waiting for a render slot |
| `import <package>` | loading a peer dependency the first time |
| `lh:*` | Lighthouse's own phases (`lh:driver:navigate`, `lh:gather:getArtifact:*`, `lh:runner:audit`…) |
| `forms.*` | the [forms](./audits/forms) audit: `forms.baseline`, `forms.infer`, each `forms.case` with its `forms.reload` and `forms.settle` |

Every 100 ms the profiler also samples Node's CPU use, heap, event-loop load and event-loop lag,
and it records garbage-collection pauses.

**Self time** is the part of a span that none of its children cover: `page.goto` self time is
the browser loading the page, while `task` self time is the waiting no other span accounts for.
When children run in parallel, overlapping time counts once.

## In the terminal

After the audits, the `pretty` reporter prints a summary. This one is from a `lighthouse a11y`
run on a two-page site:

```text
─── profile ─────────────────────────────────────────────────────
run 13.1s · 658 spans · profiler overhead ~1ms
setup  serve 6ms · routes 0ms
a11y  1.5s
    page.goto 2.0s self ×2
    browser.launch 243ms self ×1
    context.newPage 95ms self ×2
  slowest pages  / 1.1s · /about/ 1.1s
  pool  2 workers · 2 items · busy 100% · queued 0ms · slowest http://localhost:4395/ 1.1s
lighthouse  12.1s
    lh:driver:navigate 4.8s self ×4
    lh:gather:getArtifact:FullPageScreenshot 2.1s self / 2.1s ×2
    lh:gather:getBenchmarkIndex 2.0s self ×2
  slowest pages  /about/ 5.9s · / 5.6s
node  cpu 12% · loop busy 7% · lag max 454ms · heap max 205MB · gc 194ms (max pause 9ms)
hint  a11y: "page.goto" is 79% of its work (2 calls)
trace .vidimus/profile/2026-10-08T07-27-51-861Z.trace.json (open in ui.perfetto.dev or speedscope.app)
```

Per audit:

- the five spans with the most self time, their total time when it differs, and how many times they ran;
- the slowest pages;
- each pool: workers, items, how busy the workers were, total queueing and the slowest item.

**Hints** point at the obvious next step: one span taking a large share of an audit's work, one
slow item holding up a pool, a dependency slow to import, heavy garbage collection, or a
CPU-bound run (then use `--profile cpu`).

## Trace files

Each profiled run writes `<outDir>/profile/<time>.trace.json` (`.vidimus/profile/` by default) in
the Chrome trace format. Open it in [Perfetto](https://ui.perfetto.dev),
[speedscope](https://www.speedscope.app) or `chrome://tracing` for a zoomable timeline: parallel
work is laid out in separate lanes, garbage collection in its own lane, and CPU, heap and event
loop as counter tracks. Click a span to see its attributes, such as `url`, `item`, `waitMs` and `status`.

`--profile cpu` also writes `<time>.cpuprofile`, a sampling profile of the Node process: which
of vidimus' own functions use the CPU. Open it in Chrome DevTools (Performance, then load
profile) or speedscope.

## In the JSON report

With `--profile`, the [JSON reporter](./reporters#json) adds a `profile` object:

| Field | |
| --- | --- |
| `trace`, `cpuProfile` | trace file paths, relative to `root` |
| `wallMs`, `spans`, `overheadMs` | run duration, span count, estimated cost of profiling |
| `setup[]` | spans outside audits, as `{ name, count, totalMs, selfMs, maxMs }` |
| `audits[]` | per audit: `wallMs`, `workMs` (all self time added up, more than `wallMs` when work is parallel), `rows[]`, `pages[]`, `pools[]` |
| `node` | `cpu`, `heapMaxMb`, `loopBusy`, `lagMaxMs`, `gcMs`, `gcMaxMs` |
| `hints[]` | the hints shown in the terminal |

Keep it in CI to follow audit times across commits:

```sh
npx vidimus --profile -r pretty -r json:vidimus-report.json
```

## Comparing runs

Change something, profile again, and compare the two traces:

```sh
npx vidimus forms --profile                 # before
# … change forms.settle, sample, the site …
npx vidimus forms --profile                 # after
npx vidimus profile diff .vidimus/profile/<before>.trace.json .vidimus/profile/<after>.trace.json
```

```text
span                                                                 before     after    change
run                                                                   14.4s     11.1s     -3.3s
forms › (audit wall)                                                  14.4s     11.1s     -3.3s
forms › forms.settle                                                   9.5s      6.4s     -3.1s
forms › page.goto                                                      2.9s      2.7s    -225ms
forms › forms.case                                                    423ms     418ms      -5ms
```

Rows are self time per audit and span, largest changes first; `--top <n>` prints more. Timings
vary from run to run by a few percent: compare several runs before calling a small change a win.

## Your own spans

Custom audits get `span` on their [context](./plugins#the-run-context): wrap a step to see it
in the profile. Without `--profile` it just calls the function.

```ts
async run({ span, pageUrls }) {
  for (const url of pageUrls())
    await span('lorem.check', async () => {
      // …
    }, { url });
  return { summary: 'done' };
}
```

An attribute named `url` makes the span count towards that page in "slowest pages".

## Limits

- Requests made inside the browser are not spans of their own. Their time shows in the
  `page.goto` or `page.evaluate` that waits for them.
- Pages and tools that drive Chrome themselves are timed from the outside: pa11y as calls on the
  page it is given, Lighthouse through its own phase timings.
- The profiler costs a few microseconds per span. The summary prints the estimate as `profiler overhead`.
