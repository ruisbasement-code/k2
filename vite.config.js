import { defineConfig } from 'vite';
import { Relay, makeCode } from './server/relay.js';
import { mpInfo } from './server/info.js';

/** The multiplayer relay on the dev and preview servers too, so `npm run dev` can play with friends. */
function multiplayer() {
  const setup = (server) => {
    if (!server.httpServer) return;
    const code = String(process.env.K2_CODE || makeCode()).toUpperCase();
    new Relay([code]).attach(server.httpServer);
    server.middlewares.use('/mp-info', (req, res) => mpInfo(req, res, code));
    server.httpServer.once('listening', () => console.log(`  K2 multiplayer join code: ${code}`));
  };
  return { name: 'k2-multiplayer', configureServer: setup, configurePreviewServer: setup };
}

// GitHub Pages serves the game from /k2/; everywhere else it lives at the root.
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/k2/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  server: { open: !process.env.CI },
  plugins: [multiplayer()],
});
