import { defineConfig } from 'vite';

// GitHub Pages serves the game from /k2/; everywhere else it lives at the root.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/k2/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  server: { open: !process.env.CI },
});
