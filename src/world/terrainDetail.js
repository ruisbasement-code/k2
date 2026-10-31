// Small-scale relief on top of the 31 m elevation grid: rock blocks and steps on
// faces, boulders on scree and moraine, rubble stripes and ice hummocks on the
// glaciers, and wind-carved sastrugi on snow. The climber stands on and collides
// with exactly this surface (Heightmap.groundAt), and the patch of terrain drawn
// around the climber (detailPatch.js) is built from it, so what you see is solid.
//
// It also decides where the glaciers' moraine stripes run (moraineAt), for the
// terrain shading as well as the relief.

import { smooth } from './heightmap.js';

/** Stable 0..1 hash of an integer cell and a seed. */
export function hash(i, j, seed) {
  let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x, z, seed) {
  const i = Math.floor(x), j = Math.floor(z);
  let fx = x - i, fz = z - j;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j, seed), b = hash(i + 1, j, seed), c = hash(i, j + 1, seed), d = hash(i + 1, j + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm(x, z, octaves, seed) {
  let v = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += amp * vnoise(x, z, seed + o * 31);
    norm += amp;
    x = x * 2.03 + 17.1;
    z = z * 2.03 + 9.3;
    amp *= 0.5;
  }
  return v / norm;
}

/**
 * Nearest jittered feature point in a grid of `size` m cells: the distances to the
 * nearest and second nearest, and the nearest one's cell (for a per-block value).
 */
export function cellular(x, z, size, seed) {
  const gx = x / size, gz = z / size;
  const ci = Math.floor(gx), cj = Math.floor(gz);
  let d1 = 9, d2 = 9, bi = 0, bj = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      const px = i + hash(i, j, seed), pz = j + hash(i, j, seed + 7);
      const d = Math.hypot(px - gx, pz - gz);
      if (d < d1) { d2 = d1; d1 = d; bi = i; bj = j; } else if (d < d2) d2 = d;
    }
  }
  return { d1: d1 * size, d2: d2 * size, i: bi, j: bj };
}

/**
 * Where the glaciers carry moraine: dark rubble stripes running down-glacier
 * (roughly north-south here), 1 on a stripe, 0 on bare ice.
 */
export function moraineAt(x, z) {
  const warp = fbm(x * 0.0012, z * 0.0012, 2, 5) * 2.2;
  const v = fbm(x * 0.0045 + warp, z * 0.0006, 3, 11);
  return smooth(0.5, 0.6, v);
}

/** The highest any relief stands above the base surface, metres. */
export const MAX_RELIEF = 1.3;

/** Size of the cells the glacier's ice blocks and boulders are scattered in, metres. */
export const BLOCK_CELL = 9;

export class TerrainDetail {
  /** @param flats places where the ground stays smooth (camps): [{x, z, r}] */
  constructor(hm, flats = []) {
    this.hm = hm;
    this.flats = flats;
    /** Rope lines kept clear of rocks, bucketed by 8 m cell: key -> [[ax, az, bx, bz]]. */
    this.corridors = new Map();
  }

  /** Keep a strip along a line (a fixed rope) smooth, so the rope doesn't vanish into rock. */
  addCorridor(points) {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i], b = points[i + 1];
      const seg = [a.x, a.z, b.x, b.z];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4) + 1;
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps, z = a.z + ((b.z - a.z) * k) / steps;
        const key = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
        if (!this.corridors.has(key)) this.corridors.set(key, []);
        const list = this.corridors.get(key);
        if (list[list.length - 1] !== seg) list.push(seg);
      }
    }
  }

  /** Distance to the nearest corridor line, if within a few metres. */
  _corridorDistance(x, z) {
    let best = 99;
    const ci = Math.floor(x / 8), cj = Math.floor(z / 8);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const list = this.corridors.get(`${ci + di},${cj + dj}`);
        if (!list) continue;
        for (const [ax, az, bx, bz] of list) {
          const dx = bx - ax, dz = bz - az;
          const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0), 1);
          best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
        }
      }
    }
    return best;
  }

  /**
   * The ice block or boulder in glacier cell (i, j) (BLOCK_CELL m cells), or null:
   * {x, z, r, h, yaw, rock}. Big snow-capped blocks of broken ice and moraine
   * boulders are strewn over the glaciers, kept off camps and the trodden trail.
   * glacierBlocks.js draws exactly these.
   */
  block(i, j) {
    const key = i * 100003 + j;
    this._blockCache ??= new Map();
    if (this._blockCache.has(key)) return this._blockCache.get(key);
    let b = null;
    const x = (i + 0.2 + 0.6 * hash(i, j, 201)) * BLOCK_CELL, z = (j + 0.2 + 0.6 * hash(i, j, 202)) * BLOCK_CELL;
    const glacier = this.hm.glacierAt(x, z);
    if (glacier > 0.4 && hash(i, j, 203) < 0.55 * glacier) {
      const g = this._ground(x, z);
      const path = this.corridors.size ? this._corridorDistance(x, z) : 99;
      const clear = !this.keepClear || this.keepClear(x, z);
      if (g.camp > 0.99 && path > 6 && clear) {
        const rock = moraineAt(x, z) > 0.5;
        const size = hash(i, j, 204);
        const r = rock ? 0.6 + 1.6 * size * size : 1.0 + 2.6 * size * size;
        b = { x, z, r, h: r * (0.55 + 0.5 * hash(i, j, 205)), yaw: hash(i, j, 206) * Math.PI * 2, rock, i, j };
      }
    }
    if (this._blockCache.size > 100000) this._blockCache.clear();
    this._blockCache.set(key, b);
    return b;
  }

  /** Height of the ice blocks and boulders at (x, z), above the ground beneath them. */
  _blocksAt(x, z) {
    const ci = Math.floor(x / BLOCK_CELL), cj = Math.floor(z / BLOCK_CELL);
    let top = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const b = this.block(ci + di, cj + dj);
        if (!b) continue;
        const d = Math.hypot(x - b.x, z - b.z) / b.r;
        if (d < 1) top = Math.max(top, b.h * Math.sqrt(1 - d * d));
      }
    }
    return top;
  }

  /**
   * Relief above the base surface at (x, z), metres; never below a few cm. The
   * glacier blocks count too unless drawing (they have their own meshes).
   */
  at(x, z, drawing = false) {
    const { y, slope, glacier, camp } = this._ground(x, z);
    let flat = camp;
    const path = this.corridors.size ? this._corridorDistance(x, z) : 99;
    if (path < 4) flat = Math.min(flat, smooth(1.2, 3.5, path));

    // Which ground this is, as smooth weights so the relief never jumps.
    const snow = smooth(4950, 5250, y) * smooth(50, 38, slope);
    const scree = smooth(36, 22, slope) * smooth(5900, 5300, y) * (1 - snow);
    const iceFace = smooth(33, 40, slope) * smooth(62, 52, slope) * smooth(5700, 6200, y);
    const rock = Math.max(0, 1 - snow - scree) * (1 - glacier);

    let h = 0;
    if (rock > 0.01) h += rock * (1 - 0.75 * iceFace) * this._blocks(x, z);
    if (scree > 0.01) h += scree * (1 - glacier) * this._boulders(x, z, 3.6, 0.35, 0.45, 1.3, 21);
    if (snow > 0.01) h += snow * (1 - glacier) * this._sastrugi(x, z, y);
    if (glacier > 0.01) {
      const rubble = moraineAt(x, z);
      const ice = 0.12 * fbm(x * 0.22, z * 0.22, 2, 41) + 0.05 * fbm(x * 0.9, z * 0.9, 2, 43);
      const stones = this._boulders(x, z, 3.0, 0.45, 0.35, 1.0, 47) + 0.1 * fbm(x * 0.8, z * 0.8, 2, 49);
      h += glacier * (rubble * stones + (1 - rubble) * ice);
    }
    // A layer of snow over snowy ground and the glaciers, with the trodden trench
    // of the route down through it: boot-deep, a little banked up at its edges.
    const cover = Math.min(1, snow * (1 - glacier) + glacier * 0.7);
    let trench = 0;
    if (cover > 0.01) {
      const banks = path < 3 ? 0.12 * Math.exp(-(((path - 0.85) / 0.22) ** 2)) : 0;
      const floor = path < 3 ? smooth(0.4, 0.8, path) : 1;
      trench = cover * (0.25 * floor + banks);
    }
    const ground = 0.03 + h * flat + trench * camp;
    if (drawing || glacier < 0.3) return ground;
    return Math.max(ground, this._blocksAt(x, z) * 0.92);
  }

  /**
   * What kind of ground this is: altitude, slope, glacier and camp smoothing. They
   * change slowly, so they are worked out once per 2 m cell and reused.
   */
  _ground(x, z) {
    // Blend the four nearest cell values so there are no seams between cells.
    const gx = x / 2 - 0.5, gz = z / 2 - 0.5;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const a = this._cell(i, j), b = this._cell(i + 1, j), c = this._cell(i, j + 1), d = this._cell(i + 1, j + 1);
    const mix = (k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fz) + (c[k] * (1 - fx) + d[k] * fx) * fz;
    return { y: mix('y'), slope: mix('slope'), glacier: mix('glacier'), camp: mix('camp') };
  }

  _cell(i, j) {
    const key = i * 100003 + j;
    let g = this._cache?.get(key);
    if (g) return g;
    if (!this._cache || this._cache.size > 200000) this._cache = new Map();
    const hm = this.hm;
    const cx = (i + 0.5) * 2, cz = (j + 0.5) * 2;
    const [gx, gz] = hm.gradient(cx, cz, 6);
    let camp = 1;
    for (const f of this.flats) {
      const d = Math.hypot(cx - f.x, cz - f.z);
      if (d < f.r + 12) camp = Math.min(camp, smooth(f.r, f.r + 12, d));
    }
    g = { y: hm.heightAt(cx, cz), slope: (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI, glacier: hm.glacierAt(cx, cz), camp };
    this._cache.set(key, g);
    return g;
  }

  /** Jointed rock: blocks 1.5-3 m across at different heights, cracks between them. */
  _blocks(x, z) {
    const c = cellular(x, z, 2.4, 3);
    const top = 0.1 + 0.55 * hash(c.i, c.j, 13);
    const edge = smooth(0.0, 0.35, c.d2 - c.d1);
    // Rough block tops.
    return top * edge + 0.06 * vnoise(x * 2.1, z * 2.1, 19);
  }

  /** Scattered rounded boulders: in `chance` of the cells, radius rMin..rMax m. */
  _boulders(x, z, size, chance, rMin, rMax, seed) {
    const c = cellular(x, z, size, seed);
    if (hash(c.i, c.j, seed + 1) > chance) return 0.04 * vnoise(x * 1.7, z * 1.7, seed + 2);
    const r = rMin + (rMax - rMin) * hash(c.i, c.j, seed + 3);
    const d = c.d1;
    if (d >= r) return 0.04 * vnoise(x * 1.7, z * 1.7, seed + 2);
    return Math.sqrt(r * r - d * d) * 0.75;
  }

  /** Wind-carved ridges across the prevailing westerly, sharper up high. */
  _sastrugi(x, z, y) {
    const warp = vnoise(x * 0.08, z * 0.08, 61) * 6;
    const ridge = 1 - Math.abs(Math.sin((x + warp) * 0.9 + vnoise(x * 0.3, z * 0.05, 63) * 4));
    const height = 0.05 + 0.12 * smooth(5500, 7500, y);
    return height * ridge * ridge * (0.5 + vnoise(x * 0.12, z * 0.5, 65));
  }
}

/** Camps stay smooth enough to pitch tents on. */
export function campFlats(hm, places) {
  return places.filter((p) => p.tents > 0).map((p) => {
    const [x, z] = hm.gridToWorld(p.r, p.c);
    return { x, z, r: p.tents > 10 ? 130 : 35 };
  });
}
