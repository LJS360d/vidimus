import { defineConfig } from 'vite';

// Bundles the three.js showcase script, so the page loads no code from a CDN. three.js is its own
// chunk, imported only when the scene nears the viewport.
export default defineConfig({
  root: import.meta.dirname,
  base: '/vidimus/showcase/',
  build: {
    outDir: '../public/showcase',
    emptyOutDir: false,
    modulePreload: false,
    rolldownOptions: {
      input: 'showcase.ts',
      preserveEntrySignatures: 'allow-extension',
      output: { entryFileNames: 'showcase.js', chunkFileNames: '[name].[hash].js' },
    },
    chunkSizeWarningLimit: 1000,
  },
});
