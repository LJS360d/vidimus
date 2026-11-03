---
"vidimus": patch
---

Budget sizes now use a precompressed sibling only when its codec matches `budget.compression` (`.gz` for gzip, `.br` for brotli), so the "gzipped", "brotli" and "raw" labels always describe the bytes measured.
