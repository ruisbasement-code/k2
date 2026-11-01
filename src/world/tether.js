// The climber's tether to the fixed rope: a short rope from the harness to a
// carabiner clipped on the fixed rope, simulated as a chain of points (Verlet) so
// it hangs with slack, drapes on the snow and snaps tight when it holds a fall.

import * as THREE from 'three';

const SEGMENTS = 28;
const RADIUS = 0.018;
const ITERATIONS = 60;
const GRAVITY = -9.81;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _y = new THREE.Vector3(0, 1, 0);

/** A climbing carabiner: an oval ring with a gate, in anodised metal. */
function carabiner(color) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.045, 0.007, 6, 18),
    new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 }),
  );
  ring.scale.set(0.65, 1, 1);
  g.add(ring);
  const gate = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.06, 5),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.25 }),
  );
  gate.position.x = 0.03;
  g.add(gate);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}

export class Tether extends THREE.Group {
  /**
   * @param opts.segments how many links the rope is simulated as
   * @param opts.color the rope's colour
   * @param opts.clipBiner false when the far end has its own carabiner (a placed screw)
   */
  constructor(hm, { segments = SEGMENTS, color = 0x1f6fd1, clipBiner = true } = {}) {
    super();
    this.hm = hm;
    this.segments = segments;
    this.points = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this.prev = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this.active = false;
    this.length = 1;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, 1, 6, 1, true);
    this.cord = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.75 }), segments);
    this.cord.castShadow = true;
    this.cord.frustumCulled = false;
    this.add(this.cord);
    this.harnessBiner = carabiner(0xe0a020);
    this.ropeBiner = carabiner(0x9a3fd0);
    this.add(this.harnessBiner, this.ropeBiner);
    this.ropeBiner.visible = clipBiner;
    this.visible = false;
  }

  /** Lay the rope out from harness to clip, sagging a little. */
  _reset(harness, clip) {
    for (let i = 0; i <= this.segments; i++) {
      const k = i / this.segments;
      this.points[i].lerpVectors(harness, clip, k);
      this.points[i].y -= Math.sin(k * Math.PI) * 0.3;
      this.prev[i].copy(this.points[i]);
    }
  }

  /**
   * @param harness world position of the harness, or null when not clipped in
   * @param clip world position of the carabiner on the fixed rope
   * @param length tether length, metres
   * @param ropeDir direction of the fixed rope at the clip, to align the carabiner
   */
  update(dt, harness, clip, length, ropeDir) {
    if (!harness) {
      this.active = this.visible = false;
      return;
    }
    if (!this.active) this._reset(harness, clip);
    this.active = this.visible = true;
    this.length = length;
    const pts = this.points;
    const seg = length / this.segments;
    const h = Math.min(dt, 1 / 30);
    // Verlet: carry on moving, damped, with gravity.
    for (let i = 1; i < this.segments; i++) {
      const p = pts[i];
      _d.subVectors(p, this.prev[i]).multiplyScalar(0.96);
      this.prev[i].copy(p);
      p.add(_d);
      p.y += GRAVITY * h * h;
    }
    pts[0].copy(harness);
    pts[this.segments].copy(clip);
    if (harness.distanceTo(clip) >= length * 0.995) {
      // Pulled tight: the rope runs straight from harness to clip.
      for (let i = 1; i < this.segments; i++) {
        pts[i].lerpVectors(harness, clip, i / this.segments);
        this.prev[i].copy(pts[i]);
      }
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < this.segments; i++) {
        const a = pts[i], b = pts[i + 1];
        _d.subVectors(b, a);
        const dist = _d.length() || 1e-6;
        // A rope only resists stretching; it can bunch up freely.
        if (dist <= seg) continue;
        const diff = (dist - seg) / dist;
        const wa = i === 0 ? 0 : 0.5, wb = i + 1 === this.segments ? 0 : 0.5;
        const sum = wa + wb || 1;
        a.addScaledVector(_d, (diff * wa) / sum);
        b.addScaledVector(_d, (-diff * wb) / sum);
      }
      // Lie on the snow rather than through it.
      for (let i = 1; i < this.segments; i++) {
        const p = pts[i];
        const ground = this.hm.groundAt(p.x, p.z) + RADIUS + 0.02;
        if (p.y < ground) {
          p.y = ground;
          // Friction: a rope on snow stays put.
          this.prev[i].x += (p.x - this.prev[i].x) * 0.5;
          this.prev[i].z += (p.z - this.prev[i].z) * 0.5;
        }
      }
    }
    for (let i = 0; i < this.segments; i++) {
      _a.copy(pts[i]);
      _b.copy(pts[i + 1]);
      _d.subVectors(_b, _a);
      const len = _d.length();
      _mid.addVectors(_a, _b).multiplyScalar(0.5);
      _q.setFromUnitVectors(_y, len > 1e-6 ? _d.divideScalar(len) : _y);
      _s.set(1, Math.max(len, 1e-3), 1);
      _m.compose(_mid, _q, _s);
      this.cord.setMatrixAt(i, _m);
    }
    this.cord.instanceMatrix.needsUpdate = true;
    // Harness carabiner hangs along the tether; the rope one sits along the fixed rope.
    _d.subVectors(pts[1], pts[0]).normalize();
    this.harnessBiner.position.copy(pts[0]);
    this.harnessBiner.quaternion.setFromUnitVectors(_y, _d);
    this.ropeBiner.position.copy(clip);
    if (ropeDir) this.ropeBiner.quaternion.setFromUnitVectors(_y, _a.copy(ropeDir).normalize());
  }

  /** How tight the tether is, 0 slack to 1 taut. */
  get tension() {
    if (!this.active) return 0;
    return Math.min(this.points[0].distanceTo(this.points[this.segments]) / this.length, 1);
  }
}
