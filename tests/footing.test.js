// Footing checks on steep ground: Q comes up, and missing it makes you slip,
// tear your clip off the fixed rope, or rip out your own screw.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Climber, Mode } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
tuning.rockfall_per_min = 0;
tuning.footing.enabled = true;

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

/** Clipped in on a steep stretch of the first rope, axe out, facing up it. */
function onSteepRope() {
  const c = new Climber(hm, ropes, route.places);
  const p = ropes.ropes[0].find((q) => { const s = hm.slopeDeg(q.x, q.z); return s > tuning.footing.min_deg + 2 && s < tuning.axe_climb_max_deg - 1; });
  c.placeAt(p.x, p.z, 0, 0);
  c.toggleClip();
  c.toggleAxe();
  c.axe.drawing = 0;
  c.update(FRAME, { x: 0, y: 0 });
  return c;
}

/** Climb along the rope until Q comes up (or give up after a while). */
function climbUntilPrompt(c, seconds = 15) {
  for (let t = 0; t < seconds && !c.footing.prompt; t += FRAME) {
    const tan = ropes.tangentAt(c.ropeId, c.ropeS);
    c.yaw = Math.atan2(-tan.x, -tan.z);
    c.update(FRAME, { x: 0, y: 1 });
  }
}

describe('footing checks', () => {
  it('come up every now and then while you climb steep ground, and Q catches them', () => {
    const c = onSteepRope();
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // no ordinary slips
    climbUntilPrompt(c);
    expect(c.footing.prompt).not.toBe(null);
    expect(c.footing.prompt.window).toBeGreaterThanOrEqual(tuning.footing.min_window_s);
    expect(c.catchFooting()).toBe(true);
    expect(c.footing.prompt).toBe(null);
    expect(c.footing.result).toBe('held');
    for (let t = 0; t < 2; t += FRAME) c.update(FRAME, { x: 0, y: 0 });
    expect(c.falling).toBe(false);
    expect(c.clipped).toBe(true);
    // Pressing Q with nothing to catch does nothing.
    expect(c.catchFooting()).toBe(false);
  });

  it('never come up walking on gentle ground', () => {
    const c = new Climber(hm, ropes, route.places);
    const bc = route.places.find((q) => q.name === 'Base Camp');
    const [x, z] = hm.gridToWorld(bc.r, bc.c);
    c.placeAt(x, z, 0, 0);
    for (let t = 0; t < 30; t += FRAME) c.update(FRAME, { x: 0, y: 1 });
    expect(c.footing.prompt).toBe(null);
  });

  it('missed on a fixed rope: the clip usually tears free and you fall unroped', () => {
    const c = onSteepRope();
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    climbUntilPrompt(c);
    expect(c.footing.prompt).not.toBe(null);
    c.footing.prompt.left = 0.01; // about to run out
    roll.mockReturnValue(0); // the clip fails
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.footing.result).toBe('slipped');
    expect(c.falling).toBe(true);
    expect(c.fall.rope).toBe(null);
    expect(c.clipped).toBe(false);
  });

  it('missed on a fixed rope: when the clip holds, the rope catches you', () => {
    const c = onSteepRope();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    climbUntilPrompt(c);
    for (let t = 0; t < 2.5 && !c.falling; t += FRAME) c.update(FRAME, { x: 0, y: 0 });
    expect(c.falling).toBe(true);
    expect(c.fall.rope).not.toBe(null);
  });

  it('missed on your own screw: it holds you with a knock, or rips out', () => {
    for (const [roll, rips] of [[0.99, false], [0, true]]) {
      const c = onSteepRope();
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      climbUntilPrompt(c);
      c.unclip();
      let lost = false;
      c.protectionKind = () => (lost ? null : 'screw');
      c.onProtectionLost = () => { lost = true; };
      const health = c.health;
      Math.random.mockReturnValue(roll);
      c._footingFailed();
      expect(lost).toBe(rips);
      expect(c.falling).toBe(rips);
      if (!rips) expect(c.health).toBeLessThan(health);
      vi.restoreAllMocks();
    }
  });

  it('give you longer with the axe planted, and less with numb hands', () => {
    const c = onSteepRope();
    c.surface = { key: 'firm_snow', label: 'Firm snow' };
    c.mods = { grip: 1, slip: 1 };
    const axe = c._footingWindow(0.5);
    c.axe.inHand = false;
    const bare = c._footingWindow(0.5);
    c.mods = { grip: 0.6, slip: 1 };
    const numb = c._footingWindow(0.5);
    expect(axe).toBeGreaterThan(bare);
    expect(numb).toBeLessThan(bare);
    expect(c._footingWindow(1)).toBeLessThan(c._footingWindow(0) + 1e-9);
    expect(c.mode).not.toBe(Mode.FALL);
  });
});
