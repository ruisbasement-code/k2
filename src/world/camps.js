// Tents at Base Camp and the camps on the route.

import * as THREE from 'three';

const COLORS = [0xffcc33, 0xff5533, 0x33aa66, 0xf4f4f4, 0x3377dd];

export function createCamps(hm, places) {
  const group = new THREE.Group();
  const dome = new THREE.SphereGeometry(1.4, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const mats = COLORS.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  let k = 0;
  for (const p of places) {
    const [cx, cz] = hm.gridToWorld(p.r, p.c);
    for (let i = 0; i < p.tents; i++) {
      const a = i * 2.399;
      const rr = 5 + Math.sqrt(i) * (p.tents > 10 ? 9 : 4.5);
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const t = new THREE.Mesh(dome, mats[k++ % mats.length]);
      t.scale.set(1, 1, 1.3);
      t.position.set(x, hm.heightAt(x, z) + 0.05, z);
      t.rotation.y = a;
      t.castShadow = true;
      t.receiveShadow = true;
      group.add(t);
    }
  }
  return group;
}
