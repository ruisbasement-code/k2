// Avalanches: a slab of snow breaks away on a slope between about 28° and 50°
// and pours down the fall line as a wide stream of debris, following the
// terrain, until it runs out on gentler ground. Natural slides start somewhere
// above the climber; crossing a loaded slope can set one off underfoot. No
// rendering here, so tests can drive it.

import * as THREE from 'three';
import { tuning, surfaceAt } from './paceModel.js';
import { weatherTuning as W } from './weather.js';

const DEG = 180 / Math.PI;
const SNOW = new Set(['soft_snow', 'firm_snow', 'crust', 'slush']);

/** Whether a slab can break away here: open snow at avalanche angles. */
export function isSlabSlope(hm, x, z, hour = null) {
  const slope = hm.slopeDeg(x, z);
  if (slope < W.slab_min_deg || slope > W.slab_max_deg) return false;
  const y = hm.heightAt(x, z);
  if (y < 5200) return false;
  // Ice and rock faces between snow angles still hold snow after a fall.
  const key = surfaceAt(y, slope, hm.glacierAt(x, z), hour).key;
  return SNOW.has(key) || key === 'ice';
}

export class Avalanches {
  constructor(hm) {
    this.hm = hm;
    /** Slides: {blobs: [{position, velocity, size, stopped}], age, width, origin} */
    this.slides = [];
  }

  /**
   * Release a slab with its crown at (x, z). Returns the slide, or null if the
   * ground there cannot slide.
   */
  release(x, z, width = 50, rng = Math.random) {
    const hm = this.hm;
    const [gx, gz] = hm.gradient(x, z);
    const g = Math.hypot(gx, gz);
    if (g < 0.2) return null;
    const down = new THREE.Vector3(-gx / g, 0, -gz / g);
    const across = new THREE.Vector3(-down.z, 0, down.x);
    const blobs = [];
    const n = W.blobs;
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1) - 0.5) * width + (rng() - 0.5) * 4;
      const back = rng() * 25;
      const p = new THREE.Vector3(x, 0, z).addScaledVector(across, s).addScaledVector(down, back);
      hm.clampInside(p);
      p.y = hm.heightAt(p.x, p.z) + 0.5;
      const v = down.clone().multiplyScalar(2 + rng() * 2);
      v.y = -g * v.length();
      blobs.push({ position: p, velocity: v, size: 2.5 + rng() * 2.5, stopped: false });
    }
    const slide = { blobs, age: 0, width, origin: new THREE.Vector3(x, hm.heightAt(x, z), z), caught: false };
    this.slides.push(slide);
    return slide;
  }

  /**
   * Find a slab somewhere above a point, up the fall line and a little to the
   * side, and release it. Returns the slide or null if nothing above can slide.
   */
  releaseAbove(x, z, hour = null, rng = Math.random) {
    const hm = this.hm;
    for (let attempt = 0; attempt < 4; attempt++) {
      const p = new THREE.Vector3(x + (rng() - 0.5) * 160, 0, z + (rng() - 0.5) * 160);
      const steps = 5 + Math.floor(rng() * 25);
      for (let i = 0; i < steps; i++) {
        const [gx, gz] = hm.gradient(p.x, p.z);
        const g = Math.hypot(gx, gz);
        if (g < 1e-3) break;
        p.x += (gx / g) * 15;
        p.z += (gz / g) * 15;
      }
      hm.clampInside(p, 60);
      if (!isSlabSlope(hm, p.x, p.z, hour)) continue;
      const [w0, w1] = W.slab_width_m;
      return this.release(p.x, p.z, w0 + (w1 - w0) * rng(), rng);
    }
    return null;
  }

  /** Debris near a point: the nearest moving blob within radius, or null. */
  nearestMoving(point, radius) {
    let best = null;
    let bestD = radius;
    for (const s of this.slides) {
      for (const b of s.blobs) {
        if (b.stopped) continue;
        const d = b.position.distanceTo(point);
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    return best;
  }

  get active() {
    return this.slides.length > 0;
  }

  /**
   * Advance the debris in real seconds. Returns the blob that reached `target`
   * this step (the first slide to reach it), or null.
   */
  step(dt, target = null) {
    const hm = this.hm;
    const n = new THREE.Vector3();
    const steps = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / steps;
    let hit = null;
    for (const slide of this.slides) {
      slide.age += dt;
      for (const b of slide.blobs) {
        if (b.stopped) continue;
        const p = b.position;
        const v = b.velocity;
        for (let i = 0; i < steps; i++) {
          v.y -= tuning.gravity * h;
          p.addScaledVector(v, h);
          hm.clampInside(p);
          const ground = hm.heightAt(p.x, p.z) + 0.5;
          if (p.y <= ground) {
            p.y = ground;
            hm.normalAt(p.x, p.z, n);
            const into = v.dot(n);
            if (into < 0) v.addScaledVector(n, -into);
            const speed = v.length();
            if (speed > 1e-4) {
              // Snow debris runs on a low friction and slows with air and churn.
              const decel = (W.debris_friction * tuning.gravity * n.y + W.debris_drag * speed * speed) * h;
              v.multiplyScalar(Math.max(0, 1 - decel / speed));
            }
            b.slope = Math.acos(Math.min(n.y, 1)) * DEG;
          }
        }
        if (v.length() < 0.5 && (b.slope ?? 90) < 25) b.stopped = true;
        b.size = Math.min(b.size + v.length() * dt * 0.05, 9);
        if (target && !slide.caught && p.distanceTo(target) < W.catch_radius_m + b.size * 0.3) {
          slide.caught = true;
          hit = b;
        }
      }
    }
    this.slides = this.slides.filter((s) => s.age < 120 && s.blobs.some((b) => !b.stopped));
    return hit;
  }
}
