// Drives the real Climber with simulated input on the real terrain: walking,
// the fixed ropes, steep ground, falls, death and rescue, and the day counter.

import { describe, it, expect, vi } from 'vitest';
import { Climber, Mode } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';

const { tuning } = Pace;
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

// Natural rockfall is random; the tests that want it turn it back on.
const naturalRockfall = tuning.rockfall_per_min;
tuning.rockfall_per_min = 0;

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

function at(name) {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
}

function run(c, seconds, input) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

describe('climber', () => {
  it('walks across Base Camp', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    const start = c.position.clone();
    run(c, 4, { x: 0, y: 1 });
    expect(c.mode).toBe(Mode.WALK);
    expect(c.position.distanceTo(start)).toBeGreaterThan(5);
  });

  it('clips into the rope, climbs it at a realistic pace, rests and unclips', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Advanced Base Camp');
    c.placeAt(x, z, 0, 0);
    c.toggleClip();
    expect(c.ropeId).toBe(0);
    const y0 = c.position.y;
    const clock0 = c.mountainSeconds;
    const stamina0 = c.body.stamina;
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0.5); // no slips
    for (let t = 0; t < 20; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1 });
    }
    roll.mockRestore();
    const rate = (c.position.y - y0) / ((c.mountainSeconds - clock0) / 3600);
    expect(rate).toBeGreaterThan(250);
    expect(rate).toBeLessThan(500);
    expect(c.body.stamina).toBeLessThan(stamina0);

    const tired = c.body.stamina;
    run(c, 10, { x: 0, y: 0 });
    expect(c.body.stamina).toBeGreaterThan(tired);
    expect(c.verticalNow).toBe(0);
    c.toggleClip();
    expect(c.ropeId).toBe(-1);
  });

  it('moves freely while clipped in, but only as far as the leash', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Advanced Base Camp');
    c.placeAt(x, z, 0, 0);
    c.toggleClip();
    // Face along the rope, then walk sideways across it for a long time.
    const t = ropes.tangentAt(c.ropeId, c.ropeS);
    c.yaw = Math.atan2(-t.x, -t.z);
    let furthest = 0;
    for (let i = 0; i < 30 * 30; i++) {
      c.update(FRAME, { x: 1, y: 0 });
      furthest = Math.max(furthest, ropes.nearestOn(0, c.position).distance);
    }
    expect(c.clipped).toBe(true);
    expect(furthest).toBeGreaterThan(3);
    expect(furthest).toBeLessThan(tuning.rope_leash_m + 1);
  });

  it('drops you onto the rope when you slip clipped in, and the rope catches you', () => {
    const c = new Climber(hm, ropes, route.places);
    const pts = ropes.ropes[0];
    const p = pts.find((q) => { const s = hm.slopeDeg(q.x, q.z); return s > 38 && s < 50; });
    c.placeAt(p.x, p.z, 0, 0);
    c.toggleClip();
    const [gx, gz] = hm.gradient(p.x, p.z);
    c.yaw = Math.atan2(-gx, -gz);
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0);
    c.update(FRAME, { x: 0, y: 1, push: true });
    roll.mockReturnValue(0.99); // the anchor holds
    expect(c.falling).toBe(true);
    expect(c.fall.rope).not.toBe(null);
    const y0 = c.fall.startY;
    run(c, 6, { x: 0, y: 0 });
    expect(c.falling).toBe(false);
    expect(c.clipped).toBe(true);
    expect(c.dead).toBe(false);
    // Caught within the rope's reach, not slid down the face.
    expect(y0 - c.position.y).toBeLessThan(tuning.rope_slack_m + 4);
    roll.mockRestore();
  });

  it('can rip the anchor out when the rope takes a fall', () => {
    const c = new Climber(hm, ropes, route.places);
    const pts = ropes.ropes[0];
    const p = pts.find((q) => { const s = hm.slopeDeg(q.x, q.z); return s > 38 && s < 50; });
    c.placeAt(p.x, p.z, 0, 0);
    c.toggleClip();
    const [gx, gz] = hm.gradient(p.x, p.z);
    c.yaw = Math.atan2(-gx, -gz);
    let ripped = false;
    c.onMessage = (t) => { if (/ripped out/.test(t)) ripped = true; };
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0); // every chance comes up
    c.update(FRAME, { x: 0, y: 1, push: true });
    c.health = 1e9;
    run(c, 3, { x: 0, y: 0 });
    roll.mockRestore();
    expect(ripped).toBe(true);
    expect(c.clipped).toBe(false);
    expect(c.falling && c.fall.rope).toBeFalsy();
    expect(tuning.rope_fail_chance).toBeLessThan(0.05);
  });

  it('slides instead of climbing ground steeper than 35° unroped', () => {
    const spot = steepest(at('Camp 2'), tuning.no_rope_max_deg + 1, tuning.no_rope_max_deg + 6);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, spot.x, spot.z);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c.yaw = Math.atan2(-gx, -gz); // face straight up the slope
    const y0 = c.position.y;
    run(c, 2, { x: 0, y: 1 });
    expect(c.falling || c.blocked).toBe(true);
    expect(c.position.y).toBeLessThanOrEqual(y0 + 0.01);
  });

  it('turns a slip while scrambling into a slide down the slope', () => {
    const spot = steepest(at('Base Camp'), tuning.climb_start_deg + 5, tuning.no_rope_max_deg);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, spot.x, spot.z);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c.yaw = Math.atan2(-gx, -gz);
    let slipped = false;
    c.onMessage = (t) => { if (/slipped|sliding/i.test(t)) slipped = true; };
    // Make every chance roll come up as a slip, so the test is not random.
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0);
    c.update(FRAME, { x: 0, y: 1, push: true });
    roll.mockRestore();
    expect(slipped).toBe(true);
    expect(c.falling).toBe(true);
    const y0 = c.fall.startY;
    run(c, 20, { x: 0, y: 0 });
    expect(c.position.y).toBeLessThan(y0 - 5);
    expect(c.fall.distance).toBeGreaterThan(5);
  });

  it('can self-arrest a slide on snow by holding Space early, but not on ice', () => {
    const slide = (surfaceWanted, arrest) => {
      // A 30-34° slope of the wanted surface somewhere on the mountain.
      let spot = null;
      for (let r = 300; r < 420 && !spot; r += 2) {
        for (let col = 300; col < 420 && !spot; col += 2) {
          const [x, z] = hm.gridToWorld(r, col);
          const s = hm.slopeDeg(x, z);
          if (s > 30 && s < 34 && Pace.surfaceAt(hm.heightAt(x, z), s).key === surfaceWanted) spot = { x, z };
        }
      }
      const c = new Climber(hm, ropes, route.places);
      c.placeAt(spot.x, spot.z, 0, 0);
      const [gx, gz] = hm.gradient(spot.x, spot.z);
      c._startFall(gx, gz, 'test');
      run(c, 1.5, { x: 0, y: 0, arrest });
      return c;
    };
    const held = slide('firm_snow', true);
    expect(held.falling).toBe(false);
    expect(held.tumbling).toBe(false);
    const notHeld = slide('firm_snow', false);
    expect(notHeld.falling).toBe(true);
    const ice = slide('ice', true);
    expect(ice.falling).toBe(true);
  });

  it('survives a short drop, dies from a long one', () => {
    const drop = (metres) => {
      const c = new Climber(hm, ropes, route.places);
      const [x, z] = at('Base Camp');
      c.placeAt(x, z, 0, 0);
      c._startFall(0, 0, 'test');
      c.position.y += metres;
      c.fall.startY = c.position.y;
      c.velocity.set(0, 0, 0);
      run(c, 6, { x: 0, y: 0 });
      return c;
    };
    const small = drop(1);
    expect(small.health).toBe(100);
    expect(small.falling).toBe(false);
    const mid = drop(6);
    expect(mid.health).toBeLessThan(100);
    expect(mid.dead).toBe(false);
    const big = drop(40);
    expect(big.dead).toBe(true);
    expect(big.deathCause).toMatch(/fell/);
  });

  it('comes to a stop by itself on gentle ground', () => {
    const spot = steepest(at('Base Camp'), 18, 22);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c._startFall(gx, gz, 'test');
    run(c, 15, { x: 0, y: 0 });
    expect(c.falling).toBe(false);
    expect(c.dead).toBe(false);
  });

  it('is rescued to the highest camp reached, hours later', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Camp 2');
    c.placeAt(x, z, 0, 0);
    c.placeAt(x + 200, z + 200, 0, 0);
    c._startFall(0, 0, 'test');
    c._hurt(1000);
    expect(c.dead).toBe(true);
    const clock = c.mountainSeconds;
    c.rescue();
    expect(c.dead).toBe(false);
    expect(c.lastCamp.name).toBe('Camp 2');
    expect(Math.hypot(c.position.x - x, c.position.z - z)).toBeLessThan(20);
    expect(c.health).toBeLessThan(100);
    expect(c.mountainSeconds).toBe(clock + tuning.rescue_hours * 3600);
  });

  it('cannot go up a 35° slope unroped, but can on the rope', () => {
    const c = new Climber(hm, ropes, route.places);
    const pts = ropes.ropes[0];
    // A rope point on ~35-45° ground.
    const i = pts.findIndex((p) => { const s = hm.slopeDeg(p.x, p.z); return s > 35 && s < 45; });
    const p = pts[i];
    const climb = (clip) => {
      c.placeAt(p.x, p.z, 0, 0);
      if (clip) c.toggleClip();
      const t = ropes.tangentAt(0, ropes.nearestOn(0, c.position).s);
      c.yaw = Math.atan2(-t.x, -t.z);
      const roll = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
      const y0 = c.position.y;
      run(c, 3, { x: 0, y: 1 });
      roll.mockRestore();
      return c.position.y - y0;
    };
    expect(climb(false)).toBeLessThanOrEqual(0.01);
    expect(c.blocked || c.falling).toBe(true);
    expect(climb(true)).toBeGreaterThan(0.5);
  });

  it('counts expedition days', () => {
    const c = new Climber(hm, ropes, route.places);
    expect(c.day).toBe(1);
    expect(c.clockText()).toBe('06:00');
    c.mountainSeconds += 24 * 3600;
    expect(c.day).toBe(2);
  });
});

/** The steepest spot between lo and hi degrees within 400 m of a place. */
function steepest([cx, cz], lo, hi) {
  let best = null;
  for (let dx = -400; dx <= 400; dx += 10) {
    for (let dz = -400; dz <= 400; dz += 10) {
      const s = hm.slopeDeg(cx + dx, cz + dz);
      if (s >= lo && s < hi && (!best || s > best.s)) best = { s, x: cx + dx, z: cz + dz };
    }
  }
  if (!best) throw new Error(`no ground between ${lo} and ${hi} degrees`);
  return best;
}
