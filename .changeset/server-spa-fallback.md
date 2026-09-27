---
"vidimus": minor
---

The built-in server gets `server.fallback` and `server.fallbackStatus`: page requests that match no file are answered with a build file such as `index.html` or `404.html`, as single-page app hosts do, while missing assets still 404. It also sends proper content types for `.wasm`, `.glb`, `.gltf`, `.bin`, `.ktx2`, `.hdr`, `.exr`, `.map`, `.ogg`, `.mp3`, `.wav`, `.ttf` and `.otf`.
