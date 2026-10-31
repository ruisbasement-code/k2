// The wind: looping noise through a band-pass filter whose loudness and pitch
// follow the gusts, from a low murmur to the roar of a storm. Like the
// breathing, it starts from the start button because browsers need a click.

export class WindAudio {
  constructor() {
    this.muted = false;
    this.ctx = null;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise: deeper and softer than white noise.
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = 0.9;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(ctx.destination);
    src.start();
  }

  /** @param conditions the climber's weather conditions, or null */
  update(conditions) {
    if (!this.ctx || !conditions) return;
    const g = Math.min(conditions.gust / 30, 1.2);
    const level = this.muted ? 0 : 0.02 + 0.35 * g * g;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level, t, 0.25);
    this.filter.frequency.setTargetAtTime(250 + 900 * g, t, 0.3);
  }
}
