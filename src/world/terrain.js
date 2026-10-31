// Builds the K2 terrain mesh from the heightmap and its rock/snow/ice/glacier shading.
//
// Each vertex carries surface data for the shader in a `surf` attribute:
// x = slope (0 to 1 for 0 to 90 degrees), y = glacier mask,
// z = curvature (above 0.5 is a hollow where snow collects, below is a ridge).
//
// The small ledges the fall physics uses (see ledgeAt in sim/hazards.js) are drawn
// here too, from the same hash, as snowy shelves with a rock step below them.
//
// Open crevasses and pits near the climber are cut out of the surface (see
// setHoles), so you can see down into them and fall in.

import * as THREE from 'three';
import { smooth } from './heightmap.js';
import { tuning } from '../sim/paceModel.js';

/** How many open holes the terrain shader can cut out at once. */
export const MAX_TERRAIN_HOLES = 48;

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
${LEDGE_DEFINES()}
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
  return 1.0 - smoothstep(0.0, 0.08, e);
}

#ifdef TERRAIN_HOLES
uniform vec4 uHoleA[TERRAIN_HOLES];
uniform vec4 uHoleB[TERRAIN_HOLES];
uniform int uHoleCount;

// Inside an open crevasse (a lens tapering to its ends) or pit (a circle)?
bool inHole(vec2 p) {
  for (int i = 0; i < TERRAIN_HOLES; i++) {
    if (i >= uHoleCount) break;
    vec4 a = uHoleA[i];
    vec4 b = uHoleB[i];
    vec2 d = p - a.xy;
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

  // Down the fall line and across it, for streaks that run down the slope.
  vec2 downDir = length(n.xz) > 0.02 ? normalize(n.xz) : vec2(0.0, 1.0);
  vec2 across = vec2(-downDir.y, downDir.x);
  float acrossM = dot(p.xz, across);
  float alongM = dot(p.xz, downDir);
  // Thin streaks: varied across the slope, stretched 15x down it.
  float streaks = fbm(vec2(acrossM * 0.35, alongM * 0.023 + p.y * 0.02), 4);
  // Finer streaks only close up, faded out before they get small enough to shimmer.
  float closeUp = 1.0 - smoothstep(25.0, 90.0, dist);
  float streaksNear = closeUp > 0.0 ? mix(0.5, fbm(vec2(acrossM * 0.55, alongM * 0.05), 3), closeUp) : 0.5;

  // Fractured rock: blocks a few metres across, and smaller joints within them.
  float blockCrack = near > 0.0 ? cracks(p, n, 0.18) : 0.0;
  float jointCrack = grain > 0.0 ? cracks(p + 7.3, n, 0.6) * grain * 0.7 : 0.0;
  // Cracks belong to bare rock faces, not to snowfields or gentle ground.
  float faceRock = smoothstep(32.0, 42.0, slope);
  blockCrack *= (1.0 - smoothstep(200.0, 600.0, dist)) * faceRock;
  jointCrack *= faceRock;

  // Rock: dark gneiss and warm granite in banded strata; the Black Pyramid is darker.
  float strata = sin(h * 0.03 + medium * 9.0 + big * 5.0) * 0.5 + 0.5;
  vec3 rock = mix(vec3(0.24, 0.23, 0.22), vec3(0.40, 0.35, 0.30), smoothstep(0.2, 0.9, strata) * 0.8 + medium * 0.2);
  rock = mix(rock, vec3(0.14, 0.13, 0.13), smoothstep(6800.0, 7400.0, h) * (1.0 - smoothstep(7400.0, 7700.0, h)) * 0.6);
  rock *= 0.85 + 0.3 * medium * mid + 0.25 * (fine - 0.5) * near;
  // Dark water and varnish streaks down the faces, pale lighter blocks between joints.
  rock *= 1.0 - 0.28 * smoothstep(0.52, 0.75, streaks) * mid - 0.12 * smoothstep(0.55, 0.8, streaksNear) * near;
  float blockTone = hash12(floor(vec2(acrossM, p.y) * 0.18));
  rock *= 1.0 + (blockTone - 0.5) * 0.18 * near;
  rock *= 1.0 - 0.55 * blockCrack * near - 0.4 * jointCrack;

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
  // Up close, snow lies in patches and runnels on steep rock: in the cracks, on the
  // flatter tops of blocks and in gullies down the fall line.
  float steepMix = smoothstep(38.0, 48.0, slope) * smoothstep(68.0, 58.0, slope) * snowAlt;
  float patches = (fine - 0.5) * 1.0 + (streaksNear - 0.5) * 0.6 + blockCrack * 0.35;
  snowAmt += steepMix * near * patches;
  snowAmt = smoothstep(0.3, 0.6, snowAmt + (medium - 0.5) * 0.3);
  // Wind ripples (sastrugi) across the prevailing westerly, and soft runnels on steep snow.
  float ripples = grain > 0.0 ? mix(0.5, fbm(vec2(p.x * 0.09, p.z * 0.9), 3), grain) : 0.5;
  float runnels = smoothstep(30.0, 50.0, slope) * near;
  vec3 snow = vec3(0.80, 0.83, 0.88) * (0.92 + 0.08 * fine);
  snow *= 1.0 - 0.04 * runnels * smoothstep(0.45, 0.7, streaksNear) - 0.03 * (ripples - 0.5) * grain;
  // Shadowed hollows and old snow read slightly blue-grey.
  snow = mix(snow, vec3(0.70, 0.76, 0.84), clamp(-hollow * 1.5, 0.0, 0.3) + 0.12 * (1.0 - fine) * near);

  // Hard blue ice on steep faces high up, where snow does not stay.
  float iceAmt = smoothstep(33.0, 40.0, slope) * smoothstep(60.0, 50.0, slope)
    * smoothstep(5700.0, 6300.0, h) * smoothstep(0.5, 0.65, medium + (big - 0.5) * 0.4);

  // Hard ice: blue-grey, darker where it is clearest, with white fractures and bubble streaks.
  vec3 ice = mix(vec3(0.46, 0.58, 0.68), vec3(0.66, 0.75, 0.82), smoothstep(0.35, 0.7, streaks));
  ice = mix(ice, vec3(0.85, 0.89, 0.93), 0.6 * blockCrack * near + 0.3 * smoothstep(0.6, 0.8, streaksNear) * near);

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

  float snowy = max(max(snowAmt * (1.0 - glacier * 0.75), glacier * bare), ledge * 0.7);
  float iceLike = max(iceAmt, glacier * bare * 0.6);
  // Bump from screen-space derivatives breaks up into speckles at grazing angles:
  // fade it out where the surface is seen nearly edge-on.
  float graze = smoothstep(0.04, 0.25, abs(dot(n, normalize(cam - p))));
  TerrainSample s;
  s.albedo = col;
  s.roughness = mix(mix(0.95, 0.75, snowy), 0.35, iceLike);
  s.bump = (fine * near * mix(1.6, 0.35, snowy) + medium * mid * 6.0) * 0.6;
  // Cracks cut in, ripples and runnels shape the snow, a ledge stands proud of the slope.
  s.bump += (-0.25 * blockCrack * near - 0.1 * jointCrack) * (1.0 - snowy)
    + (0.05 * ripples * grain + 0.12 * runnels * streaksNear) * snowy
    + (0.35 * ledge - 0.15 * lip);
  s.bump *= graze;
  return s;
}
`;
