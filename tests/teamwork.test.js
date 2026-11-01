import { describe, it, expect } from 'vitest';
import { Pack } from '../src/sim/pack.js';
import { helpOptions, takeForHelp, giveBack, receiveHelp, mateInReach, HELP_RANGE } from '../src/sim/teamwork.js';
import { EXTRAS } from '../src/sim/gear.js';

function pack(o = {}) {
  const p = new Pack();
  p.water = 1.5;
  p.snack = 2;
  p.dex = 1;
  p.bottles = [3, 2];
  p.extra = { firstaid: 1, warmers: 1, flares: 1 };
  return Object.assign(p, o);
}

/** Just enough of a Climber for help to land on. */
function climber(o = {}) {
  return {
    health: 40, maxHealth: 100, dead: false, collapsed: null, pack: pack({ water: 0, snack: 0, dex: 0, bottles: [], extra: { firstaid: 0, warmers: 0, flares: 0 } }),
    revive(by) { if (!this.collapsed) return false; this.collapsed = null; this.revivedBy = by; return true; },
    ...o,
  };
}

describe('helping a teammate', () => {
  it('offers to get a collapsed teammate up first, and first aid only when they are hurt', () => {
    const p = pack();
    expect(helpOptions(p, { health: 10, maxHealth: 100, collapsed: 1.5 })[0].act).toBe('revive');
    expect(helpOptions(p, { health: 100, maxHealth: 100, collapsed: null }).map((o) => o.act)).not.toContain('firstaid');
    expect(helpOptions(p, { health: 60, maxHealth: 100, collapsed: null }).map((o) => o.act)).toContain('firstaid');
    expect(helpOptions(p, { health: 60, maxHealth: 100, dead: true })).toEqual([]);
  });

  it('never hands over the bottle on your own mask', () => {
    expect(helpOptions(pack({ bottles: [3] }), { health: 90, maxHealth: 100 }).map((o) => o.act)).not.toContain('oxygen');
    const p = pack({ bottles: [1, 2, 3] });
    const h = takeForHelp(p, 'oxygen');
    expect(h.litres).toBe(3);
    expect(p.bottles).toEqual([1, 2]);
  });

  it('first aid uses your kit and heals them', () => {
    const p = pack();
    const h = takeForHelp(p, 'firstaid');
    expect(p.extra.firstaid).toBe(0);
    const c = climber();
    const r = receiveHelp(c, h, 'Ana');
    expect(r.ok).toBe(true);
    expect(c.health).toBe(40 + EXTRAS.firstaid.heal);
    expect(r.text).toMatch(/Ana patched you up/);
  });

  it("gives the kit back when it couldn't help (already at full health)", () => {
    const p = pack();
    const h = takeForHelp(p, 'firstaid');
    const r = receiveHelp(climber({ health: 100 }), h, 'Ana');
    expect(r.ok).toBe(false);
    giveBack(p, h);
    expect(p.extra.firstaid).toBe(1);
  });

  it('revives a collapsed teammate, and not one already up', () => {
    const c = climber({ collapsed: { hoursLeft: 1 } });
    expect(receiveHelp(c, takeForHelp(pack(), 'revive'), 'Ana').ok).toBe(true);
    expect(c.revivedBy).toBe('Ana');
    expect(receiveHelp(c, { act: 'revive' }, 'Ana').ok).toBe(false);
  });

  it('hands items over into their pack', () => {
    const p = pack();
    const c = climber();
    for (const act of ['water', 'snack', 'dex', 'oxygen', 'warmers', 'kit', 'flares']) expect(receiveHelp(c, takeForHelp(p, act), 'Ana').ok).toBe(true);
    expect(c.pack.water).toBeCloseTo(0.5);
    expect(c.pack.snack).toBe(1);
    expect(c.pack.dex).toBe(1);
    expect(c.pack.bottles).toEqual([2]);
    expect(c.pack.extra).toEqual({ firstaid: 1, warmers: 1, flares: 1 });
    expect(p.extra).toEqual({ firstaid: 0, warmers: 0, flares: 0 });
  });

  it('refuses a gift that would not fit in a full pack', () => {
    const c = climber();
    c.pack.water = c.pack.capacity; // bottles to the brim
    expect(receiveHelp(c, { act: 'oxygen', litres: 3 }, 'Ana').ok).toBe(false);
  });

  it('only reaches a teammate standing close', () => {
    const near = { id: 'a', state: { at: [1, 0, 1] } };
    const far = { id: 'b', state: { at: [HELP_RANGE + 1, 0, 0] } };
    expect(mateInReach({ x: 0, y: 0, z: 0 }, [far, near])?.id).toBe('a');
    expect(mateInReach({ x: 0, y: 0, z: 0 }, [far])).toBe(null);
  });
});
