// Boots the K2 scene: loads the heightmap, builds the terrain, ropes and camps,
// puts the climber at Base Camp and runs the game loop.
//
// For screenshots and testing, URL parameters set up a view, e.g.
// ?place=3&rope&yaw=200&pitch=10&dist=8&fp&fly=600&start

import * as THREE from 'three';
import './style.css';
import route from './data/route.json';
import { Heightmap } from './world/heightmap.js';
import { createTerrain } from './world/terrain.js';
import { FixedRopes } from './world/fixedRopes.js';
import { createCamps } from './world/camps.js';
import { Climber, Mode } from './player/climber.js';
import { ClimberModel } from './player/climberModel.js';
import { BreathAudio } from './player/breathAudio.js';
import { Input } from './player/input.js';
import { Hud } from './ui/hud.js';

const EYE_HEIGHT = 1.65;
const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.55).normalize(); // afternoon sun from the south-west
const FOG = new THREE.Color(0xb3c3d6);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.000035);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 150000);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(120000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d72c4) }, bot: { value: FOG } },
    vertexShader: 'varying vec3 vp; void main(){ vp=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top,bot; varying vec3 vp; void main(){ float t=clamp(vp.y*2.2+.05,0.,1.); gl_FragColor=vec4(mix(bot,top,pow(t,.7)),1.); }',
  }),
);
scene.add(sky);

const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 600 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbcd0ea, 0x5a4d40, 0.8));

const params = new URLSearchParams(location.search);
const loading = document.getElementById('loading');
const hm = await Heightmap.load();
scene.add(createTerrain(hm));
const ropes = new FixedRopes(hm, route.fixed_ropes);
scene.add(ropes.createMesh());
scene.add(createCamps(hm, route.places));

const climber = new Climber(hm, ropes);
const model = new ClimberModel();
scene.add(model);
const hud = new Hud(hm, climber, route.places);
climber.onMessage = (t) => hud.showMessage(t);
const audio = new BreathAudio(climber.body);
const input = new Input(canvas);
const view = { pitch: -0.2, distance: 7, firstPerson: false, gait: 0 };

function teleport(i) {
  const p = route.places[i];
  if (!p) return;
  const [x, z] = hm.gridToWorld(p.r, p.c);
  const [fx, fz] = p.name === 'Summit' ? [0, 1000] : [0, 0];
  climber.placeAt(x, z, fx, fz);
  hud.showMessage(`${p.name}: ${p.note}`);
}

for (let i = 0; i < 9; i++) input.on(`Digit${i + 1}`, () => teleport(i));
input.on('KeyC', () => climber.toggleClip());
input.on('KeyV', () => { view.firstPerson = !view.firstPerson; });
input.on('KeyT', () => climber.cycleTimeScale());
input.on('KeyF', () => climber.toggleFly());
input.on('KeyM', () => { audio.muted = !audio.muted; hud.showMessage(audio.muted ? 'Breathing muted' : 'Breathing on'); });

teleport(0);
hud.showMessage('K2 Base Camp, 5,000 m. The fixed ropes start at Advanced Base Camp (2).');
if (params.has('place')) teleport(+params.get('place'));
if (params.has('rope')) climber.toggleClip();
if (params.has('yaw')) climber.yaw = (+params.get('yaw') * Math.PI) / 180;
if (params.has('pitch')) view.pitch = (+params.get('pitch') * Math.PI) / 180;
if (params.has('dist')) view.distance = +params.get('dist');
if (params.has('fp')) view.firstPerson = true;
if (params.has('fly')) { climber.toggleFly(); climber.position.y += +params.get('fly'); }

loading.remove();
const start = document.getElementById('start');
document.getElementById('go').onclick = () => {
  start.remove();
  audio.start();
  canvas.requestPointerLock?.();
};
if (params.has('start')) start.remove();

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

function updateCamera() {
  const look = input.takeLook();
  climber.yaw -= look.dx * 0.0025;
  view.pitch = Math.min(Math.max(view.pitch - look.dy * 0.0025, -1.45), 1.2);
  if (look.zoom) view.distance = Math.min(Math.max(view.distance * (1 + look.zoom * 0.12), 2), 80);
  const p = climber.position;
  _eye.set(p.x, p.y + EYE_HEIGHT, p.z);
  _dir.set(-Math.sin(climber.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), -Math.cos(climber.yaw) * Math.cos(view.pitch));
  if (view.firstPerson) {
    camera.position.copy(_eye);
    camera.lookAt(_eye.x + _dir.x, _eye.y + _dir.y, _eye.z + _dir.z);
  } else {
    const d = climber.mode === Mode.FLY ? Math.max(view.distance, 25) : view.distance;
    camera.position.copy(_eye).addScaledVector(_dir, -d);
    camera.position.y = Math.max(camera.position.y, hm.heightAt(camera.position.x, camera.position.z) + 0.6);
    camera.lookAt(_eye);
  }
  sky.position.copy(camera.position);
  sun.position.copy(p).addScaledVector(SUN_DIR, 300);
  sun.target.position.copy(p);
}

function animateModel(dt) {
  const c = climber;
  model.position.copy(c.position);
  let diff = c.heading - model.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  model.rotation.y += diff * (1 - Math.exp(-dt * 10));
  // Cadence is shown at a believable rate no matter how fast mountain time runs.
  const cadence = { walk: 5, climb: 3, steep: 3, rope: 2.5 }[c.mode] ?? 0;
  if (c.moving) view.gait += dt * cadence;
  let pose = { climb: 'climb', steep: 'climb', rope: 'rope', fly: 'fly' }[c.mode] ?? 'walk';
  const winded = c.body.stamina < c.body.staminaCap(c.position.y) - 5 || c.body.exhausted;
  if (!c.moving && c.mode !== Mode.FLY && winded) {
    pose = 'rest';
    view.gait += (dt * c.body.breathRate / 60) * Math.PI * 2;
  }
  model.pose(pose, view.gait, c.moving, Math.min(c.slope / 30, 1));
  model.visible = !view.firstPerson;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  climber.update(dt, input.movement());
  animateModel(dt);
  updateCamera();
  audio.update();
  hud.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.__k2 = { climber, hm, ropes, teleport, view };
