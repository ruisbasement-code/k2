// Stamina and breathing for one climber.
//
// Stamina drains when effort is above what the climber can sustain and recovers
// below it, both in mountain time; thinner air drains it faster, refills it slower
// and caps it lower. The breath cycle runs in real time so it stays readable at
// any time scale.

import { tuning, oxygenRatio, oxygenVsReference } from './paceModel.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

export class ClimberBody {
  stamina = 100;
  exhausted = false;
  /** Breaths per minute. */
  breathRate = 14;
  /** Position in the current breath, 0 to 1 (inhale first). */
  breathPhase = 0;
  /** Set by the climber's physiology: illness, hunger and the death zone lower these. */
  capMult = 1;
  recoverMult = 1;

  step(dtHours, effort, altitude, dtReal) {
    const t = tuning;
    const o2 = oxygenVsReference(altitude);
    const sustain = t.sustainable_effort;
    if (effort > sustain) {
      this.stamina -= (t.drain_per_hour * (effort - sustain)) / Math.pow(o2, t.drain_o2_exponent) * dtHours;
    } else {
      this.stamina += t.recover_per_hour * this.recoverMult * Math.pow(o2, t.recover_o2_exponent) * ((sustain - effort) / sustain) * dtHours;
    }
    const cap = this.staminaCap(altitude);
    if (this.stamina > cap) {
      // Thin air slowly wears you down to what it allows.
      this.stamina = Math.max(cap, this.stamina - t.recover_per_hour * 0.25 * dtHours);
    }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0) this.exhausted = true;
    else if (this.exhausted && this.stamina >= t.exhausted_recover_to) this.exhausted = false;

    const thin = (1 - oxygenRatio(altitude)) / (1 - oxygenRatio(8611));
    let target = t.breath_rest + t.breath_altitude * thin + t.breath_effort * effort
      + t.breath_tired * (1 - this.stamina / 100);
    target = Math.min(target, t.breath_max);
    this.breathRate = lerp(this.breathRate, target, 1 - Math.exp(-dtReal * 0.8));
    this.breathPhase = (this.breathPhase + (dtReal * this.breathRate) / 60) % 1;
  }

  /** The most stamina the air at this altitude lets you recover to. */
  staminaCap(altitude) {
    const k = clamp((altitude - tuning.cap_start_altitude) / (8611 - tuning.cap_start_altitude), 0, 1);
    return lerp(100, tuning.summit_stamina_cap, k) * this.capMult;
  }

  /** Speed multiplier from how tired the climber is. 0 when exhausted. */
  speedFactor() {
    if (this.exhausted) return 0;
    if (this.stamina < tuning.tired_below) return lerp(tuning.tired_speed, 1, this.stamina / tuning.tired_below);
    return 1;
  }

  /** How hard the climber is breathing, 0 (calm) to 1 (gasping), for HUD and audio. */
  breathlessness() {
    return clamp((this.breathRate - 12) / 40, 0, 1);
  }
}
