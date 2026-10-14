// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const waitForStylesFontsAndImages = async (budget: number) => {
  const deadline = new Promise((done) => setTimeout(done, budget));
  // Eager and sync: a lazy image never loads below the fold, and an async one can be left out
  // of the paint when the full-page screenshot grows the viewport.
  for (const img of document.images) {
    img.loading = 'eager';
    img.decoding = 'sync';
  }
  // decode() on an image whose request has not started yet rejects at once: wait for load first.
  const pendingImages = [...document.images]
    .filter((img) => !img.complete)
    .map((img) =>
      new Promise((done) => {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }).then(() => img.decode().catch(() => {})),
    );
  // Stylesheets a script added after load, as client-rendered pages do, may still be loading.
  const sheets = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]')]
    .filter((link) => !link.sheet && !link.disabled)
    .map(
      (link) =>
        new Promise((done) => {
          link.addEventListener('load', done, { once: true });
          link.addEventListener('error', done, { once: true });
        }),
    );
  await Promise.race([Promise.all(sheets), deadline]);
  const fonts = Promise.all([...document.fonts].map((face) => face.load().catch(() => {})));
  await Promise.race([fonts.then(() => document.fonts.ready), deadline]);
  await Promise.race([Promise.all(pendingImages), deadline]);
};
/* node:coverage enable */

export const FROZEN_FRAMES = 30;

export const WEBGL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

interface Instrumented {
  settled: () => boolean;
  lastRequest: number;
  glFailures: string[];
}

// Runs before any page script. Records WebGL contexts that fail and, with freeze, makes rAF
// scenes deterministic: seeded Math.random, a virtual clock, and no frames after the limit.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const instrument = (freeze: boolean, limit: number) => {
  const describe = (node: Element) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : node.classList[0] ? `.${node.classList[0]}` : '');
  const clock = performance.now.bind(performance);
  const state: Instrumented = { settled: () => true, lastRequest: 0, glFailures: [] };
  Object.defineProperty(window, '__vidimus', { value: state });

  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    const context = (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    if (!context && /webgl/i.test(type)) state.glFailures.push(describe(this));
    return context;
  } as typeof getContext;

  const raf = window.requestAnimationFrame.bind(window);
  if (!freeze) {
    window.requestAnimationFrame = (callback) => {
      state.lastRequest = clock();
      return raf(callback);
    };
    return;
  }

  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Every call moves the clock a little, so busy-wait loops still end.
  let virtual = 0;
  performance.now = () => {
    virtual += 0.001;
    return virtual;
  };
  let frames = 0;
  let lastFrame = -1;
  window.requestAnimationFrame = (callback) => {
    state.lastRequest = clock();
    return raf((timestamp) => {
      if (timestamp !== lastFrame) {
        lastFrame = timestamp;
        frames += 1;
        virtual = Math.max(virtual, (frames * 1000) / 60);
      }
      if (frames <= limit) callback(virtual);
    });
  };
  state.settled = () => frames >= limit || clock() - state.lastRequest > 200;
};
/* node:coverage enable */

// Stops what freeze cannot reach from script: video frames and endless CSS animations.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const stillMedia = async () => {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming().iterations !== Infinity) continue;
    animation.pause();
    animation.currentTime = 0;
  }
  await Promise.all(
    [...document.querySelectorAll('video')].map(async (video) => {
      video.pause();
      const settle = (event: string, start: () => void) =>
        new Promise((done) => {
          video.addEventListener(event, done, { once: true });
          setTimeout(done, 1000);
          start();
        });
      // The controls show the duration only once metadata is in, which preload="none" leaves
      // to chance; the poster stays up until playback.
      if (video.readyState < HTMLMediaElement.HAVE_METADATA && video.preload === 'none')
        await settle('loadedmetadata', () => {
          video.preload = 'metadata';
          video.load();
        });
      if (video.currentTime !== 0) await settle('seeked', () => (video.currentTime = 0));
    }),
  );
};
/* node:coverage enable */

// Paints masked elements a flat colour in place, so the layout stays as it is.
// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const maskElements = (selectors: string[], embeds: boolean) => {
  const invalid: string[] = [];
  const masked: Element[] = [];
  for (const selector of selectors) {
    try {
      masked.push(...document.querySelectorAll(selector));
    } catch {
      invalid.push(selector);
    }
  }
  if (embeds) {
    for (const frame of document.querySelectorAll('iframe[src]')) {
      try {
        const src = new URL(frame.getAttribute('src') ?? '', document.baseURI);
        if (src.origin !== location.origin) masked.push(frame);
      } catch {}
    }
  }
  // Through CSSOM, not a <style> element: a page's CSP can block injected stylesheets.
  for (const node of masked) {
    if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
    node.style.setProperty('filter', 'brightness(0)', 'important');
    node.style.setProperty('background', '#000', 'important');
    node.style.setProperty('animation', 'none', 'important');
  }
  return invalid;
};
/* node:coverage enable */

// Runs in the browser: the browser tests exercise it, Node coverage cannot see it.
/* node:coverage disable */
export const movingElements = () => {
  const describe = (node: Element) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : node.classList[0] ? `.${node.classList[0]}` : '');
  const found = new Set<string>();
  for (const animation of document.getAnimations()) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (animation.playState === 'running' && target) found.add(describe(target));
  }
  for (const video of document.querySelectorAll('video'))
    if (!video.paused) found.add(describe(video));
  const state = (window as unknown as { __vidimus?: Instrumented }).__vidimus;
  if (state && performance.now() - state.lastRequest < 500) {
    for (const canvas of document.querySelectorAll('canvas')) found.add(describe(canvas));
  }
  return [...found].slice(0, 3);
};
/* node:coverage enable */

/* node:coverage disable */
export const isSettled = () =>
  (window as unknown as { __vidimus?: Instrumented }).__vidimus?.settled() ?? true;
export const glFailuresOf = () =>
  (window as unknown as { __vidimus?: Instrumented }).__vidimus?.glFailures ?? [];
export const pageHeight = () => document.documentElement.scrollHeight;
/* node:coverage enable */
