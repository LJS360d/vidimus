import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  base: '/vidimus/react/',
  plugins: [react()],
  build: { outDir: '../dist/react', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
