import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { loadHeightmap } from './helpers.js';
import { createCamps } from '../src/world/camps.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';

describe('camps', () => {
  const hm = loadHeightmap();
  const ropes = new FixedRopes(hm, route.fixed_ropes);
  const camps = createCamps(hm, route.places, ropes);

  it('builds every camp with finite geometry, old tents and flags included', () => {
    const names = camps.children.map((c) => c.name);
    expect(names).toContain('Base Camp');
    expect(names).toContain('Camp 4');
    for (const camp of camps.children) {
      const keys = new Set();
      camp.traverse((o) => {
        if (!o.geometry) return;
        const p = o.geometry.getAttribute('position').array;
        for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
        if (o.material?.side === THREE.DoubleSide && o.material.roughness > 0.9) keys.add('worn');
      });
      // Every camp has leftovers from earlier seasons.
      expect(keys.has('worn'), camp.name).toBe(true);
    }
  });

  it('still lists only the tents you can sleep in', () => {
    const counts = {};
    for (const t of camps.userData.tents) counts[t.camp] = (counts[t.camp] ?? 0) + 1;
    for (const p of route.places) if (p.tents) expect(counts[p.name]).toBe(p.tents);
  });
});
