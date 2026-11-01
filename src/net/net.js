// The game's side of the multiplayer relay (server/relay.js): one WebSocket to
// the server that hosts the page, a join code, and plain-data messages to the
// rest of the room. Everything game-specific is in the messages' data.

/** The relay's address: the same server the page came from. */
export function relayUrl(loc = location) {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/mp`;
}

/** Whether this page is served by a K2 host (and the code, when you're on the host's own machine). */
export async function relayInfo() {
  try {
    const r = await fetch('/mp-info', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok ? j : null;
  } catch {
    return null;
  }
}

export class Net {
  constructor() {
    this.ws = null;
    /** Your id in the room, your name as the room sees it, the room's code. */
    this.id = null;
    this.name = null;
    this.room = null;
    /** Other players here: id -> name. */
    this.players = new Map();
    this._handlers = {};
  }

  get connected() {
    return this.ws?.readyState === 1 && !!this.id;
  }

  /** Listen: 'joined' ({id, name}), 'left' ({id, name}), 'msg' (data, from), 'closed'. */
  on(type, fn) {
    (this._handlers[type] ??= []).push(fn);
  }

  _fire(type, ...args) {
    for (const fn of this._handlers[type] ?? []) fn(...args);
  }

  /**
   * Join a room. Resolves with the welcome ({id, name, room, world, players}).
   * @param world {seed, start, time}: the weather and clock to share if you're first in
   */
  join({ name, room, world, url = relayUrl() }) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, room, world }));
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error("Can't reach the game server")); } };
      ws.onclose = () => {
        if (!settled) { settled = true; reject(new Error('The game server closed the connection')); }
        else if (this.id) { this.id = null; this._fire('closed'); }
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'error' && !settled) {
          settled = true;
          ws.close();
          reject(new Error(m.why));
        } else if (m.t === 'welcome') {
          settled = true;
          Object.assign(this, { id: m.id, name: m.name, room: m.room });
          this.players = new Map(m.players.map((p) => [p.id, p.name]));
          resolve(m);
        } else if (m.t === 'joined') {
          this.players.set(m.id, m.name);
          this._fire('joined', m);
        } else if (m.t === 'left') {
          this.players.delete(m.id);
          this._fire('left', m);
        } else if (m.t === 'msg') this._fire('msg', m.data, m.from);
      };
    });
  }

  /** Send data to everyone else in the room, or just to one player id. */
  send(data, to = null) {
    if (!this.connected) return false;
    this.ws.send(JSON.stringify(to ? { t: 'send', to, data } : { t: 'send', data }));
    return true;
  }

  leave() {
    this.ws?.close();
    this.ws = null;
    this.id = null;
  }
}
