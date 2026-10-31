// Shelters you make yourself: a pitched storm tent, a snow cave, a bivy sack.
// Rebuilt whenever the list of your own shelters changes.

import * as THREE from 'three';
import { PropBatch, campMaterials } from './propBatch.js';
import { domeTent } from './campProps.js';

export class ShelterMeshes extends THREE.Group {
  constructor(hm) {
    super();
    this.hm = hm;
    this.materials = campMaterials();
    this.key = '';
  }

  /** @param tents the climber's tents; only those with `own` are drawn here. */
  update(tents) {
    const own = tents.filter((t) => t.own);
    const key = own.map((t) => `${t.own}:${t.x.toFixed(1)},${t.z.toFixed(1)}`).join('|');
    if (key === this.key) return;
    this.key = key;
    for (const ch of [...this.children]) {
      this.remove(ch);
      ch.traverse((o) => o.geometry?.dispose());
    }
    if (!own.length) return;
    const b = new PropBatch();
    const rand = () => 0.9; // no props by the door
    for (const t of own) {
      const y = this.hm.heightAt(t.x, t.z);
      const base = new THREE.Matrix4().makeRotationY((t.yaw ?? 0) + Math.PI).setPosition(t.x, y - 0.05, t.z);
      if (t.own === 'tent') domeTent(b, base, 0xe8571c, rand, { len: 2, wid: 1.3, h: 1 });
      else if (t.own === 'cave') {
        b.add(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 'snow', 0xf2f5f8, base.clone().scale(new THREE.Vector3(2.2, 1.3, 2.2)), true);
        b.add(new THREE.CircleGeometry(0.45, 10), 'stone', 0x14171c, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.4, 2.12)));
      } else {
        b.add(new THREE.CapsuleGeometry(0.32, 1.5, 4, 8), 'fabric', 0xd96b1c, base.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.22, 0)), true);
      }
    }
    this.add(b.build(this.materials));
  }
}
