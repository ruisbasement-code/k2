import { describe, it, expect } from 'vitest';
import { Pack } from '../src/sim/pack.js';
import { Physiology } from '../src/sim/physiology.js';
import { tuning } from '../src/sim/paceModel.js';

const full = tuning.pack.oxygen.litres;

describe('camp stores: take and leave', () => {
  it('leaving supplies stocks the camp, and you can take them back later', () => {
    const p = new Pack();
    p.snack = 4;
    p.bottles = [full, full];
    const stores = { snack: 0, oxygen: 0 };
    expect(p.leave(stores, 'snack')).toBeNull();
    expect(p.leave(stores, 'oxygen')).toBeNull();
    expect(stores).toMatchObject({ snack: 1, oxygen: 1 });
    expect(p.snack).toBe(3);
    expect(p.bottles.length).toBe(1);
    const kg = p.kg;
    expect(p.take(stores, 'oxygen')).toBeNull();
    expect(p.kg).toBeGreaterThan(kg + 4);
    expect(stores.oxygen).toBe(0);
    expect(p.take(stores, 'oxygen')).toBe('None left here');
  });

  it('a part-used bottle is kept as it is, and handed out after the full ones', () => {
    const p = new Pack();
    p.bottles = [full, 300];
    const stores = { oxygen: 1 };
    p.leave(stores, 'oxygen');
    expect(stores.oxygen).toBe(1);
    expect(stores.o2_part).toEqual([300]);
    p.take(stores, 'oxygen');
    expect(p.bottles[1]).toBe(full);
    p.take(stores, 'oxygen');
    expect(p.bottles[2]).toBe(300);
    expect(stores.o2_part).toEqual([]);
  });

  it('unlimited stores stay unlimited', () => {
    const p = new Pack();
    p.meal = 2;
    const stores = { meal: -1 };
    p.leave(stores, 'meal');
    p.take(stores, 'meal');
    expect(stores.meal).toBe(-1);
  });

  it('gas leaves as whole canisters only, and water is not left', () => {
    const p = new Pack();
    p.gasBrews = 2;
    p.water = 1;
    expect(p.leave({ gas: 0 }, 'gas')).toMatch(/part-used/);
    expect(p.leave({ water: -1 }, 'water')).toBeTruthy();
    p.gasBrews = 6;
    const s = { gas: 0 };
    expect(p.leave(s, 'gas')).toBeNull();
    expect(p.gasBrews).toBe(2);
    expect(s.gas).toBe(1);
  });

  it('nothing goes in a full pack', () => {
    const p = new Pack();
    p.gear = new Set(['tent', 'down_suit', 'rope', 'shovel', 'crampons', 'axe', 'stove']);
    while (!p.take({ oxygen: -1 }, 'oxygen'));
    expect(p.take({ oxygen: -1 }, 'oxygen')).toBe('No room in the pack');
  });
});

describe('supply forecast', () => {
  it('says how long oxygen, food and gas last, and what the weight costs', () => {
    const p = new Pack();
    p.bottles = [full, full];
    p.snack = 4;
    p.meal = 1;
    p.gasBrews = 4;
    const f = p.forecast(2);
    expect(f.o2Hours).toBeCloseTo((2 * full) / 2 / 60);
    expect(f.foodHours).toBeGreaterThan(3);
    expect(f.brews).toBe(4);
    // Two full bottles are close to 9 kg on their own.
    expect(f.slower).toBeGreaterThan(0.05);
    // Off: planned at 2 L/min.
    expect(p.forecast(0).o2Hours).toBeCloseTo(f.o2Hours);
    expect(p.forecast(4).o2Hours).toBeCloseTo(f.o2Hours / 2);
  });
});

describe('oxygen on the move', () => {
  const air = { airTempC: -20, windMs: 5, feelsLikeC: -28, wet: 0 };

  it('swaps to the next bottle and warns before the last one runs out', () => {
    const ph = new Physiology();
    const msgs = [];
    ph.onMessage = (m) => msgs.push(m);
    const p = new Pack();
    p.bottles = [60, full];
    ph.flow = 2;
    ph.step(1, { altitude: 7800, effort: 0.5, air, pack: p });
    expect(msgs.some((m) => /swap to a fresh one/.test(m))).toBe(true);
    expect(p.bottles.length).toBe(1);
    expect(ph.flow).toBe(2);
    let h = 0;
    while (!msgs.some((m) => /Oxygen low/.test(m)) && h++ < 60) ph.step(0.25, { altitude: 7800, effort: 0.5, air, pack: p });
    const warn = msgs.find((m) => /Oxygen low/.test(m));
    expect(warn).toBeTruthy();
    expect(ph.flow).toBe(2);
    // Only once.
    ph.step(0.1, { altitude: 7800, effort: 0.5, air, pack: p });
    expect(msgs.filter((m) => /Oxygen low/.test(m)).length).toBe(1);
  });
});
