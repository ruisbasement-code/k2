// What the climber carries: food, gas for the stove, water, oxygen bottles and
// medicine, on top of the base gear (clothes, sleeping bag, harness, stove).
// Weights are real, and a heavier pack is slower and harder work.

import { tuning } from './paceModel.js';
import { DEFAULT_GEAR, PACKS, CONSUMABLE_LITRES, gearKg, gearLitres } from './gear.js';

export const ITEMS = ['snack', 'meal', 'gas', 'water', 'oxygen', 'dex'];

export class Pack {
  snack = 0;
  meal = 0;
  /** Brews left: a full canister is tuning.pack.gas.brews of them. */
  gasBrews = 0;
  /** Litres of water in your bottles. */
  water = 0;
  /** Litres of oxygen left in each bottle you carry; the first one is on the mask. */
  bottles = [];
  dex = 0;
  /** Gear by id (see GEAR in gear.js): devices, axe, crampons, tent... */
  gear = new Set(DEFAULT_GEAR);
  /** Which pack: sets how many litres fit. */
  size = 'pack45';
  /** First-aid kits, hand warmers and signal flares, packed at Base Camp. */
  extra = { firstaid: 0, warmers: 0, flares: 0 };

  /** How many of an item you have, in the units camps stock it (canisters for gas, bottles for oxygen). */
  count(item) {
    if (item === 'gas') return Math.ceil(this.gasBrews / tuning.pack.gas.brews - 1e-9);
    if (item === 'oxygen') return this.bottles.length;
    return this[item];
  }

  get kg() {
    const p = tuning.pack;
    return p.base_kg + this.snack * p.snack.kg + this.meal * p.meal.kg
      + this.count('gas') * p.gas.kg + this.water * p.water.kg_per_l + this.dex * p.dex.kg
      + this.bottles.reduce((sum, l) => sum + p.oxygen.shell_kg + l * p.oxygen.kg_per_l, 0)
      + gearKg(this);
  }

  /** How many litres the pack holds. */
  get capacity() {
    return PACKS[this.size].litres;
  }

  /** Litres taken by everything in it. */
  get litres() {
    const L = CONSUMABLE_LITRES;
    return this.snack * L.snack + this.meal * L.meal + this.count('gas') * L.gas + this.water * L.water
      + this.bottles.length * L.oxygen + this.dex * L.dex + gearLitres(this);
  }

  /** Litres of oxygen in all bottles. */
  get oxygenLitres() {
    return this.bottles.reduce((a, b) => a + b, 0);
  }

  /**
   * Take from a camp's stores up to the loadout. stores is mutated; -1 means unlimited.
   * Returns a list of what was taken, e.g. ["4 snack bars", "2 oxygen bottles"].
   */
  resupply(stores, loadout = tuning.loadout) {
    const p = tuning.pack;
    const took = [];
    for (const item of ITEMS) {
      const have = item === 'water' ? this.water : this.count(item);
      let want = Math.max(0, loadout[item] - have);
      const left = stores[item] ?? 0;
      if (left >= 0) want = Math.min(want, left);
      // Only what fits in the pack.
      want = Math.min(want, Math.max(0, this.capacity - this.litres) / CONSUMABLE_LITRES[item]);
      if (want <= 0) continue;
      if (item !== 'water') want = Math.floor(want);
      if (want <= 0) continue;
      if (left > 0) stores[item] = left - want;
      if (item === 'water') this.water += want;
      else if (item === 'gas') this.gasBrews += want * p.gas.brews;
      else if (item === 'oxygen') for (let i = 0; i < want; i++) this.bottles.push(p.oxygen.litres);
      else this[item] += want;
      took.push(item === 'water' ? `${want.toFixed(1)} L water` : `${want} ${p[item].label.toLowerCase()}`);
    }
    return took;
  }

  /**
   * Take one of an item from a camp's stores (half a litre for water). stores is
   * mutated; -1 means unlimited. Oxygen comes as a full bottle if the camp has
   * one, otherwise the fullest part-used bottle someone left there.
   * Returns null if it worked, or why not.
   */
  take(stores, item) {
    const p = tuning.pack;
    const left = stores[item] ?? 0;
    const parts = item === 'oxygen' ? (stores.o2_part ?? []) : [];
    if (left === 0 && !parts.length) return 'None left here';
    const step = item === 'water' ? 0.5 : 1;
    if (item === 'water' && this.water >= p.water.max_l - 1e-9) return `Your bottles hold ${p.water.max_l} L`;
    if (CONSUMABLE_LITRES[item] * step > this.capacity - this.litres + 1e-9) return 'No room in the pack';
    if (item === 'oxygen' && left === 0) {
      parts.sort((a, b) => b - a);
      this.bottles.push(parts.shift());
      return null;
    }
    if (left > 0) stores[item] = left - step;
    if (item === 'water') this.water = Math.min(p.water.max_l, this.water + step);
    else if (item === 'gas') this.gasBrews += p.gas.brews;
    else if (item === 'oxygen') this.bottles.push(p.oxygen.litres);
    else this[item] += 1;
    return null;
  }

  /**
   * Leave one of an item in a camp's stores, to pick up later: how expeditions
   * stock the high camps on load carries. Oxygen leaves the last bottle in the
   * pack (the one on your mask stays); gas leaves whole canisters only.
   * Returns null if it worked, or why not.
   */
  leave(stores, item) {
    const p = tuning.pack;
    if (item === 'water') return 'Camps melt their own water';
    if (this.count(item) <= 0) return 'You have none';
    const add = (n) => { if ((stores[item] ?? 0) >= 0) stores[item] = (stores[item] ?? 0) + n; };
    if (item === 'oxygen') {
      const l = this.bottles.pop();
      if (l >= p.oxygen.litres - 1) add(1);
      else (stores.o2_part ??= []).push(l);
    } else if (item === 'gas') {
      if (this.gasBrews < p.gas.brews - 1e-9) return 'Only a part-used canister: keep it';
      this.gasBrews -= p.gas.brews;
      add(1);
    } else {
      this[item]--;
      add(1);
    }
    return null;
  }

  /**
   * How long what you carry lasts, for planning a push:
   * o2Hours at flowLpm (the regulator's flow, or 2 L/min if it is off),
   * foodHours of steady climbing on snacks and meals, brews (each one melts a
   * night's water and cooks a meal), and how much slower the weight makes you.
   */
  forecast(flowLpm = 0) {
    const t = tuning;
    const flow = flowLpm || 2;
    const kcal = this.snack * t.pack.snack.kcal + this.meal * t.pack.meal.kcal;
    const burn = t.burn_rest_kcal_h + t.burn_effort_kcal_h * 0.8;
    const over = this.kg - t.pack_reference_kg;
    return {
      flow,
      o2Hours: this.oxygenLitres / flow / 60,
      foodHours: kcal / burn,
      brews: Math.floor(this.gasBrews + 1e-9),
      water: this.water,
      slower: Math.min(Math.max(t.pack_speed_per_kg * over, -0.1), 0.6),
    };
  }

  /** Draw oxygen for a time at a flow. Returns the litres you actually got. */
  breatheOxygen(flowLpm, minutes) {
    let need = flowLpm * minutes;
    let got = 0;
    while (need > 1e-9 && this.bottles.length) {
      const take = Math.min(need, this.bottles[0]);
      this.bottles[0] -= take;
      need -= take;
      got += take;
      // Empty bottles get left at the next camp, as climbers do.
      if (this.bottles[0] <= 1e-6) this.bottles.shift();
    }
    return got;
  }
}
