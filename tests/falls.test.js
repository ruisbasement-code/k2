// Falls that follow the terrain: sliding on slopes, tumbling only off steep or
// airborne ground, realistic speeds, ledges to stop on, and the tether to the rope.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Climber } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { ledgeAt, ledgesNear } from '../src/sim/hazards.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import { Tether } from '../src/world/tether.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

function at(name) {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
}

function run(c, seconds, input = { x: 0, y: 0 }) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

function find(test, step = 2) {
  for (let r = 260; r < 480; r += step) {
    for (let col = 260; col < 480; col += step) {
      const [x, z] = hm.gridToWorld(r, col);
      const s = hm.slopeDeg(x, z);
      if (test({ x, z, s, y: hm.heightAt(x, z) })) return { x, z, s };
    }
  }
  return null;
}

describe('falls follow the terrain', () => {
  it('slides on a moderate slope instead of tumbling', () => {
    const spot = find(({ x, z, s }) => s > 30 && s < 34 && !ledgeAt(x, z, s));
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c._startFall(gx, gz, 'test');
    let tumbled = false;
    for (let t = 0; t < 3 && c.falling; t += FRAME) {
      c.update(FRAME, { x: 0, y: 0 });
      tumbled ||= c.tumbling;
    }
    expect(tumbled).toBe(false);
  });

  it('tumbles once you leave the ground', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    c._startFall(0, 0, 'test');
    c.position.y += 30;
    c.health = 1e9;
    run(c, 0.5);
    expect(c.tumbling).toBe(true);
  });

  it('settles a tumble back into a slide on gentler ground', () => {
    const spot = find(({ x, z, s }) => s > 20 && s < 26 && !ledgeAt(x, z, s));
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot.x, spot.z, 0, 0);
    const [gx, gz] = hm.gradient(spot.x, spot.z);
    c._startFall(gx, gz, 'test');
    c._tumble();
    c.health = 1e9;
    run(c, 1.5);
    expect(c.tumbling).toBe(false);
  });

  it('keeps speeds realistic: air drag in free fall, energy lost tumbling', () => {
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Base Camp');
    c.placeAt(x, z, 0, 0);
    c._startFall(0, 0, 'test');
    c.position.y += 3000;
    c.health = 1e9;
    c.fall.phase = 'slide'; // no tumble drag, just air: near terminal velocity
    for (let t = 0; t < 15; t += FRAME) {
      c.fall.phase = 'slide';
      c.fall.air = 0;
      c._fallStep(FRAME, false);
    }
    const terminal = c.velocity.length();
    expect(terminal).toBeGreaterThan(45);
    expect(terminal).toBeLessThan(65);

    // A long fall down the Abruzzi to the glacier averages well under free fall speeds.
    const [cx, cz] = at('Camp 3');
    const d = new Climber(hm, ropes, route.places);
    d.placeAt(cx + 30, cz + 30, 0, 0);
    d.health = 1e9;
    const [gx, gz] = hm.gradient(d.position.x, d.position.z);
    d._startFall(gx, gz, 'test');
    let top = 0, t = 0;
    for (; t < 300 && d.falling; t += FRAME) {
      d.update(FRAME, { x: 0, y: 0 });
      top = Math.max(top, Math.hypot(d.velocity.x, d.velocity.z));
    }
    expect(top).toBeLessThan(40);
    expect(d.fall.distance / t).toBeLessThan(30);
  });
});

describe('ledges', () => {
  it('dots small ledges over steep faces', () => {
    const [x, z] = at('Camp 2');
    const near = ledgesNear(hm, x, z, 300);
    expect(near.length).toBeGreaterThan(10);
    expect(ledgeAt(near[0].x, near[0].z, near[0].slope)).not.toBe(null);
  });

  it('lets you stand on a ledge on ground too steep to stand on otherwise', () => {
    const [x, z] = at('Camp 2');
    const l = ledgesNear(hm, x, z, 600).find((q) => q.slope > 38 && q.slope < 50);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(l.x, l.z, 0, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    run(c, 2);
    expect(c.falling).toBe(false);
    expect(c.onLedge).toBe(true);
    // Step off it and you slide.
    c.placeAt(l.x + 10, l.z, 0, 0);
    if (!ledgeAt(c.position.x, c.position.z, hm.slopeDeg(c.position.x, c.position.z)) && hm.slopeDeg(c.position.x, c.position.z) > 40) {
      run(c, 0.2);
      expect(c.falling).toBe(true);
    }
  });
});

describe('rockfall', () => {
  it('is off for now: crumbling holds send no rocks down', () => {
    expect(tuning.rockfall_enabled).toBe(false);
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Camp 1');
    c.placeAt(x, z, 0, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    run(c, 1);
    expect(c.rockfall.rocks.length).toBe(0);
  });
});

describe('tether', () => {
  const ground = (x, z) => hm.heightAt(x, z);
  const [x, z] = at('Base Camp');
  const y = ground(x, z);

  it('hangs with slack between harness and rope', () => {
    const t = new Tether(hm);
    const harness = new THREE.Vector3(x, y + 1, z);
    const clip = new THREE.Vector3(x + 3, y + 1, z);
    for (let i = 0; i < 90; i++) t.update(FRAME, harness, clip, 6, new THREE.Vector3(1, 0, 0));
    const mid = t.points[Math.floor(t.points.length / 2)];
    expect(mid.y).toBeLessThan(y + 0.9);
    expect(mid.y).toBeGreaterThanOrEqual(ground(mid.x, mid.z));
    expect(t.tension).toBeLessThan(0.6);
  });

  it('pulls straight when the harness is at the end of it', () => {
    const t = new Tether(hm);
    const harness = new THREE.Vector3(x, y + 1, z);
    const clip = new THREE.Vector3(x + 6, y + 1, z);
    for (let i = 0; i < 90; i++) t.update(FRAME, harness, clip, 6, new THREE.Vector3(1, 0, 0));
    const mid = t.points[Math.floor(t.points.length / 2)];
    expect(t.tension).toBeGreaterThan(0.99);
    expect(mid.y).toBeGreaterThan(y + 0.6);
  });

  it('disappears when you unclip', () => {
    const t = new Tether(hm);
    t.update(FRAME, new THREE.Vector3(x, y + 1, z), new THREE.Vector3(x + 2, y + 1, z), 6);
    expect(t.visible).toBe(true);
    t.update(FRAME, null);
    expect(t.visible).toBe(false);
  });
});
