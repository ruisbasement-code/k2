// Builds the K2 terrain mesh from the heightmap and its rock/snow/ice/glacier shading.
//
// Each vertex carries surface data for the shader in a `surf` attribute:
// x = slope (0 to 1 for 0 to 90 degrees), y = glacier mask,
// z = curvature (above 0.5 is a hollow where snow collects, below is a ridge).
//
// Open crevasses and pits near the climber are cut out of the surface (see
// setHoles), so you can see down into them and fall in.

import * as THREE from 'three';
import { smooth } from './heightmap.js';

/** How many open holes the terrain shader can cut out at once. */
export const MAX_TERRAIN_HOLES = 32;

export function createTerrain(hm) {
  const { n, cell } = hm;
  const pos = new Float32Array(n * n * 3);
  const nrm = new Float32Array(n * n * 3);
  const surf = new Float32Array(n * n * 3);
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
      surf[i * 3] = slope / 90;
      surf[i * 3 + 1] = glacier;
      surf[i * 3 + 2] = Math.min(Math.max(0.5 + lap * 25, 0), 1);
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
  geo.setAttribute('surf', new THREE.BufferAttribute(surf, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();

  const holes = {
    uHoleA: { value: Array.from({ length: MAX_TERRAIN_HOLES }, () => new THREE.Vector4()) },
    uHoleB: { value: Array.from({ length: MAX_TERRAIN_HOLES }, () => new THREE.Vector4()) },
    uHoleCount: { value: 0 },
    // A circle around all of them, so the rest of the mountain skips the test.
    uHoleBounds: { value: new THREE.Vector4(0, 0, -1, 0) },
  };
  const terrain = new THREE.Mesh(geo, terrainMaterial(false, holes));
  terrain.receiveShadow = true;

  // Low ground beyond the edge of the data, so the horizon is not a void.
  const outerGeo = new THREE.RingGeometry(hm.size * 0.5, 100000, 64, 1);
  outerGeo.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(outerGeo.attributes.position.count * 3).fill(0.5), 3));
  const outer = new THREE.Mesh(outerGeo, terrainMaterial(true));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = 4550;
  const group = new THREE.Group();
  group.add(terrain, outer);
  /** Cut these open holes ({x, z, ux, uz, half, width, kind}) out of the surface, nearest first. */
  group.userData.setHoles = (list) => {
    const n = Math.min(list.length, MAX_TERRAIN_HOLES);
    for (let i = 0; i < n; i++) {
      const h = list[i];
      holes.uHoleA.value[i].set(h.x, h.z, h.ux, h.uz);
      holes.uHoleB.value[i].set(h.half, h.width, h.kind === 'pit' || h.kind === 'moulin' ? 1 : 0, h.bend ?? 0);
    }
    holes.uHoleCount.value = n;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += list[i].x / n; cz += list[i].z / n; }
    let r = -1;
    for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(list[i].x - cx, list[i].z - cz) + list[i].half + Math.abs(list[i].bend ?? 0) + list[i].width);
    holes.uHoleBounds.value.set(cx, cz, r, 0);
  };
  return group;
}

function terrainMaterial(flatGround, holes = null) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    if (holes) Object.assign(sh.uniforms, holes);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 surf;
varying vec3 vW;
varying vec3 vWN;
varying vec3 vSurf;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWN = normalize(mat3(modelMatrix) * objectNormal);
vSurf = surf;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${flatGround ? '#define FLAT_GROUND' : ''}
${holes ? `#define TERRAIN_HOLES ${MAX_TERRAIN_HOLES}` : ''}
${TERRAIN_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
#ifdef TERRAIN_HOLES
if (inHole(vW.xz)) discard;
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
TerrainSample ts = terrainSample(vW, normalize(vWN), vSurf, cameraPosition);
diffuseColor.rgb = ts.albedo;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = ts.roughness;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = perturbNormal(-vViewPosition, normal, ts.bump);`);
  };
  return mat;
}

// Rock, scree, glacier, snow and ice blended by slope, altitude and curvature, with
// procedural detail and bump so the ground reads at climbing scale.
const TERRAIN_GLSL = /* glsl */ `
varying vec3 vW;
varying vec3 vWN;
varying vec3 vSurf;

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

float fbm(vec2 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return v;
}

// Noise projected along the axis the surface faces most, so cliffs are not smeared.
float triFbm(vec3 p, vec3 n, float scale, int octaves) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z);
  return fbm(p.zy * scale, octaves) * w.x + fbm(p.xz * scale, octaves) * w.y + fbm(p.xy * scale, octaves) * w.z;
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

#ifdef TERRAIN_HOLES
uniform vec4 uHoleA[TERRAIN_HOLES];
uniform vec4 uHoleB[TERRAIN_HOLES];
uniform int uHoleCount;
uniform vec4 uHoleBounds;

// Inside an open crevasse (a lens tapering to its ends) or pit (a circle)?
bool inHole(vec2 p) {
  if (distance(p, uHoleBounds.xy) > uHoleBounds.z) return false;
  for (int i = 0; i < TERRAIN_HOLES; i++) {
    if (i >= uHoleCount) break;
    vec4 a = uHoleA[i];
    vec4 b = uHoleB[i];
    vec2 d = p - a.xy;
    if (dot(d, d) > (b.x + b.y + abs(b.w)) * (b.x + b.y + abs(b.w))) continue;
    float u = dot(d, a.zw);
    if (abs(u) >= b.x) continue;
    float t = u / b.x;
    float v = dot(d, vec2(-a.w, a.z)) - b.w * (1.0 - t * t);
    float w = b.z > 0.5 ? b.y * sqrt(1.0 - t * t) : b.y * sqrt(1.0 - t * t * t * t);
    if (abs(v) < w) return true;
  }
  return false;
}
#endif

struct TerrainSample { vec3 albedo; float roughness; float bump; };

TerrainSample terrainSample(vec3 p, vec3 n, vec3 surf, vec3 cam) {
  float dist = length(p - cam);
  float h = p.y;
  float slope = degrees(acos(clamp(n.y, 0.0, 1.0)));
  float glacier = surf.y;
  float hollow = surf.z - 0.5;

  // Detail fades out with distance so far slopes do not shimmer.
  float near = 1.0 - smoothstep(150.0, 1500.0, dist);
  float mid = 1.0 - smoothstep(1500.0, 9000.0, dist);
  float big = fbm(p.xz * 0.0035, 4);
  float medium = triFbm(p, n, 0.045, 4);
  float grain = 1.0 - smoothstep(15.0, 60.0, dist);
  float fine = near > 0.0 ? triFbm(p, n, 0.7, 3) * (1.0 - 0.3 * grain) + (grain > 0.0 ? triFbm(p, n, 3.1, 2) * 0.3 * grain : 0.0) : 0.5;

  // Rock: dark gneiss and warm granite in banded strata; the Black Pyramid is darker.
  float strata = sin(h * 0.03 + medium * 9.0 + big * 5.0) * 0.5 + 0.5;
  vec3 rock = mix(vec3(0.24, 0.23, 0.22), vec3(0.40, 0.35, 0.30), smoothstep(0.2, 0.9, strata) * 0.8 + medium * 0.2);
  rock = mix(rock, vec3(0.14, 0.13, 0.13), smoothstep(6800.0, 7400.0, h) * (1.0 - smoothstep(7400.0, 7700.0, h)) * 0.6);
  rock *= 0.85 + 0.3 * medium * mid + 0.25 * (fine - 0.5) * near;

  // Scree and moraine on gentle low ground.
  vec3 scree = mix(vec3(0.36, 0.33, 0.31), vec3(0.52, 0.48, 0.44), fine * near + medium * (1.0 - near));
  float screeAmt = smoothstep(34.0, 22.0, slope) * smoothstep(5900.0, 5300.0, h);

  // Glacier: rubble-covered ice streaked along the flow (roughly north-south here),
  // with bare grey-blue ice and white penitente fields between the streaks.
  float streak = fbm(vec2(p.x * 0.012, p.z * 0.0016), 4);
  float bare = smoothstep(0.48, 0.62, streak + (big - 0.5) * 0.3);
  vec3 rubble = mix(vec3(0.30, 0.28, 0.27), vec3(0.47, 0.44, 0.41), fine * near + 0.4 * (1.0 - near));
  vec3 glacierIce = mix(vec3(0.56, 0.62, 0.67), vec3(0.80, 0.83, 0.86), smoothstep(0.35, 0.8, medium));
  vec3 glacierCol = mix(rubble, glacierIce, bare);

  // Snow collects in hollows and on slopes below ~50 degrees; wind strips ridges up high.
  float snowSlope = smoothstep(55.0 + (big - 0.5) * 14.0, 40.0 + (big - 0.5) * 14.0, slope);
  float snowAlt = smoothstep(SNOWLINE - 300.0 + big * 500.0, SNOWLINE + 250.0 + big * 500.0, h);
  float wind = smoothstep(7000.0, 8000.0, h) * smoothstep(0.0, -0.25, hollow) * 0.5;
  float snowAmt = clamp(snowSlope * snowAlt + hollow * 0.8 * snowAlt - wind, 0.0, 1.0);
  snowAmt = smoothstep(0.3, 0.6, snowAmt + (medium - 0.5) * 0.3);
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.92 + 0.08 * fine);

  // Hard blue ice on steep faces high up, where snow does not stay.
  float iceAmt = smoothstep(33.0, 40.0, slope) * smoothstep(60.0, 50.0, slope)
    * smoothstep(5700.0, 6300.0, h) * smoothstep(0.5, 0.65, medium + (big - 0.5) * 0.4);

  vec3 col = rock;
  col = mix(col, scree, screeAmt);
  col = mix(col, glacierCol, glacier);
  col = mix(col, snow, snowAmt * (1.0 - glacier * 0.75));
  col = mix(col, vec3(0.58, 0.67, 0.74), iceAmt * (1.0 - snowAmt * 0.5) * 0.85);
#ifdef FLAT_GROUND
  // Distant ranges beyond the data: muted so they sit in the haze.
  col = mix(vec3(0.40, 0.39, 0.38), vec3(0.62, 0.66, 0.71), smoothstep(0.4, 0.65, big));
#endif

  float snowy = max(snowAmt * (1.0 - glacier * 0.75), glacier * bare);
  float iceLike = max(iceAmt, glacier * bare * 0.6);
  TerrainSample s;
  s.albedo = col;
  s.roughness = mix(mix(0.95, 0.75, snowy), 0.35, iceLike);
  s.bump = (fine * near * mix(1.6, 0.35, snowy) + medium * mid * 6.0) * 0.6;
  return s;
}
`;
