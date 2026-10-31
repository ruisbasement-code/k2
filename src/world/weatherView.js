// Drawing the weather: snow falling and driven by the wind around the camera,
// spindrift streaming off ridges, and the powder clouds of avalanches.

import * as THREE from 'three';

const FLAKES = 12000;
const BOX = 40; // metres around the camera
const MAX_PUFFS = 400;

function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Precipitation extends THREE.Points {
  constructor() {
    const pos = new Float32Array(FLAKES * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * BOX;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    super(geo, new THREE.PointsMaterial({
      size: 0.2, map: flakeTexture(), transparent: true, depthWrite: false, opacity: 0.9, color: 0xeef3fa, fog: false,
    }));
    this.frustumCulled = false;
    this.wobble = new Float32Array(FLAKES).map(() => Math.random() * 6.28);
    this.visible = false;
  }

  /**
   * Move the flakes for this frame. Snowfall and spindrift decide how many show;
   * the gusting wind drives them sideways. Real seconds.
   */
  update(dt, cameraPos, c) {
    const amount = c ? Math.min(1, c.snowfall + c.spindrift * 0.7) : 0;
    this.visible = amount > 0.02;
    if (!this.visible) return;
    const count = Math.floor(FLAKES * amount);
    this.geometry.setDrawRange(0, count);
    const wind = Math.min(c.gust, 30) * 0.8;
    const wx = c.windX * wind, wz = c.windZ * wind;
    const fall = 1.2 + 0.3 * c.snowfall;
    // Flakes live in a box that follows the camera; wrap them around its edges.
    const pos = this.geometry.attributes.position.array;
    const half = BOX / 2;
    const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const w = this.wobble[i];
      pos[k] += (wx + Math.sin(t * 1.3 + w) * 0.4) * dt;
      pos[k + 1] -= (fall + (w % 1) * 0.4) * dt;
      pos[k + 2] += (wz + Math.cos(t * 1.1 + w) * 0.4) * dt;
      for (let a = 0; a < 3; a++) {
        const cam = cameraPos.getComponent(a);
        const rel = pos[k + a] - cam;
        if (rel > half || rel < -half) pos[k + a] = cam + ((((rel + half) % BOX) + BOX) % BOX) - half;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.size = 0.14 + 0.1 * c.snowfall;
  }
}

/** Billowing powder clouds over each avalanche's debris. */
export class AvalancheMesh extends THREE.InstancedMesh {
  constructor(avalanches) {
    super(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 1, transparent: true, opacity: 0.82, depthWrite: false }),
      MAX_PUFFS,
    );
    this.avalanches = avalanches;
    this.frustumCulled = false;
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  update() {
    let n = 0;
    const t = performance.now() / 1000;
    for (const slide of this.avalanches.slides) {
      for (let i = 0; i < slide.blobs.length && n < MAX_PUFFS - 2; i++) {
        const b = slide.blobs[i];
        const speed = b.velocity.length();
        // A core of churning snow and a looser cloud thrown up above it while it runs.
        for (let layer = 0; layer < 2; layer++) {
          const size = b.size * (layer ? 1.4 + Math.min(speed / 30, 1) : 0.8);
          this._p.copy(b.position);
          this._p.y += layer ? size * 0.6 : 0;
          this._e.set(t * 0.3 + i, t * 0.2 + i * 2, 0);
          this._q.setFromEuler(this._e);
          this._s.set(size, size * (layer ? 0.8 : 0.5), size);
          this._m.compose(this._p, this._q, this._s);
          if (layer && b.stopped) continue;
          this.setMatrixAt(n++, this._m);
        }
      }
    }
    this.count = n;
    this.instanceMatrix.needsUpdate = true;
  }
}
