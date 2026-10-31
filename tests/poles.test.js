// Trekking poles: quicker and less tiring on gentle ground; on steep ground they
// skate, and leaning on them instead of the axe makes slips far more likely.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Climber } from '../src/player/climber.js';
import { Expedition } from '../src/sim/gear.js';
import * as Pace from '../src/sim/paceModel.js';
import { ledgeAt } from '../src/sim/hazards.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

function find(test) {
  for (let r = 200; r < 520; r += 2) {
    for (let col = 200; col < 520; col += 2) {
      const [x, z] = hm.gridToWorld(r, col);
      const s = hm.slopeDeg(x, z);
      const y = hm.heightAt(x, z);
      if (test({ x, z, s, y, key: Pace.surfaceAt(y, s, hm.glacierAt(x, z)).key })) return { x, z, s };
    }
  }
  return null;
}

function climber(spot, poles) {
  const c = new Climber(hm, ropes, route.places);
  c.tents = [];
  c.placeAt(spot.x, spot.z, 0, 0);
  c.mountainSeconds = 8 * 3600;
  c.health = 1e9;
  c.pack.gear.add('poles');
  if (poles) c.togglePoles();
  return c;
}

describe('trekking poles', () => {
  it('come out in your hands when packed, and swap with the axe', () => {
    const c = new Climber(hm, ropes, route.places);
    c.tents = [];
    const ex = new Expedition(c);
    ex.toggle('poles');
    expect(c.polesReady).toBe(true);
    c.toggleAxe();
    expect(c.poles.inHand).toBe(false);
    expect(c.axe.inHand).toBe(true);
    c.togglePoles();
    expect(c.polesReady).toBe(true);
    expect(c.axe.inHand).toBe(false);
    ex.toggle('poles');
    expect(c.polesReady).toBe(false);
  });

  it('are quicker and less tiring on gentle ground', () => {
    const spot = find(({ s, y }) => s > 3 && s < 10 && y < 5600);
    expect(spot).not.toBeNull();
    const walk = (poles) => {
      const c = climber(spot, poles);
      for (let t = 0; t < 3; t += FRAME) c.update(FRAME, { x: 0, y: 1 });
      return { pace: c.pace, effort: c.effort, help: c.polesHelp };
    };
    const bare = walk(false);
    const poles = walk(true);
    expect(poles.help).toBe(true);
    expect(poles.pace).toBeGreaterThan(bare.pace * 1.05);
    expect(poles.effort).toBeLessThan(bare.effort);
  });

  it('make slips on steep ground much more likely than the axe', () => {
    const spot = find(({ x, z, s, key }) => s > 30 && s < 34 && key === 'firm_snow' && !ledgeAt(x, z, s));
    expect(spot).not.toBeNull();
    const chance = (setup) => {
      const c = climber(spot, false);
      setup(c);
      c.update(FRAME, { x: 0, y: 0 });
      // Count the minutes of 200 evenly spread random draws that end in a slip.
      let p = 0;
      c._startFall = () => { p++; };
      const random = vi.spyOn(Math, 'random');
      for (let i = 0; i < 200; i++) {
        random.mockReturnValue(i / 200);
        c._maybeSlip(60, ...hm.gradient(spot.x, spot.z), true);
      }
      vi.restoreAllMocks();
      return { p, onSteep: c.polesOnSteep };
    };
    const withPoles = chance((c) => c.togglePoles());
    const withAxe = chance((c) => { c.toggleAxe(); c.axe.drawing = 0; });
    const bare = chance(() => {});
    expect(withPoles.onSteep).toBe(true);
    expect(withPoles.p).toBeGreaterThan(bare.p);
    expect(withPoles.p).toBeGreaterThan(withAxe.p * 3);
  });

  it('warn you once when you take them onto steep ground', () => {
    const spot = find(({ x, z, s, key }) => s > 30 && s < 34 && key === 'firm_snow' && !ledgeAt(x, z, s));
    const c = climber(spot, true);
    const msgs = [];
    c.onMessage = (m) => msgs.push(m);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    for (let t = 0; t < 1; t += FRAME) c.update(FRAME, { x: 0, y: 0 });
    expect(msgs.filter((m) => m.includes('poles skate')).length).toBe(1);
  });
});
