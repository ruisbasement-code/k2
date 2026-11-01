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
 * the camps to level.
 */
export function buildFineTerrain(hm, places = []) {
  const R = FINE_REGION;
  const step = hm.cell / R.sub;
  const n = (R.c1 - R.c0) * R.sub + 1;
  const [x0, z0] = hm.gridToWorld(R.r0, R.c0);
  const camps = places.filter((p) => p.tents > 0).map((p) => {
    const [x, z] = hm.gridToWorld(p.r, p.c);
    const base = p.tents > 10;
    return { x, z, y: hm.baseHeightAt(x, z), flat: base ? 80 : 20, fade: base ? 60 : 35, base };
  });
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
      h[j * n + i] = y + (keep > 0 ? keep * relief(hm, x, z, y, camps) : 0);
    }
  }
  hm.fine = { x0, z0, step, n, h };
  return hm.fine;
}

/** Mid-scale relief at (x, z), metres above or below the 31 m surface. */
function relief(hm, x, z, y, camps) {
  const [gx, gz] = hm.baseGradient(x, z, 40);
  const g = Math.hypot(gx, gz);
  const slope = (Math.atan(g) * 180) / Math.PI;
  const glacier = hm.baseGlacierAt(x, z);
  const fx = g > 1e-4 ? gx / g : 1, fz = g > 1e-4 ? gz / g : 0;
  let off = 0;

  // Benches: step the face into shelves and rock bands. Height bands are warped so
  // the steps wander rather than following the contours exactly.
  const face = smooth(16, 26, slope) * smooth(60, 50, slope) * (1 - glacier);
  if (face > 0.01) {
    // Benches come and go: strong in some parts of a face, absent in others.
    const where = smooth(0.42, 0.72, fbm(x * 0.0022 + 3.1, z * 0.0022, 3, 107));
    if (where > 0) {
      const H = 16 + 34 * vnoise(x * 0.003, z * 0.003, 101);
      const u = (y + (fbm(x * 0.006, z * 0.006, 3, 103) - 0.5) * 110) / H;
      const t = u - Math.floor(u);
      // Gentle for the lower part of each band, a steep step for the rest.
      const step = smooth(0.55, 1, t);
      off += (step - t + 0.275) * H * face * where * 0.8;
    }
  }

  // Ribs and gullies down the fall line: noise smeared along the fall line.
  const steep = smooth(20, 35, slope) * (1 - glacier);
  if (steep > 0.01) {
    let rib = 0;
    for (let k = -3; k <= 3; k++) {
      const px = x + fx * k * 22, pz = z + fz * k * 22;
      // No finer than about 22 m: the grid is 7.8 m, and sharper creases alias into
      // zigzag stair-steps.
      rib += ridged(px * 0.028, pz * 0.028, 111) + 0.5 * ridged(px * 0.045, pz * 0.045, 113);
    }
    rib = rib / 7 / 1.5 - 0.45;
    off += steep * rib * (9 + 8 * smooth(40, 60, slope));
  }

  // Rock buttresses and outcrops.
  if (slope > 18 && glacier < 0.5) {
    const c = cellular(x, z, 42, 121);
    if (hash(c.i, c.j, 122) < 0.5) {
      const r = 9 + 15 * hash(c.i, c.j, 123);
      const top = 4 + 9 * hash(c.i, c.j, 124);
      const knob = smooth(r, r * 0.45, c.d1 * (0.85 + 0.3 * vnoise(x * 0.15, z * 0.15, 125)));
      off += knob * top * smooth(18, 28, slope) * (1 - glacier);
    }
  }

  // Glaciers: hummocky ice, moraine ridges, and broken blocks where the ice steepens.
  if (glacier > 0.01) {
    const [wx, wz] = hm.baseGradient(x, z, 3 * hm.cell);
    const wide = (Math.atan(Math.hypot(wx, wz)) * 180) / Math.PI;
    const hummock = (fbm(x * 0.025, z * 0.025, 3, 131) - 0.5) * 9 + (ridged(x * 0.045, z * 0.045, 133) - 0.6) * 4;
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
