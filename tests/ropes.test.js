// The fixed ropes as drawn: anchored, sagging a little between anchors, resting
// on the snow but never in it, and never far from the line you clip into.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadHeightmap } from './helpers.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
ropes.hm = hm;

describe('fixed rope drape', () => {
  for (let r = 0; r < ropes.ropes.length; r++) {
    it(`hangs the ${ropes.names[r]} between anchors, on the snow but not in it`, () => {
      const d = ropes._drape(r);
      const gaps = d.anchors.slice(1).map((a, i) => (a - d.anchors[i]) * d.ds);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(35.5);
      expect(gaps.length).toBeGreaterThan(ropes.lengthOf(r) / 40);
      let lifted = 0;
      for (let i = 0; i <= d.n; i++) {
        const above = d.y[i] - d.g[i];
        expect(above).toBeGreaterThan(0.015);
        expect(above).toBeLessThan(1.5); // only off a sudden step
        if (above > 0.1) lifted++;
      }
      // It hangs clear of the ground on part of its length, not all of it.
      expect(lifted / d.n).toBeGreaterThan(0.05);
      expect(lifted / d.n).toBeLessThan(0.95);
      expect(d.kinds.every((k) => k === 'piton' || k === 'picket')).toBe(true);
      // The tether clips onto the rope as drawn, under the clip line.
      ropes.drapes = [];
      ropes.drapes[r] = d;
      const p = new THREE.Vector3(), q = new THREE.Vector3();
      for (let s = 0; s < ropes.lengthOf(r); s += 7) {
        ropes.visualPointAt(r, s, p);
        ropes.pointAt(r, s, q);
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(0.1);
      }
    });
  }
});
