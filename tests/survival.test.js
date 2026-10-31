// The body over hours and days: pack weight, food, water, cold, frostbite,
// oxygen, acclimatization and altitude illness, and the hooks for weather.

import { describe, it, expect } from 'vitest';
import { Physiology } from '../src/sim/physiology.js';
import { Pack } from '../src/sim/pack.js';
import { airAt, windChill } from '../src/sim/environment.js';
import { tuning } from '../src/sim/paceModel.js';
import { Climber } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);

/** Run the body for hours in 0.1 h steps; returns the first death cause, if any. */
function live(ph, hours, ctx) {
  for (let h = 0; h < hours; h += 0.1) {
    const hour = ((ctx.startHour ?? 12) + h) % 24;
    const air = ctx.air ?? airAt(ctx.altitude, hour);
    const r = ph.step(0.1, { ...ctx, air });
    if (r.damage === Infinity) return r.cause;
  }
  return null;
}

const fullPack = () => {
  const p = new Pack();
  p.resupply(structuredClone(tuning.camp_stores['Base Camp']));
  return p;
};

describe('pack', () => {
  it('starts at a realistic weight, and oxygen bottles are heavy', () => {
    const p = fullPack();
    expect(p.kg).toBeGreaterThan(10);
    expect(p.kg).toBeLessThan(14);
    expect(p.bottles.length).toBe(0);
    const stores = structuredClone(tuning.camp_stores['Camp 4']);
    p.resupply(stores);
    expect(p.bottles.length).toBe(2);
    expect(stores.oxygen).toBe(tuning.camp_stores['Camp 4'].oxygen - 2);
    expect(p.kg).toBeGreaterThan(18);
  });

  it('a heavier pack is slower and harder work', () => {
    const ph = new Physiology();
    const light = ph.modifiers(10), heavy = ph.modifiers(22);
    expect(heavy.speed).toBeLessThan(light.speed);
    expect(heavy.effort).toBeGreaterThan(light.effort);
  });

  it('camp stores run out', () => {
    const p = new Pack();
    const stores = { snack: 3, meal: 0, gas: 0, water: 0, oxygen: 0, dex: 0 };
    expect(p.resupply(stores)).toEqual(['3 snack bars']);
    expect(stores.snack).toBe(0);
    expect(p.resupply(stores)).toEqual([]);
  });
});

describe('food and water', () => {
  it('a day of hard climbing without eating leaves you low on sugar and slower', () => {
    const ph = new Physiology();
    live(ph, 8, { altitude: 6000, effort: 1, pack: new Pack() });
    expect(ph.food).toBeLessThan(tuning.low_sugar_below);
    expect(ph.modifiers().speed).toBeLessThan(new Physiology().modifiers().speed);
    const pack = fullPack();
    ph.nausea = 0;
    const hungry = ph.food;
    expect(ph.eat(pack)).toBe(true);
    expect(ph.food).toBeCloseTo(hungry + (tuning.pack.snack.kcal / tuning.food_kcal_full) * 100, 5);
  });

  it('effort and thin air dry you out; drinking helps', () => {
    const ph = new Physiology();
    live(ph, 6, { altitude: 7000, effort: 1, pack: new Pack() });
    expect(ph.hydration).toBeLessThan(60);
    const before = ph.hydration;
    ph.drink(0.5);
    expect(ph.hydration).toBeCloseTo(before + (0.5 / tuning.water_full_deficit_l) * 100, 5);
  });
});

describe('cold', () => {
  it('wind chill makes it feel much colder', () => {
    expect(windChill(-20, 15)).toBeLessThan(-30);
    expect(windChill(5, 1)).toBe(5);
  });

  it('the air is colder higher up and at night', () => {
    expect(airAt(8000, 12).airTempC).toBeLessThan(airAt(5000, 12).airTempC - 15);
    expect(airAt(5000, 3).airTempC).toBeLessThan(airAt(5000, 15).airTempC);
  });

  it('resting in the open on a summit night brings hypothermia, then death', () => {
    const ph = new Physiology();
    ph.acclimatized = 7000;
    ph.flow = 0;
    const cause = live(ph, 24, { altitude: 8400, effort: 0, startHour: 20, pack: new Pack() });
    expect(cause).toMatch(/froze|HACE|HAPE/);
  });

  it('a tent and sleeping bag warm you back up', () => {
    const ph = new Physiology();
    ph.core = 34.5;
    live(ph, 4, { altitude: 6700, effort: 0, startHour: 22, sheltered: true, sleeping: true, pack: new Pack() });
    expect(ph.core).toBeGreaterThan(36.5);
  });

  it('moving keeps you warm in the cold', () => {
    const ph = new Physiology();
    live(ph, 4, { altitude: 7600, effort: 1, startHour: 8, pack: new Pack() });
    expect(ph.core).toBeGreaterThan(36);
  });

  it('frostbite builds in hard wind chill and can become permanent', () => {
    const ph = new Physiology();
    let lost = null;
    ph.onPermanentInjury = (label, health) => { lost = { label, health }; };
    ph.acclimatized = 7000;
    live(ph, 24, { altitude: 7000, effort: 0.2, pack: new Pack(), air: { airTempC: -35, windMs: 20, feelsLikeC: windChill(-35, 20), wet: 0 } });
    expect(lost?.label).toMatch(/Frostbit/);
  });
});

describe('altitude', () => {
  it('sleeping far above your acclimatization brings on altitude sickness; going down cures it', () => {
    const ph = new Physiology();
    live(ph, 10, { altitude: 6700, effort: 0, startHour: 20, sheltered: true, sleeping: true, pack: new Pack() });
    expect(ph.ams).toBeGreaterThan(0.5);
    expect(ph.conditions().map((c) => c.label)).toEqual(expect.arrayContaining([expect.stringMatching(/AMS/)]));
    live(ph, 16, { altitude: 5000, effort: 0, pack: new Pack() });
    expect(ph.ams).toBeLessThan(0.1);
  });

  it('acclimatizes with time spent high, up to a limit', () => {
    const ph = new Physiology();
    live(ph, 48, { altitude: 5600, effort: 0, sheltered: true, pack: new Pack() });
    expect(ph.acclimatized).toBeGreaterThan(5400);
    live(ph, 300, { altitude: 8000, effort: 0, sheltered: true, pack: new Pack() });
    expect(ph.acclimatized).toBeLessThanOrEqual(tuning.acclimatize_max_m);
  });

  it('staying high unacclimatized ends in HACE or HAPE', () => {
    const ph = new Physiology();
    ph.food = ph.hydration = 100;
    const cause = live(ph, 48, { altitude: 8000, effort: 0.5, sheltered: true, pack: new Pack() });
    expect(cause).toMatch(/HACE|HAPE/);
  });

  it('bottled oxygen makes the air feel lower and empties the bottle', () => {
    const ph = new Physiology();
    const pack = new Pack();
    pack.bottles = [tuning.pack.oxygen.litres];
    ph.flow = 2;
    live(ph, 1, { altitude: 8000, effort: 1, pack });
    expect(ph.effectiveAltitude).toBeLessThan(6500);
    expect(pack.bottles[0]).toBeLessThan(tuning.pack.oxygen.litres - 100);
    expect(pack.bottles[0]).toBeGreaterThan(tuning.pack.oxygen.litres - 150);
  });

  it('running out of oxygen high up hits hard', () => {
    const ph = new Physiology();
    const pack = new Pack();
    pack.bottles = [30];
    ph.flow = 3;
    live(ph, 0.3, { altitude: 8200, effort: 1, pack });
    expect(ph.flow).toBe(0);
    expect(ph.rebound).toBeGreaterThan(0.3);
    expect(ph.nausea).toBeGreaterThan(0.2);
    expect(ph.effectiveAltitude).toBe(8200);
  });

  it('dexamethasone slows altitude sickness', () => {
    const a = new Physiology(), b = new Physiology();
    const pack = fullPack();
    b.takeDex(pack);
    live(a, 6, { altitude: 7000, effort: 0, pack: new Pack() });
    live(b, 6, { altitude: 7000, effort: 0, pack: new Pack() });
    expect(b.ams).toBeLessThan(a.ams);
  });

  it('nausea can make you throw up what you eat', () => {
    const ph = new Physiology();
    ph.nausea = 1;
    const pack = fullPack();
    const food = ph.food;
    let vomited = 0;
    for (let i = 0; i < 10; i++) { ph.food = food; ph.eat(pack); if (ph.food === food) vomited++; }
    expect(vomited).toBeGreaterThan(2);
  });
});

describe('climber', () => {
  function at(name) {
    const c = new Climber(hm, ropes, route.places);
    const p = route.places.find((q) => q.name === name);
    const [x, z] = hm.gridToWorld(p.r, p.c);
    c.placeAt(x, z, 0, 0);
    return c;
  }

  it('starts packed from Base Camp, eats, drinks and restocks', () => {
    const c = at('Base Camp');
    expect(c.pack.snack).toBe(tuning.loadout.snack);
    c.phys.food = 50;
    expect(c.eat()).toBe(true);
    expect(c.pack.snack).toBe(tuning.loadout.snack - 1);
    expect(c.drink()).toBe(true);
    expect(c.resupply()).toBe(true);
    expect(c.pack.snack).toBe(tuning.loadout.snack);
  });

  it('weather and terrain can change the air and add effects', () => {
    const c = at('Base Camp');
    c.environment.airTempC = -40;
    c.environment.windMs = 25;
    expect(c.air.feelsLikeC).toBeLessThan(-60);
    c.effects.set('deep-snow', { label: 'Deep snow', speed: 0.5 });
    c.update(1 / 30, { x: 0, y: 0 });
    expect(c.mods.speed).toBeLessThan(0.6);
  });

  it('deep frostbite lowers your maximum health for good', () => {
    const c = at('Base Camp');
    c.phys.frostbite = 0.95;
    c.update(1 / 30, { x: 0, y: 0 });
    expect(c.maxHealth).toBe(100 - tuning.frostbite_permanent_health);
  });

  it('warns past the turnaround time high up', () => {
    const c = at('Bottleneck');
    const said = [];
    c.onMessage = (m) => said.push(m);
    c.clipped || c.toggleClip();
    c.mountainSeconds = c.turnaroundHour * 3600 + 60;
    c.update(1 / 30, { x: 0, y: 0 });
    expect(c.pastTurnaround).toBe(true);
    expect(said.some((m) => /turnaround/.test(m))).toBe(true);
  });

  it('oxygen from the pack lowers the altitude your lungs feel', () => {
    const c = at('Camp 4');
    c.toggleClip();
    c.pack.bottles = [1000];
    c.cycleOxygen();
    c.cycleOxygen();
    c.cycleOxygen();
    expect(c.phys.flow).toBe(2);
    c.update(1 / 30, { x: 0, y: 0 });
    expect(c.breathAltitude).toBeLessThan(c.position.y - 1500);
  });

  it('sleeping cooks dinner and breakfast with the gas you carry', () => {
    const c = new Climber(hm, ropes, route.places);
    c.tents = [{ camp: 'Base Camp', x: 0, z: 0 }];
    const p = route.places[0];
    const [x, z] = hm.gridToWorld(p.r, p.c);
    c.tents[0].x = x; c.tents[0].z = z;
    c.placeAt(x, z, 0, 0);
    c.mountainSeconds = 20 * 3600;
    const gas = c.pack.gasBrews, meals = c.pack.meal;
    c.sleep();
    expect(c.pack.gasBrews).toBe(gas - 2);
    expect(c.pack.meal).toBe(meals - 2);
    expect(c.pack.water).toBe(tuning.pack.water.max_l);
  });
});
