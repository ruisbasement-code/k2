// Avalanches: where slabs go, how often they come down, and getting out alive.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Climber } from '../src/player/climber.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import { isSlabSlope, slabLoad } from '../src/sim/avalanche.js';
import { Weather, mulberry32, weatherTuning as W } from '../src/sim/weather.js';
import { loadHeightmap } from './helpers.js';
import route from '../src/data/route.json';

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const at = (name) => {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
};

afterEach(() => vi.restoreAllMocks());

describe('avalanches', () => {
  it('loads steep lee slopes most and leaves flat ground alone', () => {
    const [cx, cz] = at('Camp 3');
    let checked = 0;
    for (let i = 0; i < 900; i++) {
      const x = cx + ((i % 30) - 15) * 30, z = cz + (Math.floor(i / 30) - 15) * 30;
      const slope = hm.slopeDeg(x, z);
      const [gx, gz] = hm.gradient(x, z);
      const g = Math.hypot(gx, gz);
      if (slope < W.slab_min_deg - 3 || slope > W.slab_max_deg + 3) {
        expect(slabLoad(hm, x, z, 1, 0, 1)).toBe(0);
        continue;
      }
      if (slope < 36 || slope > 44) continue;
      // Wind blowing down the slope loads it; wind blowing up it scours it.
      const lee = slabLoad(hm, x, z, -gx / g, -gz / g, 1);
      const windward = slabLoad(hm, x, z, gx / g, gz / g, 1);
      expect(lee).toBeGreaterThan(windward * 1.8);
      expect(lee).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('starts the expedition after recent snow, with storms coming soon', () => {
    let badHours = 0, hours = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = new Weather(seed, 6 * 3600);
      expect(w.avalancheDanger(7000, 6)).toBeGreaterThan(0.3);
      for (let t = 6 * 3600; t < 30 * 3600; t += 1800) {
        w.update(t);
        hours++;
        if (['snow', 'storm', 'whiteout', 'fog'].includes(w.current.key)) badHours++;
      }
    }
    // Over the first day, a good share of the time is spent in bad weather.
    expect(badHours / hours).toBeGreaterThan(0.25);
  });

  it('brings slides down far more often after a storm than on settled snow', () => {
    const count = (fresh) => {
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
      const c = new Climber(hm, ropes, route.places);
      c.weather = new Weather(2, c.mountainSeconds);
      c.weather.force('clear', 48);
      c.phys.acclimatized = 8611;
      c._hurt = () => {};
      let slides = 0;
      c.onMessage = (m) => { if (/Avalanche! A slope|thunders down|distant roar/.test(m)) slides++; };
      const [x, z] = at('Camp 2');
      c.placeAt(x, z, 0, 0);
      c.timeScale = 60;
      for (let i = 0; i < 30 * 60 * 8; i++) {
        c.weather.freshCm = fresh;
        c.weather.windSlab = fresh ? 0.6 : 0;
        c.update(1 / 30, { x: 0, y: 0 });
        if (c.falling || c.dead) c.placeAt(x, z, 0, 0);
      }
      vi.restoreAllMocks();
      return slides;
    };
    const settled = count(0);
    const loaded = count(60);
    // About 8 mountain hours: after a storm several slides come down near you.
    expect(loaded).toBeGreaterThan(4);
    expect(loaded).toBeGreaterThan(settled * 2);
  }, 60000);

  it('buries you less often when you swim for the surface', () => {
    const buried = (swim) => {
      vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
      const c = new Climber(hm, ropes, route.places);
      let n = 0, deep = 0;
      c.onMessage = (m) => { if (/Buried/.test(m)) n++; if (/Buried deep/.test(m)) deep++; };
      for (let i = 0; i < 400; i++) {
        c.health = 100;
        c.fall = { avalanche: true, swim };
        c._avalancheStops();
      }
      vi.restoreAllMocks();
      return { n, deep };
    };
    const limp = buried(0);
    const fought = buried(W.swim_full_s);
    // Luck still matters: some get away clean, some are buried, a few deep.
    expect(limp.n).toBeGreaterThan(150);
    expect(limp.n).toBeLessThan(330);
    expect(limp.deep).toBeGreaterThan(20);
    expect(fought.n).toBeLessThan(limp.n * 0.5);
  });

  it('lets a climber caught by a slide fight to the top and survive', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(42));
    const [cx, cz] = at('Camp 2');
    let crown = null;
    for (let i = 0; i < 400 && !crown; i++) {
      const x = cx + ((i % 20) - 10) * 40, z = cz + (Math.floor(i / 20) - 10) * 40;
      if (isSlabSlope(hm, x, z)) crown = [x, z];
    }
    const c = new Climber(hm, ropes, route.places);
    const [gx, gz] = hm.gradient(crown[0], crown[1]);
    const g = Math.hypot(gx, gz);
    c.placeAt(crown[0] - (gx / g) * 30, crown[1] - (gz / g) * 30, 0, 0);
    c.avalanches.release(crown[0], crown[1], 60);
    const said = [];
    c.onMessage = (m) => said.push(m);
    let swept = false;
    for (let t = 0; t < 40 && !c.dead; t += 1 / 30) {
      c.update(1 / 30, { x: 0, y: 0, arrest: true });
      if (c.falling && c.fall.avalanche) swept = true;
      if (swept && !c.falling) break;
    }
    expect(swept).toBe(true);
    expect(said.some((m) => /Swimming hard/.test(m))).toBe(true);
  });

  it('cracks a slab above you a few seconds before it lets go', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(7));
    const c = new Climber(hm, ropes, route.places);
    const [x, z] = at('Camp 2');
    c.placeAt(x, z, 0, 0);
    let crown = null;
    for (let i = 0; i < 50 && !crown; i++) crown = c.avalanches.findAbove(x, z);
    expect(crown).not.toBeNull();
    const said = [];
    c.onMessage = (m) => said.push(m);
    c._crackAbove({ ...crown, x: x + 200, z });
    expect(c.pendingSlides.length).toBe(1);
    expect(c.avalanches.slides.length).toBe(0);
    expect(c.cues.some((q) => q.kind === 'crack')).toBe(true);
    expect(said.some((m) => /^Crack!/.test(m))).toBe(true);
    c._releaseCracked(W.warning_s - 0.5);
    expect(c.avalanches.slides.length).toBe(0);
    c._releaseCracked(1);
    expect(c.pendingSlides.length).toBe(0);
  });

  it('whumpfs underfoot on a loaded slope before it breaks', () => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(3));
    const [cx, cz] = at('Camp 2');
    let spot = null;
    for (let i = 0; i < 900 && !spot; i++) {
      const x = cx + ((i % 30) - 15) * 30, z = cz + (Math.floor(i / 30) - 15) * 30;
      if (isSlabSlope(hm, x, z) && hm.slopeDeg(x, z) > 36 && hm.slopeDeg(x, z) < 44) spot = [x, z];
    }
    expect(spot).not.toBeNull();
    const [gx, gz] = hm.gradient(spot[0], spot[1]);
    const g = Math.hypot(gx, gz);
    const c = new Climber(hm, ropes, route.places);
    c.placeAt(spot[0], spot[1], 0, 0);
    c.conditions = { avalancheDanger: 0.9, windX: -gx / g, windZ: -gz / g };
    c.weather = { windSlab: 1 };
    const said = [];
    c.onMessage = (m) => said.push(m);
    for (let i = 0; i < 300; i++) { c._whumpfCool = 0; c._maybeTriggerSlab(); }
    expect(c.slabRisk).toBeGreaterThan(0.3);
    expect(said.some((m) => /^Whumpf!/.test(m))).toBe(true);
    // A settling whumpf comes far more often than the slab actually breaking.
    const whumpfs = said.filter((m) => /^Whumpf!/.test(m)).length;
    const breaks = said.filter((m) => /fractured under your feet/.test(m)).length;
    expect(whumpfs).toBeGreaterThan(breaks * 3);
  });
});
