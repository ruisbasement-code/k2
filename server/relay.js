// The multiplayer relay: a WebSocket at /mp that groups players into rooms by a
// join code and passes each player's messages to the rest of the room. The games
// do all the simulating; the relay only knows who is in which room, the room's
// shared world (weather seed and mountain clock, from whoever joined first) and
// how to deliver a message to everyone or to one player.
//
//   client -> relay  {t:'hello', name, room, world?:{seed, start, time}}
//                    {t:'send', data, to?}        to: one player's id, or everyone
//   relay -> client  {t:'welcome', id, name, room, world, players:[{id, name}]}
//                    {t:'joined', id, name} / {t:'left', id, name}
//                    {t:'msg', from, data}
//                    {t:'error', why}

import { WebSocketServer } from 'ws';

/** Join codes: no 0/O or 1/I to mix up when reading one out. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 12;
const MAX_MESSAGE = 64 * 1024;

export function makeCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
  return s;
}

/** Tidy a join code as typed: case, spaces and dashes don't matter. */
export const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export class Relay {
  /**
   * @param codes join codes open from the start (more can be added with open())
   */
  constructor(codes = []) {
    /** code -> {code, members: [player], world} */
    this.rooms = new Map();
    this._next = 1;
    for (const c of codes) this.open(c);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
    this.wss.on('connection', (ws) => this._connect(ws));
  }

  /** Open a room for a join code; returns the code. */
  open(code = makeCode()) {
    code = cleanCode(code);
    if (!this.rooms.has(code)) this.rooms.set(code, { code, members: [], world: null });
    return code;
  }

  /** Serve /mp on an http(s) server; other upgrades (Vite's own reload socket) are left alone. */
  attach(server) {
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/mp')) return;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
    return this;
  }

  _connect(ws) {
    const player = { id: `p${this._next++}`, name: null, ws, room: null };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (!player.room) this._hello(player, m);
      else if (m.t === 'send') this._send(player, m);
    });
    ws.on('close', () => this._leave(player));
    ws.on('error', () => {});
  }

  _hello(p, m) {
    if (m?.t !== 'hello') return;
    const room = this.rooms.get(cleanCode(m.room));
    if (!room) return this._to(p, { t: 'error', why: 'No game with that code' });
    if (room.members.length >= MAX_PLAYERS) return this._to(p, { t: 'error', why: 'That game is full' });
    // Names are how players see each other (and key their ropes and signals): keep them unique.
    const base = String(m.name ?? '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 16) || 'Climber';
    let name = base;
    for (let i = 2; room.members.some((o) => o.name === name); i++) name = `${base} ${i}`;
    p.name = name;
    p.room = room;
    if (!room.members.length || !room.world) room.world = sanitizeWorld(m.world);
    room.members.push(p);
    this._to(p, { t: 'welcome', id: p.id, name, room: room.code, world: room.world, players: room.members.filter((o) => o !== p).map(({ id, name: n }) => ({ id, name: n })) });
    this._room(room, { t: 'joined', id: p.id, name }, p);
  }

  _send(p, m) {
    const room = p.room;
    // The room's clock follows the longest-standing player, for whoever joins next.
    if (room.members[0] === p && room.world && Number.isFinite(m.data?.ms)) room.world.time = m.data.ms;
    const out = { t: 'msg', from: p.id, data: m.data };
    if (m.to) {
      const q = room.members.find((o) => o.id === m.to);
      if (q) this._to(q, out);
    } else this._room(room, out, p);
  }

  _leave(p) {
    const room = p.room;
    if (!room) return;
    room.members = room.members.filter((o) => o !== p);
    p.room = null;
    this._room(room, { t: 'left', id: p.id, name: p.name });
    if (!room.members.length) room.world = null;
  }

  _room(room, msg, except = null) {
    const s = JSON.stringify(msg);
    for (const o of room.members) if (o !== except && o.ws.readyState === 1) o.ws.send(s);
  }

  _to(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  close() {
    for (const c of this.wss.clients) c.terminate();
    this.wss.close();
  }
}

function sanitizeWorld(w) {
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  return { seed: n(w?.seed, Math.floor(Math.random() * 1e9)), start: n(w?.start, 5 * 3600), time: n(w?.time, n(w?.start, 5 * 3600)) };
}
