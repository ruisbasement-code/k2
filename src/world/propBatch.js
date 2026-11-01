// Collects many small props into a few merged meshes, one per material, so a camp
// with hundreds of tents, stones and flags costs a handful of draw calls.
// Each piece carries its colour as a vertex colour.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

export class PropBatch {
  constructor() {
    this.parts = new Map(); // material key -> [geometry]
    this.lines = []; // flat xyz pairs for guy lines and flag strings
  }

  /**
   * @param geo source geometry (not modified)
   * @param key material key, see campMaterials()
   * @param color hex colour
   * @param matrix world placement
   * @param flat recompute normals per face for a faceted look
   */
  add(geo, key, color, matrix, flat = false) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('uv1');
    g.applyMatrix4(matrix);
    if (flat || !g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    _c.setHex(color);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  line(a, b) {
    this.lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  /** A sagging line from a to b drawn as segments; returns the points. */
  sagLine(a, b, sag, steps = 12) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
      if (i) this.line(pts[i - 1], p);
    }
    return pts;
  }

  build(materials) {
    const group = new THREE.Group();
    for (const [key, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), materials[key]);
      mesh.castShadow = key !== 'flag';
      mesh.receiveShadow = true;
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    if (this.lines.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.lines, 3));
      group.add(new THREE.LineSegments(geo, materials.line));
    }
    return group;
  }
}

/** Shared materials for every camp. update(t) makes the prayer flags flutter. */
export function campMaterials() {
  const time = { value: 0 };
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const flag = std({ roughness: 0.9, side: THREE.DoubleSide });
  flag.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'attribute float flutter;\nuniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float w = sin(uTime * 7.0 + position.x * 1.9 + position.z * 1.3) + 0.5 * sin(uTime * 13.0 + position.x * 4.1);
      transformed += vec3(0.55, 0.2, 0.35) * flutter * (0.07 + 0.045 * w);`,
    );
  };
  return {
    fabric: std({ roughness: 0.75, flatShading: true }),
    soft: std({ roughness: 0.8 }),
    // Old, torn fabric: seen from both sides through the rips.
    worn: std({ roughness: 0.95, flatShading: true, side: THREE.DoubleSide }),
    stone: std({ roughness: 0.95, flatShading: true }),
    snow: std({ roughness: 0.85, flatShading: true }),
    metal: std({ roughness: 0.35, metalness: 0.7 }),
    plastic: std({ roughness: 0.45 }),
    flag,
    line: new THREE.LineBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.7 }),
    update(t) { time.value = t; },
  };
}
