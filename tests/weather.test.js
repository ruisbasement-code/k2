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
    expect(w.conditionsAt(hm, p, 10).visibility).toBeLessThan(300);
    w.force('whiteout');
    expect(w.conditionsAt(hm, p, 10).visibility).toBeLessThan(40);
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
