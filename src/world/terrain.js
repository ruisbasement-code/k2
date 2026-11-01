// Builds the K2 terrain mesh from the heightmap and its rock/snow/ice/glacier shading.
//
// Each vertex carries surface data for the shader in a `surf` attribute:
// x = slope (0 to 1 for 0 to 90 degrees), y = glacier mask,
// z = curvature (above 0.5 is a hollow where snow collects, below is a ridge),
// w = moraine (1 on the glaciers' rubble stripes, from terrainDetail.js).
//
// Around the climber a fine patch (createDetailPatch) draws the small-scale
// relief you actually stand on: rocks, boulders, rubble and sastrugi.
//
// The small ledges the fall physics uses (see ledgeAt in sim/hazards.js) are drawn
// here too, from the same hash, as snowy shelves with a rock step below them.
//
// Open crevasses and pits near the climber are cut out of the surface (see
// setHoles), so you can see down into them and fall in.

import * as THREE from 'three';
import { smooth } from './heightmap.js';
import { tuning } from '../sim/paceModel.js';
import { moraineAt } from './terrainDetail.js';

/**
 * The square the detail patch covers right now. The fine terrain under it is not
 * drawn: the patch replaces it, so the two never fight over the same pixels (the
 * logarithmic depth buffer ignores polygon offset, which shimmered in stripes).
 */
const PATCH_CUT = new THREE.Vector4(1e9, 1e9, -1e9, -1e9);

/** How many open holes the terrain shader can cut out at once. */
export const MAX_TERRAIN_HOLES = 32;

export function createTerrain(hm) {
  const { n, cell } = hm;
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const surf = new Float32Array(n * n * 4);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const y = hm.h[i];
      pos[i * 3] = (c - hm.half) * cell;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = (r - hm.half) * cell;
      const gx = (hm.at(r, c + 1) - hm.at(r, c - 1)) / (2 * cell);
      const gz = (hm.at(r + 1, c) - hm.at(r - 1, c)) / (2 * cell);
      const len = Math.hypot(gx, 1, gz);
      nrm[i * 3] = -gx / len;
      nrm[i * 3 + 1] = 1 / len;
      nrm[i * 3 + 2] = -gz / len;
      const slope = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      // Glaciers are wide, flat and low: judge flatness over ~190 m so the mask is not spotty.
      const wx = (hm.at(r, c + 3) - hm.at(r, c - 3)) / (6 * cell);
      const wz = (hm.at(r + 3, c) - hm.at(r - 3, c)) / (6 * cell);
      const wide = (Math.atan(Math.hypot(wx, wz)) * 180) / Math.PI;
      const glacier = smooth(5650, 5250, y) * smooth(17, 8, wide);
      const lap = (hm.at(r, c + 2) + hm.at(r, c - 2) + hm.at(r + 2, c) + hm.at(r - 2, c) - 4 * y) / (4 * cell * cell);
      surf[i * 4] = slope / 90;
      surf[i * 4 + 1] = glacier;
      surf[i * 4 + 2] = Math.min(Math.max(0.5 + lap * 25, 0), 1);
      surf[i * 4 + 3] = glacier > 0.01 ? moraineAt(pos[i * 3], pos[i * 3 + 2]) : 0;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const holes = {
    uHoleA: { value: Array.from({ length: MAX_TERRAIN_HOLES }, () => new THREE.Vector4()) },
    uHoleB: { value: Array.from({ length: MAX_TERRAIN_HOLES }, () => new THREE.Vector4()) },
    uHoleCount: { value: 0 },
    // A circle around all of them, so the rest of the mountain skips the test.
    uHoleBounds: { value: new THREE.Vector4(0, 0, -1, 0) },
  };
  // Where the fine terrain is built, it is drawn instead of this coarse surface.
  const f = hm.fine;
  const cut = f ? new THREE.Vector4(f.x0, f.z0, f.x0 + (f.n - 1) * f.step, f.z0 + (f.n - 1) * f.step) : null;
  const terrain = new THREE.Mesh(geo, terrainMaterial(false, holes, cut));
  terrain.receiveShadow = true;

  // Low ground beyond the edge of the data, so the horizon is not a void.
  const outerGeo = new THREE.RingGeometry(hm.size * 0.5, 100000, 64, 1);
  outerGeo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(outerGeo.attributes.position.count * 4).fill(0.5), 4));
  const outer = new THREE.Mesh(outerGeo, terrainMaterial(true));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = 4550;
  const group = new THREE.Group();
  group.add(terrain, outer);
  if (f) group.add(createFineTerrain(hm, holes));
  group.userData.holes = holes;
  /** Cut these open holes ({x, z, ux, uz, half, width, kind}) out of the surface, nearest first. */
  group.userData.setHoles = (list) => {
    const n = Math.min(list.length, MAX_TERRAIN_HOLES);
    for (let i = 0; i < n; i++) {
      const h = list[i];
      holes.uHoleA.value[i].set(h.x, h.z, h.ux, h.uz);
      // z: 2 + seed for a pit, seed for a crevasse (seed in [0, 1)).
      holes.uHoleB.value[i].set(h.half, h.width, (h.kind === 'pit' || h.kind === 'moulin' ? 2 : 0) + Math.min(h.seed ?? 0, 0.999), h.bend ?? 0);
    }
    holes.uHoleCount.value = n;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += list[i].x / n; cz += list[i].z / n; }
    let r = -1;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(list[i].x - cx, list[i].z - cz) + list[i].half + Math.abs(list[i].bend ?? 0) + list[i].width * 1.55 + 3);
    holes.uHoleBounds.value.set(cx, cz, r, 0);
  };
  return group;
}

/**
 * The fine terrain (hm.fine): 500 m chunks, each drawn at four levels of detail by
 * distance, with skirts hanging from their edges to hide cracks between levels.
 */
function createFineTerrain(hm, holes) {
  const f = hm.fine;
  const { n, step, h } = f;
  const CH = 64;
  const at = (i, j) => h[Math.min(Math.max(j, 0), n - 1) * n + Math.min(Math.max(i, 0), n - 1)];
  // Normals and ground type for every post, once.
  const nrm = new Float32Array(n * n * 3);
  const surf = new Float32Array(n * n * 4);
  const coarse = hm.cell;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = f.x0 + i * step, z = f.z0 + j * step;
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step);
      const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
      const len = Math.hypot(gx, 1, gz);
      nrm[k * 3] = -gx / len;
      nrm[k * 3 + 1] = 1 / len;
      nrm[k * 3 + 2] = -gz / len;
      const y = h[k];
      const lapBig = (at(i + 8, j) + at(i - 8, j) + at(i, j + 8) + at(i, j - 8) - 4 * y) / (4 * coarse * coarse);
      const lapSmall = (at(i + 2, j) + at(i - 2, j) + at(i, j + 2) + at(i, j - 2) - 4 * y) / (4 * coarse * coarse);
      const glacier = hm.glacierAt(x, z);
      surf[k * 4] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI / 90;
      surf[k * 4 + 1] = glacier;
      surf[k * 4 + 2] = Math.min(Math.max(0.5 + lapBig * 25 + lapSmall * 6, 0), 1);
      surf[k * 4 + 3] = glacier > 0.01 ? moraineAt(x, z) : 0;
    }
  }
  const mat = terrainMaterial(false, holes, PATCH_CUT, 'fine');
  const group = new THREE.Group();
  const chunks = (n - 1) / CH;
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      const lod = new THREE.LOD();
      const ox = f.x0 + (ci + 0.5) * CH * step, oz = f.z0 + (cj + 0.5) * CH * step;
      lod.position.set(ox, at(ci * CH + CH / 2, cj * CH + CH / 2), oz);
      [[1, 0], [2, 650], [4, 1600], [8, 3600]].forEach(([stride, dist]) => {
        const mesh = new THREE.Mesh(fineChunk(f, nrm, surf, ci * CH, cj * CH, CH, stride, lod.position), mat);
        mesh.receiveShadow = true;
        lod.addLevel(mesh, dist);
      });
      group.add(lod);
    }
  }
  return group;
}

function fineChunk(f, nrm, surf, i0, j0, size, stride, origin) {
  const m = size / stride + 1;
  const skirt = 4 * (m - 1);
  const count = m * m + skirt;
  const pos = new Float32Array(count * 3), nr = new Float32Array(count * 3), sf = new Float32Array(count * 4);
  const put = (v, i, j, drop) => {
    const k = j * f.n + i;
    pos[v * 3] = f.x0 + i * f.step - origin.x;
    pos[v * 3 + 1] = f.h[k] - drop - origin.y;
    pos[v * 3 + 2] = f.z0 + j * f.step - origin.z;
    for (let q = 0; q < 3; q++) nr[v * 3 + q] = nrm[k * 3 + q];
    for (let q = 0; q < 4; q++) sf[v * 4 + q] = surf[k * 4 + q];
  };
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) put(b * m + a, i0 + a * stride, j0 + b * stride, 0);
  // The border, walked round once, and a skirt hanging below it.
  const ring = [];
  for (let a = 0; a < m - 1; a++) ring.push([a, 0]);
  for (let b = 0; b < m - 1; b++) ring.push([m - 1, b]);
  for (let a = m - 1; a > 0; a--) ring.push([a, m - 1]);
  for (let b = m - 1; b > 0; b--) ring.push([0, b]);
  const drop = 3 + 4 * stride;
  ring.forEach(([a, b], r) => put(m * m + r, i0 + a * stride, j0 + b * stride, drop));
  const idx = [];
  for (let b = 0; b < m - 1; b++) {
    for (let a = 0; a < m - 1; a++) {
      const p = b * m + a, q = p + 1, d = p + m, e = d + 1;
      idx.push(p, d, q, q, d, e);
    }
  }
  for (let r = 0; r < ring.length; r++) {
    const [a0, b0] = ring[r], [a1, b1] = ring[(r + 1) % ring.length];
    const top0 = b0 * m + a0, top1 = b1 * m + a1, low0 = m * m + r, low1 = m * m + ((r + 1) % ring.length);
    idx.push(top0, low0, top1, top1, low0, low1, top0, top1, low0, top1, low1, low0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(sf, 4));
  geo.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The fine terrain right around the climber, built from the same relief the
 * physics stands you on (hm.detail). update(position) rebuilds it as you move.
 */
export function createDetailPatch(hm, holes = null) {
  const SEG = 200, STEP = 0.4;
  const half = (SEG * STEP) / 2;
  const n = SEG + 1;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * n * 3);
  const surf = new Float32Array(n * n * 4);
  const idx = new Uint32Array(SEG * SEG * 6);
  let k = 0;
  for (let r = 0; r < SEG; r++) {
    for (let c = 0; c < SEG; c++) {
      const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('surf', new THREE.BufferAttribute(surf, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // Cut by the same crevasse openings as the terrain under it.
  const mat = terrainMaterial(false, holes);
  // Drawn in front of the coarse terrain it sits on.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  const centre = new THREE.Vector2(1e9, 1e9);
  mesh.userData.update = (p, force = false) => {
    if (!hm.detail) return;
    if (!force && Math.max(Math.abs(p.x - centre.x), Math.abs(p.z - centre.y)) < 10) return;
    // Snap to the grid so the surface doesn't swim as the patch moves.
    const snap = STEP * 4;
    centre.set(Math.round(p.x / snap) * snap, Math.round(p.z / snap) * snap);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const x = centre.x - half + c * STEP;
        const z = centre.y - half + r * STEP;
        // Fade the relief out at the patch's edge to meet the coarse terrain.
        const edge = Math.max(Math.abs(x - centre.x), Math.abs(z - centre.y));
        const fade = smooth(half, half - 10, edge);
        const base = hm.heightAt(x, z);
        pos[i * 3] = x;
        pos[i * 3 + 1] = base + (fade > 0 ? hm.detail.at(x, z, true) * fade : 0.02);
        pos[i * 3 + 2] = z;
        if ((r & 3) === 0 && (c & 3) === 0) {
          const glacier = hm.glacierAt(x, z);
          surf[i * 4] = hm.slopeDeg(x, z) / 90;
          surf[i * 4 + 1] = glacier;
          surf[i * 4 + 2] = 0.5;
          surf[i * 4 + 3] = glacier > 0.01 ? moraineAt(x, z) : 0;
        } else {
          // Slowly varying: copy from the last sampled vertex.
          const src = (r & ~3) * n + (c & ~3);
          for (let q = 0; q < 4; q++) surf[i * 4 + q] = surf[src * 4 + q];
        }
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.surf.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    mesh.visible = true;
    // Hide the fine terrain under the patch, all but a thin rim where they meet.
    const inset = 1.5;
    PATCH_CUT.set(centre.x - half + inset, centre.y - half + inset, centre.x + half - inset, centre.y + half - inset);
  };
  return mesh;
}

function terrainMaterial(flatGround, holes = null, cut = null, name = '') {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  // Each variant needs its own shader program (three would otherwise share one).
  mat.customProgramCacheKey = () => `terrain-${flatGround}-${!!holes}-${!!cut}-${name}`;
  mat.onBeforeCompile = (sh) => {
    if (holes) Object.assign(sh.uniforms, holes);
    if (cut) sh.uniforms.uCut = { value: cut };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 surf;
varying vec3 vW;
varying vec3 vWN;
varying vec4 vSurf;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
vSurf = surf;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${flatGround ? '#define FLAT_GROUND' : ''}
${holes ? `#define TERRAIN_HOLES ${MAX_TERRAIN_HOLES}` : ''}
${cut ? '#define CUT_RECT\nuniform vec4 uCut;' : ''}
${LEDGE_DEFINES()}
${TERRAIN_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef TERRAIN_HOLES
if (inHole(vW.xz)) discard;
#endif
#ifdef CUT_RECT
if (vW.x > uCut.x && vW.z > uCut.y && vW.x < uCut.z && vW.z < uCut.w) discard;
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
TerrainSample ts = terrainSample(vW, normalize(vWN), vSurf, cameraPosition);
diffuseColor.rgb = ts.albedo;
#ifdef TERRAIN_HOLES
// Round a crevasse's lip: bluish, shadowed snow and old ice just before the drop.
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.74, 0.86), gHoleRim * gHoleRim);
#endif`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = ts.roughness;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = perturbNormal(-vViewPosition, normal, ts.bump);`);
  };
  return mat;
}

const f = (x) => Number(x).toFixed(4);
const LEDGE_DEFINES = () => `
#define LEDGE_CELL ${f(tuning.ledge_cell_m)}
#define LEDGE_SHARE ${f(tuning.ledge_share)}
#define LEDGE_RADIUS ${f(tuning.ledge_radius_m)}
#define LEDGE_MIN_DEG ${f(tuning.ledge_min_deg)}
#define LEDGE_MAX_DEG ${f(tuning.ledge_max_deg)}`;

// Rock, scree, glacier, snow and ice blended by slope, altitude and curvature, with
// procedural detail and bump so the ground reads at climbing scale.
const TERRAIN_GLSL = /* glsl */ `
varying vec3 vW;
varying vec3 vWN;
varying vec4 vSurf;

const float SNOWLINE = 5100.0;

// Sine-free hash, stable at large world coordinates.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}

// World metres covered by one pixel here, set at the start of terrainSample. Noise
// finer than a couple of pixels is faded to its average instead of drawn, or it
// aliases into a shimmering maze.
float gFoot = 0.01;

// fp: the pixel's footprint in p's units (0 = draw every octave).
float fbm(vec2 p, int octaves, float fp) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    float keep = 1.0 - smoothstep(0.25, 0.6, fp);
    v += a * mix(0.5, vnoise(p), keep);
    p = p * 2.03 + vec2(17.1, 9.3);
    fp *= 2.03;
    a *= 0.5;
  }
  return v;
}

float fbm(vec2 p, int octaves) { return fbm(p, octaves, 0.0); }

// Noise projected along the axis the surface faces most, so cliffs are not smeared.
float triFbm(vec3 p, vec3 n, float scale, int octaves) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  float fp = gFoot * scale;
  return fbm(p.zy * scale, octaves, fp) * w.x + fbm(p.xz * scale, octaves, fp) * w.y + fbm(p.xy * scale, octaves, fp) * w.z;
}

// Bump mapping from screen-space derivatives (Mikkelsen 2010).
vec3 perturbNormal(vec3 pos, vec3 n, float height) {
  vec3 dpdx = dFdx(pos);
  vec3 dpdy = dFdy(pos);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - grad);
}

// The same integer hash as hazards.js, so drawn ledges sit where the physics has them.
float cellHash(int i, int j) {
  uint h = uint(i) * 374761393u + uint(j) * 668265263u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return float(h ^ (h >> 16u)) / 4294967296.0;
}

// Distance from the ledge centre in radii (1 = its edge), and the centre; x > 1.5 if none.
vec3 ledgeNear(vec2 p) {
  int i = int(floor(p.x / LEDGE_CELL));
  int j = int(floor(p.y / LEDGE_CELL));
  if (cellHash(i + 7919, j - 104729) >= LEDGE_SHARE) return vec3(9.0, 0.0, 0.0);
  float room = LEDGE_CELL * 0.5 - LEDGE_RADIUS;
  vec2 c = vec2((float(i) + 0.5) * LEDGE_CELL + (cellHash(i, j + 31) - 0.5) * 2.0 * room,
                (float(j) + 0.5) * LEDGE_CELL + (cellHash(i + 17, j) - 0.5) * 2.0 * room);
  return vec3(length(p - c) / LEDGE_RADIUS, c);
}

// Cellular noise: x = distance to the nearest feature point, y = to the second.
vec2 cells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + vec2(hash12(i + o), hash12(i + o + 19.7)) - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return sqrt(vec2(d1, d2));
}

// Joints and cracks in rock: thin dark lines along the edges between blocks.
float cracks(vec3 p, vec3 n, float scale) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  vec2 a = cells(p.zy * scale), b = cells(p.xz * scale), c = cells(p.xy * scale);
  float e = (a.y - a.x) * w.x + (b.y - b.x) * w.y + (c.y - c.x) * w.z;
  // Lines thinner than a pixel are faded out rather than aliased.
  return (1.0 - smoothstep(0.0, 0.08, e)) * (1.0 - smoothstep(0.03, 0.08, gFoot * scale));
}

#ifdef TERRAIN_HOLES
uniform vec4 uHoleA[TERRAIN_HOLES];
uniform vec4 uHoleB[TERRAIN_HOLES];
uniform int uHoleCount;
uniform vec4 uHoleBounds;

// The ragged edge: same sums as TerrainFeatures.wobble.
float holeWobble(float u, float hl, bool pit, float seed, float side) {
  float ph = seed * 40.0 + (side < 0.0 ? 17.3 : 0.0);
  float q = pit ? u / hl * 6.0 : u * 0.45;
  return 1.0 + 0.28 * sin(q + ph) + 0.16 * sin(q * 2.5 + ph * 1.7) + 0.09 * sin(q * 6.0 + ph * 2.3);
}

// How far inside an open crevasse (a lens tapering to its ends) or pit (an oval)
// p is, in metres: > 0 inside, < 0 outside (only meaningful within a few metres).
float gHoleRim = 0.0;
float holeDepthIn(vec2 p) {
  float best = -99.0;
  if (distance(p, uHoleBounds.xy) > uHoleBounds.z) return best;
  for (int i = 0; i < TERRAIN_HOLES; i++) {
    if (i >= uHoleCount) break;
    vec4 a = uHoleA[i];
    vec4 b = uHoleB[i];
    vec2 d = p - a.xy;
    float reach = b.x + abs(b.w) + b.y * 1.55 + 3.0;
    if (dot(d, d) > reach * reach) continue;
    float u = dot(d, a.zw);
    if (abs(u) >= b.x) continue;
    float t = u / b.x;
    float v = dot(d, vec2(-a.w, a.z)) - b.w * (1.0 - t * t);
    bool pit = b.z >= 1.5;
    float w = pit ? b.y * sqrt(1.0 - t * t) : b.y * sqrt(1.0 - t * t * t * t);
    w *= holeWobble(u, b.x, pit, fract(b.z), v);
    best = max(best, w - abs(v));
  }
  return best;
}
bool inHole(vec2 p) {
  float k = holeDepthIn(p);
  // Within a metre or two of the edge, the snow is trampled, cracked and shadowed.
  gHoleRim = smoothstep(-2.5, 0.0, k);
  return k > 0.0;
}
#endif

struct TerrainSample { vec3 albedo; float roughness; float bump; };

TerrainSample terrainSample(vec3 p, vec3 n, vec4 surf, vec3 cam) {
  float dist = length(p - cam);
  // The footprint from distance and viewing angle, not fwidth(p): fwidth jumps from
  // one 2x2 pixel block to the next, and since every detail fade depends on it, the
  // bump's screen-space derivatives turned those jumps into speckle and stair-steps.
  // This one varies smoothly across the screen. 0.0018 rad is about one pixel.
  float facing = abs(dot(n, (cam - p) / max(dist, 1e-3)));
  gFoot = max(dist * 0.0018 / max(facing, 0.12), 1e-4);
  float h = p.y;
  // Ground type follows the slope of the terrain, not of every boulder up close.
  float slope = surf.x * 90.0;
  float glacier = surf.y;
  float hollow = surf.z - 0.5;

  // Detail fades out with distance so far slopes do not shimmer.
  float near = 1.0 - smoothstep(150.0, 1500.0, dist);
  float mid = 1.0 - smoothstep(1500.0, 9000.0, dist);
  float big = fbm(p.xz * 0.0035, 4);
  float medium = triFbm(p, n, 0.045, 4);
  float grain = 1.0 - smoothstep(15.0, 60.0, dist);
  float fine = near > 0.0 ? triFbm(p, n, 0.7, 3) * (1.0 - 0.3 * grain) + (grain > 0.0 ? triFbm(p, n, 3.1, 2) * 0.3 * grain : 0.0) : 0.5;

  // Down the fall line and across it, for streaks that run down the slope.
  vec2 downDir = length(n.xz) > 0.02 ? normalize(n.xz) : vec2(0.0, 1.0);
  vec2 across = vec2(-downDir.y, downDir.x);
  float acrossM = dot(p.xz, across);
  // Distance down the face, counting the drop too, so cliffs don't stretch the streaks.
  float alongM = dot(p.xz, downDir) - p.y;
  // Thin streaks: varied across the slope, stretched down it.
  // Stretched only 5x: the fall line turns from one facet to the next, and longer
  // streaks broke into zigzags where it did.
  float streaks = fbm(vec2(acrossM * 0.3, alongM * 0.06), 4, gFoot * 0.3);
  // Finer streaks only close up, faded out before they get small enough to shimmer.
  float closeUp = 1.0 - smoothstep(25.0, 90.0, dist);
  float streaksNear = closeUp > 0.0 ? mix(0.5, fbm(vec2(acrossM * 0.55, alongM * 0.05), 3, gFoot * 0.55), closeUp) : 0.5;

  // Fractured rock: blocks a few metres across, and smaller joints within them.
  float blockCrack = near > 0.0 ? cracks(p, n, 0.18) : 0.0;
  float jointCrack = grain > 0.0 ? cracks(p + 7.3, n, 0.6) * grain * 0.7 : 0.0;
  // Cracks belong to bare rock faces, not to snowfields or gentle ground.
  float faceRock = smoothstep(32.0, 42.0, slope);
  blockCrack *= (1.0 - smoothstep(200.0, 600.0, dist)) * faceRock;
  jointCrack *= faceRock;

  // Rock: dark gneiss and warm granite in banded strata; the Black Pyramid is darker.
  // Strata are broad, gently tilted bands, warped only by the big-scale noise, so
  // they read as layers in the rock rather than a mottled camouflage.
  float strata = sin(h * 0.022 + big * 6.0 + p.x * 0.0011) * 0.5 + 0.5;
  vec3 rock = mix(vec3(0.19, 0.18, 0.175), vec3(0.28, 0.255, 0.23), smoothstep(0.15, 0.95, strata) * 0.85 + (medium - 0.5) * 0.15);
  rock = mix(rock, vec3(0.14, 0.13, 0.13), smoothstep(6800.0, 7400.0, h) * (1.0 - smoothstep(7400.0, 7700.0, h)) * 0.6);
  rock *= 0.93 + 0.14 * (medium - 0.5) * mid + 0.12 * (fine - 0.5) * near;
  // Dark water and varnish streaks down the faces, pale lighter blocks between joints.
  rock *= 1.0 - 0.28 * smoothstep(0.52, 0.75, streaks) * mid - 0.12 * smoothstep(0.55, 0.8, streaksNear) * near;
  float blockTone = hash12(floor(vec2(acrossM, p.y) * 0.18));
  rock *= 1.0 + (blockTone - 0.5) * 0.08 * near;
  rock *= 1.0 - 0.4 * blockCrack * near - 0.25 * jointCrack;

  // Scree and moraine on gentle low ground.
  vec3 scree = mix(vec3(0.36, 0.33, 0.31), vec3(0.52, 0.48, 0.44), fine * near + medium * (1.0 - near));
  float screeAmt = smoothstep(34.0, 22.0, slope) * smoothstep(5900.0, 5300.0, h);

  // Glacier: medial moraine stripes of dark rubble running down-glacier (from the
  // relief, so the stones you stand on are where the stripes are), bare blue-white
  // ice between them streaked with dirt along the flow, and snow cover higher up
  // (the accumulation zone) and in hollows.
  float moraine = clamp(surf.w + (medium - 0.5) * 0.25, 0.0, 1.0);
  float flowStreak = fbm(vec2(p.x * 0.05, p.z * 0.006), 3, gFoot * 0.05);
  vec3 rubble = mix(vec3(0.27, 0.25, 0.23), vec3(0.50, 0.46, 0.41), fine * near + 0.45 * (1.0 - near));
  rubble *= 0.85 + 0.3 * hash12(floor(p.xz * 1.3)) * near;
  vec3 glacierIce = mix(vec3(0.52, 0.66, 0.77), vec3(0.80, 0.86, 0.91), smoothstep(0.3, 0.75, medium));
  glacierIce = mix(glacierIce, vec3(0.45, 0.42, 0.38), smoothstep(0.55, 0.75, flowStreak) * 0.45);
  float iceCracks = near > 0.0 ? cracks(p + 3.1, vec3(0.0, 1.0, 0.0), 0.35) * near : 0.0;
  glacierIce = mix(glacierIce, vec3(0.45, 0.56, 0.66), iceCracks * 0.22);
  float glacierSnow = clamp(smoothstep(4950.0, 5250.0, h + (big - 0.5) * 300.0) + max(hollow, 0.0) * 1.5
    + (fine - 0.5) * 0.4 * near - 0.6 * moraine, 0.0, 1.0);
  float bare = 1.0 - moraine;
  vec3 glacierCol = mix(rubble, glacierIce, bare);
  glacierCol = mix(glacierCol, vec3(0.84, 0.87, 0.91), smoothstep(0.35, 0.65, glacierSnow));
  bare *= 1.0 - smoothstep(0.35, 0.65, glacierSnow);

  // Snow collects in hollows and on slopes below ~50 degrees; wind strips ridges up high.
  // The slope a face holds snow on wanders a little over hundreds of metres, not
  // from one 20 m blotch to the next.
  float snowSlope = smoothstep(57.0 + (big - 0.5) * 6.0, 43.0 + (big - 0.5) * 6.0, slope);
  float snowAlt = smoothstep(SNOWLINE - 300.0 + big * 500.0, SNOWLINE + 250.0 + big * 500.0, h);
  float wind = smoothstep(7000.0, 8000.0, h) * smoothstep(0.0, -0.25, hollow) * 0.5;
  // Gullies fill with snow and ribs stand out bare: that, not noise, is what gives a
  // snowy face its pattern.
  float snowAmt = clamp(snowSlope * snowAlt + hollow * 1.4 * snowAlt - wind, 0.0, 1.0);
  // Up close, snow lies in patches and runnels on steep rock: in the cracks, on the
  // flatter tops of blocks and in gullies down the fall line.
  float steepMix = smoothstep(38.0, 48.0, slope) * smoothstep(68.0, 58.0, slope) * snowAlt;
  float patches = (fine - 0.5) * 0.4 + (streaksNear - 0.5) * 0.5 + blockCrack * 0.25;
  snowAmt += steepMix * near * patches;
  // The edge between snow and rock runs down the fall line (snow lies in runnels
  // between rock ribs) and is soft, not a hard blotch outline.
  snowAmt = smoothstep(0.22, 0.72, snowAmt + (streaks - 0.5) * 0.3 * mid + (medium - 0.5) * 0.08);
  // Wind ripples (sastrugi) across the prevailing westerly, and soft runnels on steep snow.
  float ripples = grain > 0.0 ? mix(0.5, fbm(vec2(p.x * 0.09, p.z * 0.9), 3, gFoot * 0.9), grain) : 0.5;
  float runnels = smoothstep(30.0, 50.0, slope) * near;
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.96 + 0.04 * fine);
  snow *= 1.0 - 0.04 * runnels * smoothstep(0.45, 0.7, streaksNear) - 0.03 * (ripples - 0.5) * grain;
  // Shadowed hollows and old snow read slightly blue-grey.
  snow = mix(snow, vec3(0.70, 0.76, 0.84), clamp(-hollow * 1.5, 0.0, 0.3) + 0.05 * (1.0 - fine) * near);

  // Hard blue ice on steep faces high up, where snow does not stay.
  float iceAmt = smoothstep(33.0, 40.0, slope) * smoothstep(60.0, 50.0, slope)
    * smoothstep(5700.0, 6300.0, h) * smoothstep(0.45, 0.7, big + (streaks - 0.5) * 0.3);

  // Hard ice: blue-grey, darker where it is clearest, with white fractures and bubble streaks.
  vec3 ice = mix(vec3(0.46, 0.58, 0.68), vec3(0.66, 0.75, 0.82), smoothstep(0.35, 0.7, streaks));
  ice = mix(ice, vec3(0.85, 0.89, 0.93), 0.6 * blockCrack * near + 0.3 * smoothstep(0.6, 0.8, streaksNear) * near);

  // Rime: wind-driven frost plastered on the windward (westerly) side of rock up
  // high, a smooth pale glaze rather than speckle.
  float windward = smoothstep(0.05, 0.6, -n.x);
  float rime = windward * smoothstep(6600.0, 7600.0, h) * smoothstep(0.3, 0.7, big + (streaks - 0.5) * 0.4) * 0.45;
  rock = mix(rock, vec3(0.70, 0.74, 0.79), rime);

  vec3 col = rock;
  col = mix(col, scree, screeAmt);
  col = mix(col, glacierCol, glacier);
  col = mix(col, snow, snowAmt * (1.0 - glacier * 0.75));
  col = mix(col, ice, iceAmt * (1.0 - snowAmt * 0.5) * 0.85);

  // Ledges: a narrow step along the contour, snow-dusted where the face is rock, with
  // a soft shadow below its lip. Only drawn close up, and kept subtle.
  float ledge = 0.0, lip = 0.0;
#ifndef FLAT_GROUND
  float ledgeFade = 1.0 - smoothstep(60.0, 140.0, dist);
  if (ledgeFade > 0.0 && slope > LEDGE_MIN_DEG - 4.0 && slope < LEDGE_MAX_DEG + 4.0) {
    vec3 L = ledgeNear(p.xz);
    if (L.x < 1.6) {
      vec2 d = (p.xz - L.yz) / LEDGE_RADIUS;
      // Long across the slope, short down it, with a ragged edge.
      float e = length(vec2(dot(d, across) * 0.8, dot(d, downDir) * 1.9)) + (fine - 0.5) * 0.45 + (medium - 0.5) * 0.3;
      ledge = smoothstep(1.0, 0.8, e) * ledgeFade;
      float below = dot(d, downDir);
      lip = smoothstep(0.9, 1.05, e) * smoothstep(1.4, 1.1, e) * smoothstep(0.0, 0.4, below) * ledgeFade;
      col *= 1.0 - 0.18 * lip;
      col = mix(col, snow, ledge * (1.0 - snowAmt) * 0.7);
    }
  }
#endif
#ifdef FLAT_GROUND
  // Distant ranges beyond the data: muted so they sit in the haze.
  col = mix(vec3(0.40, 0.39, 0.38), vec3(0.62, 0.66, 0.71), smoothstep(0.4, 0.65, big));
#endif

  float snowy = max(max(snowAmt * (1.0 - glacier * 0.75), glacier * max(bare, glacierSnow)), ledge * 0.7);
  float iceLike = max(iceAmt, glacier * bare * 0.6);
  // Bump from screen-space derivatives breaks up into speckles at grazing angles:
  // fade it out where the surface is seen nearly edge-on.
  float graze = smoothstep(0.04, 0.25, abs(dot(n, normalize(cam - p))));
  TerrainSample s;
  s.albedo = col;
  s.roughness = mix(mix(0.95, 0.75, snowy), 0.35, iceLike);
  // Bump comes from screen-space derivatives, so it has to stay gentle: its height is
  // in metres, and each band's relief is kept to a few per cent of its wavelength
  // (centimetres for the fine grain, under a metre for the 20 m swell). Steeper than
  // that, the normal swings from pixel to pixel and the ground breaks into speckle.
  // Small detail also fades out once a pixel covers more than a few centimetres.
  float smallBump = 1.0 - smoothstep(0.06, 0.35, gFoot);
  float broadBump = 1.0 - smoothstep(2.0, 8.0, gFoot);
  s.bump = fine * near * mix(0.07, 0.02, snowy) * smallBump + medium * mid * 0.35 * broadBump;
  // Cracks cut in, ripples and runnels shape the snow, a ledge stands proud of the slope.
  s.bump += ((-0.05 * blockCrack * near - 0.02 * jointCrack) * (1.0 - snowy)
    + (0.015 * ripples * grain + 0.05 * runnels * streaksNear) * snowy
    + (0.12 * ledge - 0.05 * lip)) * smallBump;
  s.bump *= graze;
  return s;
}
`;
