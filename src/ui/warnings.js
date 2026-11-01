// Readable danger on screen. A frost edge creeps in from the corners of your
// vision as the cold gets to you and thaws away when you warm up; a marker
// points at a slope that has cracked above you (or a slide coming down) so you
// know which way not to be.

import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

/**
 * Ice crystals grown in from the edges of a canvas: fern-like branches,
 * thicker and denser toward the corners, clear in the middle.
 */
function frostTexture(w = 1280, h = 800) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  // A soft rime glaze around the rim.
  const rim = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  rim.addColorStop(0, 'rgba(220,238,255,0)');
  rim.addColorStop(0.65, 'rgba(220,238,255,0.12)');
  rim.addColorStop(0.85, 'rgba(228,242,255,0.35)');
  rim.addColorStop(1, 'rgba(240,248,255,0.7)');
  g.fillStyle = rim;
  g.fillRect(0, 0, w, h);
  g.lineCap = 'round';
  // Each fern: a gently curving stem with short, paired side needles at ~60°,
  // which grow their own smaller needles.
  const fern = (x, y, ang, len, width, depth) => {
    const steps = Math.max(3, Math.round(len / 7));
    const bend = (Math.random() - 0.5) * 0.06;
    g.strokeStyle = `rgba(232,244,255,${0.28 + 0.1 * depth})`;
    for (let i = 0; i < steps; i++) {
      const seg = len / steps;
      const nx = x + Math.cos(ang) * seg, ny = y + Math.sin(ang) * seg;
      g.lineWidth = width * (1 - (i / steps) * 0.7);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      if (depth > 0 && i > 0) {
        const side = len * 0.32 * (1 - i / steps) + 2;
        for (const s of [-1, 1]) if (Math.random() < 0.85) fern(nx, ny, ang + s * 1.05, side, width * 0.55, depth - 1);
      }
      x = nx; y = ny; ang += bend;
    }
  };
  for (let i = 0; i < 170; i++) {
    // Seeds hug the edges; each grows inward, roughly toward the middle.
    const edge = Math.floor(Math.random() * 4);
    const u = Math.random();
    const inset = Math.random() ** 2 * 0.1;
    const x = edge === 0 ? u * w : edge === 1 ? (1 - inset) * w : edge === 2 ? u * w : inset * w;
    const y = edge === 0 ? inset * h : edge === 1 ? u * h : edge === 2 ? (1 - inset) * h : u * h;
    const toward = Math.atan2(h / 2 - y, w / 2 - x) + (Math.random() - 0.5) * 1.8;
    const corner = Math.hypot(x / w - 0.5, y / h - 0.5) * 2; // 1 at the edges' middles, ~1.4 in the corners
    fern(x, y, toward, (40 + Math.random() * 80) * corner * corner, 1.4 + Math.random() * 1.2, 2);
  }
  // Frost blooms: small six-armed crystals scattered near the rim.
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = Math.hypot(x / w - 0.5, y / h - 0.5);
    if (r < 0.36) continue;
    const a0 = Math.random() * Math.PI;
    const size = 3 + Math.random() * 8;
    for (let k = 0; k < 6; k++) fern(x, y, a0 + (k * Math.PI) / 3, size, 0.9, 1);
  }
  // Fine sparkle of rime grains.
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = Math.hypot(x / w - 0.5, y / h - 0.5);
    if (Math.random() > (r - 0.25) * 3) continue;
    g.fillStyle = `rgba(245,250,255,${0.2 + Math.random() * 0.5})`;
    g.fillRect(x, y, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  return cv.toDataURL('image/png');
}

const LABELS = { crack: 'Slope cracking', roar: 'Avalanche' };

export class Warnings {
  constructor(climber) {
    this.climber = climber;
    this.frost = 0;
    /** The latest threat to point at: {kind, at, time}. */
    this.threat = null;
    this._v = new THREE.Vector3();
    const el = $('frost');
    el.style.backgroundImage = `url(${frostTexture()})`;
  }

  /** A cue from the climber: cracks and slides above you get a marker. */
  cue(c) {
    if (c.kind === 'crack' && c.strength > 0.2) this.threat = { kind: 'crack', at: c.at, time: 6 };
    else if (c.kind === 'roar' && c.above) this.threat = { kind: 'roar', at: c.at, time: 4 };
  }

  /** How cold you are for the frost edge, 0..1: your chill, or a cooling core. */
  coldness() {
    const ph = this.climber.phys;
    return clamp01(Math.max((ph.chill - 0.1) / 0.9, (36.4 - ph.core) / 3.4, ph.frostbite * 0.6));
  }

  update(dt, camera) {
    const c = this.climber;
    // Frost grows in slowly and thaws a little faster.
    const target = c.dead ? 0 : this.coldness();
    const rate = target > this.frost ? 0.25 : 0.5;
    this.frost += (target - this.frost) * (1 - Math.exp(-dt * rate * 3));
    const f = this.frost;
    const el = $('frost');
    el.style.setProperty('--inner', `${(78 - 52 * f).toFixed(1)}%`);
    el.style.setProperty('--tint', (0.22 * f).toFixed(3));
    el.style.opacity = f < 0.02 ? 0 : clamp01(f * 2.2).toFixed(3);

    this._marker(dt, camera);
  }

  /** Point at the threat: on it if it's in view, else at the screen's edge toward it. */
  _marker(dt, camera) {
    const m = $('threat');
    const t = this.threat;
    if (t) t.time -= dt;
    if (!t || t.time <= 0 || this.climber.dead) {
      m.classList.remove('on');
      this.threat = null;
      return;
    }
    const v = this._v.copy(t.at).project(camera);
    const behind = v.z > 1;
    let x = behind ? -v.x : v.x, y = behind ? -v.y : v.y;
    const inView = !behind && Math.abs(x) < 0.85 && Math.abs(y) < 0.8;
    if (!inView) {
      const k = Math.max(Math.abs(x) / 0.85, Math.abs(y) / 0.8, 1e-3);
      x /= k;
      y /= k;
    }
    const px = (x * 0.5 + 0.5) * innerWidth, py = (-y * 0.5 + 0.5) * innerHeight;
    m.style.transform = `translate(${px.toFixed(0)}px, ${py.toFixed(0)}px)`;
    m.querySelector('.arrow').style.transform = inView ? 'rotate(90deg)' : `rotate(${(-Math.atan2(y, x) * 180) / Math.PI}deg)`;
    m.querySelector('.label').textContent = LABELS[t.kind];
    m.classList.add('on');
    m.classList.toggle('edge', !inView);
    m.style.opacity = Math.min(1, t.time).toFixed(2);
  }
}
