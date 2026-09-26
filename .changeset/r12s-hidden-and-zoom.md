---
"vidimus": minor
---

r12s: elements that are not rendered (`display: none`, such as closed menus and popups) are no longer checked for tap target and font size; inline links inside a sentence are exempt from the tap target check, as in WCAG 2.2 success criterion 2.5.8, and a target is measured in whole pixels, so a 23.9px wide target shown as 24px is not reported; and a viewport with `maximum-scale` above 1 (`maximum-scale=1.5`) is no longer reported as disabling pinch zoom.
