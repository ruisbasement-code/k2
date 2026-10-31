import { describe, it, expect } from 'vitest';
import { Pack } from '../src/sim/pack.js';
import { Expedition, GEAR, difficulty } from '../src/sim/gear.js';
import { Climber } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import { tuning } from '../src/sim/paceModel.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const climber = () => {
  const c = new Climber(hm, ropes, route.places);
  c.tents = [];
  return c;
};

describe('pack space and weight', () => {
  it('gear takes room and weighs something', () => {
    const p = new Pack();
    const kg = p.kg, l = p.litres;
    p.gear.add('tent');
    expect(p.kg).toBeCloseTo(kg + GEAR.tent.kg);
    expect(p.litres).toBeCloseTo(l + GEAR.tent.litres);
  });

  it('a full pack takes no more supplies', () => {
    const p = new Pack();
    p.gear = new Set(['tent', 'down_suit', 'rope', 'shovel', 'crampons', 'axe', 'stove']);
    p.resupply({ snack: -1, meal: -1, gas: -1, water: -1, oxygen: 20, dex: -1 }, { snack: 10, meal: 3, gas: 2, water: 1.5, oxygen: 6, dex: 4 });
    expect(p.litres).toBeLessThanOrEqual(p.capacity + 1e-9);
    expect(p.bottles.length).toBeLessThan(6);
  });

  it("won't pack gear that doesn't fit, and a heavier pack is slower", () => {
    const c = climber();
    const ex = new Expedition(c);
    for (const id of ['tent', 'down_suit', 'rope', 'shovel', 'stove', 'screws', 'pickets']) ex.toggle(id);
    while (ex.adjust('oxygen', 1));
    expect(ex.toggle('radio') || ex.free() >= GEAR.radio.litres).toBe(true);
    expect(c.pack.litres).toBeLessThanOrEqual(c.pack.capacity + 1e-9);
    const light = c.phys.modifiers(new Pack().kg).speed;
    expect(c.phys.modifiers(c.pack.kg).speed).toBeLessThan(light);
  });

  it('the bigger pack and better gear come only after a summit and a safe return', () => {
    const c = climber();
    const bc = route.places[0];
    const [bx, bz] = hm.gridToWorld(bc.r, bc.c);
    c.placeAt(bx, bz, 0, 0);
    const ex = new Expedition(c, { summitHeight: c.position.y - 10, summit: { x: c.position.x, z: c.position.z } });
    expect(ex.available()).not.toContain('crampons_pro');
    expect(ex.packs()).toEqual(['pack45']);
    let unlocked = false;
    ex.onUnlock = () => { unlocked = true; };
    ex.update(); // standing on the "summit", which is Base Camp here
    expect(unlocked).toBe(true);
    expect(ex.available()).toContain('crampons_pro');
    expect(ex.toggle('crampons_pro')).toBe(true);
    expect(c.pack.gear.has('crampons')).toBe(false);
  });
});

describe('gear on the mountain', () => {
  it('no crampons on snow or ice makes slips likelier; steel ones make them rarer', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.surface = { key: 'ice', label: 'Ice' };
    c.pack.gear.delete('crampons');
    ex.update();
    expect(c.effects.get('gear:crampons').slip).toBe(tuning.no_crampons_slip);
    c.pack.gear.add('crampons_pro');
    ex.update();
    expect(c.effects.get('gear:crampons').slip).toBeLessThan(1);
  });

  it('a down suit and mitts keep the cold out', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.pack.gear.add('down_suit');
    c.pack.gear.add('gloves');
    ex.update();
    expect(c.phys.insulationMult).toBeGreaterThan(1);
    expect(c.phys.frostbiteMult).toBeLessThan(1);
  });

  it('a storm tent goes up on flat ground, and you can sleep in it', () => {
    const c = climber();
    const ex = new Expedition(c);
    // Flat, smooth ground well away from the camps.
    let spot = null;
    for (let x = -3000; x < 3000 && !spot; x += 53) {
      for (let z = -3000; z < 3000 && !spot; z += 47) {
        c.placeAt(x, z, 0, 0);
        if (c._campNearby() || hm.glacierAt(x, z) > 0.3) continue;
        const [gx, gz] = hm.gradient(x, z);
        if (Math.hypot(gx, gz) < 0.08 && ex.footprint().tilt < 8 && ex.footprint().bump < 0.1) spot = { x, z };
      }
    }
    c.placeAt(spot.x, spot.z, 0, 0);
    c.slope = 4;
    c.surface = { key: 'soft_snow' };
    expect(ex.shelterOption()).toBe(null);
    c.pack.gear.add('tent');
    const opt = ex.shelterOption();
    expect(opt.kind).toBe('tent');
    ex.makeShelter(opt);
    expect(c.pack.gear.has('tent')).toBe(false);
    expect(c.canSleep()).toBe(true);
    expect(ex.canCookHere()).toBe(false); // no stove
    ex.strike(ex.ownTentNearby());
    expect(c.pack.gear.has('tent')).toBe(true);
    expect(c.canSleep()).toBe(false);
  });

  it('a tent only goes up on reasonably flat, stable ground, but always in a camp', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.pack.gear.add('tent');
    // Somewhere steep and away from any camp: the tent is refused, with a reason.
    let steep = null;
    for (let x = -3000; x < 3000 && !steep; x += 37) {
      for (let z = -3000; z < 3000 && !steep; z += 41) {
        const [gx, gz] = hm.gradient(x, z);
        const far = c.places.every((p) => Math.hypot(p.x - x, p.z - z) > tuning.camp_radius_m);
        if (far && Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI > 33) steep = { x, z };
      }
    }
    c.placeAt(steep.x, steep.z, 0, 0);
    c.slope = 34;
    c.surface = { key: 'firm_snow' };
    c.onLedge = false;
    expect(c._campNearby()).toBeFalsy();
    expect(ex.pitchProblem()).toMatch(/steep/i);
    expect(ex.shelterOption()).toBe(null);
    c.surface = { key: 'rock' };
    expect(ex.pitchProblem()).toMatch(/rock/i);
    // The same ground in a camp is fine.
    c.places = [{ name: 'Test Camp', x: steep.x, z: steep.z }];
    expect(ex.pitchProblem()).toBe(null);
    expect(ex.shelterOption().kind).toBe('tent');
  });

  it('not beside a crevasse you know about', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.pack.gear.add('tent');
    c.placeAt(c.position.x + 300, c.position.z, 0, 0);
    c.slope = 5;
    c.surface = { key: 'glacier' };
    const hole = { id: 'h', hidden: false };
    const { x, z } = c.position;
    c.features = {
      corniceAt: () => null, seracAt: () => null, isKnown: (h) => !h.hidden,
      holeAt: (px, pz) => (Math.hypot(px - (x + 4), pz - z) < 1.5 ? { hole } : null),
    };
    expect(ex.pitchProblem()).toMatch(/crevasse/i);
    hole.hidden = true; // a hidden one you haven't found doesn't stop you
    expect(ex.pitchProblem()).not.toMatch(/crevasse/i);
  });

  it('protection needs the rope and the right anchor for the surface', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.slope = tuning.climb_start_deg + 5;
    c.surface = { key: 'ice', label: 'Ice' };
    expect(ex.canProtect().why).toBe('no rope');
    c.pack.gear.add('rope');
    expect(ex.canProtect().why).toBe('no ice screws');
    c.pack.gear.add('screws');
    expect(ex.canProtect().kind).toBe('screw');
    ex.protect('screw');
    ex.update();
    expect(c.effects.get('gear:protection').slip).toBeLessThan(1);
  });

  it('jobs get harder in wind and with frostbite', () => {
    const c = climber();
    const calm = difficulty(c);
    c.conditions = { gust: 25, windChillC: -35 };
    c.phys.frostbite = 0.4;
    expect(difficulty(c)).toBeGreaterThan(calm + 0.5);
  });
});
