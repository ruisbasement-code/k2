// The ice axe: held in your hand, it is the only way to self-arrest and to climb
// steep snow and ice. Without it you slide. It can be lost in a tumble.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Climber } from '../src/player/climber.js';
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

function run(c, seconds, input = { x: 0, y: 0 }) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

function find(test) {
  for (let r = 260; r < 480; r += 2) {
    for (let col = 260; col < 480; col += 2) {
      const [x, z] = hm.gridToWorld(r, col);
      const s = hm.slopeDeg(x, z);
      const y = hm.heightAt(x, z);
      if (test({ x, z, s, y, key: Pace.surfaceAt(y, s, hm.glacierAt(x, z)).key })) return { x, z, s };
    }
  }
  return null;
}

function climber(spot, axe) {
  const c = new Climber(hm, ropes, route.places);
  c.placeAt(spot.x, spot.z, 0, 0);
  c.mountainSeconds = 8 * 3600; // morning: no slush
  c.health = 1e9;
  if (axe) {
    c.toggleAxe();
    c.axe.drawing = 0;
  }
  return c;
}

describe('ice axe', () => {
  it('self-arrests only with the axe in your hand', () => {
    const spot = find(({ x, z, s, key }) => s > 24 && s < 28 && key === 'firm_snow' && !ledgeAt(x, z, s));
    const slide = (axe) => {
      const c = climber(spot, axe);
      const [gx, gz] = hm.gradient(spot.x, spot.z);
      c._startFall(gx, gz, 'test', { back: false, head: false, speed: 8 });
      vi.spyOn(Math, 'random').mockReturnValue(0.99); // the axe stays in your hands
      let arrested = false;
      for (let t = 0; t < 1.5 && c.falling; t += FRAME) {
        c.update(FRAME, { x: 0, y: 0, arrest: true });
        arrested ||= c.fall.arresting;
      }
      vi.restoreAllMocks();
      return { c, arrested };
    };
    const hands = slide(false);
    expect(hands.arrested).toBe(false);
    const axe = slide(true);
    expect(axe.arrested).toBe(true);
    expect(axe.c.falling).toBe(false);
  });

  it('takes a moment to draw, even mid-slide', () => {
    const spot = find(({ s, key }) => s > 28 && s < 33 && key === 'firm_snow');
    const c = climber(spot, false);
    c.toggleAxe();
    expect(c.axeReady).toBe(false);
    run(c, tuning.axe_draw_s + 0.1);
    expect(c.axeReady).toBe(true);
    c.toggleAxe();
    expect(c.axe.inHand).toBe(false);
  });

  it('climbs steep snow unroped that you would slide off without it', () => {
    const spot = find(({ x, z, s, key }) => s > 36 && s < 40 && key === 'firm_snow' && !ledgeAt(x, z, s));
    expect(spot).not.toBe(null);
    const go = (axe) => {
      const c = climber(spot, axe);
      const [gx, gz] = hm.gradient(spot.x, spot.z);
      c.yaw = Math.atan2(-gx, -gz);
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const y0 = c.position.y;
      run(c, 3, { x: 0, y: 1 });
      vi.restoreAllMocks();
      return { c, gain: c.position.y - y0 };
    };
    const without = go(false);
    expect(without.c.falling || without.c.blocked).toBe(true);
    const withAxe = go(true);
    expect(withAxe.c.falling).toBe(false);
    expect(withAxe.gain).toBeGreaterThan(0.3);
  });

  it('climbs very steep snow and ice just by holding it, and slides when you stow it', () => {
    const spot = find(({ x, z, s, key }) => s > 46 && s < 56 && (key === 'firm_snow' || key === 'ice') && !ledgeAt(x, z, s));
    expect(spot).not.toBe(null);
    const c = climber(spot, true);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c.yaw = Math.atan2(-gx, -gz);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const y0 = c.position.y;
    run(c, 3, { x: 0, y: 1 });
    expect(c.falling).toBe(false);
    expect(c.position.y - y0).toBeGreaterThan(0.3);
    // Put it away and the slope takes you.
    c.toggleAxe();
    run(c, 0.2, { x: 0, y: 0 });
    expect(c.falling).toBe(true);
  });

  it('can be lost in a tumble: on its leash, or gone if the leash snaps', () => {
    const spot = find(({ s, key }) => s > 28 && s < 33 && key === 'firm_snow');
    const c = climber(spot, true);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c._startFall(gx, gz, 'test');
    vi.spyOn(Math, 'random').mockReturnValue(0.3); // grip lost, leash holds
    c._tumble();
    expect(c.axe.dangling).toBeGreaterThan(0);
    expect(c.axeReady).toBe(false);
    vi.restoreAllMocks();

    const d = climber(spot, true);
    d._startFall(gx, gz, 'test');
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // leash snaps too
    d._tumble();
    expect(d.axe.have).toBe(false);
  });

  it('gives you a spare axe at a camp', () => {
    const c = new Climber(hm, ropes, route.places);
    const p = route.places.find((q) => q.name === 'Base Camp');
    const [x, z] = hm.gridToWorld(p.r, p.c);
    c.placeAt(x, z, 0, 0);
    c.axe.have = false;
    c.resupply();
    expect(c.axe.have).toBe(true);
  });
});
