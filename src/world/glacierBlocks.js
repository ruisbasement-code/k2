// The glaciers' broken ice blocks and moraine boulders (TerrainDetail.block), drawn
// as instanced meshes in 252 m chunks. A chunk's blocks are only worked out when
// it first comes near, a few chunks a frame, and small blocks are only drawn close.

import * as THREE from 'three';
import { BLOCK_CELL, hash } from './terrainDetail.js';

const CHUNK_CELLS = 28;
const CHUNK = CHUNK_CELLS * BLOCK_CELL;
const NEAR_SMALL = 450, NEAR_BIG = 1300, BIG_R = 1.8;

export class GlacierBlocks extends THREE.Group {
  constructor(hm) {
    super();
    this.hm = hm;
    this.chunks = new Map();
    const f = hm.fine;
    this.bounds = f ? [f.x0, f.z0, f.x0 + (f.n - 1) * f.step, f.z0 + (f.n - 1) * f.step] : null;
    this.geo = blockGeometry();
    this.mat = blockMaterial();
  }

  update(eye) {
    if (!this.bounds || !this.hm.detail) return;
    const [x0, z0, x1, z1] = this.bounds;
    const ci0 = Math.floor(Math.max(eye.x - NEAR_BIG, x0) / CHUNK), ci1 = Math.floor(Math.min(eye.x + NEAR_BIG, x1) / CHUNK);
    const cj0 = Math.floor(Math.max(eye.z - NEAR_BIG, z0) / CHUNK), cj1 = Math.floor(Math.min(eye.z + NEAR_BIG, z1) / CHUNK);
    // Build the nearest missing chunks first, a few a frame.
    const todo = [];
    for (let cj = cj0; cj <= cj1; cj++) {
      for (let ci = ci0; ci <= ci1; ci++) {
        if (this.chunks.has(`${ci},${cj}`)) continue;
        const d = Math.hypot((ci + 0.5) * CHUNK - eye.x, (cj + 0.5) * CHUNK - eye.z);
        if (d < NEAR_BIG + CHUNK) todo.push([d, ci, cj]);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, ci, cj] of todo.slice(0, 3)) this.chunks.set(`${ci},${cj}`, this._build(ci, cj));
    for (const c of this.chunks.values()) {
      if (!c) continue;
      const d = Math.max(0, Math.hypot(c.cx - eye.x, c.cz - eye.z) - CHUNK * 0.71);
      if (c.small) c.small.visible = d < NEAR_SMALL;
      if (c.big) c.big.visible = d < NEAR_BIG;
    }
  }

  _build(ci, cj) {
    const detail = this.hm.detail;
    const small = [], big = [];
    for (let j = cj * CHUNK_CELLS; j < (cj + 1) * CHUNK_CELLS; j++) {
      for (let i = ci * CHUNK_CELLS; i < (ci + 1) * CHUNK_CELLS; i++) {
        const b = detail.block(i, j);
        if (b) (b.r > BIG_R ? big : small).push(b);
      }
    }
    if (!small.length && !big.length) return null;
    const out = { cx: (ci + 0.5) * CHUNK, cz: (cj + 0.5) * CHUNK, small: null, big: null };
    if (small.length) out.small = this._mesh(small, false);
    if (big.length) out.big = this._mesh(big, true);
    return out;
  }

  _mesh(list, shadows) {
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const color = new THREE.Color();
    list.forEach((b, k) => {
      const tilt = new THREE.Euler((hash(b.i, b.j, 211) - 0.5) * 0.35, b.yaw, (hash(b.i, b.j, 212) - 0.5) * 0.35, 'YXZ');
      q.setFromEuler(tilt);
      s.set(b.r, b.h, b.r * (0.75 + 0.45 * hash(b.i, b.j, 213)));
      p.set(b.x, this.hm.heightAt(b.x, b.z), b.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      if (b.rock) color.setRGB(0.27, 0.26, 0.25).multiplyScalar(0.85 + 0.3 * hash(b.i, b.j, 214));
      else color.setRGB(0.60, 0.74, 0.84).lerp(new THREE.Color(0.82, 0.87, 0.91), hash(b.i, b.j, 215));
      mesh.setColorAt(k, color);
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.add(mesh);
    return mesh;
  }
}

/** A lumpy, faceted block: bottom half buried, top rounded. */
export function blockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Flatten into facets and roughen.
    const n = 1 + 0.18 * Math.sin(v.x * 5.1 + v.y * 3.3) * Math.cos(v.z * 4.7 - v.x * 2.1) + 0.08 * Math.sin(v.y * 9 + v.z * 7);
    v.multiplyScalar(n);
    v.y = v.y > 0 ? v.y : v.y * 1.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Ice or rock on the sides (the instance colour), snow on whatever faces up. */
export function blockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;\nvarying vec3 vBW;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
mat4 bm = modelMatrix;
#ifdef USE_INSTANCING
bm = modelMatrix * instanceMatrix;
#endif
vUp = normalize(mat3(bm) * objectNormal).y;
vBW = (bm * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vUp;\nvarying vec3 vBW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float speck = fract(sin(dot(floor(vBW * 3.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
float cap = smoothstep(0.35, 0.65, vUp + (speck - 0.5) * 0.25);
diffuseColor.rgb *= 0.9 + 0.2 * speck;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), cap);`);
  };
  mat.customProgramCacheKey = () => 'glacier-blocks';
  return mat;
}
