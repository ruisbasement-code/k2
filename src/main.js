// Boots the K2 scene: loads the heightmap, builds the terrain, ropes and camps,
// puts the climber at Base Camp and runs the game loop.
//
// For screenshots and testing, URL parameters set up a view, e.g.
// ?place=3&rope&yaw=200&pitch=10&dist=8&fp&fly=600&hour=18&start

import * as THREE from 'three';
import './style.css';
import route from './data/route.json';
import { Heightmap } from './world/heightmap.js';
import { createTerrain } from './world/terrain.js';
import { FixedRopes } from './world/fixedRopes.js';
import { createCamps } from './world/camps.js';
import { Climber, Mode, CLIP_RANGE } from './player/climber.js';
import { tuning } from './sim/paceModel.js';
import { ClimberModel } from './player/climberModel.js';
import { BreathAudio } from './player/breathAudio.js';
import { Input } from './player/input.js';
import { Ragdoll } from './player/ragdoll.js';
import { Hud } from './ui/hud.js';
import { Sky } from './world/sky.js';

const EYE_HEIGHT = 1.65;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 150000);
const sky = new Sky(scene);

const params = new URLSearchParams(location.search);
const loading = document.getElementById('loading');
const hm = await Heightmap.load();
scene.add(createTerrain(hm));
const ropes = new FixedRopes(hm, route.fixed_ropes);
scene.add(ropes.createMesh());
scene.add(createCamps(hm, route.places));

const climber = new Climber(hm, ropes, route.places);
const model = new ClimberModel();
scene.add(model);
const ragdoll = new Ragdoll(model);
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
  // Camps on steep ground are only safe on the rope.
  if (hm.slopeDeg(x, z) > tuning.climb_start_deg && climber.ropeDistance() < CLIP_RANGE) climber.toggleClip();
}

for (let i = 0; i < 9; i++) input.on(`Digit${i + 1}`, () => teleport(i));
input.on('KeyC', () => climber.toggleClip());
input.on('KeyV', () => { view.firstPerson = !view.firstPerson; });
input.on('KeyT', () => climber.cycleTimeScale());
input.on('KeyF', () => climber.toggleFly());
input.on('KeyR', () => climber.rescue());
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
if (params.has('hour')) climber.mountainSeconds = +params.get('hour') * 3600;

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
  sky.update(climber.hour, p, camera.position);
}

function animateModel(dt) {
  const c = climber;
  model.visible = !view.firstPerson;
  if (c.tumbling || c.dead) {
    ragdoll.update(dt, c.position, c.velocity, c.dead);
    return;
  }
  ragdoll.stop();
  model.position.copy(c.position);
  if (c.falling) {
    // Sliding: face into the slope, flat against it, digging in.
    const [gx, gz] = hm.gradient(c.position.x, c.position.z);
    model.rotation.y = Math.atan2(gx, gz);
    model.pose('slide', 0, false, 0);
    return;
  }
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
