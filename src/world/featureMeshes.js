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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const ICE_TOP = new THREE.Color(0x7fb6d2);
const ICE_MID = new THREE.Color(0x2b6a96);
const ICE_DEEP = new THREE.Color(0x050d18);

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
  vec3 ice = mix(deep, pale, band * 0.7 + flute * 0.3);
  ice = mix(ice, vec3(0.36, 0.38, 0.40), seam * 0.6);
  diffuseColor.rgb = ice * glow * 1.15;
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
    this.radius = 600;
    this.centre = new THREE.Vector3(1e9, 0, 1e9);
    this.version = -1;

    // Light glows blue through the ice walls, so they're lit from within rather than by the sun.
    this.holeMat = iceWallMaterial();
    this.lipMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
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
    this.lips = new THREE.Mesh(new THREE.BufferGeometry(), this.lipMat);
    this.lips.castShadow = this.lips.receiveShadow = true;
    this.lips.frustumCulled = false;
    this.add(this.lips);
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
   * wanded trail, then up beside the fixed rope. They glow at night and through
   * storms (no fog on the glow), so the way stays visible.
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
    const n = spots.length;
    const post = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.05, 1.3, 6).translate(0, 0.65, 0),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.5 }), n);
    const lamp = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.11, 10, 8).translate(0, 1.38, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false }), n);
    spots.forEach((p, i) => {
      _m.makeTranslation(p.x, p.y - 0.15, p.z);
      post.setMatrixAt(i, _m);
      lamp.setMatrixAt(i, _m);
    });
    for (const m of [post, lamp]) {
      m.computeBoundingSphere();
      this.add(m);
    }
    post.castShadow = true;
    // The glow: a soft warm halo around each lamp, drawn over the fog.
    // A halo that scales with distance, and a small core that stays a few pixels
    // wide however far away, so the line of lights reads across the glacier.
    const at = new THREE.BufferGeometry().setFromPoints(spots.map((p) => new THREE.Vector3(p.x, p.y + 1.23, p.z)));
    const map = glowTexture();
    const glow = (size, attenuate, color) => {
      const pts = new THREE.Points(at, new THREE.PointsMaterial({
        size, sizeAttenuation: attenuate, map, color,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      }));
      pts.frustumCulled = false;
      this.add(pts);
    };
    glow(5, true, 0xffb85c);
    glow(7, false, 0xffd9a0);
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
  update(position) {
    this.icefall.update();
    const moved = Math.hypot(position.x - this.centre.x, position.z - this.centre.z) > 60;
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
    const lips = new Tris();
    const bridges = new Tris();
    const sags = new Tris();
    const cut = [];
    const holes = f.holesNear(c.x, c.z, this.radius).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    const white = new THREE.Color(0xffffff);
    for (const h of holes) {
      const open = f.isOpen(h);
      if (open && cut.length >= MAX_TERRAIN_HOLES) continue;
      // Points along both edges of the lens (or round the circle for a pit).
      const ring = this._outline(h);
      if (open) {
        cut.push(h);
        const ys = ring.map((p) => hm.heightAt(p.x, p.z));
        const rim = Math.min(...ys);
        const bottom = rim - h.depth;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const ya = ys[i], yb = ys[(i + 1) % ring.length];
          // The walls narrow as they go down, so draw them leaning in.
          const ia = this._inward(h, a, 0.45), ib = this._inward(h, b, 0.45);
          // Pale where the light gets in near the lip, deep blue a few metres down, dark below.
          const ma = this._inward(h, a, 0.9), mb = this._inward(h, b, 0.9);
          const band = Math.min(2, h.depth * 0.15);
          walls.quad(
            new THREE.Vector3(a.x, ya + 0.05, a.z), new THREE.Vector3(b.x, yb + 0.05, b.z),
            new THREE.Vector3(mb.x, yb - band, mb.z), new THREE.Vector3(ma.x, ya - band, ma.z),
            ICE_TOP, ICE_TOP, ICE_MID, ICE_MID,
          );
          walls.quad(
            new THREE.Vector3(ma.x, ya - band, ma.z), new THREE.Vector3(mb.x, yb - band, mb.z),
            new THREE.Vector3(ib.x, bottom, ib.z), new THREE.Vector3(ia.x, bottom, ia.z),
            ICE_MID, ICE_MID, ICE_DEEP, ICE_DEEP,
          );
        }
        // Snow lips only where there's snow: bare ice just breaks off at the edge.
        if (!h.bare) this._lips(h, ring, ys, lips);
        // Snow plug at the bottom.
        const mid = new THREE.Vector3(h.x, bottom + 0.05, h.z);
        const floor = new THREE.Color(0x2e4a63);
        for (let i = 0; i < ring.length; i++) {
          const a = this._inward(h, ring[i], 0.45), b = this._inward(h, ring[(i + 1) % ring.length], 0.45);
          walls.tri(mid, new THREE.Vector3(b.x, bottom + 0.05, b.z), new THREE.Vector3(a.x, bottom + 0.05, a.z), floor, floor, floor);
        }
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
    for (const [mesh, tris] of [[this.holes, walls], [this.lips, lips], [this.bridges, bridges], [this.sags, sags]]) {
      mesh.geometry.dispose();
      mesh.geometry = tris.geometry();
    }
  }

  /**
   * Rounded snow lips along the edge: the snow on the glacier surface curls over
   * and overhangs the slot a little, thickest in the middle of a crevasse.
   */
  _lips(h, ring, ys, tris) {
    const hm = this.hm;
    const snow = new THREE.Color(0xdfe5ec), shade = new THREE.Color(0xa9bfd0);
    const pit = h.kind === 'pit' || h.kind === 'moulin';
    // Cross-section from the open snow (out) over the crest to the hanging lip (in).
    const profile = [[0.35, -0.03], [0.12, 0.08], [0.0, 0.12], [-0.18, 0.05], [-0.26, -0.2]];
    const rows = ring.map((p, i) => {
      const { u } = pit ? { u: 0 } : TerrainFeatures.local(h, p.x, p.z);
      const thick = pit ? 0.8 : 0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - (u / h.half) ** 2));
      // Outward from the hole's middle line, in the ground plane.
      const c = pit ? { x: h.x, z: h.z } : TerrainFeatures.point(h, u, 0);
      let ox = p.x - c.x, oz = p.z - c.z;
      const len = Math.hypot(ox, oz) || 1;
      ox /= len;
      oz /= len;
      return profile.map(([d, up]) => {
        const reach = d * thick;
        const x = p.x + ox * reach, z = p.z + oz * reach;
        const ground = d > 0.1 ? hm.heightAt(x, z) : ys[i];
        return new THREE.Vector3(x, ground + 0.02 + up * thick, z);
      });
    });
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i], b = rows[(i + 1) % rows.length];
      for (let k = 0; k < a.length - 1; k++) {
        const c0 = k >= 3 ? shade : snow;
        tris.quad(a[k], b[k], b[k + 1], a[k + 1], c0);
      }
    }
  }

  /** The outline of a hole as a closed loop of {x, z}. */
  _outline(h) {
    const pts = [];
    const n = 14;
    if (h.kind === 'pit' || h.kind === 'moulin') {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: h.x + Math.cos(a) * h.width, z: h.z + Math.sin(a) * h.width });
      }
      return pts;
    }
    const at = (u, side) => TerrainFeatures.point(h, u, TerrainFeatures.halfWidth(h, u) * side);
    for (let i = 0; i <= n; i++) pts.push(at(-h.half + (2 * h.half * i) / n, 1));
    for (let i = n - 1; i > 0; i--) pts.push(at(-h.half + (2 * h.half * i) / n, -1));
    return pts;
  }

  /** A point on the outline pulled toward the hole's middle line. */
  _inward(h, p, k) {
    if (h.kind === 'pit' || h.kind === 'moulin') return { x: h.x + (p.x - h.x) * k, z: h.z + (p.z - h.z) * k };
    const { u, v } = TerrainFeatures.local(h, p.x, p.z);
    return TerrainFeatures.point(h, u * 0.95, v * k);
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
