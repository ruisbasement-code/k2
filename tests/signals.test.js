import { describe, it, expect } from 'vitest';
import { Signals, FLARE, flarePosition, apexTime, flareSeenM, compassPoint } from '../src/sim/signals.js';
import { Pack } from '../src/sim/pack.js';
import { Expedition, GEAR } from '../src/sim/gear.js';
import { Climber, Mode } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const climber = () => {
  const c = new Climber(hm, ropes, route.places);
  c.tents = [];
  c.signals = new Signals('You');
  return c;
};

describe('flare flight', () => {
  const s = new Signals('A');
  const e = s.fireFlare({ x: 0, y: 5000, z: 0 }, 0, { x: 4, z: 0 });
  const f = { at: e.at, vel: e.vel, wind: e.wind };

  it('arcs a couple of hundred metres up, ahead of where you aim', () => {
    const top = flarePosition(f, apexTime(f));
    expect(top.y - 5000).toBeGreaterThan(200);
    expect(top.y - 5000).toBeLessThan(400);
    expect(top.z).toBeLessThan(-30); // yaw 0 faces -z
    expect(flarePosition(f, apexTime(f) - 1).rising).toBe(true);
    expect(flarePosition(f, apexTime(f) + 1).rising).toBe(false);
  });

  it('drifts down on the wind under its parachute, still up when it burns out', () => {
    const t1 = apexTime(f);
    const a = flarePosition(f, t1 + 1), b = flarePosition(f, t1 + 11);
    expect(a.y - b.y).toBeCloseTo(FLARE.chuteSink * 10);
    expect(b.x - a.x).toBeGreaterThan(0);
    expect(flarePosition(f, FLARE.burn).y).toBeGreaterThan(5000 + 50);
  });

  it('burns out after its burn time', () => {
    const s2 = new Signals('B');
    s2.fireFlare({ x: 0, y: 0, z: 0 });
    s2.update(FLARE.burn - 1);
    expect(s2.activeFlares()).toHaveLength(1);
    s2.update(2);
    expect(s2.activeFlares()).toHaveLength(0);
  });

  it('is seen from kilometres away even in a storm', () => {
    expect(flareSeenM(80000)).toBeGreaterThanOrEqual(20000);
    expect(flareSeenM(50)).toBeGreaterThanOrEqual(2000);
  });
});

describe('signals as events, for multiplayer later', () => {
  it('every signal is a JSON-safe event that another game can replay', () => {
    const a = new Signals('Alice');
    const b = new Signals('Bob');
    const sent = [];
    a.onEvent((e) => sent.push(JSON.parse(JSON.stringify(e))));
    a.update(3);
    a.fireFlare({ x: 100, y: 6000, z: -50 }, 1.2, { x: 2, z: -1 });
    a.toggleStrobe({ x: 100, y: 6000, z: -50 });
    a.blowWhistle({ x: 100, y: 6000, z: -50 });
    expect(sent.map((e) => e.kind)).toEqual(['flare', 'strobe', 'whistle']);
    a.update(5);
    // Bob gets the flare 5 s late: it is in the same place in both games.
    for (const e of sent) b.receive(e, 5);
    const pa = a.activeFlares()[0], pb = b.activeFlares()[0];
    expect(pb.x).toBeCloseTo(pa.x);
    expect(pb.y).toBeCloseTo(pa.y);
    expect(pb.by).toBe('Alice');
    expect(b.strobes.has('Alice')).toBe(true);
    // The same event twice draws one flare.
    b.receive(sent[0], 5);
    expect(b.activeFlares()).toHaveLength(1);
  });

  it('a searcher sees the flare and strobe and hears a nearby whistle, with a bearing', () => {
    const s = new Signals('Down');
    s.fireFlare({ x: 0, y: 7000, z: 0 });
    s.toggleStrobe({ x: 0, y: 7000, z: 0 });
    s.blowWhistle({ x: 0, y: 7000, z: 0 });
    s.update(2);
    const near = s.noticedFrom({ x: 0, y: 7000, z: 600 }, { visibility: 5000 });
    expect(near.map((n) => n.kind).sort()).toEqual(['flare', 'strobe', 'whistle']);
    expect(compassPoint(near.find((n) => n.kind === 'strobe').bearing)).toBe('N');
    // Far off in cloud: only the flare carries.
    const far = s.noticedFrom({ x: 3000, y: 6000, z: 0 }, { visibility: 600, wind: 20 });
    expect(far.map((n) => n.kind)).toEqual(['flare']);
    expect(compassPoint(far[0].bearing)).toBe('W');
    // Your own signals are not news to you.
    expect(s.noticedFrom({ x: 0, y: 7000, z: 600 }, { ignore: 'Down' })).toHaveLength(0);
  });

  it('the strobe runs its battery down in mountain time and goes off', () => {
    const s = new Signals('You');
    s.toggleStrobe({ x: 0, y: 0, z: 0 });
    s.update(1, 3600 * 59, { x: 10, y: 0, z: 0 });
    expect(s.strobeOn).toBe(true);
    expect(s.strobes.get('You').x).toBe(10);
    s.update(1, 3600 * 2);
    expect(s.strobeOn).toBe(false);
    expect(s.toggleStrobe({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('signal gear in the pack', () => {
  it('flares take pack room and weigh something; whistle and strobe go in pockets', () => {
    const p = new Pack();
    const kg = p.kg, l = p.litres;
    p.extra.flares = 3;
    expect(p.litres).toBeCloseTo(l + 0.9);
    expect(p.kg).toBeGreaterThan(kg);
    expect(GEAR.whistle.where).toBe('pocket');
    expect(GEAR.strobe.where).toBe('pocket');
  });

  it('are packed at Base Camp within the room left', () => {
    const c = climber();
    const ex = new Expedition(c);
    expect(ex.adjust('flares', 1)).toBe(true);
    expect(c.pack.extra.flares).toBe(1);
    while (ex.adjust('oxygen', 1));
    while (ex.adjust('flares', 1));
    expect(c.pack.litres).toBeLessThanOrEqual(c.pack.capacity + 1e-9);
  });

  it('a collapsed climber can still fire a flare and blow the whistle; the dead cannot', () => {
    const c = climber();
    const ex = new Expedition(c);
    ex.toggle('whistle');
    c.pack.extra.flares = 2;
    c.collapsed = { hours: 6, hoursLeft: 6, startHealth: 5 };
    const e = ex.flare();
    expect(e.kind).toBe('flare');
    expect(c.pack.extra.flares).toBe(1);
    expect(ex.whistle()?.kind).toBe('whistle');
    expect(ex.strobe()).toBeNull(); // no strobe packed
    c.mode = Mode.DEAD;
    expect(ex.flare()).toBeNull();
    expect(c.pack.extra.flares).toBe(1);
  });

  it('no flares, no flare', () => {
    const c = climber();
    expect(new Expedition(c).flare()).toBeNull();
  });
});
