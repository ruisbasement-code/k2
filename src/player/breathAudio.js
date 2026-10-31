// Procedural breathing: looping noise through a low-pass filter, shaped into
// inhale and exhale that follow the climber's breath rate. Louder and rougher the
// harder they breathe. Browsers only allow audio after a click, so start() is
// called from the start button.

export class BreathAudio {
  constructor(body) {
    this.body = body;
    this.muted = false;
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(ctx.destination);
    src.start();
  }

  update() {
    if (!this.ctx) return;
    const p = this.body.breathPhase;
    const hard = this.body.breathlessness();
    let env = 0;
    let freq = 600;
    if (p < 0.4) {
      env = Math.sin((p / 0.4) * Math.PI) * 0.7;
      freq = 500 + 500 * hard;
    } else if (p > 0.45 && p < 0.95) {
      env = Math.sin(((p - 0.45) / 0.5) * Math.PI);
      freq = 800 + 900 * hard;
    }
    const level = this.muted ? 0 : env * env * (0.04 + 0.22 * hard);
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level, t, 0.03);
    this.filter.frequency.setTargetAtTime(freq, t, 0.05);
  }
}
