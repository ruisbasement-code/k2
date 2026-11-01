// Fixed ropes on the Abruzzi Spur. Each rope is a polyline hugging the terrain,
// ordered from its bottom end to its top end.

import * as THREE from 'three';
import { tubeAlong, ropeMaterial, Parts } from './ropeMesh.js';

const ROPE_HEIGHT = 0.35;
const SPACING = 6;
// How the drawn rope hangs: sampled every DRAPE_STEP m, anchored every MIN_SPAN to
// MAX_SPAN m, sagging SAG of each span and never hanging more than MAX_LIFT m off
// the ground (an anchor goes in sooner instead).
const DRAPE_STEP = 0.75;
const MIN_SPAN = 15;
const MAX_SPAN = 35;
const SAG = 0.015;
const MAX_LIFT = 0.7;
const ROPE_RADIUS = 0.018;
const OLD_RADIUS = 0.014;
// The rope is drawn in pieces this long; their anchors and old ropes only within DETAIL_RANGE m.
const CHUNK_M = 120;
const DETAIL_RANGE = 260;
// Anchor spacing before the rope is draped (no mesh, as in the tests).
const FALLBACK_ANCHOR_M = 25;

export class FixedRopes {
  /** @param defs [{name, points: [[r, c], ...]}] from route.json */
  constructor(hm, defs) {
    this.names = [];
    this.ropes = []; // arrays of THREE.Vector3
    this.lengths = []; // cumulative distance at each point
    for (const def of defs) {
      const pts = [];
      const wps = def.points;
      for (let i = 0; i < wps.length - 1; i++) {
        const [ax, az] = hm.gridToWorld(...wps[i]);
        const [bx, bz] = hm.gridToWorld(...wps[i + 1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SPACING));
        for (let s = 0; s < steps; s++) {
          const x = ax + ((bx - ax) * s) / steps;
          const z = az + ((bz - az) * s) / steps;
          pts.push(new THREE.Vector3(x, hm.heightAt(x, z) + ROPE_HEIGHT, z));
        }
      }
      const [lx, lz] = hm.gridToWorld(...wps[wps.length - 1]);
      pts.push(new THREE.Vector3(lx, hm.heightAt(lx, lz) + ROPE_HEIGHT, lz));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      this.names.push(def.name);
      this.ropes.push(pts);
      this.lengths.push(cum);
    }
  }

  lengthOf(rope) {
    const cum = this.lengths[rope];
    return cum[cum.length - 1];
  }

  _segment(rope, s) {
    const cum = this.lengths[rope];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  pointAt(rope, s, out = new THREE.Vector3()) {
    const i = this._segment(rope, s);
    const cum = this.lengths[rope];
    const t = Math.min(Math.max((s - cum[i]) / Math.max(cum[i + 1] - cum[i], 0.001), 0), 1);
    return out.lerpVectors(this.ropes[rope][i], this.ropes[rope][i + 1], t);
  }

  /** Unit direction up the rope at distance s. */
  tangentAt(rope, s, out = new THREE.Vector3()) {
    const i = this._segment(rope, s);
    return out.subVectors(this.ropes[rope][i + 1], this.ropes[rope][i]).normalize();
  }

  /**
   * Distances along the rope of its anchors, bottom to top, the rope's two ends
   * included. Where the rope hangs once the mesh is built; before that (in tests)
   * one every FALLBACK_ANCHOR_M.
   */
  anchorsOf(rope) {
    const d = this.drapes?.[rope];
    const cache = d ? (this._anchorS ??= []) : (this._fallbackAnchorS ??= []);
    if (cache[rope]) return cache[rope];
    let list;
    if (d) list = Array.from(d.anchors, (i) => i * d.ds);
    else {
      const L = this.lengthOf(rope);
      list = [];
      for (let s = 0; s < L - FALLBACK_ANCHOR_M / 2; s += FALLBACK_ANCHOR_M) list.push(s);
      list.push(L);
    }
    return (cache[rope] = list);
  }

  /** The stretch between two anchors that s lies in: {k, lo, hi}, k counted from the bottom. */
  sectionAt(rope, s) {
    const A = this.anchorsOf(rope);
    let k = 0;
    while (k < A.length - 2 && s >= A[k + 1]) k++;
    return { k, lo: A[k], hi: A[k + 1] };
  }

  /** Nearest rope to p: {rope, s, distance, point}. rope is -1 when there are none. */
  nearest(p) {
    let best = { rope: -1, s: 0, distance: Infinity, point: null };
    for (let r = 0; r < this.ropes.length; r++) {
      const near = this.nearestOn(r, p);
      if (near.distance < best.distance) best = near;
    }
    return best;
  }

  /** Nearest point on one rope to p: {rope, s, distance, point}. */
  nearestOn(rope, p) {
    const pts = this.ropes[rope];
    const ab = new THREE.Vector3(), ap = new THREE.Vector3(), q = new THREE.Vector3();
    let best = { rope, s: 0, distance: Infinity, point: new THREE.Vector3() };
    for (let i = 0; i < pts.length - 1; i++) {
      ab.subVectors(pts[i + 1], pts[i]);
      ap.subVectors(p, pts[i]);
      const t = Math.min(Math.max(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-4), 0), 1);
      q.copy(pts[i]).addScaledVector(ab, t);
      const d = p.distanceTo(q);
      if (d < best.distance) {
        best.s = this.lengths[rope][i] + ab.length() * t;
        best.distance = d;
        best.point.copy(q);
      }
    }
    return best;
  }

  /**
   * Where the rope actually lies, which the mesh draws: anchored every 15 to 35 m
   * (more often where it bends or the ground drops away), sagging a little between
   * anchors and resting on the snow where the slope bulges up into it. Built when
   * the mesh is, once the small-scale relief is in place.
   */
  _drape(r) {
    const hm = this.hm;
    const L = this.lengthOf(r);
    const n = Math.max(2, Math.ceil(L / DRAPE_STEP));
    const ds = L / n;
    const x = new Float32Array(n + 1), z = new Float32Array(n + 1), g = new Float32Array(n + 1);
    const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      this.pointAt(r, i * ds, p);
      x[i] = p.x; z[i] = p.z; g[i] = hm.groundAt(p.x, p.z);
    }
    // Anchors wherever the line turns, so it never cuts a corner.
    const forced = new Set([n]);
    const pts = this.ropes[r];
    for (let k = 1; k < pts.length - 1; k++) {
      const ax = pts[k].x - pts[k - 1].x, az = pts[k].z - pts[k - 1].z;
      const bx = pts[k + 1].x - pts[k].x, bz = pts[k + 1].z - pts[k].z;
      const turn = Math.acos(Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1)));
      if (turn > (14 * Math.PI) / 180) forced.add(Math.round(this.lengths[r][k] / ds));
    }
    const rnd = rng(1000 + r);
    const anchors = [];
    const kinds = [];
    const lift = (i) => this._anchorKind(x[i], z[i]) === 'piton' ? 0.1 : 0.2;
    // Height of the rope at sample i between anchors a and b.
    const hang = (a, b, ya, yb, i) => {
      const t = (i - a) / (b - a);
      const span = Math.hypot((b - a) * ds, yb - ya);
      return ya + (yb - ya) * t - SAG * span * 4 * t * (1 - t);
    };
    let a = 0;
    for (;;) {
      anchors.push(a);
      if (a >= n) break;
      const ya = g[a] + lift(a);
      const maxSpan = Math.round((MIN_SPAN + (MAX_SPAN - MIN_SPAN) * (0.55 + 0.45 * rnd())) / ds);
      let limit = Math.min(n, a + maxSpan);
      for (let i = a + 1; i <= limit; i++) if (forced.has(i)) { limit = i; break; }
      let best = a + 1;
      for (let b = limit; b > best; b--) {
        const yb = g[b] + lift(b);
        let ok = true;
        for (let i = a + 1; i < b && ok; i++) if (hang(a, b, ya, yb, i) - g[i] > MAX_LIFT) ok = false;
        if (ok) { best = b; break; }
      }
      a = best;
    }
    const y = new Float32Array(n + 1);
    for (let k = 0; k < anchors.length - 1; k++) {
      const a0 = anchors[k], b0 = anchors[k + 1];
      const ya = g[a0] + lift(a0), yb = g[b0] + lift(b0);
      for (let i = a0; i <= b0; i++) y[i] = Math.max(hang(a0, b0, ya, yb, i), g[i] + ROPE_RADIUS + 0.03);
    }
    // Soften the kinks where it comes down onto the snow, never into it.
    const isAnchor = new Uint8Array(n + 1);
    for (const i of anchors) isAnchor[i] = 1;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) {
        if (isAnchor[i]) continue;
        y[i] = Math.max((y[i - 1] + 2 * y[i] + y[i + 1]) / 4, g[i] + ROPE_RADIUS + 0.03);
      }
    }
    for (const i of anchors) kinds.push(this._anchorKind(x[i], z[i]));
    return { ds, n, x, z, y, g, anchors, kinds };
  }

  /** What a rope is fixed to here: a piton on rock, a picket in snow. */
  _anchorKind(x, z) {
    return this.hm.slopeDeg(x, z) > 42 || this.hm.heightAt(x, z) < 5300 ? 'piton' : 'picket';
  }

  /** Where the drawn rope is at distance s along it (the tether clips onto this). */
  visualPointAt(rope, s, out = new THREE.Vector3()) {
    const d = this.drapes?.[rope];
    if (!d) return this.pointAt(rope, s, out);
    const f = Math.min(Math.max(s / d.ds, 0), d.n - 1e-6);
    const i = Math.floor(f), t = f - i;
    return out.set(d.x[i] + (d.x[i + 1] - d.x[i]) * t, d.y[i] + (d.y[i + 1] - d.y[i]) * t, d.z[i] + (d.z[i + 1] - d.z[i]) * t);
  }

  /**
   * The ropes as they hang between their anchors, with the knots and metal at
   * each, and the old, faded ropes of earlier seasons lying beside them. Call
   * update(cameraPosition) each frame: the small parts are only drawn nearby.
   * @param hm the heightmap, with its small-scale relief attached
   * @param features the crevasses, so no old rope lies across one
   */
  createMesh(hm, features = null) {
    this.hm = hm;
    this.features = features;
    this.drapes = this.ropes.map((_, r) => this._drape(r));
    const group = new THREE.Group();
    const chunks = [];
    const parts = {};
    for (const k of ['carabiner', 'piton', 'picket', 'knot', 'rustyPiton']) parts[k] = Parts[k]();
    const colors = [[0xb8361c, 0x1d3f8a], [0x2f63a8, 0xd8d2c0]];
    const ropeMats = colors.map(([a, b]) => ropeMaterial(a, b));
    const oldMats = [
      ropeMaterial(0x8fa3ad, 0x6d5d4b, 1), ropeMaterial(0xc8bfa8, 0x8a4b3c, 1),
      ropeMaterial(0x7f8c6a, 0xb5ab90, 1), ropeMaterial(0xa5726a, 0x9aa0a3, 1),
    ];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), pos = new THREE.Vector3();

    this.drapes.forEach((d, r) => {
      const ropeMat = ropeMats[r % ropeMats.length];
      const knotColor = new THREE.Color(colors[r % colors.length][0]);
      // The rope, in pieces so each is culled on its own.
      const CH = Math.max(2, Math.round(CHUNK_M / d.ds));
      for (let a = 0; a < d.n; a += CH) {
        const b = Math.min(d.n, a + CH);
        const pts = [];
        for (let i = a; i <= b; i++) pts.push(new THREE.Vector3(d.x[i], d.y[i], d.z[i]));
        const chunk = new THREE.Group();
        const tube = new THREE.Mesh(tubeAlong(pts, ROPE_RADIUS, 6, 0.12), ropeMat);
        tube.castShadow = true;
        chunk.add(tube);
        chunk.userData.detail = new THREE.Group();
        chunk.userData.center = pts[pts.length >> 1].clone();
        chunk.add(chunk.userData.detail);
        chunk.userData.range = [a, b];
        group.add(chunk);
        chunks.push(chunk);
      }
      // The anchors: the metal, a carabiner through it, and the knot tied off on it.
      const byChunk = new Map();
      d.anchors.forEach((i, k) => {
        const c = Math.min(Math.floor(i / CH), Math.ceil(d.n / CH) - 1);
        if (!byChunk.has(c)) byChunk.set(c, []);
        byChunk.get(c).push([i, d.kinds[k]]);
      });
      const first = chunks.length - Math.ceil(d.n / CH);
      for (const [c, list] of byChunk) {
        const chunk = chunks[first + c];
        const count = { piton: 0, picket: 0 };
        for (const [, kind] of list) count[kind]++;
        const meshes = {};
        for (const k of ['carabiner', 'knot', 'piton', 'picket']) {
          const n = k === 'piton' || k === 'picket' ? count[k] : list.length;
          if (!n) continue;
          meshes[k] = new THREE.InstancedMesh(parts[k].geo, parts[k].mat, n);
          meshes[k].castShadow = true;
          meshes[k].count = 0;
          chunk.userData.detail.add(meshes[k]);
        }
        for (const [i, kind] of list) {
          const j = Math.min(i + 1, d.n), h = Math.max(i - 1, 0);
          dir.set(d.x[j] - d.x[h], d.y[j] - d.y[h], d.z[j] - d.z[h]).normalize();
          const rnd = rng(i * 7 + r);
          // The metal: driven into the slope, leaning back against the pull from below.
          hm.groundNormalAt(d.x[i], d.z[i], pos);
          const lean = pos.clone().lerp(dir, kind === 'picket' ? 0.35 : 0.15).normalize();
          q.setFromUnitVectors(up, lean);
          const twist = new THREE.Quaternion().setFromAxisAngle(lean, rnd() * Math.PI);
          q.premultiply(twist);
          const top = kind === 'picket' ? 0.14 : 0.03;
          pos.set(d.x[i], d.g[i], d.z[i]).addScaledVector(lean, top);
          m.compose(pos, q, sc);
          meshes[kind].setMatrixAt(meshes[kind].count++, m);
          // The carabiner hangs from its top, the rope running through it.
          const bp = pos.clone().addScaledVector(lean, kind === 'picket' ? -0.02 : 0.03);
          q.setFromUnitVectors(up, dir);
          m.compose(bp, q, sc);
          meshes.carabiner.setMatrixAt(meshes.carabiner.count++, m);
          // The knot, just below it on the rope.
          q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
          m.compose(new THREE.Vector3(d.x[i], d.y[i] - 0.01, d.z[i]).addScaledVector(dir, -0.06), q, sc);
          meshes.knot.setMatrixAt(meshes.knot.count, m);
          meshes.knot.setColorAt(meshes.knot.count++, knotColor);
        }
        for (const mesh of Object.values(meshes)) {
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
      }
      // Old ropes of earlier seasons: faded, frayed, half buried, a pace or two off the line.
      const rnd = rng(77 + r * 13);
      let s = 10 + rnd() * 40;
      const L = this.lengthOf(r);
      while (s < L - 10) {
        const len = 12 + rnd() * 50;
        const old = this._oldRope(r, s, Math.min(len, L - s), rnd);
        if (old) {
          const mat = oldMats[Math.floor(rnd() * oldMats.length)];
          const c = Math.min(Math.floor(s / d.ds / CH), Math.ceil(d.n / CH) - 1);
          const chunk = chunks[first + c];
          const tube = new THREE.Mesh(tubeAlong(old.points, OLD_RADIUS, 5, 0.1), mat);
          tube.castShadow = true;
          chunk.userData.detail.add(tube);
          for (const strand of old.strands) chunk.userData.detail.add(new THREE.Mesh(tubeAlong(strand, 0.0045, 3, 0.1), mat));
          if (old.piton) {
            const pm = new THREE.Mesh(parts.rustyPiton.geo, parts.rustyPiton.mat);
            pm.position.copy(old.piton.position);
            pm.quaternion.copy(old.piton.quaternion);
            chunk.userData.detail.add(pm);
          }
        }
        s += len + 25 + rnd() * 110;
      }
    });
    group.userData.chunks = chunks;
    group.update = (cam) => {
      for (const c of chunks) c.userData.detail.visible = cam.distanceTo(c.userData.center) < DETAIL_RANGE;
    };
    return group;
  }

  /**
   * An old rope beside the line from s for len metres: {points, strands, piton},
   * or null where there's no room. It wanders a little, lies on the ground and
   * dips under the snow here and there; its ends are frayed into loose strands,
   * and one end may still be tied to a rusted piton.
   */
  _oldRope(r, s, len, rnd) {
    const hm = this.hm;
    const side = rnd() < 0.5 ? -1 : 1;
    const off = 0.5 + rnd() * 1.1;
    const phase = rnd() * 10, wav = 0.04 + rnd() * 0.06;
    const n = Math.max(4, Math.round(len / 0.7));
    const points = [];
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    const buryAt = rnd() < 0.6 ? rnd() : -1;
    for (let k = 0; k <= n; k++) {
      const sk = s + (len * k) / n;
      this.pointAt(r, sk, p);
      this.tangentAt(r, sk, t);
      const nx = -t.z, nz = t.x;
      const nl = Math.hypot(nx, nz) || 1;
      const o = side * (off + 0.35 * Math.sin(phase + sk * wav * 6.28) + 0.12 * Math.sin(phase * 3 + sk * 0.9));
      const x = p.x + (nx / nl) * o, z = p.z + (nz / nl) * o;
      if (this.features?.holeAt?.(x, z)) return null;
      // Mostly lying on the surface; buried for a stretch where the snow drifted over it.
      const bury = buryAt >= 0 ? Math.max(0, 1 - Math.abs(k / n - buryAt) * 8) : 0;
      points.push(new THREE.Vector3(x, hm.groundAt(x, z) + OLD_RADIUS * 0.7 - 0.05 * bury, z));
    }
    // Frayed ends: the sheath gone, the core strands splayed out over the snow.
    const strands = [];
    for (const [end, prev] of [[points[0], points[1]], [points[n], points[n - 1]]]) {
      const out = new THREE.Vector3().subVectors(end, prev).setY(0).normalize();
      const side2 = new THREE.Vector3(-out.z, 0, out.x);
      const count = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < count; k++) {
        const spread = (rnd() - 0.5) * 1.2, l = 0.08 + rnd() * 0.18;
        const line = [];
        for (let u = 0; u <= 3; u++) {
          const f = (u / 3) * l;
          const x = end.x + out.x * f + side2.x * spread * f * (1 + u * 0.3);
          const z = end.z + out.z * f + side2.z * spread * f * (1 + u * 0.3);
          line.push(new THREE.Vector3(x, Math.max(hm.groundAt(x, z) + 0.004, end.y - f * 0.4), z));
        }
        strands.push(line);
      }
    }
    let piton = null;
    if (rnd() < 0.35) {
      const e = points[0];
      const nrm = hm.groundNormalAt(e.x, e.z, new THREE.Vector3());
      const obj = new THREE.Object3D();
      obj.position.set(e.x, hm.groundAt(e.x, e.z) + 0.02, e.z);
      obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
      piton = obj;
      strands.splice(0, strands.length >> 1); // that end is tied, not frayed
    }
    return { points, strands, piton };
  }

}

/** Small seeded random numbers, 0..1. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
