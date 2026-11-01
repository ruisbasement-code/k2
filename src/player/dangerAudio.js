// The snowpack's warnings, synthesised: the dry crackle of a slab fracturing
// above you, the deep whumpf of a loaded slope settling underfoot, and the
// roar of a slide coming down. Panned toward where it happened so you can tell
// which way to run. Like the other sounds it starts from the start button.

export class DangerAudio {
  constructor() {
    this.muted = false;
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  /**
   * Play a cue from the climber.
   * @param cue {kind, at, strength}
   * @param camera the camera, to pan the sound toward where it came from
   */
  play(cue, camera) {
    if (!this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const out = this._panned(cue.at, camera);
    const s = Math.min(Math.max(cue.strength ?? 1, 0.15), 1);
    if (cue.kind === 'crack') this._crack(out, s);
    else if (cue.kind === 'whumpf') this._whumpf(out, s);
    else this._roar(out, s);
  }

  /** A stereo panner aimed at a point, left to right as the camera sees it. */
  _panned(at, camera) {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (at && camera && pan.pan) {
      const e = camera.matrixWorld.elements;
      // The camera's right vector is the first column of its world matrix.
      const dx = at.x - camera.position.x, dz = at.z - camera.position.z;
      const len = Math.hypot(dx, dz) || 1;
      pan.pan.value = Math.max(-0.85, Math.min(0.85, (dx * e[0] + dz * e[2]) / len));
    }
    pan.connect(ctx.destination);
    return pan;
  }

  /** A noise burst through a filter with a fast attack and an exponential tail. */
  _burst(out, t0, { type, freq, q = 0.8, level, attack = 0.002, decay, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random());
    src.stop(t0 + attack + decay + 0.05);
    return f;
  }

  /** A low sine that drops in pitch: the thump under a crack or whumpf. */
  _thump(out, t0, from, to, level, decay) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(level, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }

  /** A slab fracturing: one sharp report, then a run of dry crackles spreading out. */
  _crack(out, s) {
    const t = this.ctx.currentTime + 0.02;
    this._burst(out, t, { type: 'highpass', freq: 1800, level: 0.7 * s, decay: 0.08 });
    this._thump(out, t, 90, 38, 0.5 * s, 0.6);
    let at = t + 0.08;
    for (let i = 0; i < 14; i++) {
      at += 0.025 + Math.random() * 0.09;
      const fade = 1 - i / 16;
      this._burst(out, at, { type: 'bandpass', freq: 1200 + Math.random() * 2600, q: 2, level: (0.15 + Math.random() * 0.3) * s * fade, decay: 0.02 + Math.random() * 0.04 });
    }
  }

  /** The snowpack settling: a deep, muffled whumpf you feel more than hear. */
  _whumpf(out, s) {
    const t = this.ctx.currentTime + 0.02;
    this._burst(out, t, { type: 'lowpass', freq: 180, q: 0.5, level: 0.9 * s, attack: 0.03, decay: 0.45, rate: 0.5 });
    this._thump(out, t, 70, 32, 0.6 * s, 0.5);
  }

  /** A slide coming down: a low rumble that builds and rolls on for seconds. */
  _roar(out, s) {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const f = this._burst(out, t, { type: 'lowpass', freq: 140, q: 0.6, level: 0.8 * s, attack: 1.2, decay: 5 + 3 * s, rate: 0.35 });
    f.frequency.setValueAtTime(140, t);
    f.frequency.linearRampToValueAtTime(320 + 300 * s, t + 1.5);
    f.frequency.linearRampToValueAtTime(110, t + 7);
  }
}
