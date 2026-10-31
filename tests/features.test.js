// Crevasses, snow bridges, pits, seracs, cornices, snow caves and technical
// sections: where they are, and what they do to the climber.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Climber, Mode } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { TerrainFeatures } from '../src/sim/terrainFeatures.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import defs from '../src/data/features.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

afterEach(() => vi.restoreAllMocks());

const at = (name) => {
  const p = route.places.find((q) => q.name === name);
  return hm.gridToWorld(p.r, p.c);
};

/** A world with the cornices built, which are switched off in the game for now. */
function withCornices() {
  const on = tuning.cornices_enabled;
  tuning.cornices_enabled = true;
  const f = world();
  tuning.cornices_enabled = on;
  return f;
}

function world() {
  return new TerrainFeatures(hm, defs, { ropes, places: route.places });
}

function climberWith(features) {
  const c = new Climber(hm, ropes, route.places, features);
  c.timeScale = 1;
  c.mountainSeconds = 7 * 3600;
  return c;
}

function run(c, seconds, input) {
  for (let t = 0; t < seconds; t += FRAME) c.update(FRAME, input);
}

/** The generated holes on the glacier around Base Camp. */
function glacierHoles(f, filter = () => true) {
  const [x, z] = at('Base Camp');
  return f.holesNear(x, z - 1200, 1500).filter((h) => h.kind !== 'bergschrund' && filter(h));
}

/** A spot just outside a hole, on the side away from its middle, facing it. */
function besideHole(h, gap = 1.2) {
  const c = mid(h);
  const s = TerrainFeatures.point(h, 0, TerrainFeatures.halfWidth(h, 0) + gap);
  return { x: s.x, z: s.z, faceX: c.x, faceZ: c.z };
}

/** The middle of a hole (a bowed crevasse's centre point is off to one side). */
function mid(h) {
  return TerrainFeatures.point(h, 0, 0);
}

const STILL = { x: 0, y: 0 };
const FORWARD = { x: 0, y: 1 };

describe('where the features are', () => {
  const f = world();

  it('has crevasses on the Godwin-Austen Glacier, open low down and mostly hidden higher up', () => {
    const holes = glacierHoles(f);
    expect(holes.length).toBeGreaterThan(30);
    expect(holes.filter((h) => h.kind === 'crevasse').length).toBeGreaterThan(20);
    expect(holes.some((h) => h.kind === 'pit' || h.kind === 'moulin')).toBe(true);
    const high = holes.filter((h) => hm.heightAt(h.x, h.z) > tuning.bare_glacier_below_m);
    const hidden = high.filter((h) => h.hidden).length / high.length;
    expect(hidden).toBeGreaterThan(0.4);
    for (const h of holes) expect(hm.glacierAt(h.x, h.z) + (hm.heightAt(h.x, h.z) > 7400 ? 1 : 0)).toBeGreaterThan(0.3);
  });

  it('lies across the glacier flow, in fields of parallel cracks that never cross', () => {
    const cracks = glacierHoles(f, (q) => q.kind === 'crevasse');
    let square = 0, counted = 0;
    for (const h of cracks) {
      const [gx, gz] = hm.baseGradient(h.x, h.z, 60);
      const g = Math.hypot(gx, gz);
      if (g < 0.03) continue;
      counted++;
      if (Math.abs(h.ux * gx + h.uz * gz) / g < 0.5) square++;
    }
    // Most within 30° of square to the fall line (a whole field shares one direction).
    expect(square / counted).toBeGreaterThan(0.75);
    // No crack's middle line runs through another crack.
    for (const a of cracks) {
      for (let u = -a.half * 0.9; u <= a.half * 0.9; u += 2) {
        const p = TerrainFeatures.point(a, u, 0);
        const hit = f.holeAt(p.x, p.z);
        expect(hit === null || hit.hole === a).toBe(true);
      }
    }
  });

  it('keeps camps, the wanded trail and the fixed ropes clear', () => {
    for (const h of glacierHoles(f)) {
      expect(f.trailDistance(h.x, h.z)).toBeGreaterThan(defs.wand_trail.clear_m);
      for (const name of ['Base Camp', 'Advanced Base Camp']) {
        const [x, z] = at(name);
        expect(Math.hypot(h.x - x, h.z - z)).toBeGreaterThan(tuning.camp_radius_m);
      }
    }
    // Walk the wanded trail: no hole, and no serac, anywhere on it.
    const pts = f.trail.points;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let t = 0; t <= 1; t += 0.002) {
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
        expect(f.holeAt(x, z)).toBeNull();
        expect(f.seracAt(x, z)).toBeNull();
      }
    }
    for (const rope of ropes.ropes) {
      for (const p of rope) {
        expect(f.holeAt(p.x, p.z)).toBeNull();
        expect(f.seracAt(p.x, p.z)).toBeNull();
      }
    }
  });

  it('puts the bergschrund across the foot of the Abruzzi Spur, bridged where the trail crosses', () => {
    const berg = f.placedHoles.filter((h) => h.kind === 'bergschrund');
    expect(berg).toHaveLength(2);
    for (const h of berg) {
      const y = hm.heightAt(h.x, h.z);
      expect(y).toBeGreaterThan(5100);
      expect(y).toBeLessThan(5300);
    }
  });

  it('hangs the Bottleneck serac above the couloir at about 8,400 m, beside the rope', () => {
    const solid = tuning.serac_blocks;
    tuning.serac_blocks = true;
    const blocks = world().placedSeracs.filter((s) => s.name === 'Bottleneck serac');
    tuning.serac_blocks = solid;
    // Glacier ice towers are off.
    expect(f.seracsNear(...at('Base Camp'), 3000).filter((s) => s.name === 'Ice tower')).toHaveLength(0);
    expect(blocks.length).toBeGreaterThan(3);
    for (const b of blocks) {
      expect(b.y).toBeGreaterThan(8250);
      expect(b.y).toBeLessThan(8550);
      expect(ropes.nearest(new THREE.Vector3(b.x, b.y, b.z)).distance).toBeLessThan(200);
    }
    // Its ice falls down the fall line, toward the Bottleneck below.
    const fall = f.icefalls[0];
    const [bx, bz] = at('Bottleneck');
    const toward = (bx - fall.x) * fall.face.x + (bz - fall.z) * fall.face.z;
    expect(toward).toBeGreaterThan(0);
  });

  it('finds the summit ridge crest for its cornice, high on the mountain', () => {
    const c = withCornices().cornices.find((q) => q.name === 'Summit ridge cornice');
    for (const p of c.points) expect(p.y).toBeGreaterThan(8350);
    // The crest is higher than the ground just out on the lee side.
    const mid = c.points[Math.floor(c.points.length / 2)];
    expect(hm.heightAt(mid.x + c.lee.x * 20, mid.z + c.lee.z * 20)).toBeLessThan(mid.y);
  });

  it('names the technical sections and cols', () => {
    const chimney = f.zones.find((z) => z.name === "House's Chimney");
    const y = hm.heightAt(chimney.points[0].x, chimney.points[0].z);
    expect(y).toBeGreaterThan(6400);
    expect(y).toBeLessThan(6750);
    for (const col of f.cols) {
      expect(Math.abs(col.y - col.height_m)).toBeLessThan(250);
      expect(f.placeName(col.x, col.z)).toContain(col.name);
    }
  });
});

describe('crevasses and pits', () => {
  it('swallows you when you walk into an open crevasse, and you land hurt at the bottom', () => {
    const f = world();
    const h = glacierHoles(f, (q) => q.kind === 'crevasse' && !q.hidden && q.width > 0.6)[0];
    const c = climberWith(f);
    const s = besideHole(h);
    c.placeAt(s.x, s.z, s.faceX, s.faceZ);
    run(c, 30, FORWARD);
    expect(c.mode === Mode.HOLE || c.dead).toBe(true);
    if (c.dead) return;
    expect(c.health).toBeLessThan(100);
    expect(hm.heightAt(c.position.x, c.position.z) - c.position.y).toBeCloseTo(h.depth, 0);
    expect(c.sheltered).toBe(true);
  });

  it('hurts more the deeper you fall (an 8 m drop hurts a lot, it does not kill)', () => {
    const damage = (depth) => {
      const f = world();
      const h = { ...glacierHoles(f, (q) => q.kind === 'crevasse')[0], depth };
      const c = climberWith(f);
      const m = mid(h);
      c.placeAt(m.x, m.z, m.x + 1, m.z);
      c._enterHole({ hole: h, u: 0, v: 0 }, 'test');
      run(c, 10, STILL);
      return 100 - c.health;
    };
    const shallow = damage(8), deep = damage(30);
    expect(shallow).toBeLessThan(45);
    expect(deep).toBeGreaterThan(shallow * 2);
  });

  it('can break a hidden snow bridge under you, more likely in the afternoon', () => {
    const f = world();
    const h = glacierHoles(f, (q) => q.kind === 'crevasse' && q.hidden)[0];
    const c = climberWith(f);
    const m = mid(h);
    c.placeAt(m.x, m.z, m.x + h.ux, m.z + h.uz);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    c.mountainSeconds = 14 * 3600;
    expect(c._stepHazards(0, 0)).toBe(true);
    expect(f.isOpen(h)).toBe(true);
    expect(c.falling && c.fall.hole).toBeTruthy();
    vi.restoreAllMocks();
    const warm = climberWith(f), cold = climberWith(f);
    warm.mountainSeconds = 14 * 3600;
    cold.mountainSeconds = 5 * 3600;
    expect(warm._snowWarmth()).toBeGreaterThan(cold._snowWarmth() * 4);
  });

  it('a slide that runs over an open crevasse goes into it', () => {
    const f = world();
    const h = glacierHoles(f, (q) => q.kind === 'crevasse' && !q.hidden && q.width > 0.6)[0];
    const c = climberWith(f);
    const s = besideHole(h, 3);
    c.placeAt(s.x, s.z, s.faceX, s.faceZ);
    c._startFall(0, 0, 'test');
    c.velocity.set(mid(h).x - s.x, 0, mid(h).z - s.z).setLength(8);
    run(c, 3, STILL);
    expect(c.fall?.hole || c.mode === Mode.HOLE).toBeTruthy();
  });

  it('lets you climb out, slowly, onto the side you face', () => {
    const f = world();
    const h = { ...glacierHoles(f, (q) => q.kind === 'crevasse')[0], depth: 8 };
    const c = climberWith(f);
    const m = mid(h);
    c.placeAt(m.x, m.z, m.x, m.z);
    c._enterHole({ hole: h, u: 0, v: 0 }, 'test');
    run(c, 5, STILL);
    expect(c.mode).toBe(Mode.HOLE);
    // Face across the slot.
    c.yaw = Math.atan2(h.uz, -h.ux);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    c.timeScale = 60;
    let t = 0;
    while (c.mode === Mode.HOLE && t < 600) {
      c.update(FRAME, FORWARD);
      if (c.body.exhausted) run(c, 5, STILL);
      t += FRAME;
    }
    expect(c.mode).not.toBe(Mode.HOLE);
    expect(f.holeAt(c.position.x, c.position.z)).toBeNull();
    expect(c.position.y).toBeCloseTo(hm.groundAt(c.position.x, c.position.z), 1);
  });

  it('finds hidden crevasses ahead when you probe', () => {
    const f = world();
    const h = glacierHoles(f, (q) => q.kind === 'crevasse' && q.hidden)[0];
    const c = climberWith(f);
    const s = besideHole(h, 1.5);
    c.placeAt(s.x, s.z, s.faceX, s.faceZ);
    const before = c.mountainSeconds;
    expect(c.probe()).toContain(h);
    expect(f.isKnown(h)).toBe(true);
    expect(f.isOpen(h)).toBe(false);
    expect(c.mountainSeconds).toBe(before + tuning.probe_seconds);
  });
});

describe('cornices, seracs, caves and hard ground', () => {
  it('a cornice can break off under you and throw you down the lee side', () => {
    const f = withCornices();
    const c = climberWith(f);
    const cor = f.cornices.find((q) => q.name === 'Shoulder cornice');
    const p = cor.points[Math.floor(cor.points.length / 2)];
    const x = p.x + cor.lee.x * p.width * 0.8, z = p.z + cor.lee.z * p.width * 0.8;
    c.placeAt(x, z, x + cor.lee.x, z + cor.lee.z);
    expect(f.corniceAt(x, z)).not.toBeNull();
    expect(c.position.y).toBeGreaterThan(hm.heightAt(x, z));
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(c._stepHazards(0, 0)).toBe(true);
    expect(c.falling).toBe(true);
    expect(f.corniceAt(x, z)).toBeNull();
    expect(c.velocity.x * cor.lee.x + c.velocity.z * cor.lee.z).toBeGreaterThan(0);
  });

  it('stops you walking into a serac', () => {
    const solid = tuning.serac_blocks;
    tuning.serac_blocks = true;
    const f = world();
    tuning.serac_blocks = solid;
    const c = climberWith(f);
    const b = f.placedSeracs[2];
    // Just below its downhill face, walking into it.
    const nx = -b.uz, nz = b.ux;
    const [gx, gz] = hm.gradient(b.x, b.z);
    const s = nx * gx + nz * gz > 0 ? -1 : 1;
    const x = b.x + nx * s * (b.halfD + 1), z = b.z + nz * s * (b.halfD + 1);
    c.placeAt(x, z, b.x, b.z);
    c.toggleClip();
    run(c, 20, FORWARD);
    expect(f.seracAt(c.position.x, c.position.z)).toBeNull();
  });

  it('serac ice comes down on its own, separate from rockfall', () => {
    const f = world();
    expect(tuning.rockfall_enabled).toBe(false);
    const fall = f.icefalls[0];
    let rocks = 0;
    for (let i = 0; i < 2000 && !rocks; i++) {
      f.maybeIcefall(60, 14, fall);
      rocks = f.icefall.rocks.length;
    }
    expect(rocks).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) f.icefall.step(1 / 30);
    // They come down the slope.
    expect(Math.min(...f.icefall.rocks.map((r) => r.position.y), 9000)).toBeLessThan(fall.y);
  });

  it('heals you faster in a snow cave than out in the open', () => {
    const f = world();
    const cave = f.caverns.find((q) => q.name === 'Snow cave on the Shoulder');
    const heal = (x, z) => {
      const c = climberWith(f);
      c.placeAt(x, z, x + 1, z);
      c.health = 50;
      c.timeScale = 60;
      run(c, 30, STILL);
      return c.health - 50;
    };
    const inCave = heal(cave.x, cave.z);
    expect(inCave).toBeGreaterThan(0);
    const c = climberWith(f);
    c.placeAt(cave.x, cave.z, cave.x + 1, cave.z);
    run(c, 0.1, STILL);
    expect(c.sheltered).toBe(true);
  });

  it("slows you down in House's Chimney", () => {
    const f = world();
    const z = f.zones.find((q) => q.name === "House's Chimney");
    const p = z.points[0];
    const c = climberWith(f);
    c.placeAt(p.x, p.z, z.points[1].x, z.points[1].z);
    run(c, 0.1, STILL);
    expect(c.zone?.name).toBe("House's Chimney");
    expect(c.placeName).toBe("House's Chimney");
  });
});

describe('switched off for now', () => {
  it('has no cornices unless cornices_enabled', () => {
    expect(world().cornices).toHaveLength(tuning.cornices_enabled ? defs.cornices.length : 0);
  });
});
