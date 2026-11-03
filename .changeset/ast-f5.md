---
"vidimus": patch
---

AVIF dimensions no longer come from an arbitrary `ispe` box when the primary item has none; the image is reported as unsized instead, per the AVIF/HEIF spec.
