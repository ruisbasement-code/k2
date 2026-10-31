// Drives the real Climber with simulated input on the real terrain: walking at
// Base Camp, clipping into and climbing a fixed rope, resting, and slipping on
// very steep ground.

import { describe, it, expect, vi } from 'vitest';
import { Climber, Mode } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

function at(name) {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
}

function run(c, seconds, input) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

describe('climber', () => {
  it('walks across Base Camp', () => {
    const c = new Climber(hm, ropes);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    const start = c.position.clone();
    run(c, 4, { x: 0, y: 1 });
    expect(c.mode).toBe(Mode.WALK);
    expect(c.position.distanceTo(start)).toBeGreaterThan(5);
  });

  it('clips into the rope, climbs it at a realistic pace, rests and unclips', () => {
    const c = new Climber(hm, ropes);
    const [x, z] = at('Advanced Base Camp');
    c.placeAt(x, z, 0, 0);
    c.toggleClip();
    expect(c.ropeId).toBe(0);
    const y0 = c.position.y;
    const clock0 = c.mountainSeconds;
    const stamina0 = c.body.stamina;
    for (let t = 0; t < 20; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1 });
    }
    const rate = (c.position.y - y0) / ((c.mountainSeconds - clock0) / 3600);
    expect(rate).toBeGreaterThan(250);
    expect(rate).toBeLessThan(500);
    expect(c.body.stamina).toBeLessThan(stamina0);

    const tired = c.body.stamina;
    run(c, 10, { x: 0, y: 0 });
    expect(c.body.stamina).toBeGreaterThan(tired);
    expect(c.verticalNow).toBe(0);
    c.toggleClip();
    expect(c.ropeId).toBe(-1);
  });

  it('slips and slides down when climbing very steep ground unroped', () => {
    // Find the steepest ground near Camp 1 that is still climbable without a rope.
    const [cx, cz] = at('Camp 1');
    let best = null;
    for (let dx = -300; dx < 300; dx += 15) {
      for (let dz = -300; dz < 300; dz += 15) {
        const s = hm.slopeDeg(cx + dx, cz + dz);
        if (s < 64 && (!best || s > best.s)) best = { s, x: cx + dx, z: cz + dz };
      }
    }
    const c = new Climber(hm, ropes);
    c.placeAt(best.x, best.z, best.x, best.z);
    const [gx, gz] = hm.gradient(best.x, best.z);
    c.yaw = Math.atan2(gx, gz);
    c.body.stamina = 10;
    let slipped = false;
    c.onMessage = (t) => { if (t.startsWith('You slipped')) slipped = true; };
    // Make every chance roll come up as a slip, so the test is not random.
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0);
    const y0 = c.position.y;
    c.update(FRAME, { x: 0, y: 1, push: true });
    expect(c.mode).toBe(Mode.STEEP);
    expect(slipped).toBe(true);
    run(c, 1.5, { x: 0, y: 0 });
    expect(c.position.y).toBeLessThan(y0 - 5);
    roll.mockRestore();
  });
});
