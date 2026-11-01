// Ropes climbers fix for each other: a lead walks up, screws in, walks up, screws
// in, and the rope through the pieces becomes a fixed line the team can use.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Climber } from '../src/player/climber.js';
import * as Pace from '../src/sim/paceModel.js';
import { FixedRopes } from '../src/world/fixedRopes.js';
import { ProtectionView } from '../src/world/protectionView.js';
import { SharedRopes, LINK_M } from '../src/world/sharedRopes.js';
import route from '../src/data/route.json';
import { loadHeightmap } from './helpers.js';

const { tuning } = Pace;
tuning.rockfall_per_min = 0;

const hm = loadHeightmap();
const FRAME = 1 / 30;

/** A steep slope well away from the route's ropes, and the line up it: points every step m. */
function slopeLine(ropes, count, step) {
  const [cx, cz] = hm.gridToWorld(300, 300);
  for (let r = 0; r < 4000; r += 40) {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      let x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const deg = hm.slopeDeg(x, z);
      if (deg < 34 || deg > 42) continue;
      if (ropes.nearest(new THREE.Vector3(x, hm.heightAt(x, z), z)).distance < 200) continue;
      const pts = [];
      let ok = true;
      for (let i = 0; i < count && ok; i++) {
        pts.push({ x, y: hm.groundAt(x, z), z });
        const [gx, gz] = hm.gradient(x, z);
        const g = Math.hypot(gx, gz) || 1;
        x += (gx / g) * step;
        z += (gz / g) * step;
        const d = hm.slopeDeg(x, z);
        if (d < 30 || d > 46) ok = false;
      }
      if (ok) return pts;
    }
  }
  throw new Error('no slope found');
}

function setup() {
  const ropes = new FixedRopes(hm, route.fixed_ropes);
  const protection = new ProtectionView(hm);
  const shared = new SharedRopes(ropes, protection, 'Ana');
  const events = [];
  shared.onEvent = (e) => events.push(e);
  return { ropes, protection, shared, events };
}

afterEach(() => vi.restoreAllMocks());

describe('ropes climbers fix', () => {
  it('turns a chain of pieces into a fixed line with an anchor at each', () => {
    const { ropes, protection, shared, events } = setup();
    const pts = slopeLine(ropes, 4, 15);
    expect(shared.placed(protection.place({ ...pts[0], kind: 'screw' }))).toBe(-1); // one piece: no line yet
    let id = -1;
    for (const p of pts.slice(1)) id = shared.placed(protection.place({ ...p, kind: 'picket' }));
    expect(ropes.isPlaced(id)).toBe(true);
    expect(ropes.isActive(id)).toBe(true);
    const A = ropes.anchorsOf(id);
    expect(A.length).toBe(4);
    expect(A[0]).toBe(0);
    expect(A[3]).toBeCloseTo(ropes.lengthOf(id));
    // Each anchor is at a piece.
    const pieces = shared.lead.pieces;
    A.forEach((s, k) => {
      const q = ropes.pointAt(id, s);
      expect(Math.hypot(q.x - pieces[k].clip.x, q.z - pieces[k].clip.z)).toBeLessThan(0.05);
    });
    // Growing the line leaves the stretches below where they were.
    expect(events.at(-1)).toMatchObject({ type: 'rope', by: 'Ana', key: shared.lead.key });
    expect(events.at(-1).pieces.length).toBe(4);
  });

  it('starts a new line when the next piece is out of the rope\'s reach', () => {
    const { ropes, protection, shared } = setup();
    const pts = slopeLine(ropes, 2, 15);
    shared.placed(protection.place({ ...pts[0], kind: 'screw' }));
    const first = shared.placed(protection.place({ ...pts[1], kind: 'screw' }));
    const far = { x: pts[1].x + LINK_M * 3, y: pts[1].y, z: pts[1].z };
    shared.placed(protection.place({ ...far, kind: 'screw' }));
    expect(ropes.anchorsOf(first).length).toBe(2);
    expect(ropes.lineIds.size).toBe(1); // the new one is a single piece so far
  });

  it('lets a teammate clip in, clip past the anchors and jumar up', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no slips
    const { ropes, protection, shared } = setup();
    const pts = slopeLine(ropes, 5, 14);
    let id = -1;
    for (const p of pts) id = shared.placed(protection.place({ ...p, kind: 'picket' }));
    const c = new Climber(hm, ropes, route.places);
    const start = ropes.pointAt(id, 3);
    c.placeAt(start.x, start.z, 0, 0);
    const msgs = [];
    c.onMessage = (m) => msgs.push(m);
    c.toggleClip();
    expect(c.ropeId).toBe(id);
    expect(msgs.at(-1)).toMatch(/Ana's rope|rope you fixed/);
    c.toggleAxe();
    c.axe.drawing = 0;
    let changeovers = 0, was = false;
    for (let t = 0; t < 150 && c.clipped && !c.falling; t += FRAME) {
      const tan = ropes.tangentAt(c.ropeId, c.ropeS);
      c.yaw = Math.atan2(-tan.x, -tan.z);
      c.update(FRAME, { x: 0, y: 1 });
      if (c.changeover && !was) changeovers++;
      was = !!c.changeover;
    }
    expect(c.falling).toBe(false);
    expect(changeovers).toBeGreaterThanOrEqual(2);
    expect(c.clipSection).toBeGreaterThanOrEqual(2);
  });

  it('shows another player\'s line the same, and takes it down when they clean it', () => {
    const lead = setup();
    const pts = slopeLine(lead.ropes, 3, 15);
    for (const p of pts) lead.shared.placed(lead.protection.place({ ...p, kind: 'screw' }));
    const mine = setup();
    mine.shared.who = 'Bo';
    const id = mine.shared.receive(lead.events.at(-1));
    expect(mine.ropes.names[id]).toBe("Ana's rope");
    expect(mine.protection.pieces.length).toBe(3);
    const theirs = lead.ropes.lineIds.get(lead.shared.lead.key);
    expect(mine.ropes.lengthOf(id)).toBeCloseTo(lead.ropes.lengthOf(theirs), 3);
    expect(mine.ropes.anchorsOf(id)).toEqual(lead.ropes.anchorsOf(theirs));
    // The top piece rips: the line ends one lower, on both games.
    lead.shared.lost(lead.shared.lead.pieces[2].id);
    mine.shared.receive(lead.events.at(-1));
    expect(mine.ropes.anchorsOf(id).length).toBe(2);
    expect(mine.protection.pieces.length).toBe(2);
    // Then the next: one piece is no line, and nobody can clip to it.
    lead.shared.lost(lead.shared.lead.pieces[1].id);
    mine.shared.receive(lead.events.at(-1));
    expect(mine.ropes.isActive(id)).toBe(false);
    const p = mine.ropes.pointAt(id, 0);
    expect(mine.ropes.nearest(p).rope).not.toBe(id);
  });

  it('leaves the route\'s own features alone', () => {
    const { ropes, protection, shared } = setup();
    const pts = slopeLine(ropes, 3, 15);
    for (const p of pts) shared.placed(protection.place({ ...p, kind: 'screw' }));
    const id = ropes.lineIds.values().next().value;
    const p = ropes.pointAt(id, 5);
    expect(ropes.nearest(p).rope).toBe(id);
    expect(ropes.nearest(p, { placed: false }).rope).toBeLessThan(ropes.routeCount);
  });
});
