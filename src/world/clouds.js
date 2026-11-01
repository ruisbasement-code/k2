// Cloud layers: soft sheets of cloud at fixed heights that the mountain stands
// through. Valley cloud sits a little above Base Camp and pools in the glaciers on
// fair days, the weather's cloud band (cloud_base_m to cloud_top_m) closes in on
// cloudy days, and high cirrus streaks the sky. Climb above a layer and it lies
// below you as a sea of cloud.
//
// Each layer is a large flat sheet that follows the camera, with the cloud shapes
// fixed to the ground and drifting downwind. The shapes are smooth noise whose
// finer octaves fade out with distance, so far cloud stays soft instead of
// shimmering. Cloud thins out where the ground rises to meet it, so a slope fades
// into the layer instead of cutting a hard line through it.

import * as THREE from 'three';
import W from '../data/weather.json';

const RADIUS = 60000; // metres: how far a layer reaches from the camera

/**
 * The layers. cover: sky cover on a clear day and how much more full cloud adds.
 * scale: size of the cloud shapes, metres. stretch: drawn out east to west, along the prevailing westerly.
 */
const LAYERS = [
  { name: 'cirrus', y: 10800, scale: 5200, stretch: [3.2, 1], clear: 0.32, cloudy: 0.55, opacity: 0.55, drift: 30, soft: 0.4 },
  { name: 'band-top', y: W.cloud_top_m - 80, scale: 2600, stretch: [1.3, 1], clear: 0.0, cloudy: 0.85, opacity: 0.95, drift: 14, soft: 0.22, band: true },
  { name: 'band-base', y: W.cloud_base_m + 60, scale: 2600, stretch: [1.3, 1], clear: 0.0, cloudy: 0.85, opacity: 0.95, drift: 14, soft: 0.22, band: true },
  { name: 'valley', y: 5650, scale: 1500, stretch: [1.15, 1], clear: 0.34, cloudy: 0.3, opacity: 0.9, drift: 9, soft: 0.2 },
];

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uY, uScale, uCover, uOpacity, uSoft, uRadius, uFogDen, uDay;
uniform vec2 uOff, uStretch;
uniform vec3 uCam, uSunDir, uSunCol, uAmb, uFogCol;
uniform sampler2D uH;
uniform float uHn, uCell, uHalf, uOuter;
varying vec3 vW;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// Smooth fbm; each octave fades out once it would be finer than a pixel.
float fbm(vec2 p, float fw) {
  float s = 0.0, a = 0.5, f = 1.0, norm = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) {
    float lod = 1.0 - smoothstep(0.15, 0.6, fw * f);
    s += a * lod * vnoise(p * f);
    s += a * (1.0 - lod) * 0.5;
    norm += a;
    p = r * p + 17.0;
    f *= 2.03; a *= 0.5;
  }
  return s / norm;
}
float texel(vec2 rc) { return texture2D(uH, (clamp(rc, 0.0, uHn - 1.0) + 0.5) / uHn).r; }
float ground(vec2 xz) {
  vec2 rc = xz / uCell + uHalf;
  if (rc.x < 0.0 || rc.y < 0.0 || rc.x > uHn - 1.0 || rc.y > uHn - 1.0) return uOuter;
  vec2 i = floor(rc), f = rc - i;
  return mix(mix(texel(i), texel(i + vec2(1, 0)), f.x), mix(texel(i + vec2(0, 1)), texel(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  #include <logdepthbuf_fragment>
  // Cloud coordinates: fixed to the ground and drifting downwind.
  vec2 q = (vW.xz + uOff) / (uScale * uStretch);
  float fw = length(fwidth(q));
  float d = fbm(q, fw);
  float edge = 1.0 - uCover;
  float a = smoothstep(edge, edge + uSoft, d);
  if (a < 0.003) discard;
  // Light: thicker cloud toward the sun shades this side; seen from below it is greyer.
  vec2 sd = uSunDir.xz / uStretch;
  float d2 = fbm(q + sd * 0.07, fw);
  float lit = clamp(1.0 - (d2 - d) * 5.0, 0.35, 1.0);
  float below = step(uCam.y, uY);
  float thick = smoothstep(edge, edge + 0.45, d);
  float sunUp = max(uSunDir.y, 0.0);
  vec3 col = uAmb * 0.9 + uSunCol * lit * (0.25 + 0.55 * mix(1.0, sunUp, 0.5));
  col *= 1.0 - below * thick * 0.45;
  // Thin edges glow when the sun is behind them.
  vec3 v = normalize(vW - uCam);
  float behind = pow(max(dot(v, uSunDir), 0.0), 8.0);
  col += uSunCol * behind * (1.0 - thick) * 0.6;

  a *= uOpacity;
  // Thin out where the ground rises into the layer, at the far edge, and when the
  // eye is level with the sheet (seen edge on it would be a hard line).
  a *= smoothstep(0.0, 260.0, uY - ground(vW.xz));
  float r = length(vW.xz - uCam.xz);
  a *= 1.0 - smoothstep(uRadius * 0.45, uRadius * 0.95, r);
  a *= smoothstep(40.0, 260.0, abs(uCam.y - uY));
  if (a < 0.003) discard;

  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float dist = length(vW - uCam);
  float fogF = 1.0 - exp(-uFogDen * uFogDen * dist * dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogCol, fogF);
  gl_FragColor.a *= 1.0 - fogF * 0.85;
}`;

export class Clouds extends THREE.Group {
  constructor(hm) {
    super();
    this.frustumCulled = false;
    const tex = new THREE.DataTexture(hm.h, hm.n, hm.n, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(RADIUS * 2, RADIUS * 2, 1, 1).rotateX(-Math.PI / 2);
    this.layers = LAYERS.map((L, i) => {
      const uniforms = {
        uY: { value: L.y }, uScale: { value: L.scale }, uStretch: { value: new THREE.Vector2(...L.stretch) },
        uCover: { value: L.clear }, uOpacity: { value: L.opacity }, uSoft: { value: L.soft }, uRadius: { value: RADIUS },
        uOff: { value: new THREE.Vector2(i * 7919, i * 3571) },
        uCam: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
        uFogCol: { value: new THREE.Color() }, uFogDen: { value: 0 }, uDay: { value: 1 },
        uH: { value: tex }, uHn: { value: hm.n }, uCell: { value: hm.cell }, uHalf: { value: hm.half }, uOuter: { value: 4550 },
      };
      const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      mesh.position.y = L.y;
      this.add(mesh);
      return { ...L, mesh, u: uniforms };
    });
    this._last = performance.now();
  }

  /**
   * Follow the camera, drift with the wind and take the light of the moment.
   * @param light { sunDir, sunColor, sunIntensity, ambient, fogColor, fogDensity, day }
   */
  update(cameraPos, light, weather) {
    const now = performance.now();
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    const cloud = weather ? weather.cloud : 0.05;
    const wx = weather ? weather.windX : 1, wz = weather ? weather.windZ : 0;
    // Farther layers draw first so nearer cloud lies over them.
    const order = [...this.layers].sort((a, b) => Math.abs(b.y - cameraPos.y) - Math.abs(a.y - cameraPos.y));
    for (const L of this.layers) {
      const u = L.u;
      L.mesh.position.set(cameraPos.x, L.y, cameraPos.z);
      L.mesh.renderOrder = -10 + order.indexOf(L);
      const k = L.band ? smooth(0.45, 0.9, cloud) : Math.min(cloud / 0.65, 1);
      u.uCover.value = Math.min(L.clear + (L.cloudy - L.clear) * k, 0.92);
      L.mesh.visible = u.uCover.value > 0.02;
      u.uOff.value.x -= wx * L.drift * dt;
      u.uOff.value.y -= wz * L.drift * dt;
      u.uCam.value.copy(cameraPos);
      u.uSunDir.value.copy(light.sunDir);
      u.uSunCol.value.copy(light.sunColor).multiplyScalar(light.sunIntensity);
      u.uAmb.value.copy(light.ambient);
      u.uFogCol.value.copy(light.fogColor);
      u.uFogDen.value = light.fogDensity;
      u.uDay.value = light.day;
    }
  }
}

function smooth(e0, e1, x) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}
