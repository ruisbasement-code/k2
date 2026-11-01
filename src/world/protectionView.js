// Protection placed in the mountain: the ice screws and snow pickets climbers put
// in, each with a carabiner on it, and the rope from a climber's harness up to the
// piece they're clipped to. Fed a list of climbers each frame, so other climbers
// (multiplayer) show the same way as you do: give each an id, its harness position
// and the piece it's on.

import * as THREE from 'three';
import { Parts } from './ropeMesh.js';
import { Tether } from './tether.js';

const MAX_PIECES = 40; // the oldest are taken out (cleaned) beyond this
const ROPE_COLORS = [0x2a9d4a, 0xd9a21b, 0x8a3fb8, 0x2b7fd1, 0xd0452b];

const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

export class ProtectionView extends THREE.Group {
  constructor(hm) {
    super();
    this.hm = hm;
    /** Placed pieces: {id, x, y, z, kind, clip: Vector3 (where the rope runs through)} */
    this.pieces = [];
    this._next = 1;
    this.meshes = {};
    for (const k of ['screw', 'picket', 'carabiner']) {
      const { geo, mat } = Parts[k]();
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_PIECES);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      this.add(mesh);
      this.meshes[k] = mesh;
    }
    /** Climber id -> their rope to a piece. */
    this.ropes = new Map();
  }

  /**
   * Put a piece in where a climber stands: {x, y, z, kind: 'screw' | 'picket'}.
   * Returns the placed piece (keep its id to clip to it).
   */
  place(at) {
    const hm = this.hm;
    hm.groundNormalAt(at.x, at.z, _n);
    // Driven in at right angles to the slope, a little uphill of the boots.
    const x = at.x - _n.x * 0.4, z = at.z - _n.z * 0.4;
    const piece = { id: this._next++, x, y: hm.groundAt(x, z), z, kind: at.kind, normal: _n.clone(), yaw: Math.random() * Math.PI * 2 };
    const out = piece.kind === 'picket' ? 0.12 : 0.02;
    piece.top = new THREE.Vector3(x, piece.y, z).addScaledVector(piece.normal, out);
    piece.clip = piece.top.clone().addScaledVector(piece.normal, piece.kind === 'picket' ? -0.015 : 0.085);
    this.pieces.push(piece);
    if (this.pieces.length > MAX_PIECES) this.pieces.shift();
    this._rebuild();
    return piece;
  }

  /** Take a piece out again (cleaned on the way down). */
  remove(id) {
    this.pieces = this.pieces.filter((p) => p.id !== id);
    this._rebuild();
  }

  _rebuild() {
    for (const m of Object.values(this.meshes)) m.count = 0;
    for (const p of this.pieces) {
      _q.setFromUnitVectors(_up, p.normal);
      _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, p.yaw));
      _m.compose(p.top, _q, _s);
      const mesh = this.meshes[p.kind] ?? this.meshes.screw;
      mesh.setMatrixAt(mesh.count++, _m);
      // The carabiner hangs from the hanger, down the slope.
      _p.copy(p.clip);
      _m.compose(_p, _q, _s);
      this.meshes.carabiner.setMatrixAt(this.meshes.carabiner.count++, _m);
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param climbers [{id, harness: Vector3 | null, piece: id | null}]: each
   *   climber's harness and the piece they're clipped to; null for neither.
   */
  update(dt, climbers) {
    const seen = new Set();
    for (const c of climbers) {
      const piece = c.piece != null && this.pieces.find((p) => p.id === c.piece);
      if (!piece || !c.harness) continue;
      seen.add(c.id);
      let rope = this.ropes.get(c.id);
      if (!rope) {
        rope = new Tether(this.hm, { segments: 40, color: ROPE_COLORS[this.ropes.size % ROPE_COLORS.length], clipBiner: false });
        this.ropes.set(c.id, rope);
        this.add(rope);
      }
      const d = c.harness.distanceTo(piece.clip);
      rope.update(dt, c.harness, piece.clip, d * 1.1 + 0.8); // paid out with a little slack
    }
    for (const [id, rope] of this.ropes) if (!seen.has(id)) rope.update(dt, null);
  }
}
