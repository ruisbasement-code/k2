// Fixed ropes on the Abruzzi Spur. Each rope is a polyline hugging the terrain,
// ordered from its bottom end to its top end.

import * as THREE from 'three';

const ROPE_HEIGHT = 0.35;
const SPACING = 6;
const ANCHOR_EVERY = 60;

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

  /** Nearest rope to p: {rope, s, distance}. rope is -1 when there are none. */
  nearest(p) {
    let best = { rope: -1, s: 0, distance: Infinity };
    const ab = new THREE.Vector3(), ap = new THREE.Vector3(), q = new THREE.Vector3();
    this.ropes.forEach((pts, r) => {
      for (let i = 0; i < pts.length - 1; i++) {
        ab.subVectors(pts[i + 1], pts[i]);
        ap.subVectors(p, pts[i]);
        const t = Math.min(Math.max(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-4), 0), 1);
        q.copy(pts[i]).addScaledVector(ab, t);
        const d = p.distanceTo(q);
        if (d < best.distance) best = { rope: r, s: this.lengths[r][i] + ab.length() * t, distance: d };
      }
    });
    return best;
  }

  /** The ropes as thin tubes, plus anchor stakes. */
  createMesh() {
    const group = new THREE.Group();
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xf2481a, emissive: 0x801a05, roughness: 0.6 });
    const stakeGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6);
    const stakeMat = new THREE.MeshStandardMaterial({ color: 0xb3b8bf, metalness: 0.8, roughness: 0.35 });
    this.ropes.forEach((pts, r) => {
      const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const tube = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, 0.04, 5, false), ropeMat);
      group.add(tube);
      const count = Math.floor(this.lengthOf(r) / ANCHOR_EVERY) + 1;
      const stakes = new THREE.InstancedMesh(stakeGeo, stakeMat, count);
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      for (let k = 0; k < count; k++) {
        this.pointAt(r, k * ANCHOR_EVERY, p);
        m.makeTranslation(p.x, p.y - ROPE_HEIGHT + 0.3, p.z);
        stakes.setMatrixAt(k, m);
      }
      stakes.castShadow = true;
      group.add(stakes);
    });
    return group;
  }
}
