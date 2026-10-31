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
    expect(drain({ air: storm, inCamp: true })).toBe(0);
    expect(drain({ air: storm, outOfWind: true })).toBeLessThan(open);
    expect(drain({ air: storm, effort: 0.5 })).toBeLessThan(open);
    expect(drain({ air: storm }, { suit: 1.8 })).toBeLessThan(open / 2);
  });

  it('bites harder the weaker you are', () => {
    expect(drain({ air: storm, health: 20 })).toBeGreaterThan(drain({ air: storm, health: 100 }) * 2);
  });
});

describe('collapsing in the cold', () => {
  const highUp = () => {
    const c = new Climber(hm, ropes, route.places);
    const p = route.places.find((x) => x.name === 'Camp 3') ?? route.places[3];
    const [x, z] = hm.gridToWorld(p.r, p.c);
    // Well away from the camp's tents.
    c.placeAt(x + 300, z + 300, 0, 0);
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

  it('you can give up rather than wait', () => {
    const c = highUp();
    c.health = 5;
    run(c, 1);
    expect(c.giveUp()).toBe(true);
    expect(c.dead).toBe(true);
  });
});
