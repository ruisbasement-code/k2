// Sky, sun and light through the day. The sun rises in the east-north-east around
// 05:30, passes high in the south at midday and sets around 19:00, as on K2 in
// summer; nights are dark blue with a little moonlight so you can still move.
// Weather greys the sky and dims the sun under cloud, and fog, cloud and
// snowstorms close the view in to the visibility of the moment.

import * as THREE from 'three';

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

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(DAY_FOG.clone(), BASE_FOG_DENSITY);
    scene.fog = this.fog;
    this.uniforms = { top: { value: DAY_TOP.clone() }, bot: { value: DAY_FOG.clone() } };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(120000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: 'varying vec3 vp; void main(){ vp=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform vec3 top,bot; varying vec3 vp; void main(){ float t=clamp(vp.y*2.2+.05,0.,1.); gl_FragColor=vec4(mix(bot,top,pow(t,.7)),1.); }',
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
    if (day > 0.02) {
      this.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    } else {
      this.dir.set(0.3, 0.8, 0.45).normalize(); // moonlight from the south
    }
    this.sun.position.copy(playerPos).addScaledVector(this.dir, 300);
    this.sun.target.position.copy(playerPos);
    this.sun.color.copy(MOON).lerp(SUN_DAY, day).lerp(SUN_LOW, low * day * 0.8);
    this.sun.intensity = 0.25 + 2.05 * day;
    this.hemi.intensity = 0.12 + 0.68 * day;

    const top = this.uniforms.top.value.copy(NIGHT_TOP).lerp(DUSK_TOP, smooth(-8, 0, elevation)).lerp(DAY_TOP, smooth(2, 15, elevation));
    const fog = this.uniforms.bot.value.copy(NIGHT_FOG).lerp(DUSK_FOG, smooth(-8, 0, elevation)).lerp(DAY_FOG, smooth(2, 15, elevation));
    if (weather) {
      // Cloud cover greys the sky and takes the sun's direct light away.
      const overcast = weather.cloud;
      const grey = 0.25 + 0.75 * day;
      top.lerp(OVERCAST_TOP.clone().multiplyScalar(grey), Math.min(1, overcast * 1.2));
      fog.lerp(OVERCAST_FOG.clone().multiplyScalar(grey), overcast * 0.8);
      this.sun.intensity *= 1 - 0.85 * overcast;
      this.hemi.intensity *= 1 + 0.4 * overcast * day;
      // In thick fog, cloud or a whiteout the sky and the ground merge into one.
      const thick = smooth(3000, 60, weather.visibility);
      fog.lerp(WHITEOUT.clone().multiplyScalar(0.2 + 0.8 * day), thick * 0.8);
      top.lerp(fog, thick);
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
    return { top, day };
  }
}
