// Sky, sun and light through the day. The sun rises in the east-north-east around
// 05:30, passes high in the south at midday and sets around 19:00, as on K2 in
// summer; nights are dark blue with a little moonlight so you can still move.
// Weather greys the sky and dims the sun under cloud, and fog, cloud and
// snowstorms close the view in to the visibility of the moment.
//
// The air thins as you climb: the sky darkens toward a deep blue overhead and the
// sun burns brighter, with a wider glare around it. Around sunrise and sunset the
// sun's light turns rose on the mountain (alpenglow), the sky glows warm along the
// horizon under the sun and a pink band (the belt of Venus) lies low opposite it.

import * as THREE from 'three';
import { Clouds } from './clouds.js';

const DAY_TOP = new THREE.Color(0x3d72c4);
const DAY_FOG = new THREE.Color(0xb3c3d6);
const DUSK_TOP = new THREE.Color(0x2b3f73);
const DUSK_FOG = new THREE.Color(0xe0a98a);
const NIGHT_TOP = new THREE.Color(0x05070f);
const NIGHT_FOG = new THREE.Color(0x1a2233);
const SUN_DAY = new THREE.Color(0xfff1dc);
const SUN_LOW = new THREE.Color(0xffa060);
const MOON = new THREE.Color(0x9fb4e6);
const OVERCAST_TOP = new THREE.Color(0x7d8794);
const OVERCAST_FOG = new THREE.Color(0xb9c0c8);
const WHITEOUT = new THREE.Color(0xe4e8ec);
const HIGH_TOP = new THREE.Color(0x14398a); // the thin air's deep blue overhead
const ALPENGLOW = new THREE.Color(0xff7058);
const HORIZON_GLOW = new THREE.Color(0xff8a4c);
const BELT = new THREE.Color(0xd98fa0);
const DUSK_SKYLIGHT = new THREE.Color(0x8f93c4);
const HEMI_SKY = new THREE.Color(0xbcd0ea);
const BASE_FOG_DENSITY = 0.000035;

const SUNRISE = 5.5;
const SUNSET = 19.0;
const NOON_ELEVATION = 76; // degrees, for 36° N in early summer

const smooth = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Sun elevation (degrees, negative below the horizon) and azimuth (degrees from north). */
export function sunPosition(hour) {
  const dayFrac = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const elevation = NOON_ELEVATION * Math.sin(dayFrac * Math.PI);
  const azimuth = 65 + 230 * dayFrac; // east-north-east, through south, to west-north-west
  return { elevation, azimuth };
}

/** A short name for the time of day. */
export function partOfDay(hour) {
  if (hour < 4.5) return 'Night';
  if (hour < 6.5) return 'Dawn';
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Midday';
  if (hour < 18) return 'Afternoon';
  if (hour < 20) return 'Dusk';
  return 'Night';
}

const SKY_FRAG = /* glsl */ `
uniform vec3 top, bot, sunDir, sunCol, glowCol, beltCol;
uniform float glare, disc, glow, belt;
varying vec3 vp;
void main() {
  vec3 d = normalize(vp);
  float t = clamp(d.y * 2.2 + .05, 0., 1.);
  vec3 c = mix(bot, top, pow(t, .7));
  float mu = dot(d, sunDir);
  float up = max(d.y, 0.);
  // Warm glow along the horizon on the sun's side at sunrise and sunset.
  float side = pow(mu * .5 + .5, 3.);
  c = mix(c, glowCol, glow * side * exp(-up * 7.) * .85);
  // The belt of Venus: a rose band low in the sky opposite the sun.
  float anti = pow(max(-mu, 0.) * .6 + .4 * (1. - side), 1.5);
  c = mix(c, beltCol, belt * anti * exp(-abs(d.y - .06) * 16.));
  // Glare around the sun, a tight bright core and a soft wide halo.
  float m = max(mu, 0.);
  c += sunCol * glare * (pow(m, 1200.) * 1.4 + pow(m, 90.) * .22 + pow(m, 10.) * .07);
  // The disc itself.
  c += sunCol * disc * smoothstep(.99988, .99994, mu) * 4.;
  gl_FragColor = vec4(c, 1.);
}`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(DAY_FOG.clone(), BASE_FOG_DENSITY);
    scene.fog = this.fog;
    this.uniforms = {
      top: { value: DAY_TOP.clone() }, bot: { value: DAY_FOG.clone() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: SUN_DAY.clone() },
      glare: { value: 0 }, disc: { value: 0 },
      glowCol: { value: HORIZON_GLOW.clone() }, glow: { value: 0 },
      beltCol: { value: BELT.clone() }, belt: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(120000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: 'varying vec3 vp; void main(){ vp=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: SKY_FRAG,
      }),
    );
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.hemi = new THREE.HemisphereLight(0xbcd0ea, 0x5a4d40, 0.8);
    scene.add(this.sun, this.sun.target, this.hemi);
    this.dir = new THREE.Vector3();
    this.trueDir = new THREE.Vector3();
    this.clouds = null;
    this._light = { sunDir: this.trueDir, sunColor: this.sun.color, sunIntensity: 1, ambient: new THREE.Color(), fogColor: this.fog.color, fogDensity: 0, day: 1 };
  }

  /** Once the heightmap is in: cloud layers that the mountain stands through. */
  setTerrain(hm) {
    this.clouds = new Clouds(hm);
    this.scene.add(this.clouds);
  }

  /**
   * Move the sun and recolour the sky for an hour of the day, around the player.
   * @param weather the climber's conditions (cloud, visibility, snowfall), or null
   */
  update(hour, playerPos, cameraPos, weather = null) {
    const { elevation, azimuth } = sunPosition(hour);
    const day = smooth(-6, 8, elevation); // 0 at night, 1 in full day
    const low = 1 - smooth(4, 25, elevation); // reddening near the horizon
    const el = (Math.max(elevation, 8) * Math.PI) / 180; // light never comes from below
    const az = (azimuth * Math.PI) / 180;
    const elTrue = (elevation * Math.PI) / 180;
    this.trueDir.set(Math.sin(az) * Math.cos(elTrue), Math.sin(elTrue), -Math.cos(az) * Math.cos(elTrue));
    // Alpenglow: the low sun's rose light, strongest from just before sunrise to a
    // few degrees up, and again at sunset. High on the mountain it lasts a little
    // longer, since you see the sun over a lower horizon.
    const alt = smooth(4500, 8600, playerPos.y);
    const glow = smooth(-4 - 2 * alt, 0.5, elevation) * (1 - smooth(4, 15, elevation));
    if (day > 0.02) {
      this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    } else {
      this.dir.set(0.3, 0.8, 0.45).normalize(); // moonlight from the south
    }
    this.sun.position.copy(playerPos).addScaledVector(this.dir, 300);
    this.sun.target.position.copy(playerPos);
    this.sun.color.copy(MOON).lerp(SUN_DAY, day).lerp(SUN_LOW, low * day * 0.8).lerp(ALPENGLOW, glow * 0.75);
    // Thinner air above lets more of the sun through.
    this.sun.intensity = (0.25 + 2.05 * day) * (1 + 0.12 * alt);
    this.sun.intensity = Math.max(this.sun.intensity, 1.5 * glow);
    this.hemi.intensity = 0.12 + 0.68 * day;
    // Shade goes cool and violet at dusk, so the rose light stands out against it.
    this.hemi.color.copy(HEMI_SKY).lerp(DUSK_SKYLIGHT, glow * 0.7);

    const top = this.uniforms.top.value.copy(NIGHT_TOP).lerp(DUSK_TOP, smooth(-8, 0, elevation)).lerp(DAY_TOP, smooth(2, 15, elevation));
    top.lerp(HIGH_TOP.clone().multiplyScalar(0.3 + 0.7 * day), alt * 0.6 * day);
    const u = this.uniforms;
    let clear = 1;
    const fog = this.uniforms.bot.value.copy(NIGHT_FOG).lerp(DUSK_FOG, smooth(-8, 0, elevation)).lerp(DAY_FOG, smooth(2, 15, elevation));
    if (weather) {
      // Cloud cover greys the sky and takes the sun's direct light away.
      const overcast = weather.cloud;
      clear = 1 - smooth(0.5, 1, overcast);
      const grey = 0.25 + 0.75 * day;
      top.lerp(OVERCAST_TOP.clone().multiplyScalar(grey), Math.min(1, overcast * 1.2));
      fog.lerp(OVERCAST_FOG.clone().multiplyScalar(grey), overcast * 0.8);
      this.sun.intensity *= 1 - 0.85 * overcast;
      this.hemi.intensity *= 1 + 0.4 * overcast * day;
      // In thick fog, cloud or a whiteout the sky and the ground merge into one.
      const thick = smooth(3000, 60, weather.visibility);
      fog.lerp(WHITEOUT.clone().multiplyScalar(0.2 + 0.8 * day), thick * 0.8);
      top.lerp(fog, thick);
      clear *= 1 - thick;
      this.sun.castShadow = overcast < 0.85;
      // Exponential fog that leaves about 2% contrast at the visibility distance.
      // Seen from behind, the climber stays in view: the fog starts closing in at
      // your own position, so you still see only a few metres past yourself.
      const seen = weather.visibility + 1.5 * playerPos.distanceTo(cameraPos);
      this.fog.density = Math.max(BASE_FOG_DENSITY, 1.98 / seen);
    } else {
      this.fog.density = BASE_FOG_DENSITY;
    }
    this.fog.color.copy(fog);
    this.dome.position.copy(cameraPos);

    // The sun in the sky: its disc, the glare around it (wider and brighter up
    // high), a warm horizon under it and the belt of Venus opposite at dusk.
    u.sunDir.value.copy(this.trueDir);
    u.sunCol.value.copy(SUN_DAY).lerp(SUN_LOW, low * 0.7).lerp(ALPENGLOW, glow * 0.4);
    u.disc.value = clear * smooth(-1.5, 0.5, elevation);
    u.glare.value = clear * day * (0.45 + 0.85 * alt);
    u.glow.value = clear * glow * 0.9;
    u.belt.value = clear * glow * 0.55;

    if (this.clouds) {
      const L = this._light;
      L.sunIntensity = this.sun.intensity;
      L.ambient.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
      L.fogDensity = this.fog.density;
      L.day = day;
      this.clouds.update(cameraPos, L, weather);
    }
    return { top, day };
  }
}
