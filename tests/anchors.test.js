// Clipping past the fixed rope's anchors, jumaring up it and rappelling down it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Climber } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
tuning.rockfall_per_min = 0;

const hm = loadHeightmap();
const ropes = new FixedRopes(hm, route.fixed_ropes);
const FRAME = 1 / 30;

/** A climber clipped in on steep ground partway up the first rope, axe out. */
function onSteepRope() {
  const c = new Climber(hm, ropes, route.places);
  const pts = ropes.ropes[0];
  const p = pts.find((q, i) => i > 20 && hm.slopeDeg(q.x, q.z) > 38 && hm.slopeDeg(q.x, q.z) < tuning.axe_climb_max_deg - 2);
  c.placeAt(p.x, p.z, 0, 0);
  c.toggleClip();
  c.toggleAxe();
  c.axe.drawing = 0;
  c.update(FRAME, { x: 0, y: 0 });
  return c;
}

afterEach(() => vi.restoreAllMocks());

describe('fixed rope anchors', () => {
  it('lists anchors from bottom to top, ends included, and finds the stretch you are on', () => {
    const A = ropes.anchorsOf(0);
    expect(A[0]).toBe(0);
    expect(A[A.length - 1]).toBeCloseTo(ropes.lengthOf(0));
    for (let i = 1; i < A.length; i++) expect(A[i]).toBeGreaterThan(A[i - 1]);
    const sec = ropes.sectionAt(0, (A[3] + A[4]) / 2);
    expect(sec).toEqual({ k: 3, lo: A[3], hi: A[4] });
  });

  it('stops you at each anchor, clips you past it, and carries on up the rope', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no slips
    const c = onSteepRope();
    const k0 = c.clipSection;
    const msgs = [];
    c.onMessage = (m) => msgs.push(m);
    let changeovers = 0, wasChanging = false, jumared = false;
    for (let t = 0; t < 120 && !c.falling; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1 });
      if (c.changeover && !wasChanging) changeovers++;
      wasChanging = !!c.changeover;
      if (c.modeName() === 'Jumaring up the rope') jumared = true;
      // The clip never gets past the anchors either side of it.
      if (c.clipped && !c.changeover) {
        const [lo, hi] = c.clipRange;
        const s = ropes.nearestOn(c.ropeId, c._ropeProbe()).s;
        expect(s).toBeGreaterThan(lo - 1.5);
        expect(s).toBeLessThan(hi + 1.5);
      }
    }
    expect(c.falling).toBe(false);
    expect(c.clipped).toBe(true);
    expect(changeovers).toBeGreaterThanOrEqual(2);
    expect(c.clipSection).toBeGreaterThanOrEqual(k0 + 2);
    expect(jumared).toBe(true);
  });

  it('takes a moment at the anchor, longer with numb hands', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const c = onSteepRope();
    c.atAnchor = 1;
    c.toggleClip();
    expect(c.clipped).toBe(true);
    const warm = c.changeover.total;
    expect(warm).toBeCloseTo(tuning.anchor_changeover_s);
    c.unclip();
    c.toggleClip();
    c.phys.numb = 1;
    c.atAnchor = 1;
    c.toggleClip();
    expect(c.changeover.total).toBeGreaterThan(warm * 1.3);
  });

  it('can slip while you are off the rope at the anchor: an unroped fall', () => {
    const c = onSteepRope();
    expect(c.changeoverRisk()).toBeGreaterThan(0);
    expect(c.changeoverRisk()).toBeLessThan(0.02);
    vi.spyOn(Math, 'random').mockReturnValue(0); // the slip comes up
    let slipped = '';
    c.onMessage = (m) => { if (/unclipped at the anchor/.test(m)) slipped = m; };
    c.atAnchor = 1;
    c.toggleClip();
    for (let t = 0; t < 2 && !c.falling; t += FRAME) c.update(FRAME, { x: 0, y: 0 });
    expect(slipped).not.toBe('');
    expect(c.falling).toBe(true);
    expect(c.fall.rope).toBeFalsy();
  });

  it('is no risk on walking ground', () => {
    const c = new Climber(hm, ropes, route.places);
    const p = ropes.ropes[0].find((q) => hm.slopeDeg(q.x, q.z) < 15);
    c.placeAt(p.x, p.z, 0, 0);
    c.toggleClip();
    c.update(FRAME, { x: 0, y: 0 });
    expect(c.changeoverRisk()).toBe(0);
  });

  it('rappels down the rope faster and easier than you jumar up it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const c = onSteepRope();
    const y0 = c.position.y, clock0 = c.mountainSeconds;
    let upEffort = 0, m = 0;
    for (let t = 0; t < 20 && !c.falling; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1 });
      if (c.modeName() === 'Jumaring up the rope') { upEffort += c.effort; m++; }
    }
    const up = (c.position.y - y0) / ((c.mountainSeconds - clock0) / 3600);
    const y1 = c.position.y, clock1 = c.mountainSeconds;
    let rappelled = false, effort = 0, n = 0;
    for (let t = 0; t < 20 && !c.falling; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(tan.x, tan.z);
      c.update(FRAME, { x: 0, y: 1 });
      if (c.modeName() === 'Rappelling down the rope') { rappelled = true; effort += c.effort; n++; }
    }
    const down = (y1 - c.position.y) / ((c.mountainSeconds - clock1) / 3600);
    expect(rappelled).toBe(true);
    expect(c.clipped).toBe(true);
    expect(down).toBeGreaterThan(up * 1.5);
    expect(effort / n).toBeLessThan((upEffort / m) * 0.6);
  });
});
