// Base Camp and the camps on the route, built from the props in campProps.js.
//
// Base Camp is a spread of expedition compounds on the glacier: each has a mess
// tent, a stone kitchen, sleeping tents on levelled stone platforms, a toilet tent,
// drums and duffels, with a puja altar and prayer flags in the middle of camp.
// The camps higher up are a few tents on ledges cut into the slope, with a
// built-up stone or snow platform under each, oxygen bottles and gear around.
// Every camp has been used for decades, so there are leftovers too: faded tents
// torn and slumped on old platforms, empty platforms, caches of drums or oxygen
// under tarps or drifted snow, and at Base Camp flag poles and a memorial cairn.

import * as THREE from 'three';
import { PropBatch, campMaterials } from './propBatch.js';
import * as P from './campProps.js';

const { rng, pick } = P;

/** World placement at (x, y, z) facing yaw (local +z points along yaw). */
const place = (x, y, z, yaw) => new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);

/**
 * Builds every camp. The group's userData.tents lists the sleeping tents as
 * {camp, x, z}, for sleeping in them.
 */
export function createCamps(hm, places, ropes) {
  const group = new THREE.Group();
  const mats = campMaterials();
  const tentList = [];
  places.forEach((p, i) => {
    if (!p.tents) return;
    const b = new PropBatch();
    const rand = rng(9173 + i * 7919);
    const [cx, cz] = hm.gridToWorld(p.r, p.c);
    const sleeping = [];
    if (p.tents > 10) buildBaseCamp(b, hm, cx, cz, p.tents, rand, sleeping);
    else buildHighCamp(b, hm, ropes, cx, cz, p.tents, rand, sleeping);
    for (const [x, z] of sleeping) tentList.push({ camp: p.name, x, z });
    const camp = b.build(mats);
    camp.name = p.name;
    group.add(camp);
  });
  group.userData.tents = tentList;
  group.userData.update = (t) => mats.update(t);
  return group;
}

/**
 * Sets a tent (or anything with a footprint) on a level platform at world (x, z),
 * facing yaw. Returns the placement matrix on top of the platform.
 * cut: dig the back of the ledge into a slope instead of building it all up.
 * Footprint is x0..x1 (width), z0..z1 (depth) in local metres.
 */
function levelSite(b, hm, x, z, yaw, [x0, x1, z0, z1], kind, rand, cut = false) {
  const base0 = place(x, 0, z, yaw);
  const local = new THREE.Vector3();
  const ground = (lx, lz) => {
    local.set(lx, 0, lz).applyMatrix4(base0);
    return hm.heightAt(local.x, local.z);
  };
  // On flat ground the platform clears every corner. On a slope the back of the
  // ledge is cut into the hill (the terrain itself is the back wall) and only the
  // front is built up, the way real ledges are dug.
  const cutZ = cut ? Math.max(z0, -0.25) : z0;
  let top = -Infinity;
  for (const [lx, lz] of [[x0, cutZ], [0, cutZ], [x1, cutZ], [x0, z1], [x1, z1], [0, 0]]) top = Math.max(top, ground(lx, lz));
  top += 0.06;
  P.platform(b, base0, x0, x1, z0, z1, top, ground, kind, rand);
  return place(x, top, z, yaw);
}

/** Matrix for a small prop standing on the terrain at world (x, z). */
const onGround = (hm, x, z, yaw = 0) => place(x, hm.heightAt(x, z), z, yaw);

function buildBaseCamp(b, hm, cx, cz, tents, rand, sleeping) {
  // Puja altar near the middle of camp, with flag strings fanning out from its pole.
  const ax = cx + 9, az = cz - 7;
  const top = P.chorten(b, onGround(hm, ax, az, 0.3), rand);
  const lines = 8;
  for (let k = 0; k < lines; k++) {
    const a = (k / lines) * Math.PI * 2 + 0.2;
    const r = 15 + rand() * 6;
    const ex = ax + Math.cos(a) * r, ez = az + Math.sin(a) * r;
    const gy = hm.heightAt(ex, ez);
    P.prayerFlags(b, top, new THREE.Vector3(ex, gy + 0.4, ez), 1.2 + rand() * 0.6);
    for (let s = 0; s < 4; s++) P.stone(b, place(ex, gy, ez, 0), (rand() - 0.5) * 0.6, 0.15, (rand() - 0.5) * 0.6, 0.25, rand);
  }

  // Expedition compounds round the altar.
  const perCompound = 5;
  const compounds = Math.ceil(tents / perCompound);
  let placed = 0;
  for (let k = 0; k < compounds; k++) {
    let kx, kz, tries = 0;
    do {
      const a = k * 2.399 + 0.6 + tries * 0.37;
      const r = 30 + Math.sqrt(k) * 22 + tries * 4;
      kx = cx + Math.cos(a) * r;
      kz = cz + Math.sin(a) * r;
    } while (hm.slopeDeg(kx, kz) > 12 && ++tries < 12);
    const yaw = rand() * Math.PI * 2;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const off = (s, f) => [kx + side.x * s + fwd.x * f, kz + side.z * s + fwd.z * f];

    // Mess tent at the heart of the compound, kitchen beside it.
    const [wall, roof] = pick(rand, [[0xf2c214, 0x1f5fbf], [0xe9e4d8, 0x2e8b3e], [0x2e63b8, 0xf2c214], [0xe8571c, 0xe9e4d8]]);
    const mess = levelSite(b, hm, kx, kz, yaw, [-3.5, 3.5, -2.5, 2.7], 'rock', rand);
    P.messTent(b, mess, wall, roof);
    const [kx2, kz2] = off(-7.5, -0.5);
    const kit = levelSite(b, hm, kx2, kz2, yaw, [-2.8, 2.8, -2.2, 2.4], 'rock', rand);
    P.kitchen(b, kit, pick(rand, [0x1f5fbf, 0x2e8b3e, 0xc0392b]), rand);
    for (let d = 0; d < 3 + Math.floor(rand() * 4); d++) {
      const [bx, bz] = off(-4.2 + (d % 3) * 0.65, -2.6 - Math.floor(d / 3) * 0.65);
      P.barrel(b, onGround(hm, bx, bz, rand() * 6), rand() < 0.8 ? 0x1f4fa8 : 0x2a2a2a);
    }
    const [sx, sz] = off(4.8, 2.5);
    P.solarPanel(b, onGround(hm, sx, sz, yaw + Math.PI));
    const [tx, tz] = off(9 + rand() * 3, -6);
    P.toiletTent(b, onGround(hm, tx, tz, yaw), pick(rand, [0x2e8b3e, 0x1f5fbf, 0xf2c214]));

    // Sleeping tents in an arc in front of the mess tent, doors facing in.
    const n = Math.min(perCompound, tents - placed);
    for (let t = 0; t < n; t++) {
      const a = -0.9 + (t / Math.max(n - 1, 1)) * 1.8 + (rand() - 0.5) * 0.15;
      const r = 11 + rand() * 3;
      const [x, z] = off(Math.sin(a) * r, Math.cos(a) * r);
      const tyaw = Math.atan2(kx - x, kz - z) + (rand() - 0.5) * 0.4;
      const site = levelSite(b, hm, x, z, tyaw, [-1.6, 1.6, -1.2, 1.9], 'rock', rand);
      P.domeTent(b, site, pick(rand, P.TENT_COLORS), rand);
      sleeping.push([x, z]);
      placed++;
    }
    // Duffels piled by the mess tent door, and a flag string across the compound.
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = off(2.2 + d * 0.5, 3.6 + (rand() - 0.5) * 0.4);
      P.duffel(b, onGround(hm, dx, dz, yaw + (rand() - 0.5) * 0.5), pick(rand, [0xf2b705, 0xd62b1f, 0x1d2a44, 0x2a2a2a, 0x2e63b8]));
    }
    const [p1x, p1z] = off(-5, 7);
    const [p2x, p2z] = off(6, 9);
    const pole = (x, z) => {
      const g = hm.heightAt(x, z);
      b.add(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6), 'soft', 0x8a6a45, place(x, g + 1.6, z, 0));
      return new THREE.Vector3(x, g + 3.1, z);
    };
    P.prayerFlags(b, pole(p1x, p1z), pole(p2x, p2z), 0.7);

    // A flag pole by the mess tent, strung down to a cairn of stones, and the
    // expedition's cache of drums under a tarp behind the kitchen.
    const [fx, fz] = off(-3.8, 4.2);
    const ftop = P.flagPole(b, onGround(hm, fx, fz, rand() * 6), rand, 4.5 + rand() * 1.5);
    const [ex, ez] = off(-11 + rand() * 3, 9 + rand() * 3);
    const eg = hm.heightAt(ex, ez);
    P.prayerFlags(b, ftop, new THREE.Vector3(ex, eg + 0.4, ez), 1.0);
    for (let s = 0; s < 3; s++) P.stone(b, place(ex, eg, ez, 0), (rand() - 0.5) * 0.5, 0.15, (rand() - 0.5) * 0.5, 0.25, rand);
    if (rand() < 0.75) {
      const [gx, gz] = off(-8 + (rand() - 0.5) * 2, -5.5);
      P.gearCache(b, onGround(hm, gx, gz, yaw + (rand() - 0.5) * 0.6), rand);
    }
  }

  // Out past the compounds: what earlier seasons left behind. Empty tent
  // platforms, a few old tents slumped on theirs, the odd forgotten cache.
  for (let k = 0; k < 14; k++) {
    let x, z, tries = 0;
    do {
      const a = rand() * Math.PI * 2, r = 85 + rand() * 40;
      x = cx + Math.cos(a) * r;
      z = cz + Math.sin(a) * r;
    } while (hm.slopeDeg(x, z) > 10 && ++tries < 10);
    if (tries >= 10) continue;
    const yaw = rand() * Math.PI * 2;
    if (k % 5 === 4) {
      P.gearCache(b, onGround(hm, x, z, yaw), rand);
      continue;
    }
    const site = levelSite(b, hm, x, z, yaw, [-1.5, 1.5, -1.1, 1.7], 'rock', rand);
    if (k % 2 === 0) P.oldTent(b, site, pick(rand, P.TENT_COLORS), rand);
  }

  // A memorial cairn on a rise at the edge of camp, flags strung out from it.
  {
    let mx, mz, tries = 0;
    do {
      const a = 2.4 + tries * 0.5;
      mx = cx + Math.cos(a) * (115 + tries * 3);
      mz = cz + Math.sin(a) * (115 + tries * 3);
    } while (hm.slopeDeg(mx, mz) > 14 && ++tries < 12);
    const base = onGround(hm, mx, mz, rand() * 6);
    P.cairn(b, base, rand);
    const top = new THREE.Vector3(mx, hm.heightAt(mx, mz) + 2.3, mz);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + rand() * 0.6, r = 8 + rand() * 4;
      const x = mx + Math.cos(a) * r, z = mz + Math.sin(a) * r, g = hm.heightAt(x, z);
      P.prayerFlags(b, top, new THREE.Vector3(x, g + 0.3, z), 0.8);
      for (let s = 0; s < 3; s++) P.stone(b, place(x, g, z, 0), (rand() - 0.5) * 0.5, 0.12, (rand() - 0.5) * 0.5, 0.22, rand);
    }
  }

  // Moraine boulders scattered round camp.
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2, r = 20 + rand() * 170;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const s = 0.3 + rand() ** 3 * 1.6;
    P.stone(b, onGround(hm, x, z), 0, s * 0.3, 0, s, rand);
  }
}

function buildHighCamp(b, hm, ropes, cx, cz, tents, rand, sleeping) {
  const y0 = hm.heightAt(cx, cz);
  const kind = y0 > 6900 || y0 < 5600 ? 'snow' : 'rock';
  // A ledge or two beyond the tents in use holds an old one from another season.
  const old = 1 + (rand() < 0.6 ? 1 : 0);
  const all = findLedges(hm, ropes, cx, cz, tents + old, 40);
  const sites = all.slice(0, tents);
  for (const [x, z] of all.slice(tents)) {
    const [gx, gz] = hm.gradient(x, z, 3);
    const yaw = Math.hypot(gx, gz) > 0.02 ? Math.atan2(-gx, -gz) : rand() * 6;
    const site = levelSite(b, hm, x, z, yaw, [-1.5, 1.5, -1.0, 1.25], kind, rand, true);
    P.oldTent(b, site, pick(rand, [0xf2b705, 0xe8571c, 0xd62b1f, 0x2e63b8]), rand, { buried: kind === 'snow' });
  }
  // A cache left for the push higher: oxygen and sacks up high, drums lower down.
  {
    const [x, z] = sites.length > 1 ? sites[1] : [cx, cz];
    const [gx, gz] = hm.gradient(x, z, 3);
    const yaw = Math.hypot(gx, gz) > 0.02 ? Math.atan2(-gx, -gz) : 0;
    const fwd = [Math.sin(yaw), Math.cos(yaw)];
    const qx = x - fwd[1] * 2.6, qz = z + fwd[0] * 2.6;
    P.gearCache(b, onGround(hm, qx, qz, yaw), rand, y0 > 6000);
  }
  for (const [x, z] of sites) {
    // Long side along the contour, door facing downhill.
    const [gx, gz] = hm.gradient(x, z, 3);
    const yaw = Math.hypot(gx, gz) > 0.02 ? Math.atan2(-gx, -gz) : rand() * 6;
    const site = levelSite(b, hm, x, z, yaw, [-1.5, 1.5, -1.0, 1.25], kind, rand, true);
    // Expedition tents high on the mountain are small and mostly yellow or orange.
    P.domeTent(b, site, pick(rand, [0xf2b705, 0xf5c518, 0xe8571c, 0xd62b1f, 0xf2b705]), rand, { len: 2.1, wid: 1.35, h: 1.0 });
    sleeping.push([x, z]);
    // Gear on the porch.
    const m = site.clone();
    if (rand() < 0.7) P.oxygen(b, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.8, 0, 1.3)));
    if (y0 > 7000 && rand() < 0.6) P.oxygen(b, m.clone().multiply(new THREE.Matrix4().makeTranslation(0.75, 0, 1.05).multiply(new THREE.Matrix4().makeRotationY(0.3))));
    if (rand() < 0.5) P.rucksack(b, m.clone().multiply(new THREE.Matrix4().makeTranslation(-1.0, 0, 1.25).multiply(new THREE.Matrix4().makeRotationY(rand()))), pick(rand, [0x1d2a44, 0xc62828, 0x2e8b3e, 0x333333]));
    if (kind === 'snow' && rand() < 0.7) P.iceAxe(b, m.clone().multiply(new THREE.Matrix4().makeTranslation(1.3, 0, 0.9)));
  }

  // Tie-in line along the ledges, and marker wands or prayer flags.
  for (let i = 0; i < sites.length - 1; i++) {
    const [ax, az] = sites[i], [bx, bz] = sites[i + 1];
    if (Math.hypot(bx - ax, bz - az) > 14) continue;
    const a = new THREE.Vector3(ax, hm.heightAt(ax, az) + 0.4, az);
    const c = new THREE.Vector3(bx, hm.heightAt(bx, bz) + 0.4, bz);
    if (y0 < 6800 && i === 0) {
      a.y += 1.6; c.y += 1.6;
      P.prayerFlags(b, a, c, 0.5);
      for (const p of [a, c]) b.add(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), 'soft', 0x8a6a45, place(p.x, p.y - 1.1, p.z, 0));
    } else {
      b.sagLine(a, c, 0.25, 6);
    }
  }
  if (kind === 'snow') {
    for (let k = 0; k < 8; k++) {
      const a = rand() * Math.PI * 2, r = 8 + rand() * 25;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      P.wand(b, onGround(hm, x, z, rand() * 6));
    }
  }
  if (y0 < 6000) {
    // Advanced Base Camp keeps a few supply drums.
    for (let d = 0; d < 4; d++) {
      const x = cx + 6 + d * 0.7, z = cz + 3 + (d % 2) * 0.7;
      P.barrel(b, onGround(hm, x, z));
    }
  }
}

/** The count flattest spots near (cx, cz), at least 4.5 m apart and off the fixed rope. */
function findLedges(hm, ropes, cx, cz, count, radius) {
  const probe = new THREE.Vector3();
  const cand = [];
  for (let dx = -radius; dx <= radius; dx += 2.5) {
    for (let dz = -radius; dz <= radius; dz += 2.5) {
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const x = cx + dx, z = cz + dz;
      if (ropes && ropes.nearest(probe.set(x, hm.heightAt(x, z), z)).distance < 4) continue;
      cand.push({ x, z, score: hm.slopeDeg(x, z) + d * 0.5 });
    }
  }
  // slopeDeg samples 12 m either side; refine with the local triangle slope.
  for (const c of cand) {
    const [gx, gz] = hm.gradient(c.x, c.z, 3);
    c.score += (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }
  cand.sort((a, b) => a.score - b.score);
  const out = [];
  for (const c of cand) {
    if (out.every(([x, z]) => Math.hypot(x - c.x, z - c.z) >= 4.5)) out.push([c.x, c.z]);
    if (out.length === count) break;
  }
  return out;
}
