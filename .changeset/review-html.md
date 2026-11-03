---
"vidimus": patch
---

HTML parsing: numeric character references without `;` decode; an unclosed comment or raw-text element runs to the end of the document; `<title>` text keeps markup-like text and non-breaking spaces; the `<meta>` charset prescan reads only `charset` and `http-equiv` content-type declarations and skips unknown labels; a UTF-8 BOM is dropped. Pathological unclosed tags and long `&` runs no longer take quadratic time.
