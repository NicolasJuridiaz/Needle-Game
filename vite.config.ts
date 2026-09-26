import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (CrazyGames requires relative paths).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
