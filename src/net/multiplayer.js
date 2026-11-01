// Playing K2 with friends. One player hosts (npm run host, see the README) and
// shares a join code; everyone who joins climbs the same mountain under the same
// weather and clock, sees the others, their flares, whistles and strobes, and the
// ropes they fix, and can help a teammate standing next to them: get them up
// when they've collapsed, patch them up with a first-aid kit, or hand over
// water, food, medicine, an oxygen bottle, hand warmers or a flare. Plus chat.
//
// Messages between games (the relay passes them on untouched):
//   state     where you are and how you look, ~10 times a second
//   signal    a flare, whistle or strobe (sim/signals.js)
//   rope      a line you fixed (world/sharedRopes.js)
//   help      help for one player (sim/teamwork.js), answered by help-ack
//   chat      {text}

import { Net, relayInfo } from './net.js';
import { escapeHtml } from './teammates.js';
import { helpOptions, takeForHelp, giveBack, receiveHelp, helpedText, mateInReach } from '../sim/teamwork.js';
import { compassPoint } from '../sim/signals.js';

const STATE_EVERY_S = 0.1;
const SESSION_KEY = 'k2.mp';
const r2 = (v) => Math.round(v * 100) / 100;

export class Multiplayer {
  /**
   * @param g the game: {climber, expedition, model, sharedRopes, teammates, hud,
   *   lamp(): headlamp colour or null, world(): {seed, start, time},
   *   setWorld(world), release(), relock()}
   */
  constructor(g) {
    this.g = g;
    this.net = new Net();
    this.available = false;
    this._sendT = 0;
    this._helpFor = null;
    this._retry = null;
    this._wanted = null;
    this._build();
    this.net.on('msg', (d, from) => this._msg(d, from));
    this.net.on('joined', (p) => this._joined(p));
    this.net.on('left', (p) => {
      this.g.teammates.remove(p.id);
      this.say(`${p.name} left the game`);
    });
    this.net.on('closed', () => this._lost());
    // Your flares, whistle, strobe and fixed ropes go to everyone.
    g.climber.signals.onEvent((e) => this.net.send(e));
    g.sharedRopes.onEvent = (e) => this.net.send(e);
  }

  get connected() {
    return this.net.connected;
  }

  /** The help menu or the chat box is open: the climber stands still and the mouse is free. */
  get busy() {
    return !this.helpEl.hidden || !this.chatIn.hidden;
  }

  // ---- Joining ----

  /** Show the join panel on the title screen if this page is served by a K2 host. */
  async init() {
    const info = await relayInfo();
    this.available = !!info;
    if (!info) return;
    const params = new URLSearchParams(location.search);
    const saved = readSession();
    this.panel.hidden = false;
    this.nameIn.value = saved?.name ?? load('k2.name') ?? '';
    this.codeIn.value = params.get('join') ?? saved?.room ?? info.code ?? '';
    // Back from a respawn (a reload): straight back into the same game.
    if (saved) this.join(saved.name, saved.room);
  }

  async join(name, code) {
    name = String(name || '').trim() || 'Climber';
    code = String(code || '').trim();
    if (!code) return this._status('Type the join code your host gave you', true);
    this._status('Joining…');
    this.joinBtn.disabled = true;
    try {
      const w = await this.net.join({ name, room: code, world: this.g.world() });
      this._wanted = { name, room: w.room };
      save('k2.name', name);
      writeSession({ name, room: w.room });
      // Everything you send is under the name the room knows you by.
      this.g.climber.signals.who = w.name;
      this.g.sharedRopes.who = w.name;
      this.g.setWorld(w.world);
      for (const p of w.players) this.g.teammates.add(p.id, p.name);
      const others = w.players.length;
      this._status(`In game ${w.room} as ${w.name} · ${others ? `${others} other${others > 1 ? 's' : ''} here` : 'nobody else here yet'}`);
      this.joinBtn.textContent = 'Joined';
      this.listEl.hidden = false;
      this.say(others ? `Joined ${w.room}: ${w.players.map((p) => p.name).join(', ')} ${others > 1 ? 'are' : 'is'} here` : `Joined ${w.room}. Waiting for friends`);
      this._sendState();
    } catch (e) {
      this.joinBtn.disabled = false;
      this._status(e.message, true);
      clearSession();
    }
  }

  _joined(p) {
    const g = this.g;
    g.teammates.add(p.id, p.name);
    this.say(`${p.name} joined the game`);
    // Catch them up: your ropes, your strobe if it's flashing, where you are.
    for (const e of g.sharedRopes.snapshot()) this.net.send(e, p.id);
    const s = g.climber.signals;
    const mine = s.strobes.get(s.who);
    if (mine) this.net.send({ type: 'signal', kind: 'strobe', by: s.who, on: true, at: { x: mine.x, y: mine.y, z: mine.z }, time: s.time }, p.id);
    this._sendState();
  }

  /** Lost the server: keep climbing alone, and keep trying to get back in. */
  _lost() {
    for (const m of this.g.teammates.list) this.g.teammates.remove(m.id);
    this.say('Lost the connection to the game. Reconnecting…');
    clearTimeout(this._retry);
    const again = async () => {
      if (this.connected || !this._wanted) return;
      try {
        await this.net.join({ name: this._wanted.name, room: this._wanted.room, world: this.g.world() });
        this.g.climber.signals.who = this.net.name;
        this.g.sharedRopes.who = this.net.name;
        for (const [id, name] of this.net.players) this.g.teammates.add(id, name);
        this.say('Back in the game');
      } catch {
        this._retry = setTimeout(again, 4000);
      }
    };
    this._retry = setTimeout(again, 2000);
  }

  // ---- Each frame ----

  update(dt) {
    if (!this.connected) return;
    this._sendT -= dt;
    if (this._sendT <= 0) {
      this._sendT = STATE_EVERY_S;
      this._sendState();
    }
    this._list();
    // The teammate you were helping walked off (or got up): close the menu.
    if (!this.helpEl.hidden) {
      const m = this.g.teammates.mates.get(this._helpFor);
      if (!m || !this._inReach(m)) this.closeHelp();
    }
  }

  _sendState() {
    const { climber: c, model } = this.g;
    if (!this.connected) return;
    const lp = model.lastPose;
    this.net.send({
      k: 'state',
      ms: Math.round(c.mountainSeconds),
      at: [r2(c.position.x), r2(c.position.y), r2(c.position.z)],
      p: model.position.toArray().map(r2),
      q: model.quaternion.toArray().map((v) => Math.round(v * 1e4) / 1e4),
      pose: lp ? { mode: lp.mode, phase: r2(lp.phase), moving: lp.moving, rise: r2(lp.rise), stride: r2(lp.stride), arrest: lp.arrest } : null,
      look: model.look ?? null,
      held: model.held,
      axe: !!c.axe?.have,
      lamp: this.g.lamp(),
      health: Math.round(c.health),
      maxHealth: Math.round(c.maxHealth),
      collapsed: c.collapsed ? r2(c.collapseHoursLeft) : null,
      dead: !!c.dead,
    });
  }

  _msg(d, from) {
    const g = this.g;
    const name = this.net.players.get(from) ?? 'A climber';
    if (d?.k === 'state') {
      const before = g.teammates.mates.get(from)?.state;
      g.teammates.receive(from, name, d);
      if (before && before.collapsed == null && d.collapsed != null) this.say(`${name} has collapsed ${this._where(d)}. Get to them and press Enter to help`);
      if (before && !before.dead && d.dead) this.say(`${name} died`);
    } else if (d?.type === 'signal') g.climber.signals.receive(d);
    else if (d?.type === 'rope') g.sharedRopes.receive(d);
    else if (d?.k === 'help') {
      const r = receiveHelp(g.climber, d.help, name);
      if (r.text) this.say(r.text);
      this.net.send({ k: 'help-ack', help: d.help, ok: r.ok }, from);
    } else if (d?.k === 'help-ack') {
      if (d.ok) this.say(helpedText(d.help?.act, name));
      else {
        giveBack(g.climber.pack, d.help);
        this.say(d.help?.act === 'revive' ? `${name} is already up` : `${name} couldn't take it: you keep it`);
      }
    } else if (d?.k === 'chat') this._chatLine(name, d.text);
  }

  /** Which way and how far a teammate is from you, e.g. "120 m NE, 40 m above". */
  _where(s) {
    const p = this.g.climber.position;
    const dx = s.at[0] - p.x, dy = s.at[1] - p.y, dz = s.at[2] - p.z;
    const d = Math.hypot(dx, dz);
    const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
    const far = d < 1000 ? `${Math.round(d / 10) * 10 || Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
    const up = Math.abs(dy) < 15 ? '' : `, ${Math.round(Math.abs(dy) / 10) * 10} m ${dy > 0 ? 'above' : 'below'}`;
    return `${far} ${compassPoint(bearing)}${up}`;
  }

  _inReach(m) {
    return !!mateInReach(this.g.climber.position, [m]);
  }

  // ---- Helping a teammate ----

  /** The teammate within reach you could help, or null. */
  mateHere() {
    const c = this.g.climber;
    if (!this.connected || c.dead || c.collapsed || c.falling) return null;
    return mateInReach(c.position, this.g.teammates.list);
  }

  /** For the HUD's key prompts: Enter to help the teammate beside you. */
  action() {
    const m = this.mateHere();
    if (!m) return null;
    return ['Enter', m.state.collapsed != null ? `Help ${m.name} up` : `Help ${m.name}`];
  }

  /** Enter: help the teammate beside you, or else open the chat. */
  enter() {
    if (!this.connected) return;
    const m = this.mateHere();
    if (m) this.openHelp(m);
    else this.openChat();
  }

  openHelp(m) {
    const opts = helpOptions(this.g.climber.pack, m.state);
    if (!opts.length) return this.say(`Nothing to give ${m.name}: your pack has nothing they could use`);
    this._helpFor = m.id;
    this._opts = opts;
    const s = m.state;
    const status = s.collapsed != null ? `collapsed, ${s.collapsed.toFixed(1)} h before the cold takes them` : `health ${s.health}/${s.maxHealth}`;
    this.helpEl.innerHTML = `<div class="card panel"><h2>Help ${escapeHtml(m.name)}</h2><p class="mate-status">${status}</p>${
      opts.map((o, i) => `<button data-i="${i}"><kbd>${i + 1}</kbd> ${o.label}${o.note ? `<small>${o.note}</small>` : ''}</button>`).join('')
    }<p class="hint"><kbd>Esc</kbd> close</p></div>`;
    for (const b of this.helpEl.querySelectorAll('button')) b.onclick = () => this.pickHelp(+b.dataset.i);
    this.helpEl.hidden = false;
    this.g.release();
  }

  closeHelp() {
    if (this.helpEl.hidden) return;
    this.helpEl.hidden = true;
    this._helpFor = null;
    this.g.relock();
  }

  /** A choice from the help menu (by the number keys or a click). */
  pickHelp(i) {
    const opt = this._opts?.[i];
    const m = this.g.teammates.mates.get(this._helpFor);
    this.closeHelp();
    if (!opt || !m || !this._inReach(m)) return;
    const help = takeForHelp(this.g.climber.pack, opt.act);
    if (!help) return;
    this.net.send({ k: 'help', help }, m.id);
    if (opt.act === 'revive') this.say(`You kneel by ${m.name} and rub them warm…`);
  }

  // ---- Chat ----

  openChat() {
    this.chatIn.hidden = false;
    this.chatIn.value = '';
    this.g.release();
    this.chatIn.focus();
  }

  closeChat() {
    if (this.chatIn.hidden) return;
    this.chatIn.hidden = true;
    this.chatIn.blur();
    this.g.relock();
  }

  _chatLine(name, text, mine = false) {
    const line = document.createElement('div');
    line.className = mine ? 'mine' : '';
    line.innerHTML = `<b>${escapeHtml(name)}</b> ${escapeHtml(String(text).slice(0, 200))}`;
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }

  /** A game message: on the HUD and in the chat log, so it isn't missed. */
  say(text) {
    this.g.hud.showMessage(text);
    const line = document.createElement('div');
    line.className = 'note';
    line.textContent = text;
    this.chatLog.appendChild(line);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }

  // ---- Screen ----

  _build() {
    const card = document.querySelector('#start .card');
    this.panel = el('div', { id: 'mp', hidden: true });
    this.panel.innerHTML = `<h2>Play with friends</h2>
      <div class="mp-row"><input id="mp-name" maxlength="16" placeholder="Your name" autocomplete="nickname"><input id="mp-code" maxlength="8" placeholder="Join code" autocomplete="off"><button id="mp-join" class="ghost">Join</button></div>
      <p id="mp-status"></p>`;
    card?.appendChild(this.panel);
    this.nameIn = this.panel.querySelector('#mp-name');
    this.codeIn = this.panel.querySelector('#mp-code');
    this.joinBtn = this.panel.querySelector('#mp-join');
    this.statusEl = this.panel.querySelector('#mp-status');
    this.joinBtn.onclick = () => this.join(this.nameIn.value, this.codeIn.value);
    for (const i of [this.nameIn, this.codeIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinBtn.click(); });

    this.listEl = el('div', { id: 'team', hidden: true });
    this.helpEl = el('div', { id: 'team-help', hidden: true });
    this.chatLog = el('div', { id: 'chat-log' });
    this.chatIn = el('input', { id: 'chat-in', hidden: true, maxLength: 200, placeholder: 'Say something to the team (Enter to send, Esc to cancel)' });
    this.chatIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.chatIn.value.trim();
        if (text && this.net.send({ k: 'chat', text })) this._chatLine(this.net.name, text, true);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    document.body.append(this.listEl, this.chatLog, this.chatIn, this.helpEl);
  }

  _status(text, bad = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('bad', bad);
  }

  /** The team list, top right: who's where, and who's in trouble. */
  _list() {
    const rows = [`<div class="team-head">Game ${escapeHtml(this.net.room)}</div>`];
    for (const m of this.g.teammates.list) {
      const s = m.state;
      if (!s) { rows.push(`<div class="mate">${escapeHtml(m.name)} <small>arriving…</small></div>`); continue; }
      const state = s.dead ? '<em>dead</em>' : s.collapsed != null ? `<em>collapsed · ${s.collapsed.toFixed(1)} h</em>` : `${s.health} hp`;
      rows.push(`<div class="mate${s.dead || s.collapsed != null ? ' down' : ''}">${escapeHtml(m.name)} <small>${this._where(s)} · ${state}</small></div>`);
    }
    if (rows.length === 1) rows.push('<div class="mate"><small>Nobody else here yet</small></div>');
    const html = rows.join('');
    if (html !== this._listHtml) this.listEl.innerHTML = this._listHtml = html;
  }
}

function el(tag, props) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  return e;
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function writeSession(v) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch { /* no rejoin after a respawn */ }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* nothing saved */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not saved */ }
}
