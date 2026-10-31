// Gear: everything you can pack at Base Camp, how much room and weight it takes,
// and what it does on the mountain. The Expedition ties it to a climber each
// frame: crampons and the axe change how likely a slip is, a down suit and
// gloves keep the cold out, rope and screws let you protect a pitch, and a tent,
// snow shovel or bivy sack lets you shelter anywhere. Summiting and getting back
// to Base Camp alive unlocks better gear.

import { tuning } from './paceModel.js';

/** Snow and ice: where crampons and an axe bite. */
export const SNOW_ICE = new Set(['soft_snow', 'firm_snow', 'crust', 'slush', 'glacier', 'ice']);
const ICE = new Set(['ice', 'glacier']);

/**
 * Every piece of gear. litres is the room it takes in the pack; kg its weight.
 * unlock: only after a summit and a safe return. replaces: the better version of.
 */
export const GEAR = {
  gps: { label: 'Wympr GPS', kg: 0.22, litres: 0.3, group: 'Devices', note: 'Satellite GPS and messenger: altitude, pace, weather and forecast. Halves rescue time.' },
  monitor: { label: 'Vitals monitor', kg: 0.12, litres: 0.2, group: 'Devices', note: 'Wrist pulse oximeter: food, water, warmth, oxygen and how your body is coping.' },
  map: { label: 'Topo map', kg: 0.1, litres: 0.1, group: 'Devices', note: 'Paper map of K2 and the Godwin-Austen Glacier, with the route and camps.' },
  radio: { label: 'Radio', kg: 0.3, litres: 0.4, group: 'Devices', note: 'Hear the weather forecast anywhere, not just in camp.' },
  axe: { label: 'Ice axe', kg: 0.6, litres: 2, group: 'Climbing', note: 'Climb steeper snow and ice, and self-arrest.' },
  axe_tech: { label: 'Technical ice axe', kg: 0.5, litres: 2, group: 'Climbing', unlock: true, replaces: 'axe', note: 'Curved pick: holds better, fewer slips with it out.' },
  crampons: { label: 'Crampons', kg: 0.9, litres: 2.5, group: 'Climbing', note: 'Without them, snow and ice are treacherous.' },
  crampons_pro: { label: 'Steel-front crampons', kg: 0.8, litres: 2, group: 'Climbing', unlock: true, replaces: 'crampons', note: 'Aggressive front points: a quarter fewer slips on snow and ice.' },
  rope: { label: 'Rope, 30 m', kg: 2.2, litres: 6, group: 'Climbing', note: 'With screws or pickets, protect a steep pitch (E). Climb out of crevasses.' },
  screws: { label: 'Ice screws ×4', kg: 0.6, litres: 1.5, group: 'Climbing', note: 'Protection on ice and glacier ice. Needs the rope.' },
  pickets: { label: 'Snow pickets ×2', kg: 0.7, litres: 2, group: 'Climbing', note: 'Protection in snow. Needs the rope.' },
  poles: { label: 'Trekking poles', kg: 0.5, litres: 1, group: 'Climbing', note: 'Easier walking on gentle ground.' },
  probe: { label: 'Avalanche probe', kg: 0.3, litres: 1, group: 'Climbing', note: 'Probe for hidden crevasses (X). An axe shaft works too.' },
  tent: { label: 'Storm tent', kg: 2.4, litres: 9, group: 'Shelter', note: 'Pitch it anywhere not too steep (Z), then sleep and cook in it.' },
  tent_ul: { label: 'Ultralight storm tent', kg: 1.3, litres: 5, group: 'Shelter', unlock: true, replaces: 'tent', note: 'Same shelter, half the weight and room.' },
  bivy: { label: 'Bivy sack', kg: 0.5, litres: 2, group: 'Shelter', note: 'Crawl in and sleep where you stand (Z). No cooking.' },
  shovel: { label: 'Snow shovel', kg: 0.7, litres: 3, group: 'Shelter', note: 'Dig a snow cave to sleep in (Z), on snow.' },
  stove: { label: 'Stove', kg: 0.4, litres: 1.5, group: 'Shelter', note: 'Cook and melt snow in your own shelter (K). Camps have kitchens.' },
  down_suit: { label: 'Down suit', kg: 2.2, litres: 8, group: 'Clothing', note: 'Far warmer in the cold up high.' },
  gloves: { label: 'Spare mitts', kg: 0.3, litres: 1, group: 'Clothing', note: 'Dry spares: much slower frostbite.' },
  goggles: { label: 'Goggles', kg: 0.15, litres: 0.5, group: 'Clothing', note: 'Keep wind off your face: slower frostbite.' },
};

/** The pack itself sets how much fits. */
export const PACKS = {
  pack45: { label: '45 L pack', litres: 45 },
  pack70: { label: '70 L expedition pack', litres: 70, unlock: true },
};

/** Room each unit of a consumable takes, in litres. */
export const CONSUMABLE_LITRES = { snack: 0.15, meal: 0.6, gas: 1, water: 1, oxygen: 5, dex: 0.02, firstaid: 1, warmers: 0.1 };

/** Consumables beyond the camps' stores, packed only at Base Camp. */
export const EXTRAS = {
  firstaid: { label: 'First-aid kit', kg: 0.3, heal: 25 },
  warmers: { label: 'Hand warmers', kg: 0.05, hours: 6 },
};

/** What the climber starts with outside the game (tests, the sim on its own). */
export const DEFAULT_GEAR = ['axe', 'crampons'];

export function gearKg(pack) {
  let kg = 0;
  for (const id of pack.gear) kg += GEAR[id]?.kg ?? 0;
  for (const [id, n] of Object.entries(pack.extra)) kg += (EXTRAS[id]?.kg ?? 0) * n;
  return kg;
}

export function gearLitres(pack) {
  let l = 0;
  for (const id of pack.gear) l += GEAR[id]?.litres ?? 0;
  for (const [id, n] of Object.entries(pack.extra)) l += (CONSUMABLE_LITRES[id] ?? 0) * n;
  return l;
}

/** Litres a consumable already takes. */
export function consumableLitres(pack, item) {
  const n = item === 'water' ? pack.water : pack.count(item);
  return (CONSUMABLE_LITRES[item] ?? 0) * n;
}

/** Has the gear or its better version. */
export function hasGear(pack, id) {
  if (pack.gear.has(id)) return true;
  return Object.entries(GEAR).some(([k, g]) => g.replaces === id && pack.gear.has(k));
}

/** How hard a fiddly job with cold hands is right now, 0 (easy) to 1 (brutal). */
export function difficulty(c) {
  const w = c.conditions;
  const gust = w?.gust ?? 0;
  const feels = c.phys?.air?.feelsLikeC ?? w?.windChillC ?? 0;
  let d = Math.max(0, gust - 5) / 25
    + Math.max(0, -feels - 10) / 40
    + (c.phys?.frostbite ?? 0) * 0.8
    + Math.max(0, 1 - c.health / 100) * 0.5
    + (c.body?.exhausted ? 0.2 : 0)
    - (hasGear(c.pack, 'gloves') ? 0.08 : 0);
  return Math.min(Math.max(d, 0), 1);
}

const PROTECT_RANGE_M = 25;
const SUMMIT_REACH_M = 60;

/**
 * Gear on the mountain, for one climber: keeps the axe and the pack in step,
 * applies gear effects and tracks the summit for unlocks.
 */
export class Expedition {
  constructor(climber, { unlocked = false, summitHeight = 8611, summit = { x: 0, z: 0 } } = {}) {
    this.c = climber;
    this.unlocked = unlocked;
    this.summitHeight = summitHeight;
    this.summit = summit;
    /** Reached the summit on this life; return to Base Camp to unlock gear. */
    this.summited = false;
    /** A placed screw or picket you're protected by: {x, y, z, kind}. */
    this.anchor = null;
    /** Mountain seconds a hand warmer has left. */
    this.warmerLeft = 0;
    this.onUnlock = () => {};
    this._lastSeconds = climber.mountainSeconds;
  }

  get pack() {
    return this.c.pack;
  }

  /** Gear you can take at Base Camp: the better versions only once unlocked. */
  available() {
    return Object.keys(GEAR).filter((id) => !GEAR[id].unlock || this.unlocked);
  }

  packs() {
    return Object.keys(PACKS).filter((id) => !PACKS[id].unlock || this.unlocked);
  }

  /** Free litres in the pack. */
  free() {
    return this.pack.capacity - this.pack.litres;
  }

  /** Whether an item would fit, swapping out what it replaces. */
  fits(id) {
    const g = GEAR[id];
    let free = this.free();
    if (g.replaces && this.pack.gear.has(g.replaces)) free += GEAR[g.replaces].litres;
    for (const [k, o] of Object.entries(GEAR)) if (o.replaces === id && this.pack.gear.has(k)) free += o.litres;
    return g.litres <= free + 1e-9;
  }

  /** Pack or unpack a piece of gear at Base Camp. Returns false if it doesn't fit. */
  toggle(id) {
    const pack = this.pack;
    if (pack.gear.has(id)) {
      pack.gear.delete(id);
      if (id === 'axe' || id === 'axe_tech') this.c.axe = { have: false, inHand: false, drawing: 0, dangling: 0 };
      return true;
    }
    if (!this.fits(id)) return false;
    const g = GEAR[id];
    // One of each kind: the better version replaces the standard one and back.
    if (g.replaces) pack.gear.delete(g.replaces);
    for (const [k, o] of Object.entries(GEAR)) if (o.replaces === id) pack.gear.delete(k);
    pack.gear.add(id);
    if (id === 'axe' || id === 'axe_tech') this.c.axe = { have: true, inHand: false, drawing: 0, dangling: 0 };
    return true;
  }

  /** Change packs. Fails if what you carry won't fit in the smaller one. */
  setPack(id) {
    if (PACKS[id].litres < this.pack.litres) return false;
    this.pack.size = id;
    return true;
  }

  /** Change how many of a consumable you carry by n, within the room left. Base Camp only. */
  adjust(item, n) {
    const p = this.pack;
    const per = CONSUMABLE_LITRES[item];
    const step = item === 'water' ? 0.5 * Math.sign(n) : Math.sign(n);
    if (step > 0 && per * step > this.free() + 1e-9) return false;
    if (item in EXTRAS) p.extra[item] = Math.max(0, p.extra[item] + step);
    else if (item === 'water') p.water = Math.min(Math.max(0, p.water + step), tuning.pack.water.max_l);
    else if (item === 'gas') p.gasBrews = Math.max(0, (p.count('gas') + step) * tuning.pack.gas.brews);
    else if (item === 'oxygen') {
      if (step > 0) p.bottles.push(tuning.pack.oxygen.litres);
      else p.bottles.pop();
    } else p[item] = Math.max(0, p[item] + step);
    return true;
  }

  /** Can you place protection here? Returns the kind ('screw' or 'picket') or why not. */
  canProtect() {
    const c = this.c;
    const pack = this.pack;
    if (c.clipped || c.falling || c.dead || c.mode === 'fly' || c.mode === 'hole') return { why: '' };
    if (c.slope < tuning.climb_start_deg) return { why: '' };
    if (!pack.gear.has('rope')) return { why: 'no rope' };
    const key = c.surface?.key;
    if (ICE.has(key)) return pack.gear.has('screws') ? { kind: 'screw' } : { why: 'no ice screws' };
    if (SNOW_ICE.has(key)) return pack.gear.has('pickets') ? { kind: 'picket' } : { why: 'no snow pickets' };
    return { why: 'nothing to anchor to' };
  }

  /** Place an anchor where you stand (after the minigame). */
  protect(kind) {
    const p = this.c.position;
    this.anchor = { x: p.x, y: p.y, z: p.z, kind };
  }

  get protectedNow() {
    const a = this.anchor;
    if (!a) return false;
    const p = this.c.position;
    return Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) < PROTECT_RANGE_M;
  }

  /** The shelter you could make here, best first: {kind, label} or null. */
  shelterOption() {
    const c = this.c;
    if (c.mode === 'fly' || c.falling || c.dead || c.mode === 'hole') return null;
    if (c.nearestTent()) return null;
    const pack = this.pack;
    const steep = c.slope > tuning.shelter_max_deg && !c.onLedge;
    const tent = pack.gear.has('tent_ul') ? 'tent_ul' : pack.gear.has('tent') ? 'tent' : null;
    if (tent && !steep) return { kind: 'tent', item: tent, label: 'Pitch tent' };
    if (pack.gear.has('shovel') && SNOW_ICE.has(c.surface?.key) && !ICE.has(c.surface?.key) && !steep) return { kind: 'cave', label: 'Dig snow cave' };
    if (pack.gear.has('bivy')) return { kind: 'sack', label: 'Bivouac' };
    return null;
  }

  /** Put up a shelter where you stand: it joins the tents you can sleep in. */
  makeShelter(option) {
    const c = this.c;
    const shelter = { camp: { tent: 'your tent', cave: 'your snow cave', sack: 'your bivy' }[option.kind], x: c.position.x, z: c.position.z, own: option.kind, item: option.item, yaw: c.yaw };
    if (option.kind === 'tent') this.pack.gear.delete(option.item);
    if (option.kind === 'cave') c.mountainSeconds += tuning.cave_dig_hours * 3600;
    if (option.kind === 'tent') c.mountainSeconds += tuning.pitch_minutes * 60;
    c.tents.push(shelter);
    return shelter;
  }

  /** Your own tent within reach, to strike. */
  ownTentNearby() {
    const t = this.c.nearestTent();
    return t?.own === 'tent' ? t : null;
  }

  strike(tent) {
    const c = this.c;
    const i = c.tents.indexOf(tent);
    if (i >= 0) c.tents.splice(i, 1);
    this.pack.gear.add(tent.item);
    c.mountainSeconds += tuning.pitch_minutes * 30;
  }

  /** A bivy sack leaves nothing behind once you get up. */
  removeShelter(s) {
    const i = this.c.tents.indexOf(s);
    if (i >= 0) this.c.tents.splice(i, 1);
  }

  /** Cooking in your own shelter needs your own stove. */
  canCookHere() {
    const t = this.c.nearestTent();
    if (!t) return false;
    if (!t.own) return true;
    return t.own !== 'sack' && this.pack.gear.has('stove');
  }

  /** Use a first-aid kit. Returns the health healed, or 0. */
  firstAid() {
    const c = this.c;
    if (!this.pack.extra.firstaid || c.dead) return 0;
    const before = c.health;
    c.health = Math.min(c.maxHealth, c.health + EXTRAS.firstaid.heal);
    if (c.health <= before) return 0;
    this.pack.extra.firstaid--;
    return c.health - before;
  }

  warmer() {
    if (!this.pack.extra.warmers) return false;
    this.pack.extra.warmers--;
    this.warmerLeft = EXTRAS.warmers.hours * 3600;
    return true;
  }

  /** Each frame, after the climber has moved. */
  update() {
    const c = this.c;
    const pack = this.pack;
    const dS = Math.max(0, c.mountainSeconds - this._lastSeconds);
    this._lastSeconds = c.mountainSeconds;
    this.warmerLeft = Math.max(0, this.warmerLeft - dS);

    // The axe and the pack agree: lose it on a fall and it's gone from the pack.
    const axeId = pack.gear.has('axe_tech') ? 'axe_tech' : pack.gear.has('axe') ? 'axe' : null;
    if (!c.axe.have && axeId) pack.gear.delete(axeId);
    if (c.axe.have && !axeId) pack.gear.add('axe');

    const key = c.surface?.key;
    const set = (id, e) => (e ? c.effects.set(id, e) : c.effects.delete(id));
    const onSnow = SNOW_ICE.has(key) && c.mode !== 'fly';
    const crampons = hasGear(pack, 'crampons');
    set('gear:crampons', !onSnow ? null
      : !crampons ? { label: 'No crampons', slip: tuning.no_crampons_slip, speed: ICE.has(key) ? 0.85 : 1 }
        : pack.gear.has('crampons_pro') ? { slip: 0.75 } : null);
    set('gear:axe', pack.gear.has('axe_tech') && c.axeReady ? { slip: 0.8 } : null);
    set('gear:poles', pack.gear.has('poles') && c.mode === 'walk' && !c.axeReady ? { effort: 0.92 } : null);
    if (this.anchor && !this.protectedNow) this.anchor = null;
    if (c.clipped || c.dead) this.anchor = null;
    set('gear:protection', this.protectedNow ? { slip: 0.35 } : null);

    const ph = c.phys;
    ph.insulationMult = pack.gear.has('down_suit') ? 1.8 : 1;
    ph.frostbiteMult = (pack.gear.has('gloves') ? 0.6 : 1) * (pack.gear.has('goggles') ? 0.85 : 1) * (this.warmerLeft > 0 ? 0.5 : 1);
    c.rescueHoursMult = pack.gear.has('gps') ? 0.5 : 1;

    // Summit, then Base Camp alive: better gear.
    if (c.dead) this.summited = false;
    const p = c.position;
    if (!c.dead && c.mode !== 'fly' && p.y > this.summitHeight - 25 && Math.hypot(p.x - this.summit.x, p.z - this.summit.z) < SUMMIT_REACH_M) this.summited = true;
    if (this.summited && !c.dead && c._campNearby()?.name === 'Base Camp') {
      this.summited = false;
      if (!this.unlocked) {
        this.unlocked = true;
        this.onUnlock();
      }
    }
  }
}
