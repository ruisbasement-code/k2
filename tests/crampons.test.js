// Crampons on or in the pack, and footing on the ledges: verglas, rotten ice lips
// and loose rock live on particular ledges and steps, not the whole slope.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Climber } from '../src/player/climber.js';
import { Expedition } from '../src/sim/gear.js';
import * as Pace from '../src/sim/paceModel.js';
import { ledgeAt, ledgesNear, ledgeKind } from '../src/sim/hazards.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

const run = (c, seconds, input = { x: 0, y: 0 }) => {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
};
const at = (name) => {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
};
function find(test) {
  for (let r = 260; r < 480; r += 2) {
    for (let col = 260; col < 480; col += 2) {
      const [x, z] = hm.gridToWorld(r, col);
      const s = hm.slopeDeg(x, z);
      const y = hm.heightAt(x, z);
      if (test({ x, z, s, y, key: Pace.surfaceAt(y, s, hm.glacierAt(x, z), 8).key })) return { x, z, s };
    }
  }
  return null;
}
function climber(spot) {
  const c = new Climber(hm, ropes, route.places);
  c.tents = [];
  c.placeAt(spot.x, spot.z, 0, 0);
  c.mountainSeconds = 8 * 3600;
  c.health = 1e9;
  return c;
}

describe('crampons', () => {
  it('go on where you can stand, take time, and keep you still while you fit them', () => {
    const [x, z] = at('Base Camp');
    const c = climber({ x, z });
    c.crampons.on = false;
    const before = c.mountainSeconds;
    c.toggleCrampons();
    expect(c.crampons.fitting).toBeGreaterThan(0);
    expect(c.mountainSeconds - before).toBeGreaterThanOrEqual(tuning.crampon_on_minutes * 60);
    const p = c.position.clone();
    run(c, 0.5, { x: 0, y: 1 });
    expect(c.position.distanceTo(p)).toBeLessThan(0.01);
    run(c, tuning.crampon_fit_s * 3);
    expect(c.cramponsOn).toBe(true);
  });

  it('cannot be fitted halfway up a bare steep slope', () => {
    const spot = find(({ x, z, s, key }) => s > 30 && s < 34 && key === 'firm_snow' && !ledgeAt(x, z, s));
    const c = climber(spot);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    run(c, 0.1);
    c.crampons.on = false;
    c.toggleCrampons();
    expect(c.crampons.fitting).toBe(0);
    expect(c.crampons.on).toBe(false);
  });

  it('without them on, steep ice will not hold you even with the axe', () => {
    const spot = find(({ x, z, s, key }) => s > 45 && s < 55 && key === 'ice' && !ledgeAt(x, z, s));
    expect(spot).not.toBe(null);
    const stand = (on) => {
      const c = climber(spot);
      c.toggleAxe();
      c.axe.drawing = 0;
      c.crampons.on = on;
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      run(c, 0.3);
      vi.restoreAllMocks();
      return !c.falling;
    };
    expect(stand(true)).toBe(true);
    expect(stand(false)).toBe(false);
  });

  it('carried in the pack do nothing; worn on rock they skate', () => {
    const c = climber({ x: 0, z: 0 });
    const ex = new Expedition(c);
    c.surface = { key: 'ice', label: 'Ice' };
    c.crampons.on = false;
    ex.update();
    expect(c.effects.get('gear:crampons').slip).toBe(tuning.no_crampons_ice_slip);
    c.crampons.on = true;
    ex.update();
    expect(c.effects.get('gear:crampons')).toBeUndefined();
    c.surface = { key: 'rock', label: 'Rock' };
    ex.update();
    expect(c.effects.get('gear:crampons').slip).toBe(tuning.crampons_rock_slip);
  });
});

describe('footing on ledges', () => {
  it('only some ledges are glazed or have a rotten lip', () => {
    const [x, z] = at('Camp 2');
    const near = ledgesNear(hm, x, z, 800);
    const kinds = { sound: 0, verglas: 0, rotten: 0 };
    for (const l of near) kinds[l.kind]++;
    expect(kinds.verglas).toBeGreaterThan(0);
    expect(kinds.rotten).toBeGreaterThan(0);
    expect(kinds.sound).toBeGreaterThan(kinds.verglas + kinds.rotten);
    expect(['sound', 'verglas', 'rotten']).toContain(ledgeKind(3, 4));
  });

  it('a glazed ledge throws you off far more often without crampons', () => {
    const [x, z] = at('Camp 2');
    const l = ledgesNear(hm, x, z, 1500).find((q) => q.kind === 'verglas' && q.slope > 30 && q.slope < 45);
    expect(l).toBeTruthy();
    const slips = (on) => {
      let n = 0;
      for (let k = 0; k < 400; k++) {
        const c = climber(l);
        c.crampons.on = on;
        c.ledge = ledgeAt(l.x, l.z, l.slope);
        const [gx, gz] = hm.gradient(l.x, l.z);
        if (c._ledgeFooting(gx, gz)) n++;
      }
      return n;
    };
    expect(slips(false)).toBeGreaterThan(slips(true) * 3);
  });
});
