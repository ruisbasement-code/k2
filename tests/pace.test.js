// Checks the pace and stamina model against real-world targets, and simulates
// careful climbs of the fixed ropes. `npm test` prints the tables too.

import { describe, it, expect } from 'vitest';
import * as Pace from '../src/sim/paceModel.js';
import { ClimberBody } from '../src/sim/climberBody.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const tan = (d) => Math.tan((d * Math.PI) / 180);
const sin = (d) => Math.sin((d * Math.PI) / 180);

function rates(h) {
  return {
    walk: Pace.verticalRate(Pace.groundSpeed(false, 25, tan(25), h), tan(25)),
    climb: Pace.verticalRate(Pace.groundSpeed(true, 40, tan(40), h), tan(40)),
    rope: Pace.ropeSpeed(45, true, h) * sin(45) * 3600,
    down: Pace.ropeSpeed(45, false, h) * sin(45) * 3600,
  };
}

describe('pace', () => {
  it('prints the pace table', () => {
    console.table(Object.fromEntries([5000, 6000, 7000, 7600, 8000, 8200, 8400, 8600].map((h) => {
      const r = rates(h);
      return [`${h} m`, { 'walk 25°': Math.round(r.walk), 'climb 40°': Math.round(r.climb), 'rope 45° up': Math.round(r.rope), 'rope 45° down': Math.round(r.down) }];
    })));
  });

  it('walks and jumars 300-500 m/h at 5,000 m', () => {
    const r = rates(5000);
    expect(r.walk).toBeGreaterThanOrEqual(300);
    expect(r.walk).toBeLessThanOrEqual(500);
    expect(r.rope).toBeGreaterThanOrEqual(300);
    expect(r.rope).toBeLessThanOrEqual(500);
  });

  it('is about 100 m/h or less near the summit', () => {
    expect(rates(8400).climb).toBeLessThan(100);
    expect(rates(8400).rope).toBeLessThan(110);
    expect(rates(8600).climb).toBeLessThan(80);
  });

  it('falls steadily with altitude', () => {
    const hs = [5000, 6000, 7000, 7600, 8000, 8200, 8400, 8600];
    for (let i = 1; i < hs.length; i++) expect(rates(hs[i]).rope).toBeLessThan(rates(hs[i - 1]).rope);
  });

  it('descends a rope more than twice as fast as it climbs it', () => {
    expect(rates(8000).down).toBeGreaterThan(rates(8000).rope * 2);
  });

  it('walks about 5 km/h on the flat at sea level', () => {
    expect(Pace.walkSpeed(0) * 3.6).toBeCloseTo(5, 0);
  });
});

function minutesUntil(b, effort, h, done) {
  for (let m = 0; m < 600; m++) {
    if (done()) return m;
    b.step(1 / 60, effort, h, 0);
  }
  return 600;
}

function staminaAt(h) {
  const b = new ClimberBody();
  const climb = minutesUntil(b, 1, h, () => b.stamina <= 0);
  b.stamina = 100;
  const push = minutesUntil(b, 1.6, h, () => b.stamina <= 0);
  b.stamina = 0;
  b.exhausted = true;
  const rest = minutesUntil(b, 0, h, () => b.stamina >= b.staminaCap(h) * 0.8);
  return { climb, push, rest, cap: b.staminaCap(h) };
}

describe('stamina and breathing', () => {
  it('lasts 1-2.5 hours of steady climbing at Base Camp altitude, and refills quickly', () => {
    const s = staminaAt(5000);
    console.log('stamina at 5,000 m (minutes):', s);
    expect(s.climb).toBeGreaterThanOrEqual(60);
    expect(s.climb).toBeLessThanOrEqual(150);
    expect(s.push).toBeLessThan(s.climb / 2);
    expect(s.rest).toBeLessThanOrEqual(20);
  });

  it('goes quickly, refills slowly and never fully above 8,000 m', () => {
    const s = staminaAt(8400);
    console.log('stamina at 8,400 m (minutes):', s);
    expect(s.climb).toBeLessThan(45);
    expect(s.rest).toBeGreaterThanOrEqual(30);
    expect(s.cap).toBeLessThan(75);
  });

  it('does not drain when walking on the flat at an easy pace', () => {
    const b = new ClimberBody();
    for (let i = 0; i < 600; i++) b.step(1 / 3600, 0.45, 5000, 0.1);
    expect(b.stamina).toBeGreaterThanOrEqual(99);
  });

  it('breathes faster with effort and altitude', () => {
    const calm = new ClimberBody();
    const hard = new ClimberBody();
    for (let i = 0; i < 200; i++) {
      calm.step(0, 0, 5000, 0.1);
      hard.step(0, 1.6, 8400, 0.1);
    }
    expect(calm.breathRate).toBeLessThan(22);
    expect(hard.breathRate).toBeGreaterThan(40);
  });
});

// A careful player on the fixed ropes: climb steadily, stop when stamina is nearly
// gone, rest until it is back to 70% of what the altitude allows.
function simulateRope(ropes, r) {
  const b = new ClimberBody();
  const length = ropes.lengthOf(r);
  let s = 0, t = 0, resting = false;
  const dt = 10;
  while (s < length && t < 48 * 3600) {
    const y = ropes.pointAt(r, s).y;
    if (resting || b.exhausted || b.stamina < 5) {
      resting = b.stamina < b.staminaCap(y) * 0.7;
      b.step(dt / 3600, 0, y, dt);
    } else {
      const incline = (Math.asin(ropes.tangentAt(r, s).y) * 180) / Math.PI;
      s += Pace.ropeSpeed(incline, true, y) * b.speedFactor() * dt;
      b.step(dt / 3600, 1, y, dt);
    }
    t += dt;
  }
  return t / 3600;
}

describe('simulated climbs', () => {
  const ropes = new FixedRopes(loadHeightmap(), route.fixed_ropes);
  it('takes 8-22 hours of climbing from Advanced Base Camp to Camp 4', () => {
    const hours = simulateRope(ropes, 0);
    console.log(`${ropes.names[0]}: ${hours.toFixed(1)} h`);
    expect(hours).toBeGreaterThanOrEqual(8);
    expect(hours).toBeLessThanOrEqual(22);
  });
  it('takes 6-12 hours up the Bottleneck and Traverse, like a real summit morning', () => {
    const hours = simulateRope(ropes, 1);
    console.log(`${ropes.names[1]}: ${hours.toFixed(1)} h`);
    expect(hours).toBeGreaterThanOrEqual(6);
    expect(hours).toBeLessThanOrEqual(12);
  });
});
