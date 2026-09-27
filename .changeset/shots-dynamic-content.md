---
"vidimus": minor
---

`shots` handles pages that change on their own. `shots.freeze` (default on) seeds `Math.random`, drives `requestAnimationFrame` from a virtual clock and stops it after 30 frames, and stills videos and endless CSS animations before the screenshot. `shots.mask` paints CSS selectors flat black, and `shots.maskEmbeds` (default on) masks cross-origin iframes. WebGL runs on SwiftShader for the same output everywhere, a canvas whose WebGL context failed is logged, and a motion recording that never settles names the elements still moving.
