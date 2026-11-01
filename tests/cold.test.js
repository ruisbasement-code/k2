// Cold exposure: health ticks down in the cold, faster when you are weak; tents,
// camps, moving and a down suit slow or stop it; at very low health you collapse
// and freeze unless someone revives you.

import { describe, it, expect } from 'vitest';
import { Physiology } from '../src/sim/physiology.js';
import { airAt } from '../src/sim/environment.js';
import { tuning } from '../src/sim/paceModel.js';
import { Climber } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);

/** Health lost over an hour in this air. */
function drain(ctx, { suit = 1 } = {}) {
  const ph = new Physiology();
  ph.insulationMult = suit;
  let lost = 0;
  for (let i = 0; i < 10; i++) lost += ph.step(0.1, { altitude: 7900, effort: 0, health: 100, ...ctx }).damage;
  return lost;
}

const night = airAt(7900, 3);
const storm = airAt(7900, 3, { windMs: 25, airTempC: night.airTempC - 8 });
const midday = airAt(5000, 13);

describe('cold exposure', () => {
  it('a mild day costs nothing; a cold night and a storm cost more and more', () => {
    expect(drain({ air: midday, altitude: 5000 })).toBe(0);
    const n = drain({ air: night });
    const s = drain({ air: storm });
    expect(n).toBeGreaterThan(2);
    expect(s).toBeGreaterThan(n);
  });

  it('tents, moving and a down suit slow or stop it', () => {
    const open = drain({ air: storm });
    expect(drain({ air: storm, sheltered: true })).toBe(0);
    expect(drain({ air: storm, inCamp: true })).toBeLessThan(open / 5);
    expect(drain({ air: storm, outOfWind: true })).toBeLessThan(open);
    expect(drain({ air: storm, effort: 0.5 })).toBeLessThan(open);
    expect(drain({ air: storm }, { suit: 1.8 })).toBeLessThan(open / 2);
  });

  it('bites harder the weaker you are', () => {
    expect(drain({ air: storm, health: 20 })).toBeGreaterThan(drain({ air: storm, health: 100 }) * 2);
  });
});

describe('snowstorms and hypothermia', () => {
  const stormAir = (wet) => ({ ...airAt(6500, 14, { airTempC: -16, windMs: 20, wet }) });
  /** Core temperature and health lost after hours walking at effort 0.6 in this air. */
  const walk = (air, hours, health = 100) => {
    const ph = new Physiology();
    let lost = 0;
    for (let h = 0; h < hours; h += 0.1) lost += ph.step(0.1, { altitude: 6500, effort: 0.6, air, health }).damage;
    return { ph, lost };
  };

  it('a snowstorm soaks you and gives you hypothermia even on the move', () => {
    const dry = walk(stormAir(0), 2);
    const storm = walk(stormAir(1), 2);
    expect(storm.ph.damp).toBeGreaterThan(0.9);
    expect(storm.ph.core).toBeLessThan(tuning.hypothermia_mild_c);
    expect(storm.ph.core).toBeLessThan(dry.ph.core - 1);
    expect(storm.lost).toBeGreaterThan(dry.lost * 2);
    expect(storm.ph.conditions().map((c) => c.id)).toEqual(expect.arrayContaining(['damp', 'cold']));
  });

  it('a down suit keeps you on your feet through it', () => {
    const ph = new Physiology();
    ph.insulationMult = 1.8;
    for (let h = 0; h < 2; h += 0.1) ph.step(0.1, { altitude: 6500, effort: 0.6, air: stormAir(1), health: 100 });
    expect(ph.core).toBeGreaterThan(tuning.hypothermia_mild_c);
  });

  it('hypothermia slowly ticks health down, faster the colder you are', () => {
    const lost = (core) => {
      const ph = new Physiology();
      ph.core = core;
      // A warm, still tent: no cold drain, only the hypothermia already in you.
      return ph.step(0.01, { altitude: 5000, air: airAt(5000, 14), sheltered: true, health: 100 }).damage / 0.01;
    };
    expect(lost(37)).toBe(0);
    expect(lost(34.5)).toBeGreaterThan(0);
    expect(lost(34.5)).toBeLessThan(10);
    expect(lost(32)).toBeGreaterThan(lost(34.5) * 2);
  });

  it('wet clothes dry out in a tent', () => {
    const ph = new Physiology();
    ph.damp = 1;
    for (let h = 0; h < 2; h += 0.1) ph.step(0.1, { altitude: 5000, air: airAt(5000, 14), sheltered: true });
    expect(ph.damp).toBeLessThan(0.1);
  });
});

describe('collapsing in the cold', () => {
  const highUp = () => {
    const c = new Climber(hm, ropes, route.places);
    const p = route.places.find((x) => x.name === 'Camp 3') ?? route.places[3];
    const [x, z] = hm.gridToWorld(p.r, p.c);
    // Well away from the camp's tents, on ground you can stand on.
    let spot = null;
    for (let d = 300; d < 600 && !spot; d += 10) {
      for (let a = 0; a < 16 && !spot; a++) {
        const sx = x + d * Math.cos(a * 0.39), sz = z + d * Math.sin(a * 0.39);
        if (hm.slopeDeg(sx, sz) < 20) spot = [sx, sz];
      }
    }
    c.placeAt(spot[0], spot[1], 0, 0);
    c.mountainSeconds = 2 * 3600;
    c.environment = { airTempC: -35, windMs: 25 };
    c.clipped && c.toggleClip();
    return c;
  };
  const run = (c, realSeconds) => {
    for (let t = 0; t < realSeconds && !c.dead; t += 1 / 30) c.update(1 / 30, { x: 0, y: 0 });
  };

  it('drains health while you stand in a storm, and stops healing', () => {
    const c = highUp();
    c.health = 60;
    run(c, 30);
    expect(c.health).toBeLessThan(60);
    expect(c.dead).toBe(false);
  });

  it('collapses at low health, cannot move, and freezes if nobody comes', () => {
    const c = highUp();
    c.health = tuning.collapse_below_health - 1;
    run(c, 1);
    expect(c.collapsed).not.toBeNull();
    const pos = c.position.clone();
    for (let t = 0; t < 2; t += 1 / 30) c.update(1 / 30, { x: 0, y: 1 });
    expect(c.position.distanceTo(pos)).toBeLessThan(0.01);
    expect(c.eat()).toBe(false);
    // Fast-forward: the freeze clock runs out.
    c.timeScale = 60;
    run(c, 600);
    expect(c.dead).toBe(true);
    expect(c.collapsed).toBeNull();
    expect(c.deathCause).toMatch(/froze/);
    c.rescue();
    expect(c.dead).toBe(false);
  });

  it('a rescuer can revive you before it is too late', () => {
    const c = highUp();
    c.health = 5;
    run(c, 1);
    expect(c.collapsed).not.toBeNull();
    expect(c.revive('Another climber')).toBe(true);
    expect(c.collapsed).toBeNull();
    expect(c.health).toBeGreaterThanOrEqual(tuning.revive_health);
    expect(c.revive()).toBe(false);
  });

  it('freezing to the core collapses you instead of killing you outright', () => {
    const c = highUp();
    c.phys.core = tuning.hypothermia_death_c - 0.2;
    run(c, 1);
    expect(c.dead).toBe(false);
    expect(c.collapsed).not.toBeNull();
    expect(c.health).toBeLessThanOrEqual(tuning.collapse_below_health);
  });

  it('you can give up rather than wait', () => {
    const c = highUp();
    c.health = 5;
    run(c, 1);
    expect(c.giveUp()).toBe(true);
    expect(c.dead).toBe(true);
  });
});
