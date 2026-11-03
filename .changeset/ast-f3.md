---
"vidimus": patch
---

Images whose `width` or `height` does not parse as a number (such as `100%` or `auto`) now warn as lacking dimensions, per the HTML rules for parsing dimension values; `100px` counts as 100.
