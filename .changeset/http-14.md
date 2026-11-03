---
"vidimus": patch
---

Links audit no longer reports a link as `ERR` when its `#fragment` has malformed percent-encoding, as browsers accept such links per WHATWG HTML; the page itself is still checked, so `/missing/#%E0%A4%A` reports `404`.
