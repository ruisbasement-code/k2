// K2 elevation grid from the Copernicus GLO-30 DSM: 641 x 641 posts, 31.25 m apart,
// row 0 at the north edge. World space has x pointing east, z pointing south and
// y in metres above sea level, with the origin at the grid centre (the summit).

/** Smoothstep that also works with edges given high-to-low. */
export function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

export class Heightmap {
  constructor(meta, heights) {
    this.meta = meta;
    this.n = meta.N;
    this.cell = meta.cell;
    this.half = (this.n - 1) / 2;
    this.size = (this.n - 1) * this.cell;
    this.h = heights;
    if (heights.length !== this.n * this.n) throw new Error('heightmap size does not match its metadata');
  }

  /** Loads the heightmap served from public/data. */
  static async load(base = import.meta.env.BASE_URL) {
    const [meta, buf] = await Promise.all([
      fetch(`${base}data/k2_heightmap_meta.json`).then((r) => r.json()),
      fetch(`${base}data/k2_heightmap.f32`).then((r) => r.arrayBuffer()),
    ]);
    return new Heightmap(meta, new Float32Array(buf));
  }

  at(r, c) {
    const n = this.n;
    r = Math.min(Math.max(r, 0), n - 1);
    c = Math.min(Math.max(c, 0), n - 1);
    return this.h[r * n + c];
  }

  /** World [x, z] of a grid position. */
  gridToWorld(r, c) {
    return [(c - this.half) * this.cell, (r - this.half) * this.cell];
  }

  /**
   * Height of the rendered triangle surface at world (x, z): the fine terrain
   * (benches, ribs, outcrops, hummocks; see fineTerrain.js) where it is built,
   * else the 31 m data.
   */
  heightAt(x, z) {
    const f = this.fine;
    if (f) {
      const fc = (x - f.x0) / f.step, fr = (z - f.z0) / f.step;
      if (fc >= 0 && fr >= 0 && fc < f.n - 1 && fr < f.n - 1) {
        const c = Math.floor(fc), r = Math.floor(fr);
        const fx = fc - c, fz = fr - r;
        const i = r * f.n + c, h = f.h, n = f.n;
        const h00 = h[i], h01 = h[i + 1], h10 = h[i + n], h11 = h[i + n + 1];
        if (fx + fz < 1) return h00 + (h01 - h00) * fx + (h10 - h00) * fz;
        return h11 + (h10 - h11) * (1 - fx) + (h01 - h11) * (1 - fz);
      }
    }
    return this.baseHeightAt(x, z);
  }

  /** Height of the 31 m data alone, without the fine terrain. */
  baseHeightAt(x, z) {
    const n = this.n;
    const fc = Math.min(Math.max(x / this.cell + this.half, 0), n - 1.0001);
    const fr = Math.min(Math.max(z / this.cell + this.half, 0), n - 1.0001);
    const c = Math.floor(fc);
    const r = Math.floor(fr);
    const fx = fc - c;
    const fz = fr - r;
    const i = r * n + c;
    const h = this.h;
    const h00 = h[i], h01 = h[i + 1], h10 = h[i + n], h11 = h[i + n + 1];
    if (fx + fz < 1) return h00 + (h01 - h00) * fx + (h10 - h00) * fz;
    return h11 + (h10 - h11) * (1 - fx) + (h01 - h11) * (1 - fz);
  }

  /**
   * Surface gradient [dh/dx, dh/dz], sampled d metres either side so it does not
   * jump at every triangle edge.
   */
  gradient(x, z, d = 12) {
    return [
      (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d),
      (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d),
    ];
  }

  /** Gradient of the 31 m data alone. */
  baseGradient(x, z, d = 12) {
    return [
      (this.baseHeightAt(x + d, z) - this.baseHeightAt(x - d, z)) / (2 * d),
      (this.baseHeightAt(x, z + d) - this.baseHeightAt(x, z - d)) / (2 * d),
    ];
  }

  /**
   * The ground you actually stand on: the base surface plus the small-scale relief
   * (rocks, boulders, sastrugi) when a TerrainDetail is attached as `detail`.
   */
  groundAt(x, z) {
    return this.heightAt(x, z) + (this.detail ? this.detail.at(x, z) : 0);
  }

  /** Unit normal of the ground you stand on, at the scale of a boot (35 cm). */
  groundNormalAt(x, z, out) {
    if (!this.detail) return this.normalAt(x, z, out);
    const d = 0.35;
    const gx = (this.groundAt(x + d, z) - this.groundAt(x - d, z)) / (2 * d);
    const gz = (this.groundAt(x, z + d) - this.groundAt(x, z - d)) / (2 * d);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** Unit surface normal at world (x, z). */
  normalAt(x, z, out) {
    const [gx, gz] = this.gradient(x, z, 3);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** How much (0 to 1) the ground at (x, z) is glacier: low, wide and flat. Matches the terrain shading. */
  glacierAt(x, z) {
    return this.baseGlacierAt(x, z);
  }

  /** Glacier mask from the 31 m data (the fine terrain's hummocks don't change it). */
  baseGlacierAt(x, z) {
    const y = this.baseHeightAt(x, z);
    const [gx, gz] = this.baseGradient(x, z, 3 * this.cell);
    const wide = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    return smooth(5650, 5250, y) * smooth(17, 8, wide);
  }

  slopeDeg(x, z) {
    const [gx, gz] = this.gradient(x, z);
    return (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  clampInside(p, margin = 2) {
    const lim = this.size / 2 - margin;
    p.x = Math.min(Math.max(p.x, -lim), lim);
    p.z = Math.min(Math.max(p.z, -lim), lim);
    return p;
  }

  latitude(z) {
    return this.meta.lat0 - z / this.meta.mlat;
  }

  longitude(x) {
    return this.meta.lon0 + x / this.meta.mlon;
  }
}
