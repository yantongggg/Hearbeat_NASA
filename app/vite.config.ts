import { defineConfig } from 'vite';

// `base` is relative so the build works at any path (GitHub Pages project site, artifact, local file server).
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
});
