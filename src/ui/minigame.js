// Short hands-on jobs with cold fingers: staking a tent, driving a picket,
// twisting in an ice screw, digging a snow cave, lighting the stove. Each is a
// few seconds long and gets harder with wind, cold, frostbite and injury
// (difficulty 0..1). start() resolves true on success, false on a fail or Esc.

const W = 300, H = 74;

const KINDS = {
  /** A marker sweeps a bar; hit Space while it's in the green. One hit per stake. */
  tent: { title: 'Stake the tent', mode: 'timing', hits: 4, misses: 3, keys: ['Space'] },
  picket: { title: 'Drive the picket', mode: 'timing', hits: 3, misses: 3, keys: ['Space'] },
  /** Alternate A and D in time to turn the screw in before it backs out. */
  screw: { title: 'Twist in the screw', mode: 'twist', turns: 10, keys: ['A', 'D'] },
  cave: { title: 'Dig the snow cave', mode: 'twist', turns: 16, keys: ['A', 'D'] },
  /** Hold Space to pump, let go in the green to light it. */
  stove: { title: 'Light the stove', mode: 'pump', keys: ['Space'] },
};

export class Minigame {
  constructor(el) {
    this.el = el;
    this.active = null;
    addEventListener('keydown', (e) => this._key(e, true), true);
    addEventListener('keyup', (e) => this._key(e, false), true);
  }

  get busy() {
    return !!this.active;
  }

  start(kind, difficulty = 0) {
    if (this.active) return Promise.resolve(false);
    const k = KINDS[kind];
    const d = Math.min(Math.max(difficulty, 0), 1);
    const g = {
      kind, ...k, d, t: 0, done: 0, missed: 0, flash: 0, flashColor: '',
      // timing: marker position 0..1 bouncing, a zone that moves each hit.
      pos: 0, dir: 1, speed: 0.75 + 1.1 * d, zone: 0.24 - 0.14 * d, zoneAt: 0.5,
      // twist: progress decays; each correct alternate key turns it in.
      progress: 0, want: 'A', decay: 0.07 + 0.22 * d,
      // pump: pressure rises while held, the green window is narrow in the cold.
      pressure: 0, holding: false, win: [0.62 + 0.06 * d, 0.8 - 0.04 * d],
    };
    g.zoneAt = 0.2 + Math.random() * 0.6;
    this.el.innerHTML = `<div class="mini-title">${k.title}</div><canvas width="${W * 2}" height="${H * 2}"></canvas>
      <div class="mini-keys">${k.keys.map((x) => `<kbd>${x}</kbd>`).join(' ')}<span>${k.mode === 'pump' ? 'hold, release in the green' : k.mode === 'twist' ? 'alternate' : 'in the green'}</span></div>`;
    this.el.hidden = false;
    this.ctx = this.el.querySelector('canvas').getContext('2d');
    this.ctx.scale(2, 2);
    this.active = g;
    return new Promise((resolve) => {
      g.resolve = resolve;
      let last = performance.now();
      const tick = (now) => {
        if (this.active !== g) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        this._step(g, dt);
        this._draw(g);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  _end(ok) {
    const g = this.active;
    if (!g) return;
    g.flash = 1;
    g.flashColor = ok ? '#6fcf8a' : '#ff6a55';
    this._draw(g);
    this.active = null;
    setTimeout(() => { if (!this.active) this.el.hidden = true; }, ok ? 350 : 600);
    g.resolve(ok);
  }

  _key(e, down) {
    const g = this.active;
    if (!g) return;
    if (['Space', 'KeyA', 'KeyD', 'Escape', 'Tab'].includes(e.code) || down) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (down && e.code === 'Escape') return this._end(false);
    if (e.repeat) return;
    if (g.mode === 'timing' && down && e.code === 'Space') {
      const hit = Math.abs(g.pos - g.zoneAt) < g.zone / 2;
      g.flash = 1;
      g.flashColor = hit ? '#6fcf8a' : '#ff6a55';
      if (hit) {
        g.done++;
        g.zoneAt = 0.15 + Math.random() * 0.7;
        if (g.done >= g.hits) this._end(true);
      } else if (++g.missed >= g.misses) this._end(false);
    } else if (g.mode === 'twist' && down && (e.code === 'KeyA' || e.code === 'KeyD')) {
      const key = e.code === 'KeyA' ? 'A' : 'D';
      if (key === g.want) {
        g.progress += 1 / g.turns;
        g.want = key === 'A' ? 'D' : 'A';
        if (g.progress >= 1) this._end(true);
      } else {
        // Out of rhythm: the screw skips back a little.
        g.progress = Math.max(0, g.progress - 0.5 / g.turns);
        g.flash = 0.6;
        g.flashColor = '#ff6a55';
      }
    } else if (g.mode === 'pump' && e.code === 'Space') {
      if (down) g.holding = true;
      else if (g.holding) {
        g.holding = false;
        const [a, b] = g.win;
        if (g.pressure >= a && g.pressure <= b) this._end(true);
        else if (g.pressure > 0.08) {
          g.missed++;
          g.flash = 1;
          g.flashColor = '#ff6a55';
          g.pressure = 0;
          if (g.missed >= 3) this._end(false);
        }
      }
    }
  }

  _step(g, dt) {
    g.t += dt;
    g.flash = Math.max(0, g.flash - dt * 3);
    // Wind makes everything wander.
    const gust = g.d * (Math.sin(g.t * 3.1) * 0.6 + Math.sin(g.t * 7.3) * 0.4);
    if (g.mode === 'timing') {
      g.pos += g.dir * g.speed * dt * (1 + 0.6 * gust);
      if (g.pos > 1) { g.pos = 1; g.dir = -1; }
      if (g.pos < 0) { g.pos = 0; g.dir = 1; }
    } else if (g.mode === 'twist') {
      g.progress = Math.max(0, g.progress - g.decay * dt);
      if (g.t > 12) this._end(false);
    } else if (g.mode === 'pump') {
      if (g.holding) g.pressure = Math.min(1, g.pressure + dt * (0.55 + 0.25 * g.d) * (1 + 0.5 * gust));
      else g.pressure = Math.max(0, g.pressure - dt * 0.4);
      if (g.pressure >= 1) {
        g.holding = false;
        g.pressure = 0;
        g.missed++;
        g.flash = 1;
        g.flashColor = '#ff6a55';
        if (g.missed >= 3) this._end(false);
      }
    }
  }

  _draw(g) {
    const x = this.ctx;
    x.clearRect(0, 0, W, H);
    const track = (y, h) => { x.fillStyle = 'rgba(255,255,255,.12)'; roundRect(x, 10, y, W - 20, h, h / 2); x.fill(); };
    if (g.mode === 'timing') {
      track(26, 14);
      x.fillStyle = 'rgba(111,207,138,.75)';
      const zw = g.zone * (W - 20);
      roundRect(x, 10 + g.zoneAt * (W - 20) - zw / 2, 26, zw, 14, 7);
      x.fill();
      x.fillStyle = '#fff';
      x.fillRect(10 + g.pos * (W - 20) - 2, 18, 4, 30);
      this._pips(g.hits, g.done, g.misses - g.missed);
    } else if (g.mode === 'twist') {
      const cx = W / 2, cy = 36, r = 24;
      x.lineWidth = 7;
      x.strokeStyle = 'rgba(255,255,255,.12)';
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = '#8fd0ff';
      x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + g.progress * Math.PI * 2); x.stroke();
      x.fillStyle = '#fff';
      x.font = '600 15px system-ui';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(g.want, cx, cy + 1);
      x.fillStyle = 'rgba(255,255,255,.5)';
      x.fillRect(10, H - 6, (W - 20) * Math.max(0, 1 - g.t / 12), 2);
    } else {
      track(26, 14);
      const [a, b] = g.win;
      x.fillStyle = 'rgba(111,207,138,.75)';
      x.fillRect(10 + a * (W - 20), 26, (b - a) * (W - 20), 14);
      x.fillStyle = g.pressure > b ? '#ff8a3d' : '#ffd98a';
      roundRect(x, 10, 29, Math.max(8, g.pressure * (W - 20)), 8, 4);
      x.fill();
      this._pips(0, 0, 3 - g.missed);
    }
    if (g.flash > 0) {
      x.globalAlpha = g.flash * 0.35;
      x.fillStyle = g.flashColor;
      x.fillRect(0, 0, W, H);
      x.globalAlpha = 1;
    }
  }

  /** Dots for jobs done, and the tries you have left. */
  _pips(total, done, left) {
    const x = this.ctx;
    for (let i = 0; i < total; i++) {
      x.fillStyle = i < done ? '#6fcf8a' : 'rgba(255,255,255,.2)';
      x.beginPath(); x.arc(14 + i * 12, 62, 4, 0, 7); x.fill();
    }
    for (let i = 0; i < left; i++) {
      x.fillStyle = 'rgba(255,106,85,.8)';
      x.beginPath(); x.arc(W - 14 - i * 12, 62, 3, 0, 7); x.fill();
    }
  }
}

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.roundRect(X, Y, w, h, r);
}
