// Camp props built from three.js primitives: dome tents, mess and kitchen tents,
// stone platforms, prayer flags, barrels, duffels, oxygen bottles and so on.
// Each function adds its pieces to a PropBatch at a world placement matrix whose
// local frame has y up and the "front" (doors) facing +z.

import * as THREE from 'three';

const M = () => new THREE.Matrix4();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** base × translate(x, y, z) × rotY(ry) × scale(sx, sy, sz) */
const at = (base, x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) =>
  M().copy(base).multiply(M().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), V(sx, sy, sz)));

/** Geometry from a flat list of triangles [[x,y,z], ...]. */
function tris(points) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  return g;
}

const GEO = {
  dome: new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 6),
  rock: new THREE.IcosahedronGeometry(1, 0),
  rock1: new THREE.DodecahedronGeometry(1, 0),
  capsule: new THREE.CapsuleGeometry(1, 1.4, 3, 8),
};

export const TENT_COLORS = [0xf2b705, 0xe8571c, 0xd62b1f, 0xf5c518, 0x2f7d4a, 0x2e63b8, 0xe9e4d8];
export const FLAG_COLORS = [0x1f5fbf, 0xf3f3ee, 0xd8261c, 0x2e8b3e, 0xf2c214]; // sky, air, fire, water, earth
const STONE_COLORS = [0x77706a, 0x8a8078, 0x6a645f, 0x9a9087, 0x5d5853];
const SNOW_COLORS = [0xeef2f7, 0xe2e9f1, 0xf6f8fb, 0xd9e2ec];

export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

/** One rough stone of radius r. */
export function stone(b, base, x, y, z, r, rand, color, key = 'stone') {
  const m = M().copy(base).multiply(M().compose(
    V(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)),
    V(r * (0.8 + rand() * 0.5), r * (0.5 + rand() * 0.3), r * (0.8 + rand() * 0.5)),
  ));
  b.add(rand() < 0.5 ? GEO.rock : GEO.rock1, key, color ?? pick(rand, STONE_COLORS), m, true);
}

/**
 * A two-pole dome tent with a front vestibule, poles and guy lines.
 * Footprint about len × wid metres, front door on +z.
 */
export function domeTent(b, base, color, rand, { len = 2.2, wid = 1.45, h = 1.1 } = {}) {
  const a = len / 2, c = wid / 2;
  b.add(GEO.dome, 'fabric', color, at(base, 0, 0, 0, Math.PI / 8, a, h, c), true);
  // Darker groundsheet "bathtub" round the bottom edge.
  b.add(GEO.cyl6, 'fabric', 0x2a2d33, at(base, 0, 0.05, 0, 0, a * 1.01, 0.1, c * 1.01), true);
  // Vestibule: a sloping porch over the door.
  const ay = h * 0.78, az = c * 0.62, fz = c + 0.75, bx = a * 0.55;
  const vest = tris([
    [0, ay, az], [-bx, 0, c * 0.85], [0, 0, fz],
    [0, ay, az], [0, 0, fz], [bx, 0, c * 0.85],
  ]);
  b.add(vest, 'fabric', color, M().copy(base), true);
  // Zip and door panel, slightly darker, on the vestibule's left half.
  const door = tris([[0, ay - 0.06, az + 0.03], [-bx * 0.55, 0.02, c * 0.85 + 0.12], [0, 0.02, fz - 0.02]]);
  b.add(door, 'fabric', new THREE.Color(color).multiplyScalar(0.6).getHex(), at(base, -0.01, 0, 0.01), true);
  // Two crossing poles over the fly, corner to corner.
  for (const s of [-1, 1]) {
    const phi = Math.atan2(c * s, a);
    const r = 1 / Math.sqrt(Math.cos(phi) ** 2 / (a * a) + Math.sin(phi) ** 2 / (c * c));
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * Math.PI;
      pts.push(V(Math.cos(t) * r * Math.cos(phi) * 1.03, Math.sin(t) * h * 1.03, Math.cos(t) * r * Math.sin(phi) * 1.03));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.014, 4);
    b.add(tube, 'metal', 0x30343a, M().copy(base));
  }
  // Guy lines from the fly out to stakes.
  for (const [lx, lz, sx, sz] of [[a * 0.7, -c * 0.5, a + 0.7, -c - 0.6], [-a * 0.7, -c * 0.5, -a - 0.7, -c - 0.6], [a * 0.75, 0, a + 0.9, 0.3], [-a * 0.75, 0, -a - 0.9, 0.3]]) {
    const from = V(lx, h * 0.55, lz).applyMatrix4(base);
    const to = V(sx, 0.02, sz).applyMatrix4(base);
    b.line(from, to);
    b.add(GEO.cyl6, 'metal', 0xb8bcc2, at(base, sx, 0.05, sz, 0, 0.012, 0.15, 0.012));
  }
  // Something left outside the door now and then: boots or a pack.
  if (rand() < 0.5) duffel(b, at(base, bx * 0.6 + 0.3, 0, c + 0.45, rand()), pick(rand, [0x1d2a44, 0xc62828, 0x333333, 0xe6a700]), 0.6);
}

/** Big frame tent with walls and a pitched roof (Base Camp dining tent). */
export function messTent(b, base, wallColor, roofColor, { len = 6, wid = 4, wallH = 1.9, ridge = 2.9 } = {}) {
  const a = len / 2, c = wid / 2;
  b.add(GEO.box, 'fabric', wallColor, at(base, 0, wallH / 2, 0, 0, len, wallH, wid));
  const o = 0.2; // eave overhang
  const roof = tris([
    // two roof planes
    [-a - o, wallH - 0.08, c + o], [a + o, wallH - 0.08, c + o], [a + o, ridge, 0],
    [-a - o, wallH - 0.08, c + o], [a + o, ridge, 0], [-a - o, ridge, 0],
    [a + o, wallH - 0.08, -c - o], [-a - o, wallH - 0.08, -c - o], [-a - o, ridge, 0],
    [a + o, wallH - 0.08, -c - o], [-a - o, ridge, 0], [a + o, ridge, 0],
  ]);
  b.add(roof, 'fabric', roofColor, M().copy(base), true);
  // Gable ends in wall colour.
  const gable = tris([
    [-a, wallH, c], [-a, ridge - 0.02, 0], [-a, wallH, -c],
    [a, wallH, -c], [a, ridge - 0.02, 0], [a, wallH, c],
  ]);
  b.add(gable, 'fabric', wallColor, M().copy(base), true);
  // Door flap, rolled-up window strips and a valance trim.
  b.add(GEO.box, 'fabric', 0x24262b, at(base, -a * 0.45, 0.85, c + 0.01, 0, 0.9, 1.7, 0.02));
  b.add(GEO.cyl, 'fabric', wallColor, M().copy(base).multiply(M().makeTranslation(-a * 0.45, 1.72, c + 0.06)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.07, 0.95, 0.07)));
  for (const s of [-1, 1]) {
    b.add(GEO.box, 'fabric', 0x9fb6c8, at(base, a * 0.35, 1.35, s * (c + 0.01), 0, 1.6, 0.45, 0.02));
    b.add(GEO.box, 'fabric', roofColor, at(base, 0, wallH - 0.05, s * (c + 0.02), 0, len, 0.12, 0.02));
  }
  // Guy lines from the eaves.
  for (const sx of [-1, 0, 1]) {
    for (const sz of [-1, 1]) {
      const from = V(sx * a, wallH, sz * (c + o)).applyMatrix4(base);
      const to = V(sx * (a + 0.6), 0, sz * (c + 1.6)).applyMatrix4(base);
      b.line(from, to);
    }
  }
}

/** Stone-walled kitchen shelter with a tarp roof. */
export function kitchen(b, base, tarpColor, rand) {
  const len = 4.4, wid = 3.2;
  // Dry-stone walls on three sides, the front (+z) left open.
  const wall = (x0, z0, x1, z1) => {
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.5);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i <= n; i++) {
        const t = (i + (row % 2) * 0.5) / n;
        if (t > 1) continue;
        stone(b, base, x0 + (x1 - x0) * t, 0.15 + row * 0.3, z0 + (z1 - z0) * t, 0.3, rand);
      }
    }
  };
  wall(-len / 2, wid / 2, -len / 2, -wid / 2);
  wall(-len / 2, -wid / 2, len / 2, -wid / 2);
  wall(len / 2, -wid / 2, len / 2, wid / 2);
  // Tarp sloping from the back wall to two poles at the front.
  const tarp = tris([
    [-len / 2 - 0.3, 1.0, -wid / 2 - 0.2], [-len / 2 - 0.3, 2.2, wid / 2 + 0.4], [len / 2 + 0.3, 2.2, wid / 2 + 0.4],
    [-len / 2 - 0.3, 1.0, -wid / 2 - 0.2], [len / 2 + 0.3, 2.2, wid / 2 + 0.4], [len / 2 + 0.3, 1.0, -wid / 2 - 0.2],
  ]);
  b.add(tarp, 'fabric', tarpColor, M().copy(base), true);
  for (const s of [-1, 1]) b.add(GEO.cyl6, 'metal', 0x8b8f94, at(base, s * len / 2, 1.1, wid / 2 + 0.4, 0, 0.03, 2.2, 0.03));
  // Gas canisters and a stove table inside.
  b.add(GEO.box, 'metal', 0x9aa0a6, at(base, 0, 0.45, -wid / 2 + 0.6, 0, 1.6, 0.06, 0.6));
  for (let i = 0; i < 3; i++) b.add(GEO.cyl, 'plastic', 0xd9d4c4, at(base, -0.6 + i * 0.6, 0.2, -wid / 2 + 0.6, 0, 0.13, 0.4, 0.13));
}

/** Tall narrow toilet or shower tent. */
export function toiletTent(b, base, color) {
  b.add(GEO.box, 'fabric', color, at(base, 0, 0.95, 0, 0, 1.1, 1.9, 1.1));
  b.add(GEO.cone, 'fabric', color, at(base, 0, 2.05, 0, Math.PI / 4 + Math.PI / 6, 0.85, 0.3, 0.85), true);
  b.add(GEO.box, 'fabric', 0x24262b, at(base, 0, 0.85, 0.56, 0, 0.6, 1.5, 0.02));
}

/** Blue plastic storage drum. */
export function barrel(b, base, color = 0x1f4fa8) {
  b.add(GEO.cyl, 'plastic', color, at(base, 0, 0.42, 0, 0, 0.29, 0.84, 0.29));
  b.add(GEO.cyl, 'plastic', 0x1a1a1a, at(base, 0, 0.86, 0, 0, 0.3, 0.05, 0.3));
}

/** Expedition duffel bag lying on the ground. */
export function duffel(b, base, color, scale = 1) {
  b.add(GEO.capsule, 'soft', color, M().copy(base).multiply(M().makeTranslation(0, 0.22 * scale, 0)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.22 * scale, 0.4 * scale, 0.2 * scale)));
  b.add(GEO.box, 'soft', 0x111111, at(base, 0, 0.44 * scale, 0, 0, 0.5 * scale, 0.03, 0.06 * scale));
}

/** Oxygen cylinder lying on its side. */
export function oxygen(b, base) {
  b.add(GEO.cyl, 'metal', 0xe8661c, M().copy(base).multiply(M().makeTranslation(0, 0.1, 0)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.09, 0.6, 0.09)));
  b.add(GEO.cyl, 'metal', 0xc9ccd0, M().copy(base).multiply(M().makeTranslation(0.34, 0.1, 0)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.04, 0.1, 0.04)));
}

/** Ice axe planted head-up in the snow. */
export function iceAxe(b, base) {
  b.add(GEO.cyl6, 'metal', 0x2b5fa8, at(base, 0, 0.3, 0, 0, 0.016, 0.6, 0.016));
  b.add(GEO.box, 'metal', 0xb8bcc2, at(base, 0, 0.62, 0, 0, 0.3, 0.035, 0.025));
}

/** Packed rucksack standing up. */
export function rucksack(b, base, color) {
  b.add(GEO.box, 'soft', color, at(base, 0, 0.32, 0, 0, 0.36, 0.62, 0.26), true);
  b.add(GEO.box, 'soft', 0x1d1d1f, at(base, 0, 0.66, 0, 0, 0.38, 0.1, 0.28), true);
  b.add(GEO.cyl, 'soft', 0xe8c11c, M().copy(base).multiply(M().makeTranslation(0, 0.08, 0.1)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.08, 0.5, 0.08)));
}

/** Bamboo marker wand with a little red flag, used to mark the way on snow. */
export function wand(b, base) {
  b.add(GEO.cyl6, 'soft', 0xc8a96a, at(base, 0, 0.6, 0, 0, 0.012, 1.2, 0.012));
  const f = tris([[0, 1.18, 0], [0.22, 1.12, 0], [0, 1.04, 0]]);
  setFlutter(f, [0, 1, 0.3]);
  b.add(f, 'flag', 0xd8261c, M().copy(base), true);
}

/** Solar panel on a tilted frame. */
export function solarPanel(b, base) {
  const m = M().copy(base).multiply(M().makeTranslation(0, 0.55, 0)).multiply(M().makeRotationX(-0.75));
  b.add(GEO.box, 'metal', 0x1b2a4a, m.multiply(M().makeScale(1.6, 1.0, 0.04)));
  b.add(GEO.cyl6, 'metal', 0x8b8f94, at(base, -0.6, 0.3, -0.3, 0, 0.02, 0.6, 0.02));
  b.add(GEO.cyl6, 'metal', 0x8b8f94, at(base, 0.6, 0.3, -0.3, 0, 0.02, 0.6, 0.02));
}

function setFlutter(g, values) {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = values[i % values.length];
  g.setAttribute('flutter', new THREE.BufferAttribute(a, 1));
}

/**
 * A string of prayer flags between world points a and b, sagging in the middle.
 * Flags cycle blue, white, red, green, yellow.
 */
export function prayerFlags(b, a, z, sag = 0.6) {
  const len = a.distanceTo(z);
  const pts = b.sagLine(a, z, sag, Math.max(4, Math.ceil(len / 1.5)));
  const curve = new THREE.CatmullRomCurve3(pts);
  const count = Math.floor(len / 0.34);
  const dir = new THREE.Vector3();
  for (let i = 1; i < count; i++) {
    const p = curve.getPointAt(i / count);
    curve.getTangentAt(i / count, dir);
    const w = 0.24, h = 0.2;
    const q = p.clone().addScaledVector(dir, w);
    const pb = p.clone(); pb.y -= h;
    const qb = q.clone(); qb.y -= h;
    const g = tris([p.toArray(), pb.toArray(), qb.toArray(), p.toArray(), qb.toArray(), q.toArray()]);
    setFlutter(g, [0, 1, 1, 0, 1, 0]);
    b.add(g, 'flag', FLAG_COLORS[i % 5], M(), true);
  }
}

/**
 * Levelled tent platform: a flat top at height top, its walls running down to the
 * ground at each corner and flaring out like a stacked wall. The footprint is the
 * rectangle x0..x1, z0..z1 in the local frame of base (which sits at height 0).
 * ground(x, z) gives the local ground height under a local point.
 */
export function platform(b, base, x0, x1, z0, z1, top, ground, kind, rand) {
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const T = corners.map(([x, z]) => [x, top, z]);
  const B = corners.map(([x, z]) => {
    const g = ground(x, z) - 0.35;
    const flare = 0.08 * Math.max(top - g, 0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dx = Math.sign(x - cx), dz = Math.sign(z - cz);
    return [x + dx * flare, g, z + dz * flare];
  });
  const faces = [T[0], T[3], T[2], T[0], T[2], T[1]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push(T[i], T[j], B[j], T[i], B[j], B[i]);
  }
  const snow = kind === 'snow';
  b.add(tris(faces), snow ? 'snow' : 'stone', snow ? 0xe9eef5 : 0x7d756d, M().copy(base), true);
  // Stones (or cut snow blocks) on the face of the wall and round the rim, so it
  // reads as built.
  const block = (x, y, z, r) => (snow
    ? stone(b, base, x, y, z, r * 1.15, rand, pick(rand, SNOW_COLORS), 'snow')
    : stone(b, base, x, y, z, r, rand));
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const n = Math.round(Math.hypot(T[j][0] - T[i][0], T[j][2] - T[i][2]) / 0.45);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = T[i][0] + (T[j][0] - T[i][0]) * t, z = T[i][2] + (T[j][2] - T[i][2]) * t;
      block(x, top + 0.04, z, 0.17);
      const drop = top - ground(x, z);
      for (let y = top - 0.35; y > top - drop; y -= 0.4) {
        const f = (top - y) * 0.08;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        block(x + Math.sign(x - cx) * f * (i % 2), y, z + Math.sign(z - cz) * f * ((i + 1) % 2), 0.24);
      }
    }
  }
}

/** Puja altar: a stepped stone chorten with a tall flag pole. Returns the pole top. */
export function chorten(b, base, rand) {
  const steps = [[2.4, 0.55], [1.8, 0.5], [1.2, 0.55], [0.7, 0.45]];
  let y = 0;
  for (const [w, h] of steps) {
    b.add(GEO.box, 'stone', 0xb9b2a6, at(base, 0, y + h / 2, 0, 0, w, h, w), true);
    // Rough stones round each step's edge.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      stone(b, base, Math.cos(a) * w * 0.55, y + 0.15, Math.sin(a) * w * 0.55, 0.18, rand);
    }
    y += h;
  }
  // Whitewashed top and a juniper-burning niche.
  b.add(GEO.cone, 'stone', 0xf0ece2, at(base, 0, y + 0.3, 0, 0, 0.42, 0.6, 0.42), true);
  b.add(GEO.box, 'stone', 0x2a2522, at(base, 0, 0.75, 1.21, 0, 0.5, 0.35, 0.02));
  // Flag pole.
  const poleH = 7;
  b.add(GEO.cyl6, 'soft', 0x8a6a45, at(base, 0, poleH / 2, 0, 0, 0.06, poleH, 0.06));
  b.add(GEO.cone, 'metal', 0xd4af37, at(base, 0, poleH + 0.15, 0, 0, 0.1, 0.3, 0.1));
  return V(0, poleH, 0).applyMatrix4(base);
}

/** A colour washed out by seasons of sun: greyed and paled toward bleached canvas. */
export function faded(color, amount = 0.55) {
  return new THREE.Color(color).lerp(new THREE.Color(0xbdb6aa), amount).getHex();
}

/**
 * An old tent left from an earlier season: the fly faded, sagging flat with one
 * side caved in, torn through in places with a few rags flapping, a snapped pole
 * sticking up. buried: half drifted over with snow (high camps).
 */
export function oldTent(b, base, color, rand, { len = 2.1, wid = 1.4, h = 1.0, buried = false } = {}) {
  const a = len / 2, c = wid / 2;
  const col = faded(color, 0.45 + rand() * 0.25);
  // The fly, slumped: low, lopsided, with a hollow where a pole has gone.
  const g = GEO.dome.toNonIndexed();
  const p = g.getAttribute('position');
  const lean = (rand() - 0.5) * 0.8, dip = rand() * 2;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const cave = Math.exp(-((x - Math.cos(dip) * 0.4) ** 2 + (z - Math.sin(dip) * 0.4) ** 2) * 3);
    const yy = y * (0.45 - 0.3 * cave) * (1 + lean * x * 0.4);
    p.setXYZ(i, x * a * (1 + 0.12 * (1 - y)), Math.max(yy, 0.02) * h, z * c * (1 + 0.12 * (1 - y)));
  }
  // Torn through in places: drop some of the fly's facets.
  const keep = [];
  for (let t = 0; t < p.count; t += 3) {
    if (p.getY(t) + p.getY(t + 1) + p.getY(t + 2) > 0.2 * h && rand() < 0.18) continue;
    for (let k = 0; k < 3; k++) keep.push(p.getX(t + k), p.getY(t + k), p.getZ(t + k));
  }
  b.add(tris(chunk(keep)), 'worn', col, at(base, 0, 0, 0, Math.PI / 8), true);
  b.add(GEO.cyl6, 'worn', 0x3a3a38, at(base, 0, 0.03, 0, 0, a * 1.02, 0.06, c * 1.02), true);
  // Rags of fly that still flap in the wind.
  for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
    const ang = rand() * Math.PI * 2;
    const x = Math.cos(ang) * a * 0.8, z = Math.sin(ang) * c * 0.8, y = 0.25 * h;
    const w = 0.25 + rand() * 0.3;
    const rag = tris([[x, y, z], [x + w, y - 0.05, z + w * 0.3], [x + w * 0.4, y - 0.25, z + w * 0.6]]);
    setFlutter(rag, [0, 1, 1]);
    b.add(rag, 'flag', col, M().copy(base), true);
  }
  // A snapped pole poking up at an angle.
  const pm = M().copy(base).multiply(M().makeTranslation(a * 0.3, 0.3 * h, -c * 0.2))
    .multiply(M().makeRotationZ(0.6 + rand() * 0.5)).multiply(M().makeRotationX(rand() - 0.5))
    .multiply(M().makeTranslation(0, 0.3, 0)).multiply(M().makeScale(0.014, 0.6, 0.014));
  b.add(GEO.cyl6, 'metal', 0x55585e, pm);
  if (buried) {
    // A drift banked up against the windward side and over the foot.
    for (let k = 0; k < 4; k++) {
      const x = -a * 0.9 + k * a * 0.55, z = -c * (0.6 + rand() * 0.3);
      stone(b, base, x, 0.05, z, 0.55 + rand() * 0.3, rand, pick(rand, SNOW_COLORS), 'snow');
    }
  } else {
    // Stones that held the guy lines, the lines long gone.
    for (let k = 0; k < 4; k++) stone(b, base, (k % 2 ? 1 : -1) * (a + 0.4), 0.05, (k < 2 ? 1 : -1) * (c + 0.3), 0.16, rand);
  }
}

function chunk(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/**
 * A gear cache: drums, duffels and a coiled rope under a tarp weighed down with
 * stones (Base Camp), or stuff sacks and oxygen bottles marked with a wand and
 * half snowed over (high camps).
 */
export function gearCache(b, base, rand, high = false) {
  if (!high) {
    const tarp = pick(rand, [0x2e63b8, 0x2e8b3e, 0x8a7a5a, 0x1f5fbf]);
    barrel(b, at(base, -0.35, 0, -0.2), 0x1f4fa8);
    barrel(b, at(base, 0.3, 0, -0.25), rand() < 0.5 ? 0x1f4fa8 : 0x2a2a2a);
    duffel(b, at(base, 0, 0, 0.45, 0.1), pick(rand, [0xf2b705, 0xd62b1f, 0x1d2a44]));
    duffel(b, at(base, 0.1, 0.42, 0.4, -0.2), pick(rand, [0x2a2a2a, 0x2e63b8, 0xe6a700]), 0.85);
    // The tarp thrown over the pile, sagging to the ground at its edges.
    const t = 1.05, d = 0.95, top = 0.95;
    const sheet = tris([
      [-t, 0.05, -d], [0, top, -0.1], [t, 0.05, -d],
      [t, 0.05, -d], [0, top, -0.1], [t, 0.1, d],
      [t, 0.1, d], [0, top, -0.1], [-t, 0.1, d],
      [-t, 0.1, d], [0, top, -0.1], [-t, 0.05, -d],
    ]);
    b.add(sheet, 'worn', faded(tarp, 0.25), M().copy(base), true);
    for (const [x, z] of [[-t, -d], [t, -d], [t, d], [-t, d], [0, d + 0.05], [0, -d - 0.05]]) stone(b, base, x, 0.12, z, 0.2, rand);
    // A coil of rope and a spare stove box beside it.
    const coil = new THREE.TorusGeometry(0.22, 0.05, 5, 12);
    b.add(coil, 'soft', pick(rand, [0xd62b1f, 0x2e63b8, 0xe6a700]), M().copy(base).multiply(M().makeTranslation(t + 0.45, 0.05, 0.2)).multiply(M().makeRotationX(Math.PI / 2)));
    b.add(GEO.box, 'plastic', 0x6b6b5e, at(base, -t - 0.4, 0.15, 0.3, 0.4, 0.45, 0.3, 0.35));
    return;
  }
  for (let k = 0; k < 3; k++) {
    const m = at(base, -0.2 + k * 0.18, 0, -0.1 + (k % 2) * 0.2, 0.2 * k);
    oxygen(b, m);
  }
  // Stuff sacks tied together, and a snow drift creeping over the pile.
  for (let k = 0; k < 2; k++) {
    b.add(GEO.capsule, 'soft', pick(rand, [0xd62b1f, 0x1d2a44, 0xe6a700, 0x2e8b3e]),
      M().copy(base).multiply(M().makeTranslation(0.45 - k * 0.4, 0.17, 0.35)).multiply(M().makeRotationZ(Math.PI / 2)).multiply(M().makeScale(0.15, 0.17, 0.15)));
  }
  for (let k = 0; k < 3; k++) stone(b, base, -0.5 + k * 0.45, 0.02, -0.4, 0.4 + rand() * 0.2, rand, pick(rand, SNOW_COLORS), 'snow');
  wand(b, at(base, 0.7, 0, -0.2));
}

/**
 * A tall prayer-flag pole (darchog) with a long banner down it. Returns the pole
 * top, for stringing flags from it.
 */
export function flagPole(b, base, rand, height = 5) {
  b.add(GEO.cyl6, 'soft', 0x8a6a45, at(base, 0, height / 2, 0, 0, 0.05, height, 0.05));
  for (let k = 0; k < 5; k++) stone(b, base, Math.cos(k * 1.3) * 0.35, 0.1, Math.sin(k * 1.3) * 0.35, 0.22, rand);
  // Banner: a column of flags down the pole, one colour above the next.
  for (let k = 0; k < 5; k++) {
    const y = height - 0.3 - k * 0.42;
    const f = tris([[0.05, y, 0], [0.05, y - 0.4, 0], [0.5, y - 0.4, 0], [0.05, y, 0], [0.5, y - 0.4, 0], [0.5, y, 0]]);
    setFlutter(f, [0, 0, 1, 0, 1, 1]);
    b.add(f, 'flag', FLAG_COLORS[k], M().copy(base), true);
  }
  return V(0, height, 0).applyMatrix4(base);
}

/** A memorial cairn: a rough stone pyramid a couple of metres high, a few plaques on its face. */
export function cairn(b, base, rand) {
  for (let row = 0; row < 6; row++) {
    const r = 1.3 - row * 0.2, n = Math.max(3, Math.round(r * 7));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + row * 0.5;
      stone(b, base, Math.cos(a) * r, 0.15 + row * 0.33, Math.sin(a) * r, 0.34 - row * 0.03, rand);
    }
  }
  stone(b, base, 0, 2.1, 0, 0.3, rand);
  for (let k = 0; k < 4; k++) {
    const a = 0.2 + k * 0.35;
    const r = 1.0 - (k % 2) * 0.25, y = 0.6 + (k % 2) * 0.5;
    b.add(GEO.box, 'metal', pick(rand, [0xb9a46a, 0x9da3a8, 0xc8b88a]), at(base, Math.sin(a) * r, y, Math.cos(a) * r, a, 0.3, 0.22, 0.02));
  }
}
