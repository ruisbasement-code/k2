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

  /** Height of the rendered triangle surface at world (x, z). */
  heightAt(x, z) {
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

  /** Unit surface normal at world (x, z). */
  normalAt(x, z, out) {
    const [gx, gz] = this.gradient(x, z, 3);
    return out.set(-gx, 1, -gz).normalize();
  }

  /** How much (0 to 1) the ground at (x, z) is glacier: low, wide and flat. Matches the terrain shading. */
  glacierAt(x, z) {
    const y = this.heightAt(x, z);
    const [gx, gz] = this.gradient(x, z, 3 * this.cell);
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
