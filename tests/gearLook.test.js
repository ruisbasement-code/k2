import { describe, it, expect } from 'vitest';
import { GearLook } from '../src/player/gearLook.js';
import { Pack } from '../src/sim/pack.js';

// A stand-in climber: GearLook only reads the pack, the regulator and the signals.
const climber = () => ({ pack: new Pack(), phys: { flow: 0 }, signals: null });

describe('gear look', () => {
  it('shows what you carry, as plain data', () => {
    const c = climber();
    c.pack.gear = new Set(['crampons_pro', 'rope', 'tent_ul', 'goggles', 'down_suit']);
    const look = new GearLook().update(c, null, 0.016);
    expect(look).toMatchObject({ crampons: 2, rope: true, tent: 'tent_ul', goggles: true, suit: 'down', oxygen: 0, o2: false, hand: null });
    expect(JSON.parse(JSON.stringify(look))).toEqual(look);
  });

  it('puts the mask on only while oxygen flows from a bottle', () => {
    const c = climber();
    const g = new GearLook();
    c.pack.bottles = [600, 600];
    expect(g.update(c, null, 0.016)).toMatchObject({ oxygen: 2, o2: false });
    c.phys.flow = 2;
    expect(g.update(c, null, 0.016)).toMatchObject({ oxygen: 2, o2: true });
  });

  it('holds a device up, and what you just used for a moment', () => {
    const c = climber();
    const g = new GearLook();
    c.pack.snack = 3;
    expect(g.update(c, 'gps', 0.016).hand).toBe('gps');
    c.pack.snack = 2;
    expect(g.update(c, 'gps', 0.016).hand).toBe('snack');
    expect(g.update(c, 'gps', 5).hand).toBe('gps');
  });

  it('does not show items left at a camp as used', () => {
    const c = climber();
    const g = new GearLook();
    c.pack.snack = 3;
    g.update(c, null, 0.016);
    c.pack.snack = 1;
    expect(g.update(c, null, 0.016, true).hand).toBe(null);
  });
});
