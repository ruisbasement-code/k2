// The weather timeline, temperature, wind, visibility and the snowpack.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Weather, windChill, weatherTuning as W } from '../src/sim/weather.js';
import { loadHeightmap } from './helpers.js';

const hm = loadHeightmap();
const DAY = 86400;

describe('weather', () => {
  it('is the same timeline for the same seed', () => {
    const a = new Weather(7, 6 * 3600);
    const b = new Weather(7, 6 * 3600);
    a.update(10 * DAY);
    b.update(10 * DAY);
    expect(a.spells.map((s) => s.key)).toEqual(b.spells.map((s) => s.key));
  });

  it('has every kind of weather over a season, storms most in the afternoon', () => {
    const w = new Weather(3, 0);
    w._extend(120 * DAY);
    const kinds = new Set(w.spells.map((s) => s.key));
    for (const k of Object.keys(W.conditions)) expect(kinds.has(k)).toBe(true);
    const stormStarts = w.spells.filter((s) => s.key === 'storm' || s.key === 'snow').map((s) => (s.start / 3600) % 24);
    const afternoon = stormStarts.filter((h) => h >= 11 && h <= 19).length / stormStarts.length;
    expect(afternoon).toBeGreaterThan(8 / 24);
  });

  it('is mild at Base Camp by day and bitter on the summit at night', () => {
    const w = new Weather(1, 0);
    w.force('clear');
    const bcDay = w.airTemperature(5000, 14.5);
    const summitNight = w.airTemperature(8611, 4);
    expect(bcDay).toBeGreaterThan(0);
    expect(bcDay).toBeLessThan(10);
    expect(summitNight).toBeLessThan(-25);
    expect(summitNight).toBeGreaterThan(-45);
    expect(windChill(-25, 20)).toBeLessThan(-40);
  });

  it('blows harder up high, on ridges and in storms', () => {
    const w = new Weather(1, 0);
    w.force('clear');
    expect(w.windSpeed(8400, 0.5)).toBeGreaterThan(w.windSpeed(5000, 0.5) * 2.5);
    expect(w.windSpeed(7000, 1)).toBeGreaterThan(w.windSpeed(7000, 0) * 2.5);
    const calm = w.windSpeed(7000, 0.5);
    w.force('storm');
    expect(w.windSpeed(7000, 0.5)).toBeGreaterThan(calm * 2);
  });

  it('closes visibility right down in storms and whiteouts', () => {
    const w = new Weather(1, 0);
    const p = new THREE.Vector3(0, 0, 2000);
    p.y = hm.heightAt(p.x, p.z);
    w.force('clear');
    expect(w.conditionsAt(hm, p, 10).visibility).toBeGreaterThan(5000);
    w.force('storm');
    expect(w.conditionsAt(hm, p, 10).visibility).toBeLessThan(20);
    w.force('whiteout');
    expect(w.conditionsAt(hm, p, 10).visibility).toBeLessThan(15);
  });

  it('has a storm on most days, but they pass', () => {
    let days = 0, stormy = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = new Weather(seed, 0);
      w._extend(30 * DAY);
      for (let d = 0; d < 30; d++) {
        days++;
        if (w.spells.some((s) => (s.key === 'storm' || s.key === 'whiteout') && s.start < (d + 1) * DAY && s.end > d * DAY)) stormy++;
      }
      expect(w.spells.filter((s) => s.key === 'storm').every((s) => s.end - s.start <= 14 * 3600)).toBe(true);
    }
    expect(stormy / days).toBeGreaterThan(0.4);
    expect(stormy / days).toBeLessThan(0.9);
  });

  it('builds fresh snow in storms, which raises the avalanche danger, then settles', () => {
    const w = new Weather(1, 0);
    w.force('clear', 48);
    w.update(DAY);
    const calm = w.avalancheDanger(7000, 8);
    w.force('storm', 24);
    w.update(2 * DAY);
    expect(w.freshCm).toBeGreaterThan(40);
    expect(w.avalancheDanger(7000, 8)).toBeGreaterThan(calm + 0.4);
    w.force('clear', 200);
    w.update(9 * DAY);
    expect(w.avalancheDanger(7000, 8)).toBeLessThan(0.4);
  });

  it('gives a radio forecast', () => {
    const w = new Weather(5, 6 * 3600);
    expect(w.forecastText(6 * 3600).length).toBeGreaterThan(5);
  });
});

describe('weather on the climber', async () => {
  const { Climber, Mode } = await import('../src/player/climber.js');
  const { FixedRopes } = await import('../src/world/fixedRopes.js');
  const { Avalanches, isSlabSlope } = await import('../src/sim/avalanche.js');
  const route = (await import('../src/data/route.json')).default;
  const ropes = new FixedRopes(hm, route.fixed_ropes);
  const FRAME = 1 / 30;
  const at = (name) => {
    const p = route.places.find((q) => q.name === name);
    return hm.gridToWorld(p.r, p.c);
  };

  it('exposes the conditions where the climber is', () => {
    const c = new Climber(hm, ropes, route.places);
    c.weather = new Weather(2, c.mountainSeconds);
    const [x, z] = at('Camp 4');
    c.placeAt(x, z, 0, 0);
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.conditions.airC).toBeLessThan(0);
    expect(c.conditions.windChillC).toBeLessThanOrEqual(c.conditions.airC);
    expect(c.conditions.visibility).toBeGreaterThan(0);
    // The survival systems' air hook, when present, follows the weather.
    c.environment = {};
    c.weather.force('storm');
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.environment.airTempC).toBeCloseTo(c.conditions.airC, 5);
    expect(c.environment.windMs).toBeCloseTo(c.conditions.wind, 5);
    expect(c.environment.wet).toBeGreaterThan(0.5);
  });

  it('is pushed downwind in a storm, and slowed walking into it', () => {
    const c = new Climber(hm, ropes, route.places);
    c.weather = new Weather(2, c.mountainSeconds);
    c.weather.force('storm', 48);
    const [x, z] = at('Camp 4');
    c.placeAt(x, z, 0, 0);
    c.update(FRAME, { x: 0, y: 0 });
    const start = c.position.clone();
    let pushed = 0;
    for (let t = 0; t < 20 && !c.falling; t += FRAME) {
      const before = c.position.clone();
      c.update(FRAME, { x: 0, y: 0 });
      pushed += (c.position.x - before.x) * c.conditions.windX + (c.position.z - before.z) * c.conditions.windZ;
    }
    expect(pushed).toBeGreaterThan(0.2);
    expect(c.position.distanceTo(start)).toBeGreaterThan(0.2);
    const into = new THREE.Vector3(-c.conditions.windX, 0, -c.conditions.windZ);
    const withIt = new THREE.Vector3(c.conditions.windX, 0, c.conditions.windZ);
    expect(c._windPace(into)).toBeLessThan(c._windPace(withIt));
    expect(c._windPace(into)).toBeLessThan(0.9);
  });

  it('runs an avalanche down the slope that sweeps a climber below away', () => {
    // Find a slab slope near Camp 3 and stand below its crown.
    const av = new Avalanches(hm);
    const [cx, cz] = at('Camp 2');
    let crown = null;
    for (let i = 0; i < 400 && !crown; i++) {
      const x = cx + ((i % 20) - 10) * 40, z = cz + (Math.floor(i / 20) - 10) * 40;
      if (isSlabSlope(hm, x, z)) crown = [x, z];
    }
    expect(crown).not.toBeNull();
    const slide = av.release(crown[0], crown[1], 60);
    const y0 = slide.origin.y;
    let lowest = y0;
    for (let t = 0; t < 30 && av.active; t += FRAME) {
      av.step(FRAME);
      for (const b of slide.blobs) lowest = Math.min(lowest, b.position.y);
    }
    expect(y0 - lowest).toBeGreaterThan(100);

    const c = new Climber(hm, ropes, route.places);
    c.placeAt(crown[0], crown[1], 0, 0);
    // Stand just under where the slab breaks.
    const [gx, gz] = hm.gradient(crown[0], crown[1]);
    const g = Math.hypot(gx, gz);
    c.placeAt(crown[0] - (gx / g) * 30, crown[1] - (gz / g) * 30, 0, 0);
    c.avalanches.release(crown[0], crown[1], 60);
    const h0 = c.health;
    let swept = false;
    for (let t = 0; t < 20; t += FRAME) {
      c.update(FRAME, { x: 0, y: 0 });
      if (c.falling && c.fall.avalanche) swept = true;
    }
    expect(swept).toBe(true);
    expect(c.health).toBeLessThan(h0);
  });

  it('lets ice fall from the serac when you are under the Bottleneck', () => {
    const c = new Climber(hm, ropes, route.places);
    c.weather = new Weather(2, c.mountainSeconds);
    const [x, z] = at('Bottleneck');
    c.placeAt(x, z, 0, 0);
    c.toggleClip();
    c.mountainSeconds = 14 * 3600;
    c.timeScale = 60;
    let released = false;
    for (let i = 0; i < 4000 && !released; i++) {
      c.update(FRAME, { x: 0, y: 0 });
      released = c.rockfall.rocks.some((r) => r.ice && r.size > 0.39);
    }
    expect(released).toBe(true);
    expect(c.mode).not.toBe(Mode.FLY);
  });

  it('calves the terrain features\' Bottleneck serac when they are present', async () => {
    const { TerrainFeatures } = await import('../src/sim/terrainFeatures.js');
    const defs = (await import('../src/data/features.json')).default;
    const features = new TerrainFeatures(hm, defs, { ropes, places: route.places });
    const c = new Climber(hm, ropes, route.places, features);
    c.weather = new Weather(2, c.mountainSeconds);
    const [x, z] = at('Bottleneck');
    c.placeAt(x, z, 0, 0);
    c.toggleClip();
    c.mountainSeconds = 14 * 3600;
    c.timeScale = 60;
    let released = false;
    for (let i = 0; i < 4000 && !released; i++) {
      c.update(FRAME, { x: 0, y: 0 });
      released = features.icefall.rocks.length > 0;
    }
    expect(released).toBe(true);
    expect(c.rockfall.rocks.some((r) => r.ice && r.size > 0.39)).toBe(false);
  });
});
