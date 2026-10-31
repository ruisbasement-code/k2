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

  it('a storm tent goes up anywhere not too steep, and you can sleep in it', () => {
    const c = climber();
    const ex = new Expedition(c);
    c.placeAt(c.position.x + 300, c.position.z, 0, 0);
    expect(ex.shelterOption()).toBe(null);
    c.pack.gear.add('tent');
    c.slope = 10;
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
