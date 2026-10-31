// Momentum, step-by-step slips, loose rock and rockfall, snow types and the trail,
// breath pace, and how the way you land in a slide changes self-arrest.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Climber } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { isLoose, SnowTrail } from '../src/sim/hazards.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
// Rockfall is off in the game for now; these tests turn it on to check it still works.
const rockfallOff = !tuning.rockfall_enabled;
tuning.rockfall_enabled = true;
const naturalRockfall = tuning.rockfall_per_min;
tuning.rockfall_per_min = 0;

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

function at(name) {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
}

function run(c, seconds, input) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

/** First grid spot (every 2 cells over the mountain) that passes the test. */
function find(test) {
  for (let r = 260; r < 480; r += 2) {
    for (let col = 260; col < 480; col += 2) {
      const [x, z] = hm.gridToWorld(r, col);
      const s = hm.slopeDeg(x, z);
      const y = hm.heightAt(x, z);
      if (test({ x, z, s, y })) return { x, z, s, y };
    }
  }
  return null;
}

function facingUphill(c) {
  const [gx, gz] = hm.gradient(c.position.x, c.position.z);
  c.yaw = Math.atan2(-gx, -gz);
}

describe('momentum and footing', () => {
  it('speeds up and slows down gradually', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    c.update(FRAME, { x: 0, y: 1 });
    const first = c.pace;
    run(c, 3, { x: 0, y: 1 });
    const full = c.pace;
    expect(first).toBeLessThan(full * 0.2);
    // Let go: you carry on a little before stopping.
    const p = c.position.clone();
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.pace).toBeGreaterThan(0);
    expect(c.position.distanceTo(p)).toBeGreaterThan(0);
    run(c, 3, { x: 0, y: 0 });
    expect(c.pace).toBe(0);
  });

  it('can trip running down steep ground, head-first', () => {
    const spot = find(({ s, y }) => s > 20 && s < 23 && y < 5600);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, spot.x, spot.z);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c.yaw = Math.atan2(gx, gz); // face down the slope
    run(c, 1, { x: 0, y: 1, push: true });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    c.update(FRAME, { x: 0, y: 1, push: true });
    expect(c.falling).toBe(true);
    expect(c.fall.orient.head).toBe(true);
  });

  it('makes careless, turning and downhill steps riskier', () => {
    const base = Pace.slipChancePerStep(32, { surface: 'firm_snow' });
    expect(base).toBeGreaterThan(0);
    expect(Pace.slipChancePerStep(32, { surface: 'firm_snow', careless: true })).toBeGreaterThan(base * 2);
    expect(Pace.slipChancePerStep(32, { surface: 'firm_snow', turning: true })).toBeGreaterThan(base);
    expect(Pace.slipChancePerStep(32, { surface: 'firm_snow', downhill: true })).toBeGreaterThan(base);
    expect(Pace.slipChancePerStep(20, { surface: 'firm_snow' })).toBe(0);
  });

  it('crumbles loose holds, sends rocks down and can make you slip', () => {
    const spot = find(({ x, z, s, y }) => s > 27 && s < 34 && isLoose(x, z, Pace.surfaceAt(y, s, hm.glacierAt(x, z)).key));
    expect(spot).not.toBe(null);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, spot.x, spot.z);
    facingUphill(c);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    c.update(FRAME, { x: 0, y: 1 });
    expect(c.rockfall.rocks.length).toBeGreaterThan(0);
    expect(c.falling).toBe(true);
    vi.restoreAllMocks();
    const r = c.rockfall.rocks[0];
    const y0 = r.position.y;
    c.rockfall.step(2);
    expect(r.position.y).toBeLessThan(y0);
  });
});

describe('rock and ice fall', () => {
  it('hurts when a rock hits you', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    c.rockfall.release(new THREE.Vector3(x, c.position.y + 6, z), new THREE.Vector3(0, 0, 0), 0.25);
    run(c, 1.5, { x: 0, y: 0 });
    expect(c.health).toBeLessThan(90);
  });

  it('comes down from steep faces, most in the afternoon', () => {
    const c = new Climber(hm, ropes, route.places);
    c.mountainSeconds = 15 * 3600;
    const afternoon = c._rockfallHourFactor();
    c.mountainSeconds = 2 * 3600;
    expect(c._rockfallHourFactor()).toBeLessThan(afternoon);

    // Below a steep face somewhere on the Abruzzi, rocks come down by themselves.
    let released = [];
    for (const p of ropes.ropes[0]) {
      released = c.rockfall.releaseAbove(p.x, p.z, () => 0.5);
      if (released.length) break;
    }
    expect(released.length).toBeGreaterThan(0);
    const y0 = released[0].position.y;
    c.rockfall.step(3);
    expect(released[0].position.y).toBeLessThan(y0);
  });

  it('is off in the game for now, but can be turned on in tuning', () => {
    expect(rockfallOff).toBe(true);
    expect(naturalRockfall).toBeGreaterThan(0);
  });
});

describe('snow', () => {
  it('has crust up high, and slush in the afternoon sun low down', () => {
    expect(Pace.surfaceAt(7300, 25).key).toBe('crust');
    expect(Pace.surfaceAt(6000, 25, 0, 7).key).toBe('firm_snow');
    expect(Pace.surfaceAt(6000, 25, 0, 14).key).toBe('slush');
    expect(Pace.surfaceAt(8000, 25, 0, 14).key).toBe('crust');
  });

  it('sinks you in powder, less on your own trail', () => {
    const spot = find(({ s, y }) => s < 10 && y > 5100 && y < 6000);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.surface.key).toBe('soft_snow');
    const deep = c.sink;
    expect(deep).toBeGreaterThan(0.25);
    c.trail.tread(c.position.x, c.position.z, 0, true);
    c.trail.tread(c.position.x, c.position.z, 0, false);
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.sink).toBeLessThan(deep * 0.3);
  });

  it('leaves footprints when you walk on snow', () => {
    const spot = find(({ s, y }) => s < 10 && y > 5100 && y < 6000);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    run(c, 3, { x: 0, y: 1 });
    expect(c.trail.prints.length).toBeGreaterThan(3);
    const trail = new SnowTrail();
    expect(trail.packing(0, 0)).toBe(0);
  });
});

describe('breath pace', () => {
  const climbHigh = (push) => {
    const c = new Climber(hm, ropes, route.places);
    const p = ropes.ropes[1][2];
    c.placeAt(p.x, p.z, 0, 0);
    c.toggleClip();
    let gasped = false;
    c.onMessage = (t) => { if (/Gasping/.test(t)) gasped = true; };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (let t = 0; t < 30; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1, push });
      if (!c.clipped) break;
    }
    vi.restoreAllMocks();
    return { c, gasped };
  };

  it('needs several breaths per step up high', () => {
    expect(Pace.breathsPerStep(5000)).toBeLessThan(1);
    expect(Pace.breathsPerStep(8200)).toBeGreaterThan(3);
  });

  it('makes you stop and gasp if you rush up high', () => {
    expect(climbHigh(true).gasped).toBe(true);
    expect(climbHigh(false).gasped).toBe(false);
  });
});

describe('how you slide', () => {
  const slide = (how) => {
    const spot = find(({ x, z, s, y }) => s > 30 && s < 34 && Pace.surfaceAt(y, s, hm.glacierAt(x, z)).key === 'firm_snow');
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c._startFall(gx, gz, 'test', how);
    run(c, 1.5, { x: 0, y: 0, arrest: true });
    return c;
  };

  it('lands you on your front facing in, on your back facing out', () => {
    const c = new Climber(hm, ropes, route.places);
    const spot = find(({ s }) => s > 30 && s < 34);
    c.placeAt(spot.x, spot.z, 0, 0);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c.heading = Math.atan2(-gx, -gz); // facing uphill
    c._startFall(gx, gz, 'test');
    expect(c.fall.orient.back).toBe(false);
    c.placeAt(spot.x, spot.z, 0, 0);
    c.heading = Math.atan2(gx, gz); // facing downhill
    c._startFall(gx, gz, 'test');
    expect(c.fall.orient.back).toBe(true);
  });

  it('arrests best on your front feet-first, worst head-first on your back', () => {
    const good = slide({ back: false, head: false });
    expect(good.falling).toBe(false);
    const bad = slide({ back: true, head: true });
    expect(bad.falling || bad.dead).toBe(true);
  });
});
