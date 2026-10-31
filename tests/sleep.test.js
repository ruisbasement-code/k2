// Sleeping in a camp tent: skipping the night, resting, and healing everything
// but permanent injuries.

import { describe, it, expect } from 'vitest';
import { Climber, Mode } from '../src/player/climber.js';
import { sleepPlan } from '../src/sim/sleep.js';
import { tuning } from '../src/sim/paceModel.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import { createCamps } from '../src/world/camps.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const tents = createCamps(hm, route.places, ropes).userData.tents;

function climberAtTent(campName, hour) {
  const c = new Climber(hm, ropes, route.places);
  c.tents = tents;
  const tent = tents.find((t) => t.camp === campName);
  c.placeAt(tent.x + 1, tent.z + 1, tent.x, tent.z);
  c.mountainSeconds = (2 - 1) * 86400 + hour * 3600;
  return c;
}

describe('sleep', () => {
  it('every camp has tents to sleep in', () => {
    for (const p of route.places.filter((q) => q.tents > 0)) {
      expect(tents.filter((t) => t.camp === p.name).length).toBeGreaterThan(0);
    }
  });

  it('sleeps through the night to the morning, rested and healed', () => {
    const c = climberAtTent('Camp 2', 21);
    c.phys.acclimatized = 6700;
    c.health = 35;
    c.body.stamina = 10;
    c.body.exhausted = true;
    expect(c.canSleep()).toBe(true);
    const r = c.sleep();
    expect(r.night).toBe(true);
    expect(r.hours).toBeCloseTo(9, 5);
    expect(c.day).toBe(3);
    expect(c.hour).toBeCloseTo(tuning.wake_hour, 5);
    expect(c.health).toBe(100);
    expect(c.body.stamina).toBeCloseTo(c.body.staminaCap(c.position.y), 5);
    expect(c.body.exhausted).toBe(false);
  });

  it('after midnight sleeps until the same morning', () => {
    const c = climberAtTent('Base Camp', 2);
    c.sleep();
    expect(c.day).toBe(2);
    expect(c.hour).toBeCloseTo(tuning.wake_hour, 5);
  });

  it('naps in the day, resting only partly', () => {
    const c = climberAtTent('Camp 1', 12);
    c.body.stamina = 10;
    const r = c.sleep();
    expect(r.night).toBe(false);
    expect(c.hour).toBeCloseTo(12 + tuning.nap_hours, 5);
    expect(c.body.stamina).toBeGreaterThan(10);
    expect(c.body.stamina).toBeLessThan(c.body.staminaCap(c.position.y));
  });

  it('does not heal permanent injuries', () => {
    const c = climberAtTent('Base Camp', 20);
    c.addPermanentInjury('Broken wrist', 25);
    c.health = 20;
    c.sleep();
    expect(c.maxHealth).toBe(75);
    expect(c.health).toBe(75);
    // Resting awake in camp does not get past it either.
    for (let t = 0; t < 20; t += 1 / 30) c.update(1 / 30, { x: 0, y: 0 });
    expect(c.health).toBe(75);
  });

  it('needs a tent within reach, and not while falling or dead', () => {
    const c = climberAtTent('Camp 2', 21);
    const t = c.nearestTent();
    c.placeAt(t.x + 20, t.z + 20, t.x, t.z);
    if (!c.nearestTent()) {
      expect(c.canSleep()).toBe(false);
      const clock = c.mountainSeconds;
      expect(c.sleep()).toBe(null);
      expect(c.mountainSeconds).toBe(clock);
    }
    c.placeAt(t.x, t.z, 0, 0);
    c.mode = Mode.DEAD;
    expect(c.canSleep()).toBe(false);
  });

  it('plans night sleep and day naps by the clock', () => {
    expect(sleepPlan(18).night).toBe(true);
    expect(sleepPlan(5.5).hours).toBeCloseTo(0.5, 5);
    expect(sleepPlan(10)).toEqual({ night: false, hours: tuning.nap_hours });
  });
});
