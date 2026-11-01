// Drawing for the terrain features: crevasse and pit walls (the terrain shader
// cuts their openings out of the surface), snow bridges you've found and the
// faint sag of hidden ones, the Bottleneck serac's ice cliff, cornices and snow
// overhangs, snow caves, the lamp posts along the path from Base Camp to Camp 1,
// and serac ice coming down.

import * as THREE from 'three';
import { TerrainFeatures } from '../sim/terrainFeatures.js';
import { tuning } from '../sim/paceModel.js';
import { MAX_TERRAIN_HOLES } from './terrain.js';
import { RockfallMesh } from './hazardMeshes.js';
import { blockGeometry, blockMaterial } from './glacierBlocks.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ICE_TOP = new THREE.Color(0x7fb6d2);
const ICE_MID = new THREE.Color(0x1d4f78);
const ICE_DEEP = new THREE.Color(0x050d18);
const ICE_LIP = new THREE.Color(0xb8d4e4);
const MAX_RUBBLE = 1600;

/** A repeatable 0..1 number for a hole, a point on it and a purpose. */
const rnd = (h, i, k) => {
  const s = Math.sin(((h.seed ?? 0) * 1000 + i * 12.9898 + k * 78.233)) * 43758.5453;
  return s - Math.floor(s);
};

/** A growable list of triangles with vertex colours, turned into a geometry. */
class Tris {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  quad(a, b, c, d, ca, cb = ca, cc = cb, cd = cc) {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }

  tri(a, b, c, ca, cb, cc) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (const k of [ca, cb, cc]) this.col.push(k.r, k.g, k.b);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/** A box with its corners pushed about, so ice and rock look broken rather than cut. */
function jaggedBox(seed) {
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 3, 2).toNonIndexed();
  const p = g.attributes.position;
  const key = (x, y, z) => `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
  const moved = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (!moved.has(k)) {
      const h = Math.sin(moved.size * 12.9898 + seed * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      const r2 = (Math.sin(moved.size * 4.1 + seed * 9.7) * 1000) % 1;
      moved.set(k, [(r - 0.5) * 0.25, (r2 - 0.5) * 0.15, (((r * 7) % 1) - 0.5) * 0.25]);
    }
    const [dx, dy, dz] = moved.get(k);
    // The top narrows a little and the base stays on the ground.
    const y = p.getY(i);
    const taper = 1 - 0.2 * (y + 0.5);
    p.setXYZ(i, p.getX(i) * taper + dx, y + (y > -0.49 ? dy : 0), p.getZ(i) * taper + dz);
  }
  g.translate(0, 0.5, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * Crevasse walls: glacier ice in layers. Each year's snow becomes a band of ice,
 * so the walls are striped with pale and deep blue layers and dirty seams, fluted
 * where meltwater ran down them, and the light fades to black with depth.
 */
function iceWallMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvIceW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vIceW;
float iceHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float iceNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(iceHash(i), iceHash(i + vec2(1.0, 0.0)), f.x), mix(iceHash(i + vec2(0.0, 1.0)), iceHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 h = vIceW.xz;
  float along = h.x * 0.7 + h.y * 0.7;
  // Layers, gently warped, thick and thin.
  float warp = iceNoise(vec2(along * 0.08, vIceW.y * 0.05)) * 3.0;
  float layer = vIceW.y * 1.6 + warp;
  float band = smoothstep(0.35, 0.65, iceNoise(vec2(layer, along * 0.02)));
  float seam = smoothstep(0.93, 0.99, iceNoise(vec2(vIceW.y * 3.0 + warp, along * 0.05)));
  // Vertical flutes from meltwater.
  float flute = iceNoise(vec2(along * 1.3, vIceW.y * 0.08));
  float glow = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
  vec3 pale = vec3(0.72, 0.88, 0.95), deep = vec3(0.20, 0.52, 0.74);
  vec3 ice = mix(deep, pale, 0.25 + band * 0.35 + flute * 0.25);
  ice = mix(ice, vec3(0.36, 0.38, 0.40), seam * 0.6);
  diffuseColor.rgb = ice * glow;
}`);
  };
  return mat;
}

/** A soft round glow for the path lights. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,230,180,0.8)');
  grad.addColorStop(0.5, 'rgba(255,190,110,0.25)');
  grad.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Fade a path-light material out with distance from the climber, so a lamp only
 * shows within `range` metres. Glows fade softly over the last part of the
 * range; solid parts are dropped once they've faded out.
 */
function fadeWithRange(mat, uniforms, soft) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLightAt = uniforms.uLightAt;
    sh.uniforms.uLightRange = uniforms.uLightRange;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform vec3 uLightAt;\nuniform float uLightRange;\nvarying float vLightFade;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 lightWorld = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lightWorld = instanceMatrix * lightWorld;
  #endif
  lightWorld = modelMatrix * lightWorld;
  float lightD = distance(lightWorld.xyz, uLightAt);
  vLightFade = 1.0 - smoothstep(uLightRange * 0.6, uLightRange, lightD);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vLightFade;\nvoid main() {')
      .replace('#include <alphatest_fragment>', soft
        ? 'diffuseColor.a *= vLightFade;\n#include <alphatest_fragment>'
        : 'if (vLightFade < 0.5) discard;\n#include <alphatest_fragment>');
  };
  mat.customProgramCacheKey = () => `pathlight-${soft}`;
  return mat;
}

export class FeatureMeshes extends THREE.Group {
  /**
   * @param terrain the terrain group from createTerrain (to cut holes out of)
   */
  constructor(hm, features, terrain, ropes) {
    super();
    this.hm = hm;
    this.features = features;
    this.terrain = terrain;
    this.ropes = ropes;
    this.radius = 350;
    this.centre = new THREE.Vector3(1e9, 0, 1e9);
    this.version = -1;

    // Light glows blue through the ice walls, so they're lit from within rather than by the sun.
    this.holeMat = iceWallMaterial();
    this.bridgeMat = new THREE.MeshStandardMaterial({
      color: 0x5d7894, roughness: 1, transparent: true, opacity: 0.4, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3,
    });
    this.sagMat = this.bridgeMat.clone();
    this.sagMat.opacity = 0.1;
    this.iceMat = new THREE.MeshStandardMaterial({ color: 0xd7ecf6, roughness: 0.3, metalness: 0.05, flatShading: true });
    this.snowMat = new THREE.MeshStandardMaterial({ color: 0xeef3f8, roughness: 0.85, side: THREE.DoubleSide });
    this.cliffMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.02, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2725, roughness: 0.95, flatShading: true });
    this.iceBoxes = [0, 1, 2].map((k) => jaggedBox(k + 1));

    this.holes = new THREE.Mesh(new THREE.BufferGeometry(), this.holeMat);
    // Broken ice blocks along the lips and wedged in the slots, like the glacier's own.
    this.rubble = new THREE.InstancedMesh(blockGeometry(), blockMaterial(), MAX_RUBBLE);
    this.rubble.count = 0;
    this.rubble.castShadow = this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.add(this.rubble);
    this.bridges = new THREE.Mesh(new THREE.BufferGeometry(), this.bridgeMat);
    this.sags = new THREE.Mesh(new THREE.BufferGeometry(), this.sagMat);
    for (const m of [this.holes, this.bridges, this.sags]) {
      m.frustumCulled = false;
      this.add(m);
    }
    this.holes.receiveShadow = true;
    this.towers = this.iceBoxes.map((g) => {
      const m = new THREE.InstancedMesh(g, this.iceMat, 300);
      m.count = 0;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      this.add(m);
      return m;
    });
    this.cornices = new THREE.Mesh(new THREE.BufferGeometry(), this.snowMat);
    this.cornices.castShadow = this.cornices.receiveShadow = true;
    this.cornices.frustumCulled = false;
    this.add(this.cornices);

    this._static();
    this.icefall = new RockfallMesh(features.icefall);
    this.add(this.icefall);
  }

  /** Things that never change: the named seracs, caves, rock bands and wands. */
  _static() {
    const f = this.features;
    const hm = this.hm;
    // The hanging seracs, drawn as one continuous ice cliff each.
    if (f.placedSeracs.length) {
      for (const ice of f.icefalls) {
        const cliff = new THREE.Mesh(this._iceCliff(ice), this.cliffMat);
        cliff.castShadow = cliff.receiveShadow = true;
        this.add(cliff);
      }
    }
    // Snow caves: a drift with a dark hole facing down the slope.
    for (const c of f.caverns) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(c.radius * 1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.snowMat);
      dome.scale.y = 0.6;
      // Dug into the slope: sink it to the lowest ground around it so no edge floats.
      let low = c.y;
      for (let k = 0; k < 8; k++) low = Math.min(low, hm.heightAt(c.x + Math.cos(k * 0.785) * c.radius * 1.6, c.z + Math.sin(k * 0.785) * c.radius * 1.6));
      dome.position.set(c.x, low - 0.3, c.z);
      const door = new THREE.Mesh(new THREE.CircleGeometry(c.radius * 0.45, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x05080c }));
      const yaw = Math.atan2(c.face.x, c.face.z);
      door.position.set(c.x + c.face.x * c.radius * 1.5, low - 0.25, c.z + c.face.z * c.radius * 1.5);
      door.rotation.y = yaw;
      dome.castShadow = dome.receiveShadow = true;
      this.add(dome, door);
    }
    // Rock: the walls of House's Chimney and the dark buttresses of the Black Pyramid.
    const rocks = [];
    for (const z of f.zones) {
      const pts = z.points;
      if (z.walls) {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
          const n = Math.ceil(len / 6);
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            for (const side of [-1, 1]) {
              const x = a.x + (b.x - a.x) * t - uz * side * 2.6, zz = a.z + (b.z - a.z) * t + ux * side * 2.6;
              rocks.push({ x, z: zz, ux, uz, halfL: 3.4, halfD: 0.9 + 0.4 * ((k * 7 + side + 3) % 3) / 3, height: 2.5 + ((k * 5 + side + 3) % 4) * 0.6 });
            }
          }
        }
      }
      if (z.rocks) {
        let seed = 1;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 400 && rocks.length < 600; i++) {
          const k = Math.floor(rnd() * (pts.length - 1));
          const a = pts[k], b = pts[k + 1];
          const t = rnd();
          const ang = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * z.radius_m;
          const x = a.x + (b.x - a.x) * t + Math.cos(ang) * r, zz = a.z + (b.z - a.z) * t + Math.sin(ang) * r;
          if (this.ropes && this.ropes.nearest(new THREE.Vector3(x, hm.heightAt(x, zz), zz)).distance < 7) continue;
          const yaw = rnd() * Math.PI;
          rocks.push({ x, z: zz, ux: Math.cos(yaw), uz: Math.sin(yaw), halfL: 1 + rnd() * 3, halfD: 0.8 + rnd() * 2, height: 1.5 + rnd() * 4 });
        }
      }
    }
    if (rocks.length) {
      const m = new THREE.InstancedMesh(this.iceBoxes[1], this.rockMat, rocks.length);
      rocks.forEach((r, i) => {
        // From the lowest corner, tall enough to stand clear of the slope at the highest.
        let lo = Infinity, hi = -Infinity;
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const y = hm.heightAt(r.x + r.ux * r.halfL * a - r.uz * r.halfD * b, r.z + r.uz * r.halfL * a + r.ux * r.halfD * b);
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        m.setMatrixAt(i, this._blockMatrix({ ...r, y: lo - 0.5, height: r.height + (hi - lo) }));
      });
      m.computeBoundingSphere();
      m.castShadow = m.receiveShadow = true;
      this.add(m);
    }
    this._pathLights();
  }

  /**
   * Lamp posts along the way from Base Camp to Camp 1: across the glacier on the
   * wanded trail, then up beside the fixed rope. They glow at night with no fog
   * on the glow, but only as far as you can see: in storms, low visibility or
   * when you're ill, only the lamps a few metres away show.
   */
  _pathLights() {
    const f = this.features;
    const hm = this.hm;
    const spots = [];
    const along = (pts, every, side) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 1e-3) continue;
        const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
        for (let d = (spots.length ? 0 : every / 2); d < len; d += every) {
          const x = a.x + ((b.x - a.x) * d) / len + nx * side, z = a.z + ((b.z - a.z) * d) / len + nz * side;
          spots.push(new THREE.Vector3(x, hm.heightAt(x, z), z));
        }
      }
    };
    if (f.trail) along(f.trail.points, tuning.path_light_every_m, 2);
    // Up the rope as far as Camp 1.
    const c1 = f.camps[2];
    if (this.ropes && c1) {
      const rope = this.ropes.ropes[0];
      const end = rope.reduce((best, p, i) => (Math.hypot(p.x - c1.x, p.z - c1.z) < Math.hypot(rope[best].x - c1.x, rope[best].z - c1.z) ? i : best), 0);
      const pts = rope.slice(0, end + 1).filter((_, i) => i % 3 === 0 || i === end);
      along(pts, tuning.path_light_every_m * 0.7, 1.6);
    }
    if (!spots.length) return;
    // In small groups, so each group is culled when it's off screen or far away.
    const postGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.3, 6).translate(0, 0.65, 0);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 });
    const lampGeo = new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.38, 0);
    this.lightUniforms = { uLightAt: { value: new THREE.Vector3() }, uLightRange: { value: tuning.path_light_draw_m } };
    const lampMat = fadeWithRange(new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false }), this.lightUniforms, false);
    // The glow: a halo that scales with distance, and a small core that stays a
    // few pixels wide however far away, drawn over the fog so it shows in storms.
    const map = glowTexture();
    const glowMat = (size, attenuate, color) => fadeWithRange(new THREE.PointsMaterial({
      size, sizeAttenuation: attenuate, map, color,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }), this.lightUniforms, true);
    const halo = glowMat(5, true, 0xffb85c), core = glowMat(6, false, 0xffd9a0);
    this.lightGroups = [];
    const size = 8;
    for (let g = 0; g < spots.length; g += size) {
      const group = spots.slice(g, g + size);
      const lamps = new THREE.Group();
      const post = new THREE.InstancedMesh(postGeo, postMat, group.length);
      const lamp = new THREE.InstancedMesh(lampGeo, lampMat, group.length);
      group.forEach((p, i) => {
        _m.makeTranslation(p.x, p.y - 0.15, p.z);
        post.setMatrixAt(i, _m);
        lamp.setMatrixAt(i, _m);
      });
      post.computeBoundingSphere();
      lamp.computeBoundingSphere();
      const at = new THREE.BufferGeometry().setFromPoints(group.map((p) => new THREE.Vector3(p.x, p.y + 1.23, p.z)));
      at.computeBoundingSphere();
      lamps.add(post, lamp, new THREE.Points(at, halo), new THREE.Points(at, core));
      lamps.userData.centre = at.boundingSphere.center.clone();
      lamps.userData.radius = at.boundingSphere.radius;
      this.lightGroups.push(lamps);
      this.add(lamps);
    }
  }

  /**
   * How far you can make out a path light: the draw distance in clear weather,
   * closing in to a few metres in storms and low visibility, and when illness
   * or injury blurs your vision.
   */
  _lightRange(climber) {
    const far = tuning.path_light_draw_m, near = tuning.path_light_near_m;
    if (!climber) return far;
    const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
    const w = climber.conditions;
    const vis = w ? w.visibility : 80000;
    const clear = Math.min(far, Math.max(near, vis * 2));
    // Storms and murk: from 1.5 km visibility down to 300 m, the lamps close in.
    const murk = smooth(tuning.path_light_clear_vis_m, tuning.path_light_storm_vis_m, vis);
    // Illness (blurred vision) and injury (from 70 health down).
    const ill = smooth(0.05, 0.4, climber.mods?.blur ?? 0);
    const hurt = climber.dead ? 1 : smooth(70, 35, climber.feltHealth ?? climber.health ?? 100);
    const k = Math.max(murk, ill, hurt);
    return Math.exp(Math.log(clear) + (Math.log(near) - Math.log(clear)) * k);
  }

  /** Hide the lights beyond how far you can see them. */
  _cullLights(position, climber) {
    const range = this._lightRange(climber);
    this.lightUniforms?.uLightAt.value.copy(position);
    if (this.lightUniforms) this.lightUniforms.uLightRange.value = range;
    for (const g of this.lightGroups ?? []) g.visible = g.userData.centre.distanceTo(position) < range + g.userData.radius;
  }

  /**
   * A hanging serac as a single ice cliff: a face of blue-white ice, slightly
   * overhanging at its lip, with a snow-covered top running back into the slope.
   */
  _iceCliff(ice) {
    const hm = this.hm;
    const tris = new Tris();
    const n = Math.max(2, Math.round(ice.length / 4));
    const back = { x: -ice.face.x, z: -ice.face.z };
    const faceCol = new THREE.Color(0xbcdcec), deepCol = new THREE.Color(0x7fb2cf), snow = new THREE.Color(0xf1f5f9);
    const rows = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bx = ice.x + ice.along.x * t, bz = ice.z + ice.along.z * t;
      // Height swells in the middle and wanders, so the lip isn't a ruler line.
      const h = (24 + 18 * Math.sin(Math.PI * t)) * (0.85 + 0.15 * Math.sin(i * 1.7) * Math.cos(i * 0.6));
      const base = hm.heightAt(bx, bz) - 3;
      const lipX = bx + ice.face.x * 2.5, lipZ = bz + ice.face.z * 2.5;
      const depth = 28 + 6 * Math.sin(i * 0.9);
      const rx = bx + back.x * depth, rz = bz + back.z * depth;
      rows.push({
        base: new THREE.Vector3(bx, base, bz),
        mid: new THREE.Vector3(bx + ice.face.x * 1.2, base + h * 0.55, bz + ice.face.z * 1.2),
        lip: new THREE.Vector3(lipX, base + h, lipZ),
        top: new THREE.Vector3(bx + back.x * 4, base + h + 1.2, bz + back.z * 4),
        rear: new THREE.Vector3(rx, Math.max(hm.heightAt(rx, rz), base + h * 0.5) - 1, rz),
        shade: i % 3 === 0 ? deepCol : faceCol,
      });
    }
    for (let i = 0; i < n; i++) {
      const a = rows[i], b = rows[i + 1];
      tris.quad(a.base, b.base, b.mid, a.mid, deepCol, deepCol, b.shade, a.shade);
      tris.quad(a.mid, b.mid, b.lip, a.lip, a.shade, b.shade, faceCol, faceCol);
      tris.quad(a.lip, b.lip, b.top, a.top, snow);
      tris.quad(a.top, b.top, b.rear, a.rear, snow);
    }
    // Close off the two ends.
    for (const r of [rows[0], rows[n]]) {
      tris.quad(r.base, r.mid, r.lip, r.top, deepCol, faceCol, faceCol, snow);
      tris.tri(r.base, r.top, r.rear, deepCol, snow, snow);
    }
    return tris.geometry();
  }

  /** Place a unit block on the ground, along the feature's axis. */
  _blockMatrix(b) {
    _q.setFromAxisAngle(_up, Math.atan2(-b.uz, b.ux));
    _s.set(b.halfL * 2, b.height, b.halfD * 2);
    return _m.compose(_p.set(b.x, b.y, b.z), _q, _s);
  }

  /** Rebuild what's near the climber when they move or something collapses. */
  update(position, climber) {
    this.icefall.update();
    this._cullLights(position, climber);
    const moved = Math.hypot(position.x - this.centre.x, position.z - this.centre.z) > 80;
    if (!moved && this.version === this.features.version) return;
    this.centre.copy(position);
    this.version = this.features.version;
    this._holes(position);
    this._towers(position);
    this._cornices();
  }

  _holes(c) {
    const f = this.features;
    const hm = this.hm;
    const walls = new Tris();
    const bridges = new Tris();
    const sags = new Tris();
    const cut = [];
    const rubble = [];
    const holes = f.holesNear(c.x, c.z, this.radius).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    const white = new THREE.Color(0xffffff);
    const col = (a, b, t) => a.clone().lerp(b, t);
    for (const h of holes) {
      const open = f.isOpen(h);
      if (open && cut.length >= MAX_TERRAIN_HOLES) continue;
      // Points along both ragged edges of the lens (or round the oval of a pit).
      const ring = this._outline(h);
      if (open) {
        cut.push(h);
        const ys = ring.map((p) => hm.heightAt(p.x, p.z));
        const rim = Math.min(...ys);
        const bottom = rim - h.depth;
        // The wall at each point of the rim, top to bottom: the lip, an undercut
        // just below it, then the ice narrowing in steps and ledges to the dark.
        // Light only gets a few metres in: pale at the lip, deep blue by about
        // 4 m down, nearly black by 9 m, black at the bottom.
        const band = Math.min(1.6, h.depth * 0.1);
        const cols = ring.map((p, i) => {
          const y = ys[i];
          const j = (k) => rnd(h, i, k) - 0.5;
          const lv = [
            [1, y + 0.05],
            [1.08 + 0.08 * j(1), y - band],
            [0.85 + 0.14 * j(2), Math.max(bottom + 2, y - 4 - 1.2 * j(3))],
            [0.66 + 0.14 * j(4), Math.max(bottom + 1, y - 9 - 2 * j(5))],
            [0.4, bottom],
          ];
          return lv.map(([k, yy]) => {
            const q = this._inward(h, p, k);
            return new THREE.Vector3(q.x, yy, q.z);
          });
        });
        const shades = [ICE_LIP, ICE_TOP, col(ICE_MID, ICE_DEEP, 0.35), ICE_DEEP, ICE_DEEP.clone().multiplyScalar(0.2)];
        for (let i = 0; i < ring.length; i++) {
          const a = cols[i], b = cols[(i + 1) % ring.length];
          for (let k = 0; k < a.length - 1; k++) walls.quad(a[k], b[k], b[k + 1], a[k + 1], shades[k], shades[k], shades[k + 1], shades[k + 1]);
        }
        // Snow plug at the bottom.
        const mid = new THREE.Vector3(h.x, bottom + 0.05, h.z);
        const floor = new THREE.Color(0x101e2c);
        for (let i = 0; i < ring.length; i++) {
          const a = cols[i][4], b = cols[(i + 1) % ring.length][4];
          walls.tri(mid, new THREE.Vector3(b.x, bottom + 0.05, b.z), new THREE.Vector3(a.x, bottom + 0.05, a.z), floor, floor, floor);
        }
        this._rubble(h, ring, ys, bottom, rubble);
      } else {
        // A bridge: a dim crack line if you've found it, the faintest sag if not.
        const out = f.isKnown(h) ? bridges : sags;
        const mid = new THREE.Vector3(h.x, hm.heightAt(h.x, h.z) + 0.04, h.z);
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          out.tri(mid, new THREE.Vector3(b.x, hm.heightAt(b.x, b.z) + 0.04, b.z), new THREE.Vector3(a.x, hm.heightAt(a.x, a.z) + 0.04, a.z), white, white, white);
        }
      }
    }
    this.terrain.userData.setHoles?.(cut);
    for (const [mesh, tris] of [[this.holes, walls], [this.bridges, bridges], [this.sags, sags]]) {
      mesh.geometry.dispose();
      mesh.geometry = tris.geometry();
    }
    this._placeRubble(rubble);
  }

  /**
   * Blocks that have broken off the lips: strewn along the edge, some tipped
   * half over it, and now and then one wedged across the slot further down.
   */
  _rubble(h, ring, ys, bottom, out) {
    const f = this.features;
    const hm = this.hm;
    const pit = h.kind === 'pit' || h.kind === 'moulin';
    const centre = (p) => (pit ? { x: h.x, z: h.z } : TerrainFeatures.point(h, TerrainFeatures.local(h, p.x, p.z).u, 0));
    for (let i = 0; i < ring.length; i++) {
      if (rnd(h, i, 11) > 0.55) continue;
      const p = ring[i];
      const c = centre(p);
      let ox = p.x - c.x, oz = p.z - c.z;
      const len = Math.hypot(ox, oz) || 1;
      ox /= len;
      oz /= len;
      const r = 0.35 + 1.1 * rnd(h, i, 12) ** 2 * Math.min(1.5, 0.5 + h.width * 0.4);
      const d = r * 0.6 + 2.2 * rnd(h, i, 13) ** 1.5;
      const x = p.x + ox * d, z = p.z + oz * d;
      if (f.holeAt(x, z)) continue;
      out.push({ x, y: hm.heightAt(x, z), z, r, h: r * (0.5 + 0.5 * rnd(h, i, 14)), yaw: rnd(h, i, 15) * 6.283, tilt: rnd(h, i, 16), rock: h.bare && rnd(h, i, 17) < 0.35 });
    }
    // Chockstones: a block or two jammed between the walls of a crevasse.
    if (!pit) {
      const n = Math.floor(rnd(h, 99, 18) * 3);
      for (let k = 0; k < n; k++) {
        const u = (rnd(h, k, 19) - 0.5) * h.half * 1.2;
        const w = TerrainFeatures.halfWidth(h, u, 1) + TerrainFeatures.halfWidth(h, u, -1);
        if (w < 0.6) continue;
        const q = TerrainFeatures.point(h, u, 0);
        const top = hm.heightAt(q.x, q.z);
        const y = top - (top - bottom) * (0.2 + 0.4 * rnd(h, k, 20));
        const r = w * 0.4;
        out.push({ x: q.x, y, z: q.z, r, h: r * 0.8, yaw: rnd(h, k, 21) * 6.283, tilt: rnd(h, k, 22), rock: false });
      }
    }
  }

  _placeRubble(list) {
    const mesh = this.rubble;
    const n = Math.min(list.length, MAX_RUBBLE);
    const color = new THREE.Color();
    const e = new THREE.Euler();
    for (let k = 0; k < n; k++) {
      const b = list[k];
      e.set((b.tilt - 0.5) * 0.6, b.yaw, (b.tilt * 7 % 1 - 0.5) * 0.6, 'YXZ');
      _q.setFromEuler(e);
      _s.set(b.r, b.h, b.r * (0.75 + 0.4 * b.tilt));
      _p.set(b.x, b.y, b.z);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(k, _m);
      if (b.rock) color.setRGB(0.27, 0.26, 0.25);
      else color.setRGB(0.60, 0.74, 0.84).lerp(ICE_LIP, b.tilt);
      mesh.setColorAt(k, color);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** The ragged outline of a hole as a closed loop of {x, z}: one side out, the other back. */
  _outline(h) {
    const pts = [];
    const n = h.kind === 'pit' || h.kind === 'moulin' ? 12 : Math.max(14, Math.min(40, Math.round(h.half / 1.5)));
    // Spaced more closely towards the ends, where the edges curve fastest.
    const u = (i) => -h.half * Math.cos((Math.PI * i) / n);
    const at = (uu, side) => TerrainFeatures.point(h, uu, TerrainFeatures.halfWidth(h, uu, side) * side);
    for (let i = 0; i <= n; i++) pts.push(at(u(i), 1));
    for (let i = n - 1; i > 0; i--) pts.push(at(u(i), -1));
    return pts;
  }

  /** A point on the outline pulled toward the hole's middle line (k > 1 pushes it out). */
  _inward(h, p, k) {
    if (h.kind === 'pit' || h.kind === 'moulin') return { x: h.x + (p.x - h.x) * k, z: h.z + (p.z - h.z) * k };
    const { u, v } = TerrainFeatures.local(h, p.x, p.z);
    return TerrainFeatures.point(h, u * Math.min(1, 0.95 + 0.05 * k), v * k);
  }

  _towers(c) {
    const list = this.features.seracsNear(c.x, c.z, this.radius).filter((s) => s.name === 'Ice tower');
    const counts = [0, 0, 0];
    for (const s of list) {
      const k = Math.abs(Math.round(s.x * 0.37 + s.z * 0.11)) % 3;
      if (counts[k] >= 300) continue;
      this.towers[k].setMatrixAt(counts[k]++, this._blockMatrix(s));
    }
    this.towers.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
    });
  }

  /** Cornice lips along the crests: a flat top that curls over and tucks back into the lee slope. */
  _cornices() {
    const f = this.features;
    const hm = this.hm;
    const tris = new Tris();
    const white = new THREE.Color(0xffffff);
    const top = tuning.cornice_top_m;
    for (const c of f.cornices) {
      const pts = c.points;
      const lee = c.lee;
      const profile = (p) => {
        const w = p.width;
        const prof = [[-1.5, -0.4], [-0.6, top], [w * 0.55, top + 0.12], [w * 0.92, top - 0.05], [w * 1.02, -0.35], [w * 0.9, -1.1], [w * 0.6, -1.7]];
        const pts3 = prof.map(([d, h]) => new THREE.Vector3(p.x + lee.x * d, p.y + h, p.z + lee.z * d));
        // The underside tucks back into the snow of the lee slope.
        const back = new THREE.Vector3(p.x + lee.x * w * 0.15, 0, p.z + lee.z * w * 0.15);
        back.y = Math.min(p.y - 1.9, hm.heightAt(back.x, back.z) - 0.3);
        pts3.push(back);
        return pts3;
      };
      for (let i = 0; i < pts.length - 1; i++) {
        if (f.brokenCornice.has(`${c.id}:${Math.floor(i / c.section)}`)) continue;
        const a = profile(pts[i]), b = profile(pts[i + 1]);
        for (let k = 0; k < a.length - 1; k++) tris.quad(a[k], b[k], b[k + 1], a[k + 1], white);
      }
    }
    this.cornices.geometry.dispose();
    this.cornices.geometry = tris.geometry();
  }
}
