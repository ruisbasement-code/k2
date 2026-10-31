import { readFileSync } from 'node:fs';
import { Heightmap } from '../src/world/heightmap.js';
import { TerrainDetail, campFlats } from '../src/world/terrainDetail.js';
import route from '../src/data/route.json';

/**
 * Loads the heightmap from public/data, the same files the game fetches, with the
 * same small-scale relief the game stands you on (pass false for the bare grid).
 */
export function loadHeightmap(detail = true) {
  const meta = JSON.parse(readFileSync(new URL('../public/data/k2_heightmap_meta.json', import.meta.url)));
  const bytes = readFileSync(new URL('../public/data/k2_heightmap.f32', import.meta.url));
  const hm = new Heightmap(meta, new Float32Array(Uint8Array.from(bytes).buffer));
  if (detail) hm.detail = new TerrainDetail(hm, campFlats(hm, route.places));
  return hm;
}
