---
"vidimus": patch
---

`r12s` now detects horizontal overflow at mobile widths: under mobile emulation the check measured a viewport that grew with the content, so overflow below 768px was never reported. Overflow findings no longer list elements clipped by a scrolling box or off the start edge of the page, and suggest `aspect-ratio` sizing when an iframe or video causes it.
