import { readFileSync } from 'node:fs';
import { Heightmap } from '../src/world/heightmap.js';

/** Loads the heightmap from public/data, the same files the game fetches. */
export function loadHeightmap() {
  const meta = JSON.parse(readFileSync(new URL('../public/data/k2_heightmap_meta.json', import.meta.url)));
  const bytes = readFileSync(new URL('../public/data/k2_heightmap.f32', import.meta.url));
  return new Heightmap(meta, new Float32Array(Uint8Array.from(bytes).buffer));
}
