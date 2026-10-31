// Drawing for the hazards simulation: falling rocks and ice chunks, and the
// footprints the climber leaves in the snow.

import * as THREE from 'three';

const MAX_ROCKS = 96;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _yaw = new THREE.Quaternion();

export class RockfallMesh extends THREE.Group {
  constructor(rockfall) {
    super();
    this.rockfall = rockfall;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    this.stone = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5b534b, roughness: 0.95, flatShading: true }), MAX_ROCKS);
    this.ice = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.25, metalness: 0.05, flatShading: true }), MAX_ROCKS);
    for (const m of [this.stone, this.ice]) {
      m.castShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      this.add(m);
    }
  }

  update() {
    let ns = 0, ni = 0;
    for (const r of this.rockfall.rocks) {
      // Spin the rock as it rolls, from how far it has gone.
      const spin = r.age * (2 + r.velocity.length() / Math.max(r.size, 0.05));
      _q.setFromEuler(new THREE.Euler(spin, spin * 0.7, spin * 0.3));
      _s.setScalar(r.size);
      _m.compose(r.position, _q, _s);
      if (r.ice && ni < MAX_ROCKS) this.ice.setMatrixAt(ni++, _m);
      else if (!r.ice && ns < MAX_ROCKS) this.stone.setMatrixAt(ns++, _m);
    }
    this.stone.count = ns;
    this.ice.count = ni;
    this.stone.instanceMatrix.needsUpdate = true;
    this.ice.instanceMatrix.needsUpdate = true;
  }
}

/** Boot prints pressed into the snow, laid on the slope. */
export class FootprintMesh extends THREE.InstancedMesh {
  constructor(hm, max) {
    const geo = new THREE.CircleGeometry(0.5, 10);
    geo.rotateX(-Math.PI / 2);
    geo.scale(0.13, 1, 0.3);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9fb2c8, roughness: 1, transparent: true, opacity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    });
    super(geo, mat, max);
    this.hm = hm;
    this.max = max;
    this.next = 0;
    this.count = 0;
    this.frustumCulled = false;
    this.receiveShadow = true;
  }

  add({ x, z, yaw }) {
    const y = this.hm.heightAt(x, z) + 0.03;
    this.hm.normalAt(x, z, _n);
    _yaw.setFromAxisAngle(_up, yaw);
    _q.setFromUnitVectors(_up, _n).multiply(_yaw);
    _s.setScalar(1);
    _m.compose(new THREE.Vector3(x, y, z), _q, _s);
    this.setMatrixAt(this.next, _m);
    this.next = (this.next + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
    this.instanceMatrix.needsUpdate = true;
  }
}
