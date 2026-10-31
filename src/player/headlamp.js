// The climber's headlamp: a spot light from the helmet that cycles through modes
// with L. It lights whatever you're looking at in first person, and where the
// head points in third person.

import * as THREE from 'three';

export const LAMP_MODES = [
  { name: 'Off' },
  { name: 'Regular', color: 0xfff1dc, intensity: 25, angle: 0.42, distance: 80 },
  { name: 'High beam', color: 0xf2f6ff, intensity: 160, angle: 0.24, distance: 180 },
  { name: 'Red (night vision)', color: 0xff2414, intensity: 9, angle: 0.62, distance: 35 },
  { name: 'Flashing', color: 0xfff1dc, intensity: 70, angle: 0.4, distance: 100, flash: true },
];

export class Headlamp {
  constructor(scene) {
    this.mode = 0;
    this.light = new THREE.SpotLight(0xffffff, 0, 80, 0.42, 0.5, 1.4);
    scene.add(this.light, this.light.target);
  }

  get current() {
    return LAMP_MODES[this.mode];
  }

  /** Next mode; returns its name. */
  cycle() {
    this.mode = (this.mode + 1) % LAMP_MODES.length;
    return this.current.name;
  }

  set(mode) {
    this.mode = Math.min(Math.max(mode | 0, 0), LAMP_MODES.length - 1);
  }

  /**
   * @param t seconds, for the flashing mode
   * @param from where the lamp is (world)
   * @param dir unit direction it points (world)
   * @returns the lamp's colour this frame, or null when dark (for the lens glow)
   */
  update(t, from, dir) {
    const m = this.current;
    // Flashing: a double blink every second, like a real headlamp's beacon mode.
    const lit = m.intensity && (!m.flash || (t % 1) < 0.07 || ((t % 1) > 0.16 && (t % 1) < 0.23));
    // Off is zero intensity, not an invisible light: changing the number of lights
    // in the scene would recompile every shader on each blink.
    this.light.intensity = 0;
    if (!lit) return null;
    this.light.color.setHex(m.color);
    this.light.intensity = m.intensity;
    this.light.angle = m.angle;
    this.light.distance = m.distance;
    this.light.position.copy(from);
    this.light.target.position.copy(from).add(dir);
    return m.color;
  }
}
