// The mountain's own shadows and the shade of its hollows.
//
// The sun's shadow map only reaches 60 m around the climber, so on its own a ridge
// never darkens the face behind it and a gully is lit like an open slope, and the
// whole mountain reads flat. Here, once at start-up, the GPU walks out from every
// point of the terrain in 16 compass directions and records how high the skyline
// stands in each (a horizon map). Then any surface can tell, for any sun, whether
// the mountain hides it (the sun is below the skyline that way) and how much of the
// sky it sees (ambient occlusion: darker in gullies, chimneys and under steps).
//
// Two maps: a coarse one over the whole 20 km of data, and a sharper one over the
// fine terrain of the Abruzzi side (fineTerrain.js), so a bench or buttress casts
// its own shadow onto the slope below it.

import * as THREE from 'three';

const DIRS = 16;
const COARSE_SIZE = 512;
const FINE_SIZE = 768;

export class HorizonMaps {
  constructor(renderer, hm) {
    const coarseTex = heightTexture(hm.h, hm.n);
    const f = hm.fine;
    const fineTex = f ? heightTexture(f.h, f.n) : coarseTex;
    const src = {
      uHC: { value: coarseTex },
      uHCn: { value: hm.n },
      uCell: { value: hm.cell },
      uHalf: { value: hm.half },
      uHF: { value: fineTex },
      uHFn: { value: f ? f.n : 2 },
      uHFo: { value: new THREE.Vector3(f ? f.x0 : 0, f ? f.z0 : 0, f ? f.step : 1) },
    };
    const lim = hm.size / 2;
    this.coarseRect = new THREE.Vector4(-lim, -lim, lim, lim);
    this.fineRect = f
      ? new THREE.Vector4(f.x0, f.z0, f.x0 + (f.n - 1) * f.step, f.z0 + (f.n - 1) * f.step)
      : new THREE.Vector4(1e9, 1e9, 1e9, 1e9);
    const coarse = bake(renderer, src, this.coarseRect, COARSE_SIZE, false, hm.cell);
    const fine = f ? bake(renderer, src, this.fineRect, FINE_SIZE, true, f.step * 0.6) : coarse;
    coarseTex.dispose();
    if (fineTex !== coarseTex) fineTex.dispose();
    this.uniforms = {
      uHzC0: { value: coarse[0] }, uHzC1: { value: coarse[1] }, uHzC2: { value: coarse[2] }, uHzC3: { value: coarse[3] },
      uHzF0: { value: fine[0] }, uHzF1: { value: fine[1] }, uHzF2: { value: fine[2] }, uHzF3: { value: fine[3] },
      uHzCRect: { value: this.coarseRect },
      uHzFRect: { value: this.fineRect },
    };
  }

  /**
   * Shade a lit material (standard, physical, lambert or phong) with the terrain's
   * shadows: the directional lights (sun and moon) are hidden behind the skyline,
   * and the sky's light is dimmed in hollows. Works with instanced and skinned meshes
   * and with a material's own onBeforeCompile.
   */
  shade(material) {
    if (material.userData.horizon) return material;
    material.userData.horizon = true;
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    const u = this.uniforms;
    material.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(material, sh, r);
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHzW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
vec4 hzWP = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
hzWP = instanceMatrix * hzWP;
#endif
vHzW = (modelMatrix * hzWP).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${HORIZON_GLSL}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nhzLoad(vHzW.xz);')
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= hzSun( inverseTransformDirection( directLight.direction, viewMatrix ) );',
        ))
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= hzAO;
reflectedLight.indirectSpecular *= mix(1.0, hzAO, 0.7);`);
    };
    material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-horizon`;
    material.needsUpdate = true;
    return material;
  }

  /** Shade every lit material under obj (see shade). */
  shadeAll(obj) {
    obj.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) this.shade(m);
      }
    });
  }
}

/** Heights as a float texture, row r at y = r, column c at x = c. */
function heightTexture(h, n) {
  const t = new THREE.DataTexture(h, n, n, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Bakes the skyline's elevation, as a share of 90 degrees, in DIRS compass
 * directions (azimuth k * 360 / DIRS, clockwise from north) into four RGBA targets.
 */
function bake(renderer, src, rect, size, useFine, firstStep) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...src,
      uRect: { value: rect },
      uBase: { value: 0 },
      uFine: { value: useFine ? 1 : 0 },
      uFirst: { value: firstStep },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BAKE_GLSL,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const targets = [];
  const prev = renderer.getRenderTarget();
  for (let k = 0; k < 4; k++) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    mat.uniforms.uBase.value = k * 4;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    targets.push(rt.texture);
  }
  renderer.setRenderTarget(prev);
  mat.dispose();
  return targets;
}

const BAKE_GLSL = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uHC;
uniform float uHCn;
uniform float uCell;
uniform float uHalf;
uniform sampler2D uHF;
uniform float uHFn;
uniform vec3 uHFo;
uniform vec4 uRect;
uniform float uBase;
uniform float uFine;
uniform float uFirst;
varying vec2 vUv;

float bilerp(sampler2D t, vec2 g, float n) {
  g = clamp(g, vec2(0.0), vec2(n - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float a = texelFetch(t, i, 0).r, b = texelFetch(t, i + ivec2(1, 0), 0).r;
  float c = texelFetch(t, i + ivec2(0, 1), 0).r, d = texelFetch(t, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float heightAt(vec2 p) {
  if (uFine > 0.5) {
    vec2 g = (p - uHFo.xy) / uHFo.z;
    if (g.x >= 0.0 && g.y >= 0.0 && g.x < uHFn - 1.0 && g.y < uHFn - 1.0) return bilerp(uHF, g, uHFn);
  }
  return bilerp(uHC, p / uCell + uHalf, uHCn);
}

float horizon(vec2 p, float h0, float az) {
  vec2 dir = vec2(sin(az), -cos(az));
  float best = 0.0;
  float d = uFirst;
  for (int k = 0; k < 72; k++) {
    // The earth curves away: about 18 m over 15 km.
    float t = (heightAt(p + dir * d) - h0 - d * d * 7.85e-8) / d;
    best = max(best, t);
    d *= 1.12;
    if (d > 16000.0) break;
  }
  return atan(best) / 1.5707963;
}

void main() {
  vec2 p = mix(uRect.xy, uRect.zw, vUv);
  // A little above the ground, so a slope does not shadow itself.
  float h0 = heightAt(p) + 1.5;
  vec4 o;
  for (int c = 0; c < 4; c++) {
    float az = (uBase + float(c)) * 6.2831853 / ${DIRS}.0;
    o[c] = horizon(p, h0, az);
  }
  gl_FragColor = o;
}
`;

const HORIZON_GLSL = /* glsl */ `
varying vec3 vHzW;
uniform sampler2D uHzC0;
uniform sampler2D uHzC1;
uniform sampler2D uHzC2;
uniform sampler2D uHzC3;
uniform sampler2D uHzF0;
uniform sampler2D uHzF1;
uniform sampler2D uHzF2;
uniform sampler2D uHzF3;
uniform vec4 uHzCRect;
uniform vec4 uHzFRect;
float hzA[${DIRS}];
float hzAO = 1.0;

void hzPut(vec4 a, vec4 b, vec4 c, vec4 d, float w) {
  for (int k = 0; k < 4; k++) {
    hzA[k] += a[k] * w;
    hzA[k + 4] += b[k] * w;
    hzA[k + 8] += c[k] * w;
    hzA[k + 12] += d[k] * w;
  }
}

// Read the skyline around this point, sharp map where there is one.
void hzLoad(vec2 xz) {
  for (int k = 0; k < ${DIRS}; k++) hzA[k] = 0.0;
  vec2 fuv = (xz - uHzFRect.xy) / (uHzFRect.zw - uHzFRect.xy);
  // Hand over from the sharp map to the coarse one over its outer 4 percent.
  vec2 e = min(fuv, 1.0 - fuv);
  float wf = smoothstep(0.0, 0.04, min(e.x, e.y));
  if (wf > 0.0) hzPut(texture2D(uHzF0, fuv), texture2D(uHzF1, fuv), texture2D(uHzF2, fuv), texture2D(uHzF3, fuv), wf);
  if (wf < 1.0) {
    // Beyond the data (the far plain) there is nothing to cast a shadow: fade out.
    vec2 cuv = (xz - uHzCRect.xy) / (uHzCRect.zw - uHzCRect.xy);
    vec2 ce = min(cuv, 1.0 - cuv);
    float wc = (1.0 - wf) * smoothstep(-0.01, 0.01, min(ce.x, ce.y));
    cuv = clamp(cuv, 0.0, 1.0);
    if (wc > 0.0) hzPut(texture2D(uHzC0, cuv), texture2D(uHzC1, cuv), texture2D(uHzC2, cuv), texture2D(uHzC3, cuv), wc);
  }
  // Share of the sky seen: open to the zenith, less as the skyline rises.
  float sky = 0.0;
  for (int k = 0; k < ${DIRS}; k++) {
    float s = sin(hzA[k] * 1.5707963);
    sky += 1.0 - s * s;
  }
  sky /= ${DIRS}.0;
  // Open ground keeps its light; gullies and the feet of walls go a good deal darker.
  hzAO = mix(0.35, 1.0, smoothstep(0.35, 0.95, sky));
}

// How much of a light coming from world direction dir gets past the skyline.
float hzSun(vec3 dir) {
  float az = atan(dir.x, -dir.z);
  if (az < 0.0) az += 6.2831853;
  float u = az / 6.2831853 * ${DIRS}.0;
  int i0 = int(floor(u)) % ${DIRS};
  int i1 = (i0 + 1) % ${DIRS};
  float hz = mix(hzA[i0], hzA[i1], fract(u)) * 1.5707963;
  float el = asin(clamp(dir.y, -1.0, 1.0));
  // A soft edge, about the sun's width and the map's blur.
  return smoothstep(hz - 0.012, hz + 0.03, el);
}
`;
