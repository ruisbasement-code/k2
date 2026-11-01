// /mp-info: tells the game a multiplayer relay is here. The join code is filled in
// only for someone playing on the host's own machine, never through the tunnel.

export function isLocal(req) {
  const a = req.socket.remoteAddress ?? '';
  const proxied = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'];
  return !proxied && (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1');
}

export function mpInfo(req, res, code) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: true, code: isLocal(req) ? code : null }));
}
