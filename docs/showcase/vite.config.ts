import { defineConfig } from 'vite';

// Bundles three.js with the showcase script, so the page loads no code from a CDN.
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: '../public/showcase',
    emptyOutDir: false,
    lib: { entry: 'showcase.ts', formats: ['es'], fileName: () => 'showcase.js' },
    chunkSizeWarningLimit: 1000,
  },
});
