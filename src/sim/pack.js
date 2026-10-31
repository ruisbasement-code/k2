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
  /** First-aid kits and hand warmers, packed at Base Camp. */
  extra = { firstaid: 0, warmers: 0 };

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
