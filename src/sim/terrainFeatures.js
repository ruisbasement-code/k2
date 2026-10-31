// The parts of K2 the 31 m elevation grid can't show: crevasses (open, and hidden
// under snow bridges), the bergschrund, pits and moulins, seracs including the
// Bottleneck serac, cornices and snow overhangs, snow caves, the technical rock of
// House's Chimney and the Black Pyramid, and the cols. No rendering here, so
// tests can drive it.
//
// The named features come from src/data/features.json. Crevasses, pits and small
// ice towers on the glaciers are generated from the terrain, cell by cell, the
// same every time: transverse crevasses lie across the flow where the ice
// steepens, most of them hidden under snow once you're above the bare lower
// glacier. A wand-marked trail from Base Camp to the ropes is kept clear.

import * as THREE from 'three';
import { tuning } from './paceModel.js';
import { Rockfall } from './hazards.js';

/** A stable 0..1 hash of a grid cell, with a salt per feature type. */
function hash(i, j, salt) {
  let h = (i * 374761393 + j * 668265263 + salt * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Distance from (x, z) to the segment a-b, and how far along it (0..1). */
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / Math.max(dx * dx + dz * dz, 1e-6), 0), 1);
  return [Math.hypot(x - ax - dx * t, z - az - dz * t), t];
}

/** Distance from (x, z) to a polyline of {x, z}. */
function polyDist(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z)[0]);
  return best;
}

/** The nearest point to (x, z) on a polyline of {x, z}. */
function nearestOnPoly(x, z, pts) {
  let best = { x, z }, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [d, t] = segDist(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    if (d < bd) {
      bd = d;
      best = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t };
    }
  }
  return best;
}

export class TerrainFeatures {
  /**
   * @param defs features.json
   * @param opts {ropes, places}: kept clear of crevasses
   */
  constructor(hm, defs, { ropes = null, places = [] } = {}) {
    this.hm = hm;
    this.ropes = ropes;
    const w = (rc) => {
      const [x, z] = hm.gridToWorld(rc[0], rc[1]);
      return { x, z };
    };
    this.camps = places.filter((p) => p.tents > 0).map((p) => w([p.r, p.c]));
    this.trail = defs.wand_trail ? { ...defs.wand_trail, points: defs.wand_trail.points.map(w) } : null;
    /** Crevasses, pits and the bergschrund placed by hand; generated ones live in the cell cache. */
    this.placedHoles = [];
    for (const [k, b] of (defs.bergschrunds ?? []).entries()) this._bergschrund(b, k, w);
    /** Solid ice blocks you can't walk through: {x, z, ux, uz, halfL, halfD, height, y, name}. */
    this.placedSeracs = [];
    /** Where serac ice breaks off: {x, y, z, along: {x, z}, length, name}. */
    this.icefalls = [];
    for (const [k, s] of (defs.seracs ?? []).entries()) this._serac(s, k, w);
    this.cornices = tuning.cornices_enabled ? (defs.cornices ?? []).map((c, k) => this._cornice(c, k, w)) : [];
    this.caverns = (defs.caverns ?? []).map((c) => this._cavern(c, w));
    this.zones = (defs.zones ?? []).map((z) => ({ ...z, points: z.points.map(w) }));
    this.cols = (defs.cols ?? []).map((c) => {
      const p = w(c.at);
      return { ...c, ...p, y: hm.heightAt(p.x, p.z) };
    });

    /** Bridges that have fallen in, and hidden crevasses you've found, by id. */
    this.opened = new Set();
    this.revealed = new Set();
    /** Cornice sections that have broken off, by "cornice:section". */
    this.brokenCornice = new Set();
    /** Ice blocks coming down from seracs. Separate from rockfall, which is off. */
    this.icefall = new Rockfall(hm);
    /** Bumped when a feature changes how it looks (a bridge or cornice collapses, a crevasse is found). */
    this.version = 0;
    this._cells = new Map();
  }

  // ---------------------------------------------------------------- building

  _bergschrund(b, k, w) {
    const hm = this.hm;
    let c = w(b.at);
    // Centre the bridged gap on the wanded trail, where it crosses.
    if (this.trail) c = nearestOnPoly(c.x, c.z, this.trail.points);
    const [gx, gz] = hm.gradient(c.x, c.z, 20);
    const g = Math.hypot(gx, gz) || 1;
    // Along the contour, across the fall line.
    const ux = -gz / g, uz = gx / g;
    const half = b.length_m / 2;
    const gap = b.gap_m / 2;
    const side = (half - gap) / 2;
    for (const s of [-1, 1]) {
      const off = s * (gap + side);
      this.placedHoles.push({
        id: `bergschrund${k}${s > 0 ? 'b' : 'a'}`, name: b.name, kind: 'bergschrund',
        x: c.x + ux * off, z: c.z + uz * off, ux, uz, half: side, width: b.width_m / 2,
        depth: b.depth_m, hidden: false, strength: 1,
      });
    }
  }

  _serac(s, k, w) {
    const hm = this.hm;
    const a = w(s.from), b = w(s.to);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    // Upslope, so the blocks sit above their base line and their face looks down the slope.
    const [gx, gz] = hm.gradient((a.x + b.x) / 2, (a.z + b.z) / 2, 20);
    let nx = -uz, nz = ux;
    if (nx * gx + nz * gz < 0) { nx = -nx; nz = -nz; }
    // Its ice cliff is only built (drawn and solid) when serac_blocks is on.
    const n = tuning.serac_blocks ? Math.max(1, Math.round(len / 18)) : 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const r = hash(k, i, 11);
      const halfL = len / n / 2 + 2;
      const halfD = s.depth_m / 2 * (0.8 + 0.4 * hash(k, i, 12));
      const x = a.x + (b.x - a.x) * t + nx * halfD;
      const z = a.z + (b.z - a.z) * t + nz * halfD;
      const height = s.height_m[0] + (s.height_m[1] - s.height_m[0]) * r;
      this.placedSeracs.push(this._block(x, z, ux, uz, halfL, halfD, height, s.name, `${k}:${i}`));
    }
    if (s.icefall) {
      const y = (hm.heightAt(a.x, a.z) + hm.heightAt(b.x, b.z)) / 2 + s.height_m[0];
      this.icefalls.push({ name: s.name, x: a.x, z: a.z, y, along: { x: b.x - a.x, z: b.z - a.z }, length: len, face: { x: -nx, z: -nz } });
    }
  }

  /** An ice block standing on the slope: its base is the lowest ground under its corners. */
  _block(x, z, ux, uz, halfL, halfD, height, name, id) {
    const hm = this.hm;
    let y = Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      y = Math.min(y, hm.heightAt(x + ux * halfL * a - uz * halfD * b, z + uz * halfL * a + ux * halfD * b));
    }
    return { id, name, x, z, ux, uz, halfL, halfD, height, y: y - 1 };
  }

  /**
   * A cornice along a ridge crest. The 31 m grid rounds every crest off, so we
   * find the true crest by looking across the line for the highest ground.
   */
  _cornice(def, k, w) {
    const hm = this.hm;
    const a = w(def.from), b = w(def.to);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const n = Math.max(2, Math.round(len / 6));
    // Find the crest across the line for each lee side, and keep the side the
    // ground falls away from: cornices grow out over the drop.
    const crest = (lx, lz) => {
      const raw = [];
      let drop = 0;
      for (let i = 0; i <= n; i++) {
        const px = a.x + (b.x - a.x) * (i / n), pz = a.z + (b.z - a.z) * (i / n);
        let best = -Infinity, off = 0;
        for (let o = -120; o <= 120; o += 2) {
          const h = hm.heightAt(px + lx * o, pz + lz * o);
          if (h > best) { best = h; off = o; }
        }
        raw.push(off);
        drop += best - hm.heightAt(px + lx * (off + 20), pz + lz * (off + 20));
      }
      return { raw, drop, lx, lz };
    };
    const hint = -uz * def.lee[0] + ux * def.lee[1] >= 0 ? 1 : -1;
    const one = crest(-uz * hint, ux * hint), other = crest(uz * hint, -ux * hint);
    // The wind side wins unless the other side clearly drops further.
    const { raw, lx, lz } = other.drop > one.drop * 1.5 + n ? other : one;
    const points = raw.map((_, i) => {
      // Smooth the crest so the lip doesn't zigzag.
      let s = 0, m = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) { s += raw[j]; m++; }
      const off = s / m;
      const t = i / n;
      let x = a.x + (b.x - a.x) * t + lx * off, z = a.z + (b.z - a.z) * t + lz * off;
      // Then settle each point on the highest ground right there.
      let y = hm.heightAt(x, z);
      for (let o = -6; o <= 6; o += 1) {
        const h = hm.heightAt(x + lx * o, z + lz * o);
        if (h > y) { y = h; x += lx * o; z += lz * o; }
      }
      const width = def.width_m[0] + (def.width_m[1] - def.width_m[0]) * (0.5 + 0.5 * Math.sin(i * 0.7 + k * 3) * hash(k, i, 21));
      return { x, z, y: hm.heightAt(x, z), width };
    });
    return { name: def.name, kind: def.kind, id: k, points, lee: { x: lx, z: lz }, section: tuning.cornice_section_points };
  }

  _cavern(def, w) {
    const hm = this.hm;
    const c = w(def.near);
    // The flattest spot nearby: caves are dug into gentle ground.
    let best = { x: c.x, z: c.z, s: Infinity };
    for (let r = 0; r <= 40; r += 4) {
      for (let a = 0; a < 12; a++) {
        const x = c.x + Math.cos(a * 0.52) * r, z = c.z + Math.sin(a * 0.52) * r;
        const s = hm.slopeDeg(x, z) + r * 0.15;
        if (s < best.s) best = { x, z, s };
      }
    }
    const [gx, gz] = hm.gradient(best.x, best.z);
    const g = Math.hypot(gx, gz) || 1;
    // The entrance faces down the slope.
    return { name: def.name, x: best.x, z: best.z, y: hm.heightAt(best.x, best.z), radius: def.radius_m, face: { x: -gx / g, z: -gz / g } };
  }

  // ------------------------------------------------------- generated features

  /** Whether a spot is kept clear: camps, fixed ropes and the wanded trail. */
  _clear(x, z, r) {
    for (const c of this.camps) if (Math.hypot(c.x - x, c.z - z) < tuning.camp_radius_m + r + 20) return false;
    if (this.trail && polyDist(x, z, this.trail.points) < this.trail.clear_m + r) return false;
    if (this.ropes && this.ropes.nearest(new THREE.Vector3(x, this.hm.heightAt(x, z), z)).distance < r + 10) return false;
    for (const h of this.placedHoles) if (Math.hypot(h.x - x, h.z - z) < h.half + r + 15) return false;
    return true;
  }

  /** The generated features of one cell: [] or a crevasse, a pit or an ice tower. */
  _cell(i, j) {
    const key = `${i},${j}`;
    let out = this._cells.get(key);
    if (out) return out;
    out = this._makeCell(i, j);
    this._cells.set(key, out);
    return out;
  }

  _makeCell(i, j) {
    const t = tuning;
    const hm = this.hm;
    const cell = t.crevasse_cell_m;
    const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * cell;
    const z = (j + 0.2 + 0.6 * hash(i, j, 2)) * cell;
    if (Math.abs(x) > hm.size / 2 - 60 || Math.abs(z) > hm.size / 2 - 60) return [];
    const y = hm.heightAt(x, z);
    const slope = hm.slopeDeg(x, z);
    const glacier = hm.glacierAt(x, z);
    const roll = hash(i, j, 3);
    const [gx, gz] = hm.gradient(x, z, 20);
    const g = Math.hypot(gx, gz) || 1;
    // Across the flow: the ice cracks where it speeds up over a steeper step.
    const ux = -gz / g, uz = gx / g;
    // The high snowfields (the Shoulder) crack too, less often.
    const snowfield = y > t.snowfield_crevasse_m[0] && y < t.snowfield_crevasse_m[1] && slope > 6 && slope < 30;
    if (glacier < 0.35 && !snowfield) return [];
    const steep = smooth(3, 14, slope);
    // Ice towers where the glacier breaks over its steepest steps (an icefall).
    if (glacier > 0.35 && slope > 9 && roll < t.serac_tower_share * smooth(9, 16, slope)) {
      const halfL = 4 + 5 * hash(i, j, 4), halfD = 3 + 3 * hash(i, j, 5);
      if (!this._clear(x, z, halfL + 3)) return [];
      return [{ type: 'serac', ...this._block(x, z, ux, uz, halfL, halfD, 7 + 10 * hash(i, j, 6), 'Ice tower', `t${i},${j}`) }];
    }
    const chance = snowfield ? t.snowfield_crevasse_share : t.crevasse_share * (0.3 + 0.7 * steep) * glacier;
    if (roll >= chance) return [];
    const bare = y < t.bare_glacier_below_m;
    // Hidden: snow covers most crevasses above the bare lower glacier.
    const hidden = hash(i, j, 7) < (bare ? t.hidden_share_bare : t.hidden_share_snow);
    const pit = !snowfield && hash(i, j, 8) < t.pit_share;
    const half = pit ? 1.2 + 2.5 * hash(i, j, 9) : 8 + 22 * hash(i, j, 9);
    if (!this._clear(x, z, half)) return [];
    const width = pit ? half : 0.4 + (hidden ? 0.8 : 1.6) * hash(i, j, 10);
    const depth = t.hole_depth_m[0] + (t.hole_depth_m[1] - t.hole_depth_m[0]) * hash(i, j, 11);
    return [{
      type: 'hole', id: `${pit ? 'p' : 'c'}${i},${j}`, kind: pit ? (bare ? 'moulin' : 'pit') : 'crevasse',
      name: pit ? (bare ? 'Moulin' : 'Pit') : 'Crevasse',
      x, z, ux, uz, half, width, depth, hidden,
      // Wide crevasses have thin, weak bridges.
      strength: 0.35 + 0.65 * hash(i, j, 12) - (width > 1 ? 0.2 : 0),
    }];
  }

  /** Generated features in the cells around a point. */
  *_near(x, z, r = 0) {
    const cell = tuning.crevasse_cell_m;
    const reach = Math.ceil((r + 32) / cell);
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) yield* this._cell(i, j);
    }
  }

  // ------------------------------------------------------------------ queries

  /** Every hole within r of a point (generated and placed), for drawing. */
  holesNear(x, z, r) {
    const out = [];
    for (const f of this._near(x, z, r)) if (f.type === 'hole' && Math.hypot(f.x - x, f.z - z) < r) out.push(f);
    for (const h of this.placedHoles) if (Math.hypot(h.x - x, h.z - z) < r + h.half) out.push(h);
    return out;
  }

  /** Every serac block within r of a point. */
  seracsNear(x, z, r) {
    const out = [];
    for (const f of this._near(x, z, r)) if (f.type === 'serac' && Math.hypot(f.x - x, f.z - z) < r) out.push(f);
    for (const s of this.placedSeracs) if (Math.hypot(s.x - x, s.z - z) < r + s.halfL) out.push(s);
    return out;
  }

  /** Half the width of a hole at a point along it: crevasses taper to their ends. */
  static halfWidth(h, u) {
    if (h.kind === 'pit' || h.kind === 'moulin') return h.width * Math.sqrt(Math.max(0, 1 - (u / h.half) ** 2));
    return h.width * Math.sqrt(Math.max(0, 1 - (u / h.half) ** 4));
  }

  /** The hole at (x, z), if you're over one: {hole, u, v} (along it, across it). */
  holeAt(x, z) {
    const test = (h) => {
      const dx = x - h.x, dz = z - h.z;
      const u = dx * h.ux + dz * h.uz;
      if (Math.abs(u) >= h.half) return null;
      const v = -dx * h.uz + dz * h.ux;
      return Math.abs(v) < TerrainFeatures.halfWidth(h, u) ? { hole: h, u, v } : null;
    };
    for (const h of this.placedHoles) {
      const hit = test(h);
      if (hit) return hit;
    }
    for (const f of this._near(x, z)) {
      if (f.type !== 'hole') continue;
      const hit = test(f);
      if (hit) return hit;
    }
    return null;
  }

  /** Whether you can see into it: open from the start, or its bridge has fallen in. */
  isOpen(h) {
    return !h.hidden || this.opened.has(h.id);
  }

  /** Whether you know it's there: open, or found by probing. */
  isKnown(h) {
    return this.isOpen(h) || this.revealed.has(h.id);
  }

  openBridge(h) {
    if (this.opened.has(h.id)) return;
    this.opened.add(h.id);
    this.version++;
  }

  /** The serac block at (x, z), if that spot is inside solid ice. */
  seracAt(x, z) {
    const test = (s) => {
      const dx = x - s.x, dz = z - s.z;
      return Math.abs(dx * s.ux + dz * s.uz) < s.halfL && Math.abs(-dx * s.uz + dz * s.ux) < s.halfD;
    };
    for (const s of this.placedSeracs) if (test(s)) return s;
    for (const f of this._near(x, z)) if (f.type === 'serac' && test(f)) return f;
    return null;
  }

  /**
   * The cornice under (x, z), if you're out on one: {cornice, section, out}, where
   * out runs from 0 at the crest to 1 at the lip.
   */
  corniceAt(x, z) {
    for (const c of this.cornices) {
      const pts = c.points;
      let best = Infinity, bi = -1;
      for (let i = 0; i < pts.length; i++) {
        const d = (x - pts[i].x) ** 2 + (z - pts[i].z) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      if (best > 30 * 30) continue;
      const p = pts[bi];
      const d = (x - p.x) * c.lee.x + (z - p.z) * c.lee.z;
      if (d <= 0 || d >= p.width) continue;
      if ((bi === 0 || bi === pts.length - 1) && Math.sqrt(best) > p.width + 3) continue;
      const section = Math.floor(bi / c.section);
      if (this.brokenCornice.has(`${c.id}:${section}`)) continue;
      return { cornice: c, section, out: d / p.width, point: p };
    }
    return null;
  }

  breakCornice(hit) {
    this.brokenCornice.add(`${hit.cornice.id}:${hit.section}`);
    this.version++;
  }

  /**
   * How much higher than the elevation grid the snow surface is here: the top of
   * a cornice standing out over the drop below it.
   */
  liftAt(x, z) {
    const hit = this.corniceAt(x, z);
    if (!hit) return 0;
    return Math.max(0, hit.point.y + tuning.cornice_top_m - this.hm.heightAt(x, z));
  }

  /** The snow cave you're in, if any. */
  cavernAt(x, z) {
    return this.caverns.find((c) => Math.hypot(c.x - x, c.z - z) < c.radius) ?? null;
  }

  /** The technical section you're in, if any. */
  zoneAt(x, z) {
    return this.zones.find((zn) => polyDist(x, z, zn.points) < zn.radius_m) ?? null;
  }

  /** The col you're on, if any. */
  colAt(x, z) {
    return this.cols.find((c) => Math.hypot(c.x - x, c.z - z) < c.radius_m) ?? null;
  }

  /** How far (x, z) is from the wanded trail across the glacier. */
  trailDistance(x, z) {
    return this.trail ? polyDist(x, z, this.trail.points) : Infinity;
  }

  /** The name of the place you're in, for the HUD. */
  placeName(x, z) {
    const zone = this.zoneAt(x, z);
    if (zone) return zone.name;
    const cave = this.cavernAt(x, z);
    if (cave) return cave.name;
    const col = this.colAt(x, z);
    if (col) return `${col.name} (${col.height_m.toLocaleString('en-US')} m)`;
    for (const f of this.icefalls) {
      if (Math.hypot(x - (f.x + f.along.x / 2), z - (f.z + f.along.z / 2)) < 180) return `Under the ${f.name}`;
    }
    return '';
  }

  /**
   * Probe the snow ahead with your axe shaft or pole: finds hidden crevasses
   * within reach in front of you. Returns the ones found.
   */
  probe(x, z, dirX, dirZ) {
    const found = [];
    const reach = tuning.probe_reach_m;
    for (let d = 0.5; d <= reach; d += 0.5) {
      for (const s of [-0.6, 0, 0.6]) {
        const px = x + dirX * d - dirZ * s, pz = z + dirZ * d + dirX * s;
        const hit = this.holeAt(px, pz);
        if (hit && !this.isKnown(hit.hole) && !found.includes(hit.hole)) found.push(hit.hole);
      }
    }
    for (const h of found) this.revealed.add(h.id);
    if (found.length) this.version++;
    return found;
  }

  /**
   * Serac icefall: blocks breaking off the face at any hour, more in the warm
   * afternoon. Returns the icefall that let go, or null.
   */
  maybeIcefall(dtM, hour, near, rng = Math.random) {
    const t = tuning;
    if (!t.serac_fall_enabled) return null;
    const warm = hour > 11 && hour < 18 ? 1.5 : hour < 6 || hour > 21 ? 0.6 : 1;
    for (const f of this.icefalls) {
      // Only matters when you're close enough to be under it.
      if (near && Math.hypot(near.x - f.x, near.z - f.z) > 2000) continue;
      if (rng() >= (t.serac_fall_per_hour * warm * dtM) / 3600) continue;
      this.releaseIcefall(f, rng);
      return f;
    }
    return null;
  }

  releaseIcefall(f, rng = Math.random) {
    const at = rng();
    const x = f.x + f.along.x * at, z = f.z + f.along.z * at;
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const px = x + (rng() - 0.5) * 14 + f.face.x * 2, pz = z + (rng() - 0.5) * 14 + f.face.z * 2;
      const p = new THREE.Vector3(px, this.hm.heightAt(px, pz) + 6 + rng() * 20, pz);
      const v = new THREE.Vector3(f.face.x, 0, f.face.z).multiplyScalar(3 + rng() * 4);
      this.icefall.release(p, v, 0.4 + rng() * 0.9, true);
    }
  }
}
