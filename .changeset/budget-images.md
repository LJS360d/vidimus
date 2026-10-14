---
'vidimus': patch
---

budget: check every srcset and picture source against `budget.image`, key srcset-only dimension findings on their url, count one font file per `@font-face`, require exact files for assets, brotli at quality 5; assets: accept `apple-touch-icon-precomposed`.

Srcset-only dimension findings are keyed by url and fonts are counted per face, so their messages change: regenerate existing baselines.
