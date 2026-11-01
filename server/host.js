// Host K2 for friends: serves the built game (dist/) and the multiplayer relay on
// one port, prints the join code, and with --tunnel opens a Cloudflare quick
// tunnel so friends anywhere can reach it.
//
//   npm run host            build, then serve on http://localhost:8787
//   npm run host:tunnel     the same, plus a public https://….trycloudflare.com link
//
// PORT and K2_CODE (a join code of your own) can be set in the environment.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Relay, makeCode } from './relay.js';
import { mpInfo } from './info.js';

const PORT = +(process.env.PORT || 8787);
const ROOT = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

const code = makeCodeFrom(process.env.K2_CODE);
const relay = new Relay([code]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/mp-info') return mpInfo(req, res, code);
  // Only files inside dist/, never anything above it.
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, path);
  if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    send(res, 404, 'Not found');
  }
});
relay.attach(server);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use. Close the other server, or pick another port: set PORT=8788 && npm run host\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, async () => {
  try { await stat(join(ROOT, 'index.html')); } catch {
    console.error('\nNo built game in dist/. Run "npm run build" first (npm run host does it for you).\n');
  }
  const lan = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('\n  K2 multiplayer is running\n');
  console.log(`  Join code:     ${code}`);
  console.log(`  On this PC:    http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Same Wi-Fi:    http://${ip}:${PORT}`);
  if (process.argv.includes('--tunnel')) tunnel();
  else console.log(`\n  For friends elsewhere, in another window run:\n    cloudflared tunnel --url http://localhost:${PORT}\n  and send them the https://….trycloudflare.com link it prints, plus the code.\n`);
});

/** A Cloudflare quick tunnel: no account needed; prints the public link when it's up. */
function tunnel() {
  console.log('\n  Opening a Cloudflare tunnel…');
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const watch = (buf) => {
    const m = !shown && String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m) return;
    shown = true;
    console.log(`\n  Send your friends this link:\n\n    ${m[0]}/?join=${code}\n\n  (or ${m[0]} and the code ${code})\n`);
  };
  cf.stdout.on('data', watch);
  cf.stderr.on('data', watch);
  cf.on('error', (e) => {
    if (e.code === 'ENOENT') {
      console.error('\n  cloudflared is not installed. Install it with:\n    winget install --id Cloudflare.cloudflared\n  then open a new Command Prompt and run npm run host:tunnel again.\n  (The game is still running for this PC and your Wi-Fi.)\n');
    } else console.error(e);
  });
  cf.on('exit', (c) => { if (c && shown) console.error(`  The tunnel closed (exit ${c}).`); });
  const stop = () => { cf.kill(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function makeCodeFrom(s) {
  const c = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c || makeCode();
}

function send(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(text);
}
