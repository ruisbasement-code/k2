// The mountain's mid-scale shape, on a grid four times finer than the 31 m
// elevation data, over the Abruzzi side of K2 from the summit down to Base Camp:
//
//  - benches: the faces are stepped into flatter shelves and steep rock bands,
//    as on the real spur, not one even slope;
//  - ribs and gullies running down the fall line;
//  - rock buttresses and outcrops standing out of the faces;
//  - on the glaciers, lumpy ice hummocks, moraine ridges and, where the ice
//    steepens at the foot of the mountain, a field of broken blocks;
//  - shoulders levelled where the camps sit.
//
// It is worked out once at start-up and baked into a height grid, which
// Heightmap.heightAt then reads, so every system (the climber, ropes, camps,
// crevasses, avalanches) and the drawn terrain agree on the same ground.

import { smooth } from './heightmap.js';
import { hash, vnoise, fbm, cellular, moraineAt } from './terrainDetail.js';

/** Grid rows and columns (of the 31 m data) the fine terrain covers, and how much finer it is. */
export const FINE_REGION = { r0: 296, r1: 504, c0: 296, c1: 504, sub: 4 };

const ridged = (x, z, seed) => 1 - Math.abs(2 * vnoise(x, z, seed) - 1);

/**
 * Builds the fine grid and attaches it to hm (hm.fine). places: route.places, for
 * the camps to level; lines: route.fixed_ropes, whose line keeps to the milder
 * ground climbers pick (no towers or deep-cut gullies across it).
 */
export function buildFineTerrain(hm, places = [], lines = []) {
  const R = FINE_REGION;
  const step = hm.cell / R.sub;
  const n = (R.c1 - R.c0) * R.sub + 1;
  const [x0, z0] = hm.gridToWorld(R.r0, R.c0);
  const camps = places.filter((p) => p.tents > 0).map((p) => {
    const [x, z] = hm.gridToWorld(p.r, p.c);
    const base = p.tents > 10;
    return { x, z, y: hm.baseHeightAt(x, z), flat: base ? 80 : 20, fade: base ? 60 : 35, base };
  });
  const segs = [];
  for (const l of lines) {
    for (let k = 0; k + 1 < l.points.length; k++) segs.push([...hm.gridToWorld(...l.points[k]), ...hm.gridToWorld(...l.points[k + 1])]);
  }
  const routeDist = (x, z) => {
    let best = 1e9;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az;
      const t = Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0), 1);
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };
  const h = new Float32Array(n * n);
  const edge = (R.c1 - R.c0) * hm.cell * 0.5;
  const cx = x0 + edge, cz = z0 + edge;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const y = hm.baseHeightAt(x, z);
      // Fade to nothing at the region's edge, to meet the coarse terrain there.
      const rim = Math.max(Math.abs(x - cx), Math.abs(z - cz));
      const keep = smooth(edge, edge - 250, rim);
      h[j * n + i] = y + (keep > 0 ? keep * relief(hm, x, z, y, camps, smooth(18, 60, routeDist(x, z))) : 0);
    }
  }
  hm.fine = { x0, z0, step, n, h };
  return hm.fine;
}

/**
 * Mid-scale relief at (x, z), metres above or below the 31 m surface. wild: 0 on
 * the fixed-rope line, 1 away from it, where the mountain is at its roughest.
 */
function relief(hm, x, z, y, camps, wild = 1) {
  const [gx, gz] = hm.baseGradient(x, z, 40);
  const g = Math.hypot(gx, gz);
  const slope = (Math.atan(g) * 180) / Math.PI;
  const glacier = hm.baseGlacierAt(x, z);
  const fx = g > 1e-4 ? gx / g : 1, fz = g > 1e-4 ? gz / g : 0;
  let off = 0;

  // Sharpen the mountain's own shape: the 31 m data rounds every ridge off and fills
  // every gully in, which is what makes the faces read as one smooth sheet. Push each
  // point away from the average of the ground around it, at two scales, so aretes
  // and spurs stand up sharp and couloirs cut in deep.
  const rock = 1 - glacier;
  if (rock > 0.01) {
    let sharp = 0;
    for (const [rad, k] of [[45, 0.9], [110, 0.55]]) {
      let ring = 0;
      for (let a = 0; a < 6; a++) {
        const t = (a / 6) * Math.PI * 2;
        ring += hm.baseHeightAt(x + Math.cos(t) * rad, z + Math.sin(t) * rad);
      }
      sharp += (y - ring / 6) * k;
    }
    // Softly limited, so a summit or a big cliff does not grow a spike.
    off += wild * rock * smooth(8, 22, slope) * 26 * Math.tanh(sharp / 26);
  }

  // Benches: step the face into shelves and rock bands. Height bands are warped so
  // the steps wander rather than following the contours exactly.
  const face = smooth(16, 26, slope) * smooth(60, 50, slope) * (1 - glacier);
  if (face > 0.01) {
    // Benches come and go: strong in some parts of a face, absent in others. Away
    // from the rope they are wider spread, with flatter ledges and steeper steps;
    // on the rope's line they stay as gentle as climbers find them there.
    const wb = fbm(x * 0.0022 + 3.1, z * 0.0022, 3, 107);
    const where = smooth(0.42 - 0.12 * wild, 0.72 - 0.12 * wild, wb);
    if (where > 0) {
      const v = vnoise(x * 0.003, z * 0.003, 101);
      const H = (16 + 34 * v) * (1 - wild) + (14 + 30 * v) * wild;
      const u = (y + (fbm(x * 0.006, z * 0.006, 3, 103) - 0.5) * 110) / H;
      const t = u - Math.floor(u);
      const gentle = (smooth(0.55, 1, t) - t + 0.275) * 0.8;
      // A ledge you can stand and rest on for most of each band (nearly level), then
      // a short, steep rock step up to the next.
      const sharpStep = (smooth(0.62, 0.97, t) - t + 0.31) * 0.92;
      off += (gentle * (1 - wild) + sharpStep * wild) * H * face * where;
    }
  }

  // Ribs and gullies down the fall line: noise smeared along the fall line.
  const steep = smooth(20, 35, slope) * (1 - glacier);
  if (steep > 0.01) {
    let rib = 0;
    for (let k = -3; k <= 3; k++) {
      const px = x + fx * k * 22, pz = z + fz * k * 22;
      rib += ridged(px * 0.028, pz * 0.028, 111) + 0.5 * ridged(px * 0.07, pz * 0.07, 113);
    }
    rib = rib / 7 / 1.5 - 0.45;
    off += steep * rib * (9 + 4 * wild + (8 + 2 * wild) * smooth(40, 60, slope));
  }

  // Rock buttresses and outcrops. Away from the rope most are blocky towers: steep
  // walls and a flattish top you can stand on; the rest are rounder knobs. On the
  // rope's line they stay the small knobs climbers pass.
  if (slope > 15 && glacier < 0.5) {
    const lean = smooth(15, 26, slope) * (1 - glacier);
    if (wild < 1) {
      const c = cellular(x, z, 42, 121);
      if (hash(c.i, c.j, 122) < 0.5) {
        const r = 9 + 15 * hash(c.i, c.j, 123);
        const top = 4 + 9 * hash(c.i, c.j, 124);
        const knob = smooth(r, r * 0.45, c.d1 * (0.85 + 0.3 * vnoise(x * 0.15, z * 0.15, 125)));
        off += (1 - wild) * knob * top * smooth(18, 28, slope) * (1 - glacier);
      }
    }
    if (wild > 0) {
      const c = cellular(x, z, 58, 127);
      if (hash(c.i, c.j, 122) < 0.55) {
        const r = 12 + 22 * hash(c.i, c.j, 123);
        const top = 7 + 16 * hash(c.i, c.j, 124);
        const d = c.d1 * (0.85 + 0.3 * vnoise(x * 0.12, z * 0.12, 125));
        const knob = hash(c.i, c.j, 126) < 0.7 ? smooth(r, r * 0.78, d) : smooth(r, r * 0.4, d);
        off += wild * knob * top * lean;
      }
    }
  }

  // Glaciers: hummocky ice, moraine ridges, and broken blocks where the ice steepens.
  if (glacier > 0.01) {
    const [wx, wz] = hm.baseGradient(x, z, 3 * hm.cell);
    const wide = (Math.atan(Math.hypot(wx, wz)) * 180) / Math.PI;
    const hummock = (fbm(x * 0.025, z * 0.025, 3, 131) - 0.5) * 9 + (ridged(x * 0.07, z * 0.07, 133) - 0.6) * 4;
    const blocks = cellular(x, z, 18, 135);
    const broken = (0.3 + 0.7 * smooth(4, 12, wide)) * (hash(blocks.i, blocks.j, 136) * 7 + 2) * smooth(0, 4, blocks.d2 - blocks.d1);
    const moraine = moraineAt(x, z);
    off += glacier * (hummock + broken + moraine * 3.5);
  }

  // Camps: high camps sit on a levelled shoulder; Base Camp's glacier is calmer.
  for (const c of camps) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > c.flat + c.fade) continue;
    const w = smooth(c.flat + c.fade, c.flat, d);
    off = c.base ? off * (1 - 0.7 * w) : off + (c.y - y - off) * w * 0.8;
  }
  return off;
}
