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
import { RockfallMesh, FootprintMesh, LedgeMesh } from './world/hazardMeshes.js';
import { Tether } from './world/tether.js';

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
const camps = createCamps(hm, route.places, ropes);
scene.add(camps);

const climber = new Climber(hm, ropes, route.places);
const rockMesh = new RockfallMesh(climber.rockfall);
scene.add(rockMesh);
const prints = new FootprintMesh(hm, tuning.max_footprints);
scene.add(prints);
climber.trail.onPrint = (p) => prints.add(p);
const ledges = new LedgeMesh(hm);
scene.add(ledges);
const tether = new Tether(hm);
scene.add(tether);
const model = new ClimberModel();
scene.add(model);
const ragdoll = new Ragdoll(model);
const hud = new Hud(hm, climber, route.places);
climber.onMessage = (t) => hud.showMessage(t);
const audio = new BreathAudio(climber.body);
const input = new Input(canvas);
const view = { pitch: -0.2, distance: 7, firstPerson: false, gait: 0, time: 0 };

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
  sway(camera);
  sky.update(climber.hour, p, camera.position);
}

/**
 * Exposure and balance: on steep ground the view drifts and tilts a little with
 * your breathing, and a jolt (a slip, a crumbling hold, a rock) shakes it.
 */
function sway(cam) {
  const c = climber;
  if (c.mode === Mode.FLY) return;
  const t = view.time;
  const exposure = Math.min(Math.max((c.slope - 25) / 30, 0), 1) * (c.falling ? 0 : 1);
  const breath = Math.sin(c.body.breathPhase * Math.PI * 2);
  const roll = exposure * (0.012 * Math.sin(t * 0.7) + 0.006 * breath)
    + c.shake * 0.05 * Math.sin(t * 37) * Math.sin(t * 23);
  cam.rotateZ(roll);
  cam.rotateX(c.shake * 0.03 * Math.sin(t * 41) + exposure * 0.004 * breath);
}

const _basis = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _U = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _N = new THREE.Vector3();

/** Lay the body flat on the slope: head up or down the fall line, on its front or back. */
function slideOrientation(c) {
  const [gx, gz] = hm.gradient(c.position.x, c.position.z);
  hm.normalAt(c.position.x, c.position.z, _N);
  // Up the slope, along the surface.
  _U.set(gx, gx * gx + gz * gz, gz);
  if (_U.lengthSq() < 1e-8) _U.set(0, 0, -1);
  _U.normalize();
  const { head, back } = c.fall.orient;
  if (head) _U.negate();
  // A runaway slide spins you slowly about the slope's normal.
  if (c.fall.spin) _U.applyAxisAngle(_N, c.fall.spin);
  // The model faces -z: on the front, -z points into the slope.
  _Z.copy(_N).multiplyScalar(back ? -1 : 1);
  _X.crossVectors(_U, _Z).normalize();
  _Z.crossVectors(_X, _U);
  _basis.makeBasis(_X, _U, _Z);
  model.quaternion.setFromRotationMatrix(_basis);
  // The model's pivot is at its feet: put the middle of the body on the ground point.
  model.position.copy(c.position).addScaledVector(_U, -0.9).addScaledVector(_N, 0.2);
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
    // Sliding flat on the slope, the way the fall left you, digging in.
    slideOrientation(c);
    model.pose('slide', 0, false, 0);
    return;
  }
  // Sunk into the snow, and swaying a little on exposed ground or after a jolt.
  model.position.y -= c.sink * 0.8;
  const exposure = Math.min(Math.max((c.slope - 25) / 30, 0), 1);
  model.rotation.set(0, model.rotation.y, exposure * 0.03 * Math.sin(view.time * 0.9) + c.shake * 0.12 * Math.sin(view.time * 29));
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
  // Ground rise in the direction the climber faces, for fitting hands and feet to the slope.
  const [gx, gz] = hm.gradient(c.position.x, c.position.z, 3);
  const rise = -(gx * Math.sin(model.rotation.y) + gz * Math.cos(model.rotation.y));
  model.pose(pose, view.gait, c.moving, rise);
}

const _harness = new THREE.Vector3();
const _clip = new THREE.Vector3();
const _ropeDir = new THREE.Vector3();

/** The tether from the harness to the fixed rope: slides along it, locks on it in a fall. */
function updateTether(dt) {
  const c = climber;
  const ropeFall = c.falling && c.fall.rope;
  if (!c.clipped && !ropeFall) {
    tether.update(dt, null);
    return;
  }
  model.updateMatrixWorld(true);
  model.localToWorld(_harness.set(0, 0.98, -0.12));
  let id, length;
  if (ropeFall) {
    id = c.fall.rope.id;
    _clip.copy(c.fall.rope.anchor);
    length = c.fall.rope.length;
  } else {
    id = c.ropeId;
    ropes.pointAt(id, ropes.nearestOn(id, c.position).s, _clip);
    length = tuning.rope_leash_m + 1;
  }
  ropes.tangentAt(id, ropes.nearestOn(id, _clip).s, _ropeDir);
  tether.update(dt, _harness, _clip, length, _ropeDir);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  view.time += dt;
  climber.update(dt, input.movement());
  rockMesh.update();
  ledges.update(climber.position);
  animateModel(dt);
  updateTether(dt);
  updateCamera();
  audio.update();
  camps.userData.update(now / 1000);
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

window.__k2 = { climber, hm, ropes, teleport, view, tether };
