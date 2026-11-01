// Boots the K2 scene: loads the heightmap, builds the terrain, ropes and camps,
// puts the climber at Base Camp and runs the game loop.
//
// For screenshots and testing, URL parameters set up a view, e.g.
// ?place=3&rope&yaw=200&pitch=10&dist=8&fp&fly=600&hour=18&start
// and for the weather ?weather=storm&seed=4&avalanche

import * as THREE from 'three';
import './style.css';
import route from './data/route.json';
import { Heightmap } from './world/heightmap.js';
import { createTerrain, createDetailPatch } from './world/terrain.js';
import { buildFineTerrain } from './world/fineTerrain.js';
import { GlacierBlocks } from './world/glacierBlocks.js';
import { HorizonMaps } from './world/horizon.js';
import { TerrainDetail, campFlats } from './world/terrainDetail.js';
import { FixedRopes } from './world/fixedRopes.js';
import { createCamps } from './world/camps.js';
import { Climber, Mode, CLIP_RANGE } from './player/climber.js';
import { tuning } from './sim/paceModel.js';
import { ClimberModel } from './player/climberModel.js';
import { GearLook } from './player/gearLook.js';
import { BreathAudio } from './player/breathAudio.js';
import { Input } from './player/input.js';
import { Ragdoll } from './player/ragdoll.js';
import { Headlamp } from './player/headlamp.js';
import { Hud } from './ui/hud.js';
import { Sky } from './world/sky.js';
import { RockfallMesh, FootprintMesh } from './world/hazardMeshes.js';
import { Tether } from './world/tether.js';
import { ProtectionView } from './world/protectionView.js';
import { Weather, weatherTuning } from './sim/weather.js';
import { Precipitation, AvalancheMesh } from './world/weatherView.js';
import { WindAudio } from './player/windAudio.js';
import { DangerAudio } from './player/dangerAudio.js';
import { Warnings } from './ui/warnings.js';
import { TerrainFeatures } from './sim/terrainFeatures.js';
import { FeatureMeshes } from './world/featureMeshes.js';
import featureDefs from './data/features.json';
import { Expedition, GEAR, difficulty, hasGear } from './sim/gear.js';
import { Inventory, hotbarItems } from './ui/inventory.js';
import { ledgesNear } from './sim/hazards.js';
import { Minigame } from './ui/minigame.js';
import { ControlsMenu } from './ui/controls.js';
import { Signals, flareSeenM, compassPoint } from './sim/signals.js';
import { SignalView, playWhistle } from './world/signalView.js';
import { ShelterMeshes } from './world/shelters.js';

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
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 150000);
const sky = new Sky(scene);

const params = new URLSearchParams(location.search);
const loading = document.getElementById('loading');
const hm = await Heightmap.load();
// The mountain's benches, ribs, buttresses and glacier hummocks, before anything stands on it.
buildFineTerrain(hm, route.places, route.fixed_ropes);
const terrain = createTerrain(hm);
scene.add(terrain);
const ropes = new FixedRopes(hm, route.fixed_ropes);
// The rocks, boulders and sastrugi you stand on, smooth at camps and along the ropes.
hm.detail = new TerrainDetail(hm, campFlats(hm, route.places));
for (const line of ropes.ropes) hm.detail.addCorridor(line);

const detailPatch = createDetailPatch(hm, terrain.userData.holes);
scene.add(detailPatch);
const features = new TerrainFeatures(hm, featureDefs, { ropes, places: route.places });
// The wanded trail across the glacier is trodden too.
if (features.trail) hm.detail.addCorridor(features.trail.points);
// Broken ice blocks and boulders strewn over the glaciers. They come right up to the crevasse lips, but never over a hole.
hm.detail.keepClear = (x, z) => !features.nearHole(x, z, 3.5) && !features.seracsNear(x, z, 10).length;
const glacierBlocks = new GlacierBlocks(hm);
scene.add(glacierBlocks);
const featureMeshes = new FeatureMeshes(hm, features, terrain, ropes);
scene.add(featureMeshes);
const ropeMesh = ropes.createMesh(hm, features);
scene.add(ropeMesh);
const camps = createCamps(hm, route.places, ropes);
scene.add(camps);

const climber = new Climber(hm, ropes, route.places, features);
// You walk out of Base Camp with your crampons in the pack: strap them on where the ice starts.
climber.crampons.on = false;
climber.tents = camps.userData.tents;
const rockMesh = new RockfallMesh(climber.rockfall);
scene.add(rockMesh);
const prints = new FootprintMesh(hm, tuning.max_footprints);
scene.add(prints);
climber.trail.onPrint = (p) => prints.add(p);
const tether = new Tether(hm);
scene.add(tether);
// Ice screws and pickets you put in, and your rope to the one you're on.
const protection = new ProtectionView(hm);
scene.add(protection);
let myPiece = null;
const precipitation = new Precipitation();
scene.add(precipitation);
const avalancheMesh = new AvalancheMesh(climber.avalanches);
scene.add(avalancheMesh);
const model = new ClimberModel();
scene.add(model);
// What the climber visibly carries and holds; plain data another player's game could draw.
const gearLook = new GearLook();
const ragdoll = new Ragdoll(model);
const headlamp = new Headlamp(scene);
// Flares, whistle and strobe. Every signal is also an event on climber.signals
// (onEvent) that multiplayer can send to other players, who pass it to receive().
climber.signals = new Signals('You');
const signalView = new SignalView();
scene.add(signalView);
const summitPlace = route.places.find((p) => p.name === 'Summit');
const [summitX, summitZ] = summitPlace ? hm.gridToWorld(summitPlace.r, summitPlace.c) : [0, 0];
const expedition = new Expedition(climber, {
  unlocked: params.has('unlock') || load('k2.unlocked') === '1',
  summitHeight: hm.heightAt(summitX, summitZ),
  summit: { x: summitX, z: summitZ },
});
expedition.onUnlock = () => {
  save('k2.unlocked', '1');
  hud.showMessage('Summit gear unlocked at Base Camp');
};
const shelters = new ShelterMeshes(hm);
scene.add(shelters);
const hud = new Hud(hm, climber, route.places, expedition);
const warnings = new Warnings(climber);
climber.onMessage = (t) => hud.showMessage(t);
const audio = new BreathAudio(climber.body);
const wind = new WindAudio();
const danger = new DangerAudio();
const input = new Input(canvas);
const view = {
  pitch: -0.2, distance: 7, firstPerson: false, gait: 0, time: 0,
  // Smoothing for the body and camera: the model's facing, its offset from the
  // climber's feet, how long since it got up from a fall, the chase camera's
  // follow point and how far it's lifted off the ground behind you.
  modelYaw: 0, bodyOffset: new THREE.Vector3(), settle: 0, collapseT: 0, follow: null, lift: 0,
};

function teleport(i) {
  const p = route.places[i];
  if (!p) return;
  const [x, z] = hm.gridToWorld(p.r, p.c);
  const [fx, fz] = p.name === 'Summit' ? [0, 1000] : [0, 0];
  climber.placeAt(x, z, fx, fz);
  hud.showMessage(p.name);
  // Camps on steep ground are only safe on the rope.
  if (hm.slopeDeg(x, z) > tuning.climb_start_deg && climber.ropeDistance() < CLIP_RANGE) climber.toggleClip();
}

// 1 to 9: the hotbar slots along the bottom.
for (let i = 0; i < 9; i++) input.on(`Digit${i + 1}`, () => useSlot(i));
input.on('KeyC', () => climber.toggleClip());
input.on('KeyV', () => { view.firstPerson = !view.firstPerson; });
input.on('KeyT', () => climber.cycleTimeScale());
input.on('KeyF', () => climber.toggleFly());
input.on('KeyR', () => (climber.collapsed ? climber.giveUp() : climber.dead ? respawn() : climber.getUp()));
input.on('KeyZ', () => shelterOrSleep());
input.on('KeyK', () => cook());
input.on('KeyB', () => climber.eat());
input.on('KeyH', () => climber.drink());
input.on('KeyO', () => climber.cycleOxygen());
input.on('KeyP', () => climber.takeDex());
input.on('KeyG', () => gearUp());
input.on('KeyY', () => climber.cycleTurnaround());
input.on('KeyX', () => {
  if (!hasGear(climber.pack, 'probe') && !climber.axe.have) hud.showMessage('Nothing to probe with');
  else climber.probe();
});
input.on('KeyL', () => hud.showMessage(`Headlamp: ${headlamp.cycle()}`));
input.on('KeyI', () => climber.toggleAxe());
input.on('KeyE', () => protect());
input.on('KeyJ', () => holdDevice('gps'));
input.on('KeyU', () => holdDevice('monitor'));
input.on('KeyM', () => holdDevice('map'));
input.on('Tab', () => (inventory.open ? inventory.hide() : openInventory(false)));
// Dev tool: step through the kinds of weather.
input.on('KeyN', () => {
  const keys = Object.keys(weatherTuning.conditions);
  const next = keys[(keys.indexOf(climber.weather.current.key) + 1) % keys.length];
  climber.weather.force(next, 12);
  hud.showMessage(`Weather: ${weatherTuning.conditions[next].label}`);
});

// ---- Gear, shelter and the jobs that need cold hands ----

const minigame = new Minigame(document.getElementById('mini'));
const inventory = new Inventory(document.getElementById('inventory'), expedition, {
  held: () => hud.held,
  hold: (id) => holdDevice(id),
  use: (item) => {
    const use = {
      snack: () => climber.eat(),
      water: () => climber.drink(),
      oxygen: () => climber.cycleOxygen(),
      dex: () => climber.takeDex(),
      meal: () => hud.showMessage('Cook meals in a tent (K)'),
      gas: () => hud.showMessage('Gas is for the stove (K)'),
      firstaid: () => {
        const healed = expedition.firstAid();
        hud.showMessage(healed ? `Patched up: +${Math.round(healed)} health` : 'Nothing to patch up');
      },
      warmers: () => { if (expedition.warmer()) hud.showMessage('Hand warmers in your mitts'); },
      flares: () => {
        if (!expedition.flare()) return;
        const km = flareSeenM(climber.conditions?.visibility) / 1000;
        hud.showMessage(`Flare away: seen up to ${km.toFixed(km < 10 ? 1 : 0)} km off in this weather`);
      },
      whistle: () => {
        if (!expedition.whistle()) return;
        playWhistle(audio.ctx, muted);
        hud.showMessage('Three blasts on the whistle');
      },
      strobe: () => {
        if (!expedition.strobe()) return hud.showMessage('The strobe battery is flat');
        hud.showMessage(climber.signals.strobeOn ? `Strobe on (${Math.round(climber.signals.strobeHours)} h of battery)` : 'Strobe off');
      },
    }[item];
    use?.();
    inventory.render();
  },
});
inventory.onClose = () => relock();

/** Hold or use what's in a hotbar slot. */
function useSlot(i) {
  const it = hotbarItems(climber)[i];
  if (!it) return;
  if (['gps', 'monitor', 'map'].includes(it.id)) holdDevice(it.id);
  else if (it.id === 'axe' || it.id === 'axe_tech') climber.toggleAxe();
  else if (it.id === 'poles') climber.togglePoles();
  else if (it.id === 'crampons' || it.id === 'crampons_pro') climber.toggleCrampons();
  else inventory.actions.use(it.id);
}

function openInventory(store) {
  if (minigame.busy) return;
  release();
  inventory.show(store);
}

function holdDevice(id) {
  if (!climber.pack.gear.has(id)) {
    hud.showMessage(`No ${GEAR[id].label.toLowerCase()}: pack one at Base Camp`);
    return;
  }
  hud.hold(id);
  inventory.render();
}

/** G: strike your tent, gear up at Base Camp, or open another camp's stores to take or leave supplies. */
function gearUp() {
  const own = expedition.ownTentNearby();
  if (own) {
    expedition.strike(own);
    hud.showMessage('Tent packed away');
    return;
  }
  if (climber._campNearby()?.name === 'Base Camp') openInventory(true);
  else if (climber.storesHere() && !climber.collapsed) openInventory('camp');
  else climber.resupply();
}

/** A job done with your hands: the climber stops while you do it. */
async function job(kind) {
  input.keys = {};
  return minigame.start(kind, difficulty(climber));
}

/** Z: sleep in a tent here, or make a shelter from what you carry. */
async function shelterOrSleep() {
  if (minigame.busy) return;
  if (climber.canSleep()) {
    const tent = climber.nearestTent();
    if (climber.sleep()) hud.showSleep();
    if (tent?.own === 'sack') expedition.removeShelter(tent);
    return;
  }
  const option = expedition.shelterOption();
  // Carrying a tent but the ground won't take it: say why.
  const badSite = expedition.carriesTent() && option?.kind !== 'tent' && expedition.pitchProblem();
  if (!option) {
    if (climber.mode !== Mode.FLY && !climber.falling && !climber.dead) hud.showMessage(badSite || 'No tent here');
    return;
  }
  if (badSite) hud.showMessage(badSite);
  if (option.kind === 'sack') {
    const s = expedition.makeShelter(option);
    if (climber.sleep()) hud.showSleep();
    expedition.removeShelter(s);
    return;
  }
  if (await job(option.kind === 'tent' ? 'tent' : 'cave')) {
    expedition.makeShelter(option);
    hud.showMessage(option.kind === 'tent' ? 'Tent pitched' : 'Snow cave dug');
  } else {
    climber.mountainSeconds += 10 * 60;
    hud.showMessage(option.kind === 'tent' ? 'The wind fights you. Try again' : 'The walls slumped. Try again');
  }
}

/** K: cook in a tent; in your own shelter you need your stove, and to light it. */
async function cook() {
  if (minigame.busy) return;
  const tent = climber.canSleep() && climber.nearestTent();
  if (tent?.own) {
    if (tent.own === 'sack') return hud.showMessage('No cooking in a bivy sack');
    if (!climber.pack.gear.has('stove')) return hud.showMessage('No stove');
    if (climber.pack.gasBrews < 1) return climber.cook();
    if (!(await job('stove'))) return hud.showMessage("The stove won't light");
  }
  if (climber.cook()) hud.showSleep();
}

/** E: place an ice screw or snow picket and clip the rope to it. */
/** Put a screw or picket in where you stand and clip your rope to it. */
function placeProtection(kind) {
  expedition.protect(kind);
  myPiece = protection.place(expedition.anchor).id;
}

async function protect() {
  if (minigame.busy || climber.mode === Mode.FLY) return;
  const p = expedition.canProtect();
  if (!p.kind) {
    if (p.why) hud.showMessage(p.why[0].toUpperCase() + p.why.slice(1));
    return;
  }
  if (await job(p.kind)) {
    placeProtection(p.kind);
    hud.showMessage(p.kind === 'screw' ? 'Screw in, rope clipped' : 'Picket in, rope clipped');
  } else hud.showMessage(p.kind === 'screw' ? "The screw won't bite" : "The picket won't hold");
}

// ---- Pause menu and the mouse ----

let muted = false;
const menu = new ControlsMenu(document.getElementById('menu'), {
  isMuted: () => muted,
  onMute: () => { muted = audio.muted = wind.muted = danger.muted = !muted; },
});
menu.onClose = () => relock();
menu.onGetUp = () => climber.getUp();
let releasing = false;
let lostLockAt = -1e9;
function release() {
  if (document.pointerLockElement) {
    releasing = true;
    document.exitPointerLock();
  }
}
function relock() {
  if (!menu.open && !inventory.open && !document.getElementById('start')) canvas.requestPointerLock?.();
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) return;
  lostLockAt = performance.now();
  if (releasing) { releasing = false; return; }
  if (!inventory.open && !minigame.busy && !document.getElementById('start')) menu.show();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (e.code !== 'Escape' || e.repeat || minigame.busy) return;
  if (performance.now() - lostLockAt < 300) return; // the same Esc that freed the mouse
  if (inventory.open) inventory.hide();
  else if (menu.open) menu.hide();
  else if (!document.getElementById('start')) menu.show();
});

teleport(0);
// You gear up at Base Camp: the pack starts with food and water, and no gear.
climber.pack.gear.clear();
climber.axe = { have: false, inHand: false, drawing: 0, dangling: 0 };
if (params.has('kit')) for (const id of ['gps', 'monitor', 'map', 'axe', 'crampons']) expedition.toggle(id);
// ?signals: a pack with flares, a whistle and a strobe, for trying them out.
if (params.has('signals')) {
  for (const id of ['whistle', 'strobe']) expedition.toggle(id);
  climber.pack.extra.flares = 3;
}
// ?allgear: carry everything, two oxygen bottles on and flowing, to see it all on the climber.
if (params.has('allgear')) {
  climber.pack.size = 'pack70';
  for (const id of ['gps', 'monitor', 'map', 'axe', 'crampons_pro', 'rope', 'screws', 'pickets', 'probe', 'tent', 'bivy', 'shovel', 'down_suit', 'goggles', 'radio', 'whistle', 'strobe']) expedition.toggle(id);
  climber.pack.bottles = [tuning.pack.oxygen.litres, tuning.pack.oxygen.litres];
  climber.phys.flow = tuning.o2_flows.find((f) => f > 0) ?? 2;
}
// ?hold=gps|map|monitor: hold a device up.
if (params.has('hold')) hud.hold(params.get('hold'));
if (params.has('place')) teleport(+params.get('place'));
// Dev: stand on the nearest ledge of a kind (verglas, rotten, sound) to see its footing.
if (params.has('ledge')) {
  const p = climber.position;
  const l = ledgesNear(hm, p.x, p.z, 900).filter((q) => q.kind === params.get('ledge') && q.slope < 40)
    .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  if (l) climber.placeAt(l.x, l.z, l.x, l.z - 1);
}
if (params.has('rope')) climber.toggleClip();
if (params.has('yaw')) climber.yaw = (+params.get('yaw') * Math.PI) / 180;
if (params.has('pitch')) view.pitch = (+params.get('pitch') * Math.PI) / 180;
if (params.has('dist')) view.distance = +params.get('dist');
if (params.has('fp')) view.firstPerson = true;
if (params.has('fly')) { climber.toggleFly(); climber.position.y += +params.get('fly'); }
if (params.has('injure')) for (const hit of params.get('injure').split(',')) climber._injure(+hit);
if (params.has('lamp')) headlamp.set(+params.get('lamp'));
if (params.has('hour')) climber.mountainSeconds = +params.get('hour') * 3600;
climber.weather = new Weather(params.has('seed') ? +params.get('seed') : Math.floor(Math.random() * 1e9), climber.mountainSeconds);
if (params.has('weather')) climber.weather.force(params.get('weather'), 48);
if (params.has('avalanche')) climber.avalanches.releaseAbove(climber.position.x, climber.position.z);
if (params.has('crack')) { const crown = climber.avalanches.findAbove(climber.position.x, climber.position.z); if (crown) climber._crackAbove(crown); }

// The mountain's own shadows (ridges, buttresses, steps) and darker gullies, on
// everything lit. ?flatlight leaves them off, to compare.
if (!params.has('flatlight')) {
  const horizon = new HorizonMaps(renderer, hm);
  horizon.shade(glacierBlocks.mat);
  horizon.shadeAll(scene);
}

loading.remove();
const start = document.getElementById('start');
document.getElementById('go').onclick = () => {
  start.remove();
  audio.start();
  wind.start();
  danger.start();
  // First stop: the Base Camp store, to gear up.
  openInventory(true);
};
if (params.has('start')) start.remove();
// Back from the dead: straight to Base Camp, no title screen.
if (takeFlag('k2.respawn')) {
  start.querySelector('h1').textContent = 'Base Camp';
  start.querySelector('.sub').textContent = 'Day 1 · 5,000 m';
  document.getElementById('go').textContent = 'Gear up';
}

/** Dead: start again from Base Camp, everything fresh. Summit unlocks are kept. */
function respawn() {
  if (!climber.dead) return;
  try { sessionStorage.setItem('k2.respawn', '1'); } catch { /* the title screen shows instead */ }
  location.replace(location.pathname);
}
document.getElementById('respawn').onclick = () => respawn();

const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();

function updateCamera(dt) {
  const look = input.takeLook();
  climber.yaw -= look.dx * 0.0025;
  view.pitch = Math.min(Math.max(view.pitch - look.dy * 0.0025, -1.45), 1.2);
  if (look.zoom) view.distance = Math.min(Math.max(view.distance * (1 + look.zoom * 0.12), 2), 80);
  const p = climber.position;
  _eye.set(p.x, view.groundY + EYE_HEIGHT, p.z);
  _dir.set(-Math.sin(climber.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), -Math.cos(climber.yaw) * Math.cos(view.pitch));
  if (view.firstPerson) {
    // Eyes in the posed head, so your own arms and legs sit right below you.
    model.updateMatrixWorld(true);
    // A little forward of the face, so the puffy chest doesn't fill the view looking down.
    if (climber.mode !== Mode.FLY) model.joints.head.localToWorld(_eye.set(0, 0.08, -0.14));
    camera.position.copy(_eye);
    camera.lookAt(_eye.x + _dir.x, _eye.y + _dir.y, _eye.z + _dir.z);
  } else {
    // A chase camera: it trails a touch behind sudden moves (a swing, a surge, a
    // slip) instead of being bolted to you, and catches up at once after a jump.
    if (!view.follow || view.follow.distanceToSquared(_eye) > 36) view.follow = _eye.clone();
    else view.follow.lerp(_eye, 1 - Math.exp(-dt * (climber.falling ? 25 : 10)));
    const d = climber.mode === Mode.FLY ? Math.max(view.distance, 25) : view.distance;
    camera.position.copy(view.follow).addScaledVector(_dir, -d);
    // Lift over the ground behind you smoothly rather than popping up a step.
    const ground = hm.groundAt(camera.position.x, camera.position.z);
    const need = Math.max(0, ground + 0.6 - camera.position.y);
    view.lift += (need - view.lift) * (1 - Math.exp(-dt * (need > view.lift ? 18 : 3)));
    camera.position.y = Math.max(camera.position.y + view.lift, ground + 0.3);
    camera.lookAt(view.follow);
  }
  sway(camera);
  sky.update(climber.hour, p, camera.position, climber.conditions);
  updateHeadlamp();
}

const _lampPos = new THREE.Vector3();
const _lampDir = new THREE.Vector3();

/** The headlamp shines where you look in first person, and where the head points otherwise. */
function updateHeadlamp() {
  if (view.firstPerson) {
    _lampPos.copy(camera.position).y += 0.08;
    camera.getWorldDirection(_lampDir);
  } else {
    model.updateMatrixWorld(true);
    const head = model.joints.head;
    head.localToWorld(_lampPos.set(0, 0.15, -0.15));
    head.localToWorld(_lampDir.set(0, -0.25, -1)).sub(head.localToWorld(new THREE.Vector3(0, 0, 0))).normalize();
  }
  model.setLamp(headlamp.update(view.time, _lampPos, _lampDir));
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
  // Nausea and dizziness make the world swim.
  const queasy = c.phys.nausea * 0.5 + c.phys.rebound * 0.5 + c.mods.wobble * 0.5;
  const roll = exposure * (0.012 * Math.sin(t * 0.7) + 0.006 * breath) + queasy * 0.03 * Math.sin(t * 0.45)
    + c.shake * 0.05 * Math.sin(t * 37) * Math.sin(t * 23);
  cam.rotateZ(roll);
  cam.rotateX(c.shake * 0.03 * Math.sin(t * 41) + exposure * 0.004 * breath);
}

const _basis = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _U = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _N = new THREE.Vector3();

/**
 * Lay the body flat on the slope: head up or down the fall line, on its front or
 * back. Writes the orientation to q and the body's offset from the feet to off.
 */
function slideOrientation(c, q, off) {
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
  q.setFromRotationMatrix(_basis);
  // The model's pivot is at its feet: put the middle of the body on the ground point.
  off.set(0, 0, 0).addScaledVector(_U, -0.9).addScaledVector(_N, 0.2);
}

/** What's in the hands, for posing: the axe once drawn, or the trekking poles. */
function heldGear() {
  const a = climber.axe;
  const poles = climber.pack.gear.has('poles');
  model.held = {
    axe: a.have && a.inHand && a.drawing <= 0,
    poles: climber.polesReady,
    stowedPoles: poles && !climber.polesReady,
  };
}

/** The axe in the hand only while it's drawn; on the pack when stowed; nowhere once lost. */
function showAxe() {
  const a = climber.axe;
  const held = model.held.axe;
  if (model.axe) model.axe.visible = model.axe.visible && held;
  if (model.stowedAxe) model.stowedAxe.visible = a.have && !held;
}

const _qTarget = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _offTarget = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _AXIS_X = new THREE.Vector3(1, 0, 0);
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/** Ease the body's orientation and its offset from the feet toward a target. */
function settleModel(dt, rate) {
  const k = 1 - Math.exp(-dt * rate);
  model.quaternion.slerp(_qTarget, k);
  view.bodyOffset.lerp(_offTarget, k);
  model.position.copy(climber.position).add(view.bodyOffset);
}

function animateModel(dt) {
  const c = climber;
  // In first person you see your own body (the head is hidden), unless scouting.
  model.visible = !(view.firstPerson && c.mode === Mode.FLY);
  model.firstPerson = view.firstPerson;
  heldGear();
  model.setGear(gearLook.update(c, hud.held, dt, inventory.open));
  const [gx, gz] = hm.gradient(c.position.x, c.position.z, 3);
  const riseAlong = (yaw) => -(gx * Math.sin(yaw) + gz * Math.cos(yaw));
  // Collapsed in the cold you crumple where you stand (and lie there if nobody comes).
  const crumpled = !!c.collapsed || (c.dead && view.collapseT > 0);
  view.collapseT = crumpled ? view.collapseT + dt : 0;
  if (c.tumbling || (c.dead && !crumpled)) {
    ragdoll.update(dt, c.position, c.velocity, c.dead);
    view.bodyOffset.copy(model.position).sub(c.position);
    view.settle = 1;
    return;
  }
  ragdoll.stop();
  // Just up from a tumble, a slide or a collapse: roll back upright over a moment.
  view.settle = Math.max(0, view.settle - dt / 0.6);
  if (crumpled) {
    // Knees buckle, then you topple forward from them onto the snow.
    const t = view.collapseT;
    const f = Math.min(Math.max((t - 0.8) / 0.8, 0), 1);
    const rise = riseAlong(view.modelYaw);
    _qYaw.setFromAxisAngle(_AXIS_Y, view.modelYaw);
    _qTilt.setFromAxisAngle(_AXIS_X, (Math.atan(rise) - Math.PI / 2) * f * f);
    _qTarget.copy(_qYaw).multiply(_qTilt);
    // Pivot about a point just above the feet, so you fall forward from there.
    _pivot.set(0, 0.15, 0);
    _offTarget.copy(_pivot).applyQuaternion(_qTilt).negate().add(_pivot).applyQuaternion(_qYaw);
    _offTarget.y += view.groundY - c.position.y;
    settleModel(dt, 14);
    // Still folded at the knees until you're halfway down, then stretched out.
    model.pose(f < 0.5 ? 'kneel' : 'lie', 0, false, 0, { dt });
    view.settle = 1;
    showAxe();
    return;
  }
  if (c.falling) {
    // Sliding flat on the slope, the way the fall left you, digging in.
    slideOrientation(c, _qTarget, _offTarget);
    settleModel(dt, 12);
    model.pose('slide', 0, false, 0, { dt, arrest: !!c.fall.arresting, time: view.time });
    view.settle = 1;
    showAxe();
    return;
  }
  let pose = { climb: 'climb', steep: 'climb', rope: 'rope', fly: 'fly', hole: 'climb' }[c.mode] ?? 'walk';
  const winded = c.body.stamina < c.body.staminaCap(c.breathAltitude) - 5 || c.body.exhausted;
  if (!c.moving && c.mode !== Mode.FLY && winded) pose = 'rest';
  // On steep ground (or a rope) you always face into the slope: backing down it
  // or side-stepping across it. On gentler ground you face out and plunge-step down.
  const steep = pose === 'climb' || pose === 'rope';
  const faceIn = steep && riseAlong(c.heading) < 0.7 * Math.hypot(gx, gz);
  const backing = steep && riseAlong(c.heading) < -0.25;
  // In first person the body turns with your view, so you see your own arms and legs.
  const faceYaw = faceIn ? Math.atan2(-gx, -gz) : view.firstPerson ? c.yaw : c.heading;
  let diff = faceYaw - view.modelYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  // Turn a little slower on steep ground, where each foot is placed with care.
  view.modelYaw += diff * (1 - Math.exp(-dt * (steep ? 7 : 10)));
  // Sunk into the snow, and swaying a little on exposed ground or after a jolt.
  const exposure = Math.min(Math.max((c.slope - 25) / 30, 0), 1);
  _euler.set(0, view.modelYaw, exposure * 0.03 * Math.sin(view.time * 0.9) + c.shake * 0.12 * Math.sin(view.time * 29));
  _qTarget.setFromEuler(_euler);
  // Stepping over rocks: ease the body up and down rather than popping.
  _offTarget.set(0, view.groundY - c.position.y - c.sink * 0.8, 0);
  if (view.settle > 0) settleModel(dt, 5);
  else {
    model.quaternion.copy(_qTarget);
    view.bodyOffset.copy(_offTarget);
    model.position.copy(c.position).add(view.bodyOffset);
  }
  // The legs keep pace with how fast you're really going (shorter steps when you're
  // crawling up high), at a believable rate however fast mountain time runs.
  // Backing down runs the climbing cycle in reverse.
  const v = c.pace * c.timeScale;
  let stride = 1;
  let cadence = 0;
  if (pose === 'walk') {
    stride = Math.min(Math.max(v / 1.1, 0.35), 1);
    cadence = Math.min(Math.max((Math.PI * v) / (0.56 * stride), 2.5), 7.5);
  } else if (pose === 'climb') {
    stride = Math.min(Math.max(v / 0.5, 0.35), 1);
    cadence = Math.min(Math.max((Math.PI * v) / (0.28 * stride), 1.5), 4.5);
  } else if (pose === 'rope') cadence = 2.5;
  if (c.moving) view.gait += dt * cadence * (backing ? -1 : 1);
  if (pose === 'rest') view.gait += (dt * c.body.breathRate / 60) * Math.PI * 2;
  // Ground rise in the direction the model faces, for fitting hands and feet to the slope.
  const rise = riseAlong(view.modelYaw);
  model.pose(pose, view.gait, c.moving, rise, {
    dt, stride, time: view.time,
  });
  showAxe();
}

const _harness = new THREE.Vector3();
const _clip = new THREE.Vector3();
const _ropeDir = new THREE.Vector3();

/** Your rope from the harness to the screw or picket you put in, while you're near it. */
function updateProtection(dt) {
  const on = myPiece != null && expedition.protectedNow && !climber.dead;
  if (on) {
    model.updateMatrixWorld(true);
    model.joints.pelvis.localToWorld(_protHarness.set(0, 0.02, -0.17));
  }
  // Other climbers (multiplayer) go in this list the same way.
  protection.update(dt, [{ id: 'me', harness: on ? _protHarness : null, piece: myPiece }]);
}
const _protHarness = new THREE.Vector3();

/** The tether from the harness to the fixed rope: slides along it, locks on it in a fall. */
function updateTether(dt) {
  const c = climber;
  const ropeFall = c.falling && c.fall.rope;
  if (!c.clipped && !ropeFall) {
    tether.update(dt, null);
    return;
  }
  model.updateMatrixWorld(true);
  model.joints.pelvis.localToWorld(_harness.set(0, 0.02, -0.17)); // harness belay loop
  let id, length;
  if (ropeFall) {
    id = c.fall.rope.id;
    _clip.copy(c.fall.rope.anchor);
    length = c.fall.rope.length;
  } else {
    id = c.ropeId;
    ropes.visualPointAt(id, ropes.nearestOn(id, c.position).s, _clip);
    length = tuning.rope_leash_m + 1;
  }
  ropes.tangentAt(id, ropes.nearestOn(id, _clip).s, _ropeDir);
  tether.update(dt, _harness, _clip, length, _ropeDir);
}

/**
 * Other climbers' signals you can make out from here (multiplayer, later): say
 * once which way and how far each new one is.
 */
const noticed = new Set();
function noticeSignals() {
  const c = climber;
  for (const s of c.signals.noticedFrom(c.position, { visibility: c.conditions?.visibility, wind: c.conditions?.wind, ignore: c.signals.who })) {
    const key = s.kind === 'whistle' ? `whistle@${Math.round(c.signals.whistle.at)}` : s.id;
    if (noticed.has(key)) continue;
    noticed.add(key);
    const where = `${compassPoint(s.bearing)}, ${s.distance < 1000 ? `${Math.round(s.distance / 10) * 10} m` : `${(s.distance / 1000).toFixed(1)} km`}`;
    hud.showMessage({ flare: `A red flare goes up to the ${where} off`, strobe: `A strobe flashing to the ${where} off`, whistle: `A whistle, three blasts, to the ${where}` }[s.kind]);
  }
  // A strobe that stops can be noticed again when it starts once more.
  for (const key of noticed) if (key.startsWith('strobe:') && !c.signals.strobes.has(key.slice(7))) noticed.delete(key);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  view.time += dt;
  // Smoothed height for the body and camera over the small rocks; exact in a fall.
  const cy = climber.position.y;
  view.groundY = climber.falling || Math.abs(cy - view.groundY) > 3 || !Number.isFinite(view.groundY)
    ? cy : view.groundY + (cy - view.groundY) * (1 - Math.exp(-dt * 14));
  // Paused in the menu; standing still while busy with your hands or your pack.
  if (climber.dead && document.pointerLockElement) release(); // free the mouse for the respawn button
  if (!menu.open) {
    const still = minigame.busy || inventory.open;
    const before = climber.mountainSeconds;
    climber.update(dt, still ? { x: 0, y: 0, push: false, up: false, down: false, arrest: false } : input.movement());
    expedition.update();
    climber.signals.update(dt, climber.mountainSeconds - before, climber.position);
    noticeSignals();
  }
  signalView.update(climber.signals, view.time);
  shelters.update(climber.tents);
  rockMesh.update();
  featureMeshes.update(climber.position, climber);
  animateModel(dt);
  updateTether(dt);
  updateProtection(dt);
  ropeMesh.update(camera.position);
  detailPatch.userData.update(climber.position);
  glacierBlocks.update(camera.position);
  updateCamera(dt);
  audio.update();
  wind.update(climber.conditions);
  precipitation.update(dt, camera.position, climber.conditions);
  avalancheMesh.update();
  camps.userData.update(now / 1000);
  hud.update(dt);
  for (const cue of climber.cues.splice(0)) { danger.play(cue, camera); warnings.cue(cue); }
  warnings.update(dt, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.__k2 = { climber, protection, placeProtection, ropeMesh, signals: climber.signals, signalView, hm, ropes, teleport, view, tether, features, featureMeshes, weather: climber.weather, expedition, hud, inventory, minigame, menu };

/** Read and clear a one-off flag that survives a reload. */
function takeFlag(key) {
  try {
    const v = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return v === '1';
  } catch { return false; }
}

/** Browser storage can be missing or blocked; the game runs without it. */
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not saved */ }
}
