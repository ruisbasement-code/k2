// The climber's body over hours and days: food, water, warmth, oxygen and the
// altitude illnesses, and how they feed into each other.
//
// Everything runs in mountain hours. The climber calls step() every frame with
// the altitude, effort, the air (src/sim/environment.js) and the pack, and reads
// back modifiers for speed, effort, stamina and slips, the conditions for the
// HUD, and any damage.
//
// Causes and effects, roughly as in real life:
// - Food is burned by effort and shivering. Low blood sugar slows you, makes you
//   clumsy and stops stamina coming back; with nothing left you stop shivering.
// - Water is lost faster with effort and in thin, dry air. Dehydration makes
//   altitude sickness and frostbite more likely and saps stamina.
// - Core temperature balances heat from effort and shivering against the wind
//   chill through your clothes. Resting in the open cools you; a tent and
//   sleeping bag warm you. Below 35 °C you are clumsy, below 32 °C confused and
//   no longer shivering, at 28 °C you die.
// - Frostbite builds in hard wind chill, faster when you are cold, dry, short of
//   oxygen or not moving. It heals while still shallow; deep frostbite is a
//   permanent injury.
// - Acclimatization follows the altitude you spend time at, slowly, up to about
//   7,000 m. Above what you are acclimatized to, you get altitude sickness (AMS),
//   worse when you sleep high; severe AMS high up turns into cerebral oedema
//   (HACE: stumbling, confusion), and hard work high up into pulmonary oedema
//   (HAPE: breathless, weak). Both kill. Going down, bottled oxygen and
//   dexamethasone treat them.
// - Above the death zone the body slowly wears out whatever you do.
// - Bottled oxygen makes the air feel lower. Running out high up, after relying
//   on a high flow, hits hard: dizziness and nausea for a while.

import { tuning, curve } from './paceModel.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

const STAGES = {
  food: [[20, 'Low blood sugar', 'You feel shaky and weak. Eat something (B).'], [0, 'Starving', 'You have nothing left to burn. Eat (B).']],
  water: [[60, 'Thirsty', 'You are getting dehydrated. Drink (H).'], [30, 'Dehydrated', 'Badly dehydrated: weak and headachy. Drink (H) or melt snow at a camp (K).'], [10, 'Severely dehydrated', 'Severely dehydrated. Drink now.']],
  cold: [[35, 'Hypothermia', 'Mild hypothermia: shivering hard and clumsy. Keep moving or get into a tent.'], [32, 'Moderate hypothermia', 'Moderate hypothermia: you have stopped shivering and are confused. Get into a tent.']],
  frostbite: [[0.25, 'Frostnip', 'Your fingers and toes are numb: frostnip.'], [0.5, 'Frostbite', 'Frostbite: your fingers are clumsy and white. Get warm in a tent.']],
  ams: [[0.25, 'Mild AMS', 'Your head is pounding: mild altitude sickness. Rest, drink, or go down.'], [0.5, 'AMS', 'Altitude sickness: nausea and a splitting headache. Go down or use oxygen.'], [0.8, 'Severe AMS', 'Severe altitude sickness: you are vomiting. Go down now.']],
  hace: [[0.3, 'HACE', 'Cerebral oedema (HACE): you are stumbling and confused. Descend now, use oxygen, take dex (P).'], [0.7, 'Severe HACE', 'Severe HACE. You will die if you do not descend.']],
  hape: [[0.3, 'HAPE', 'Pulmonary oedema (HAPE): a wet cough, breathless at rest. Descend now and use oxygen.'], [0.7, 'Severe HAPE', 'Severe HAPE. You are drowning on the inside. Descend.']],
  deterioration: [[0.2, 'Death zone', 'The death zone is wearing you down. Do not linger.']],
  nausea: [[0.5, 'Nauseous', 'You feel sick. Food may not stay down.']],
};

export class Physiology {
  /** Food store, % of tuning.food_kcal_full. */
  food = 85;
  /** Hydration, % (0 is a deficit of tuning.water_full_deficit_l). */
  hydration = 90;
  /** Core body temperature, °C. */
  core = tuning.core_normal_c;
  /** Frostbite in hands and feet, 0..1 (0.8 is deep and permanent). */
  frostbite = 0;
  /** The altitude the body is used to, metres. */
  acclimatized = tuning.acclimatized_start_m;
  /** Altitude illnesses, 0..1 (1 is death for HACE and HAPE). */
  ams = 0;
  hace = 0;
  hape = 0;
  /** Wear from the death zone, 0..1. */
  deterioration = 0;
  /** Shock from oxygen running out high up, 0..1, fades over a couple of hours. */
  rebound = 0;
  nausea = 0;
  /** Hours of dexamethasone left in your blood. */
  dexHours = 0;
  /** Oxygen flow set on the regulator, and what you actually got last step, L/min. */
  flow = 0;
  flowGot = 0;
  /** The altitude the air feels like with the oxygen you are breathing. */
  effectiveAltitude = 5000;
  /** Air last step: temperature, wind, wind chill. */
  air = { airTempC: 0, windMs: 0, feelsLikeC: 0, wet: 0 };
  onMessage = () => {};
  /** Called with (label, health) when something leaves a permanent injury. */
  onPermanentInjury = () => {};
  _stage = {};

  get shivering() {
    return this.core < 36.5 && this.core > tuning.hypothermia_moderate_c && this.food > 0;
  }

  /** How far above what you are acclimatized to the air feels, metres. */
  get altitudeGap() {
    return this.effectiveAltitude - this.acclimatized;
  }

  /**
   * Advance the body.
   * @param dtH mountain hours
   * @param ctx {altitude, effort, air, pack, sheltered, sleeping}
   * @returns {damage, cause} health lost and what from
   */
  step(dtH, { altitude, effort = 0, air, pack, sheltered = false, sleeping = false }) {
    const t = tuning;
    if (dtH <= 0) return { damage: 0, cause: null };
    this.air = air;

    // Oxygen.
    const wanted = this.flow;
    if (wanted > 0 && pack) {
      const got = pack.breatheOxygen(wanted, dtH * 60);
      this.flowGot = got / (dtH * 60);
      if (this.flowGot < wanted * 0.98) {
        this.flow = 0;
        if (altitude > 7000 && wanted >= 1) this.rebound = clamp(this.rebound + 0.3 + 0.15 * wanted, 0, 1);
        this.onMessage(altitude > 7000 ? 'Your oxygen ran out! The thin air hits you like a wall.' : 'Your oxygen ran out.');
      }
    } else {
      this.flowGot = 0;
    }
    const drop = curve(t.o2_altitude_drop, this.flowGot);
    this.effectiveAltitude = Math.max(altitude - drop, Math.min(altitude, t.o2_floor_m));
    const eff = this.effectiveAltitude;

    // Food.
    const kcal = t.burn_rest_kcal_h + t.burn_effort_kcal_h * effort + (this.shivering ? t.burn_shiver_kcal_h : 0);
    this.food = clamp(this.food - (kcal / t.food_kcal_full) * 100 * dtH, 0, 100);

    // Water.
    const litres = t.water_loss_rest_l_h + t.water_loss_effort_l_h * effort + t.water_loss_per_km_l_h * Math.max(0, (altitude - 3000) / 1000);
    this.hydration = clamp(this.hydration - (litres / t.water_full_deficit_l) * 100 * dtH, 0, 100);

    // Warmth.
    const outside = sheltered ? air.airTempC + t.tent_warmth_c : air.feelsLikeC;
    const insulation = sleeping ? t.sleeping_bag_insulation : t.insulation * (1 - 0.4 * clamp(air.wet ?? 0, 0, 1));
    let heat = t.heat_rest + t.heat_effort * effort + (this.shivering ? t.heat_shiver : 0);
    if (this.food <= 0) heat *= 0.6;
    const loss = (this.core - outside) / insulation;
    this.core = Math.min(t.core_normal_c, this.core + (heat - loss) * t.heat_rate_c_per_h * dtH);

    // Frostbite.
    if (!sheltered && air.feelsLikeC < t.frostbite_from_c) {
      const k = (this.core < t.hypothermia_mild_c ? 2 : 1) * (this.hydration < 50 ? 1.3 : 1)
        * (eff > 7000 ? 1.5 : 1) * (effort < 0.2 ? 1.3 : 1);
      this.frostbite += ((t.frostbite_from_c - air.feelsLikeC) / 30) * t.frostbite_per_h * k * dtH;
    } else if (sheltered || air.feelsLikeC > -10) {
      this.frostbite = Math.max(0, this.frostbite - t.frostbite_heal_per_h * dtH);
    }
    if (this.frostbite >= 0.8) {
      this.frostbite = 0.6;
      this.onPermanentInjury('Frostbitten fingers and toes', t.frostbite_permanent_health);
      this.onMessage('Deep frostbite. Some of your fingers and toes will not recover.');
    }
    this.frostbite = clamp(this.frostbite, 0, 1);

    // Acclimatization.
    if (eff > this.acclimatized) {
      const toward = Math.min(t.acclimatize_max_m, eff);
      if (toward > this.acclimatized) {
        this.acclimatized = Math.min(toward, this.acclimatized + t.acclimatize_m_per_h * Math.min(1, (eff - this.acclimatized) / 500) * dtH);
      }
    } else if (eff < this.acclimatized - 500) {
      this.acclimatized = Math.max(t.acclimatized_start_m, this.acclimatized - t.deacclimatize_m_per_h * dtH);
    }
    const gap = this.altitudeGap;
    const dex = this.dexHours > 0;
    this.dexHours = Math.max(0, this.dexHours - dtH);

    // Death zone.
    if (eff > t.death_zone_m) this.deterioration += t.deterioration_per_km_h * ((eff - t.death_zone_m) / 1000) * dtH;
    else if (eff < 6500) this.deterioration -= 0.02 * dtH;
    this.deterioration = clamp(this.deterioration, 0, 1);

    // Altitude sickness.
    if (gap > t.ams_safe_gap_m) {
      this.ams += t.ams_rate_per_h * ((gap - t.ams_safe_gap_m) / 1000) * (sleeping ? 1.5 : 1)
        * (this.hydration < 50 ? 1.3 : 1) * (dex ? 0.4 : 1) * dtH;
    } else {
      this.ams -= t.ams_recover_per_h * (gap < 0 ? 2 : 1) * dtH;
    }
    this.ams = clamp(this.ams, 0, 1);
    const extra = this.deterioration * 0.03;
    if (this.ams > 0.6 && gap > 800) this.hace += (t.hace_rate_per_h * ((gap - 600) / 1000) * (dex ? 0.3 : 1) + extra) * dtH;
    else this.hace -= (dex ? 0.2 : t.edema_recover_per_h) * (gap < 0 ? 2 : 1) * dtH;
    if (gap > 700) this.hape += (t.hape_rate_per_h * ((gap - 600) / 1000) * (1 + effort) * (air.feelsLikeC < -25 ? 1.5 : 1) + extra) * dtH;
    else this.hape -= t.edema_recover_per_h * (gap < 0 ? 2 : 1) * dtH;
    this.hace = clamp(this.hace, 0, 1);
    this.hape = clamp(this.hape, 0, 1);

    this.rebound = Math.max(0, this.rebound - 0.5 * dtH);
    this.nausea = clamp(Math.max((this.ams - 0.35) / 0.5, this.rebound * 0.8, (gap - 1800) / 1500, this.hace * 0.8), 0, 1);

    this._announce();
    return this._damage(dtH);
  }

  _damage(dtH) {
    const t = tuning;
    if (this.hace >= 1) return { damage: Infinity, cause: 'Your brain swelled from the altitude (HACE).' };
    if (this.hape >= 1) return { damage: Infinity, cause: 'Your lungs filled with fluid from the altitude (HAPE).' };
    if (this.core <= t.hypothermia_death_c) return { damage: Infinity, cause: 'You froze to death.' };
    let damage = 0, cause = null;
    const add = (amount, why) => {
      if (amount <= 0) return;
      if (amount > damage) cause = why;
      damage += amount;
    };
    // Illness wears your health down well before it kills you outright.
    if (this.hace > 0.4) add(t.illness_health_per_h * (this.hace / 0.4) * dtH, 'HACE killed you.');
    if (this.hape > 0.4) add(t.illness_health_per_h * (this.hape / 0.4) * dtH, 'HAPE killed you.');
    if (this.ams > 0.8) add(2 * dtH, 'Altitude sickness wore you down until you could not go on.');
    if (this.core < t.hypothermia_moderate_c) add(5 * dtH, 'You froze to death.');
    if (this.frostbite > 0.6) add(1 * dtH, 'Frostbite and the cold finished you.');
    if (this.deterioration > 0.5) add(2 * dtH, 'The death zone wore you out.');
    if (this.food <= 0) add(1 * dtH, 'You starved.');
    if (this.hydration <= 0) add(15 * dtH, 'You died of dehydration.');
    else if (this.hydration < 10) add(5 * dtH, 'You died of dehydration.');
    return { damage, cause };
  }

  /** Message once each time a condition gets worse. */
  _announce() {
    for (const [key, stages] of Object.entries(STAGES)) {
      const level = this._level(key, stages);
      const prev = this._stage[key] ?? 0;
      if (level > prev) this.onMessage(stages[level - 1][2]);
      this._stage[key] = level;
    }
  }

  _value(key) {
    return { food: this.food, water: this.hydration, cold: this.core }[key] ?? this[key];
  }

  /** 0 for none, else 1 + the index of the worst stage reached. Food, water and cold count down. */
  _level(key, stages) {
    const v = this._value(key);
    const down = key === 'food' || key === 'water' || key === 'cold';
    let level = 0;
    stages.forEach(([at], i) => { if (down ? v < at || (at === 0 && v <= 0) : v >= at) level = i + 1; });
    return level;
  }

  /** The conditions you have now, worst stage of each: [{id, label, severity 0..1}]. */
  conditions() {
    const out = [];
    for (const [key, stages] of Object.entries(STAGES)) {
      const level = this._level(key, stages);
      if (level) out.push({ id: key, label: stages[level - 1][1], severity: level / stages.length });
    }
    return out;
  }

  /** Multipliers the body puts on movement, effort, stamina and slips. */
  modifiers(packKg = tuning.pack_reference_kg) {
    const t = tuning;
    const over = packKg - t.pack_reference_kg;
    const low = this.food < t.low_sugar_below;
    const mild = this.core < t.hypothermia_mild_c;
    const moderate = this.core < t.hypothermia_moderate_c;
    return {
      speed: clamp(1 - t.pack_speed_per_kg * over, 0.4, 1.1)
        * (low ? 0.85 : 1) * (this.food <= 0 ? 0.7 : 1) * (this.hydration < 30 ? 0.85 : 1)
        * (mild ? 0.9 : 1) * (moderate ? 0.6 : 1)
        * (this.ams > 0.5 ? 0.88 : 1) * (this.ams > 0.8 ? 0.8 : 1)
        * (this.hace > 0.3 ? 0.7 : 1) * (this.hape > 0.3 ? 0.7 : 1),
      effort: Math.max(0.6, 1 + t.pack_effort_per_kg * over) * (this.hape > 0.3 ? 1.3 : 1),
      staminaCap: (1 - 0.4 * this.deterioration) * (this.hape > 0.3 ? 1 - 0.5 * this.hape : 1)
        * (this.food <= 0 ? 0.6 : 1) * (1 - 0.3 * this.rebound),
      staminaRecover: (low ? 0.6 : 1) * (this.hydration < 60 ? 0.75 : 1) * (this.nausea > 0.5 ? 0.8 : 1),
      slip: (low ? 1.3 : 1) * (mild ? 1.5 : 1) * (this.hace > 0.3 ? 1 + 2 * this.hace : 1)
        * (this.frostbite > 0.5 ? 1.2 : 1) * (1 + this.rebound),
      /** Stumbling: how much your steering wanders, 0..1. */
      wobble: clamp((this.hace > 0.3 ? this.hace : 0) + (moderate ? 0.5 : 0) + this.rebound * 0.3, 0, 1),
      /** How blurred and dim your vision is, 0..1, for the screen. */
      blur: clamp(Math.max(this.hace, this.rebound * 0.6, this.nausea * 0.3, moderate ? 0.5 : 0), 0, 1),
    };
  }

  /** Eat a snack or a meal from the pack. Returns false if there was none. */
  eat(pack, item = 'snack') {
    if (pack[item] <= 0) return false;
    pack[item]--;
    if (this.nausea > 0.4 && Math.random() < this.nausea * 0.7) {
      this.hydration = Math.max(0, this.hydration - 6);
      this.onMessage('You threw it straight back up. The altitude has taken your appetite.');
      return true;
    }
    this.food = Math.min(100, this.food + (tuning.pack[item].kcal / tuning.food_kcal_full) * 100);
    return true;
  }

  /** Drink litres of water. */
  drink(litres) {
    this.hydration = Math.min(100, this.hydration + (litres / tuning.water_full_deficit_l) * 100);
  }

  takeDex(pack) {
    if (pack.dex <= 0) return false;
    pack.dex--;
    this.dexHours = tuning.pack.dex.hours;
    return true;
  }
}
