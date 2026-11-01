// Drawing distress signals: each flare a red star with a wide glow and a trail of
// sparks, drawn over the fog so it shows through cloud and snow from kilometres
// away, and lighting the snow under it red; each strobe a white flash. One light
// does the glow on the ground, for the nearest flare, so adding flares never
// changes the scene's lights (no shader rebuilds mid-game).

import * as THREE from 'three';
import { FLARE, STROBE, flarePosition } from '../sim/signals.js';

const MAX_FLARES = 12;
const MAX_STROBES = 8;
const TRAIL = 24; // sparks behind each flare
const TRAIL_STEP = 0.12; // seconds between them along the path

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function points(n, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const p = new THREE.Points(geo, material);
  p.frustumCulled = false;
  p.renderOrder = 10;
  return p;
}

export class SignalView extends THREE.Group {
  constructor() {
    super();
    const map = glowTexture();
    const mat = (size, attenuate, blending = THREE.AdditiveBlending) => new THREE.PointsMaterial({
      size, sizeAttenuation: attenuate, map, vertexColors: true,
      transparent: true, depthWrite: false, blending, fog: false, toneMapped: false,
    });
    // A halo some tens of metres wide, and a core that stays a few pixels wide however far.
    this.halo = points(MAX_FLARES + MAX_STROBES, mat(70, true));
    this.core = points(MAX_FLARES + MAX_STROBES, mat(18, false, THREE.NormalBlending));
    // A soft bloom of fixed screen size, so a far-off flare still reads as a glow.
    this.bloom = points(MAX_FLARES + MAX_STROBES, mat(70, false));
    this.bloom.geometry.attributes.position = this.halo.geometry.attributes.position;
    this.bloom.geometry.attributes.color = this.halo.geometry.attributes.color;
    this.sparks = points(MAX_FLARES * TRAIL, mat(5, false));
    this.core.renderOrder = 11; // the red star over its own glow
    this.add(this.halo, this.bloom, this.sparks, this.core);
    this.light = new THREE.PointLight(0xff3a24, 0, 900, 1);
    this.add(this.light);
  }

  /**
   * @param signals the Signals (sim)
   * @param t real seconds, for the flicker and the strobe flashes
   */
  update(signals, t) {
    const halo = this.halo.geometry, core = this.core.geometry, sparks = this.sparks.geometry;
    const hp = halo.attributes.position.array, hc = halo.attributes.color.array;
    const cp = core.attributes.position.array, cc = core.attributes.color.array;
    const sp = sparks.attributes.position.array, sc = sparks.attributes.color.array;
    let n = 0, s = 0;
    let brightest = null;
    const put = (x, y, z, r, g, b, k, cr, cg, cb) => {
      hp.set([x, y, z], n * 3); hc.set([r * k, g * k, b * k], n * 3);
      cp.set([x, y, z], n * 3); cc.set([cr, cg, cb], n * 3);
      n++;
    };
    for (const f of signals.flares.slice(-MAX_FLARES)) {
      const age = signals.time - f.start;
      const pos = flarePosition(f, age);
      // Flares flicker as they burn, and gutter out at the end.
      const fade = Math.min(1, (FLARE.burn - age) / 4, age / 0.3);
      const k = Math.max(0, fade * (0.8 + 0.2 * Math.sin(t * 31 + f.start) * Math.sin(t * 17)));
      put(pos.x, pos.y, pos.z, 0.9, 0.18, 0.1, k, 1, 0.3 + 0.25 * k, 0.2 + 0.15 * k);
      if (!brightest || k > brightest.k) brightest = { ...pos, k };
      // The trail: sparks along where it has just been, fading behind.
      for (let i = 1; i <= TRAIL && s < MAX_FLARES * TRAIL; i++) {
        const back = age - i * TRAIL_STEP;
        if (back < 0) break;
        const q = flarePosition(f, back);
        const j = (1 - i / TRAIL) * k * (q.rising ? 1 : 0.5);
        sp.set([q.x + Math.sin(i * 12.9 + t * 3) * 0.6, q.y, q.z + Math.cos(i * 7.3 + t * 3) * 0.6], s * 3);
        sc.set([j, j * 0.45, j * 0.25], s * 3);
        s++;
      }
    }
    // Strobes: a short white flash each period.
    for (const st of [...signals.strobes.values()].slice(0, MAX_STROBES)) {
      const phase = ((t - st.since) % STROBE.periodS) / STROBE.periodS;
      const k = phase < 0.08 ? 1 : 0;
      put(st.x, st.y + 1.5, st.z, 0.6, 0.7, 1, k * 0.5, k, k, k);
    }
    this.bloom.geometry.setDrawRange(0, n);
    for (const g of [halo, core]) {
      g.setDrawRange(0, n);
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
    }
    sparks.setDrawRange(0, s);
    sparks.attributes.position.needsUpdate = sparks.attributes.color.needsUpdate = true;
    // Red light on the snow under the brightest flare.
    if (brightest) this.light.position.set(brightest.x, brightest.y, brightest.z);
    this.light.intensity = brightest ? 300 * brightest.k : 0;
  }
}

/** Three blasts on a whistle, made up on the spot (no sound files). */
export function playWhistle(ctx, muted = false) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + 0.05;
  for (let i = 0; i < 3; i++) {
    const at = t0 + i * 1.0;
    const osc = ctx.createOscillator();
    const trill = ctx.createOscillator();
    const trillGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 3100;
    // The pea in the whistle warbles the pitch.
    trill.frequency.value = 38;
    trillGain.gain.value = 140;
    trill.connect(trillGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.03);
    gain.gain.setValueAtTime(0.12, at + 0.6);
    gain.gain.linearRampToValueAtTime(0, at + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at); trill.start(at);
    osc.stop(at + 0.75); trill.stop(at + 0.75);
  }
}
