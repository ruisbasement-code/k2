// Things on the mountain that move or change under the climber: loose rock that
// crumbles, rocks and ice chunks bouncing down the slopes, and the trail of
// footprints that packs the snow. No rendering here, so tests can drive it.

import * as THREE from 'three';
import { tuning, surfaceAt } from './paceModel.js';

const DEG = 180 / Math.PI;

/** A stable 0..1 hash of a grid cell. */
function hash2(i, j) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Whether the rock at this spot is loose. Scree is mostly loose, solid rock sometimes. */
export function isLoose(x, z, surface) {
  const share = tuning.surfaces[surface]?.loose ?? 0;
  if (share <= 0) return false;
  const cell = tuning.loose_cell_m;
  return hash2(Math.floor(x / cell), Math.floor(z / cell)) < share;
}

/**
 * What a ledge is like underfoot. Most are sound. Some are glazed with verglas
 * (a thin skin of water ice, drawn glassy blue): treacherous without crampons.
 * Some have a rotten ice lip along their outer, downhill edge (drawn pale with a
 * dark crack): stand out on it and it can break away under you.
 */
export function ledgeKind(i, j) {
  const r = hash2(i - 4421, j + 7741);
  if (r < tuning.verglas_share) return 'verglas';
  if (r < tuning.verglas_share + tuning.rotten_lip_share) return 'rotten';
  return 'sound';
}

/**
 * How far out toward the downhill edge of a ledge (x, z) is: 0 at the centre or
 * on the uphill side, 1 at the very lip. gx, gz: the uphill gradient there.
 */
export function ledgeOut(ledge, x, z, gx, gz) {
  const g = Math.hypot(gx, gz);
  if (g < 1e-6) return 0;
  const down = ((ledge.x - x) * gx + (ledge.z - z) * gz) / g;
  // A ledge is drawn 1.9 times shorter down the slope than across it (terrain.js).
  return Math.max(0, Math.min(1, (down * 1.9) / tuning.ledge_radius_m));
}

/**
 * The ledge at this spot, if any: small terraces and steps on steep faces that the
 * elevation grid is too coarse to show. Returns {x, z (its centre), i, j (its
 * cell), kind (see ledgeKind)} or null.
 */
export function ledgeAt(x, z, slopeDeg) {
  const t = tuning;
  if (slopeDeg < t.ledge_min_deg || slopeDeg > t.ledge_max_deg) return null;
  const cell = t.ledge_cell_m;
  const i = Math.floor(x / cell), j = Math.floor(z / cell);
  if (hash2(i + 7919, j - 104729) >= t.ledge_share) return null;
  // Somewhere inside the cell, away from its edges.
  const room = cell / 2 - t.ledge_radius_m;
  const cx = (i + 0.5) * cell + (hash2(i, j + 31) - 0.5) * 2 * room;
  const cz = (j + 0.5) * cell + (hash2(i + 17, j) - 0.5) * 2 * room;
  return Math.hypot(x - cx, z - cz) <= t.ledge_radius_m ? { x: cx, z: cz, i, j, kind: ledgeKind(i, j) } : null;
}

/** Every ledge centre within radius of a point, for drawing. */
export function ledgesNear(hm, x, z, radius) {
  const t = tuning;
  const cell = t.ledge_cell_m;
  const out = [];
  const room = cell / 2 - t.ledge_radius_m;
  for (let i = Math.floor((x - radius) / cell); i <= Math.floor((x + radius) / cell); i++) {
    for (let j = Math.floor((z - radius) / cell); j <= Math.floor((z + radius) / cell); j++) {
      if (hash2(i + 7919, j - 104729) >= t.ledge_share) continue;
      const cx = (i + 0.5) * cell + (hash2(i, j + 31) - 0.5) * 2 * room;
      const cz = (j + 0.5) * cell + (hash2(i + 17, j) - 0.5) * 2 * room;
      if (Math.abs(cx) > hm.size / 2 - 50 || Math.abs(cz) > hm.size / 2 - 50) continue;
      const s = hm.slopeDeg(cx, cz);
      if (s >= t.ledge_min_deg && s <= t.ledge_max_deg) out.push({ x: cx, z: cz, slope: s, kind: ledgeKind(i, j) });
    }
  }
  return out;
}

/**
 * Footprints in the snow. Every step on snow treads its cell; trodden snow is
 * packed, so you sink less and move faster on your own trail.
 */
export class SnowTrail {
  constructor() {
    this.cells = new Map();
    /** Footprints for drawing: {x, z, yaw, left}. Oldest are dropped. */
    this.prints = [];
    this.onPrint = () => {};
  }

  _key(x, z) {
    const c = tuning.trail_cell_m;
    return `${Math.floor(x / c)},${Math.floor(z / c)}`;
  }

  tread(x, z, yaw, left) {
    const k = this._key(x, z);
    this.cells.set(k, (this.cells.get(k) ?? 0) + 1);
    const print = { x, z, yaw, left };
    this.prints.push(print);
    if (this.prints.length > tuning.max_footprints) this.prints.shift();
    this.onPrint(print);
  }

  /** How packed the snow is here, 0 (untouched) to 0.85 (a well-trodden trail). */
  packing(x, z) {
    const n = this.cells.get(this._key(x, z)) ?? 0;
    return n === 0 ? 0 : n === 1 ? 0.5 : 0.85;
  }
}

/**
 * Rocks and ice chunks falling down the terrain in real time. They bounce off the
 * slope, roll to a stop on gentle ground and can hit the climber.
 */
export class Rockfall {
  constructor(hm) {
    this.hm = hm;
    /** {position, velocity, size, ice, age} */
    this.rocks = [];
  }

  /** Let a rock go at a point, with a push. */
  release(position, velocity, size = 0.25, ice = false) {
    const rock = { position: position.clone(), velocity: velocity.clone(), size, ice, age: 0 };
    rock.position.y = Math.max(rock.position.y, this.hm.heightAt(rock.position.x, rock.position.z) + size);
    this.rocks.push(rock);
    return rock;
  }

  /**
   * Natural rock and ice fall somewhere up the slope above a point, if there is
   * a steep enough face there. Returns the rocks released.
   */
  releaseAbove(x, z, rng = Math.random) {
    const hm = this.hm;
    const p = new THREE.Vector3(x, 0, z);
    // Walk up the fall line to find a steep face 40-150 m above.
    const steps = 4 + Math.floor(rng() * 10);
    for (let i = 0; i < steps; i++) {
      const [gx, gz] = hm.gradient(p.x, p.z);
      const g = Math.hypot(gx, gz);
      if (g < 1e-3) return [];
      p.x += (gx / g) * 12;
      p.z += (gz / g) * 12;
    }
    p.y = hm.heightAt(p.x, p.z);
    const slope = hm.slopeDeg(p.x, p.z);
    if (slope < tuning.rockfall_source_deg) return [];
    const surface = surfaceAt(p.y, slope, hm.glacierAt(p.x, p.z));
    const ice = surface.key === 'ice' || surface.key === 'glacier';
    if (!ice && surface.key !== 'rock' && surface.key !== 'scree') return [];
    const n = 1 + Math.floor(rng() * 4);
    const out = [];
    for (let i = 0; i < n; i++) {
      const jitter = new THREE.Vector3((rng() - 0.5) * 6, 0.5, (rng() - 0.5) * 6);
      out.push(this.release(p.clone().add(jitter), new THREE.Vector3(0, 0, 0), 0.15 + rng() * 0.35, ice));
    }
    return out;
  }

  /**
   * Advance the rocks. Returns the hits on a body at `target` (its middle):
   * [{rock, speed}] for each rock that struck it this step.
   */
  step(dt, target = null) {
    const hm = this.hm;
    const t = tuning;
    const n = new THREE.Vector3();
    const hits = [];
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const h = dt / steps;
    for (const rock of this.rocks) {
      const p = rock.position;
      const v = rock.velocity;
      for (let i = 0; i < steps; i++) {
        v.y -= t.gravity * h;
        p.addScaledVector(v, h);
        hm.clampInside(p);
        const ground = hm.heightAt(p.x, p.z) + rock.size;
        if (p.y <= ground) {
          p.y = ground;
          hm.normalAt(p.x, p.z, n);
          const into = v.dot(n);
          if (into < 0) v.addScaledVector(n, -into * (1 + t.rock_bounce));
          const speed = v.length();
          if (speed > 1e-4) {
            const decel = t.rock_friction * t.gravity * n.y * h;
            v.multiplyScalar(Math.max(0, 1 - decel / speed));
          }
          rock.slope = Math.acos(Math.min(n.y, 1)) * DEG;
        }
        if (target && !rock.hit && p.distanceTo(target) < t.rock_hit_radius_m + rock.size) {
          rock.hit = true;
          hits.push({ rock, speed: v.length() });
        }
      }
      rock.age += dt;
    }
    // Rocks that stopped on gentle ground, or have been going a long time, are done.
    this.rocks = this.rocks.filter((r) => r.age < 40 && !(r.velocity.length() < 0.3 && (r.slope ?? 90) < 30 && r.age > 1));
    return hits;
  }
}
