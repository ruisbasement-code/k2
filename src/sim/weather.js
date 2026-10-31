// The mountain's weather: spells of clear sky, cloud, high winds, fog, snow,
// storms and whiteouts follow each other, with storms building most in the
// afternoon. From the current spell come the air temperature (by hour and
// altitude), the wind (stronger up high and on ridges, gusting), visibility
// (cloud bands, drifting fog, spindrift) and the snowpack that feeds avalanches.
//
// The weather is a seeded timeline in mountain time, so it can be forecast and
// tests can replay it. No rendering here.

import data from '../data/weather.json';

export const weatherTuning = data;
const W = data;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Small seeded random number generator. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1D noise, -1..1, for gusts, drifting fog and the wandering wind. */
function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    let v = Math.imul((n + seed * 7919) | 0, 374761393);
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return (((v ^ (v >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}

/** Wind chill (°C) from air temperature and wind in m/s, the North American formula. */
export function windChill(airC, windMs) {
  const kmh = windMs * 3.6;
  if (airC > 10 || kmh < 4.8) return airC;
  const v = Math.pow(kmh, 0.16);
  return 13.12 + 0.6215 * airC - 11.37 * v + 0.3965 * airC * v;
}

const DANGER = ['Low', 'Moderate', 'Considerable', 'High', 'Extreme'];

/** The avalanche danger scale's name for a danger of 0..1. */
export function dangerLabel(d) {
  return DANGER[clamp(Math.floor(d * 5), 0, 4)];
}

/** Compass name for a direction in degrees from north. */
export function compass(deg) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export class Weather {
  /**
   * @param seed same seed, same weather
   * @param startSeconds mountain time the timeline starts at
   */
  constructor(seed = 1, startSeconds = 0) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    /** Spells: {key, start, end, windDay, sudden}, in mountain seconds. */
    this.spells = [];
    const hours = W.start_hours;
    this.spells.push({ key: W.start_condition, start: startSeconds - 3600, end: startSeconds + hours * 3600, windDay: 1, sudden: false });
    /** Fresh snow in the last days, cm, and how much of it the wind has drifted into slabs (0..1). */
    this.freshCm = W.start_fresh_cm;
    this.windSlab = 0;
    this.time = startSeconds;
    /** Real seconds, for gusts. */
    this.realTime = 0;
    this.current = this._sample(startSeconds);
  }

  /** Pick the spell that follows one. */
  _next(prev) {
    const rng = this.rng;
    const hour = (prev.end / 3600) % 24;
    const [a, b] = W.afternoon_hours;
    const afternoon = hour >= a - 2 && hour <= b;
    const table = { ...W.transitions[prev.key] };
    if (afternoon) {
      table.snow = (table.snow ?? 0) + W.afternoon_storm_bonus * 0.5;
      table.storm = (table.storm ?? 0) + W.afternoon_storm_bonus * 0.5;
    }
    let total = 0;
    for (const k in table) total += table[k];
    let r = rng() * total;
    let key = prev.key;
    for (const k in table) {
      r -= table[k];
      if (r <= 0) { key = k; break; }
    }
    const [h0, h1] = W.conditions[key].hours;
    const hours = h0 + (h1 - h0) * rng() * rng();
    return { key, start: prev.end, end: prev.end + hours * 3600, windDay: 0.7 + 0.6 * rng(), sudden: false };
  }

  /** Make sure the timeline reaches a time. */
  _extend(seconds) {
    while (this.spells[this.spells.length - 1].end < seconds) this.spells.push(this._next(this.spells[this.spells.length - 1]));
  }

  spellAt(seconds) {
    this._extend(seconds);
    const s = this.spells;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].start <= seconds) return { spell: s[i], prev: s[i - 1] ?? s[i] };
    return { spell: s[0], prev: s[0] };
  }

  /** Change the weather right now, for testing and screenshots. Lasts `hours`. */
  force(key, hours = 6) {
    if (!W.conditions[key]) return;
    const t = this.time;
    this._extend(t);
    this.spells = this.spells.filter((s) => s.start < t);
    const last = this.spells[this.spells.length - 1];
    if (last) last.end = t;
    this.spells.push({ key, start: t, end: t + hours * 3600, windDay: 1, sudden: true });
    this.current = this._sample(t);
  }

  /** Blend the spell's settings in from the one before, over its fade time. */
  _sample(seconds) {
    const { spell, prev } = this.spellAt(seconds);
    const c = W.conditions[spell.key];
    const p = W.conditions[prev.key];
    const k = spell.sudden ? 1 : smooth(0, c.fade_min * 60, seconds - spell.start);
    return {
      key: spell.key,
      label: c.label,
      cloud: lerp(p.cloud, c.cloud, k),
      snow: lerp(p.snow, c.snow, k),
      // Visibility changes by ratios, so blend it in log space.
      visibility: Math.exp(lerp(Math.log(p.visibility_m), Math.log(c.visibility_m), k)),
      wind: lerp(p.wind * prev.windDay, c.wind * spell.windDay, k),
      temp: lerp(p.temp, c.temp, k),
    };
  }

  /**
   * Advance to a mountain time. Time jumps (a rescue, a night's sleep) are
   * integrated in steps so the snowpack still builds and settles.
   * @param seconds mountain seconds
   * @param dtReal real seconds this frame, for gusts
   */
  update(seconds, dtReal = 0) {
    this.realTime += dtReal;
    let dt = seconds - this.time;
    if (dt < 0) dt = 0;
    while (dt > 0) {
      const h = Math.min(dt, 600);
      this.time += h;
      dt -= h;
      this._snowpack(h / 3600);
    }
    this.time = seconds;
    this.current = this._sample(seconds);
    return this.current;
  }

  _snowpack(hours) {
    const s = this._sample(this.time);
    this.freshCm += s.snow * W.snow_cm_per_hour * hours;
    const warm = this.airTemperature(5800, (this.time / 3600) % 24) > 0 ? W.warm_settle_mult : 1;
    this.freshCm = Math.max(0, this.freshCm - W.settle_cm_per_hour * warm * hours);
    const wind = W.wind_low_m_s * 2 * s.wind;
    if (wind > W.load_from_m_s && this.freshCm > 2) this.windSlab = Math.min(1, this.windSlab + W.load_per_hour * hours * (wind / W.load_from_m_s));
    else this.windSlab = Math.max(0, this.windSlab - W.load_per_hour * 0.25 * hours * warm);
  }

  /** Air temperature (°C) at an altitude and hour, in the current weather. */
  airTemperature(altitude, hour, s = this.current) {
    const mean = (W.day_high_c + W.day_low_c) / 2;
    const amp = ((W.day_high_c - W.day_low_c) / 2) * (1 - 0.6 * s.cloud);
    // Warmest mid-afternoon, coldest before dawn: a skewed daily wave.
    const rising = hour >= W.coldest_hour && hour < W.warmest_hour;
    const wave = rising
      ? -Math.cos(((hour - W.coldest_hour) / (W.warmest_hour - W.coldest_hour)) * Math.PI)
      : Math.cos((((hour - W.warmest_hour + 24) % 24) / (24 - (W.warmest_hour - W.coldest_hour))) * Math.PI);
    const night = 1 - smooth(5, 8, hour) * (1 - smooth(18, 21, hour));
    const lapse = ((altitude - W.reference_altitude) / 1000) * W.lapse_c_per_km;
    return mean + amp * wave - lapse + s.temp + W.clear_night_extra_c * night * (1 - s.cloud);
  }

  /** Where the wind comes from, degrees from north, wandering around the prevailing westerly. */
  windFromDeg() {
    return W.prevailing_from_deg + W.direction_wander_deg * noise1(this.time / 3600 / 5, this.seed + 3);
  }

  /** How exposed a spot is: 0 deep in a hollow, 0.5 open slope, 1 on a ridge or crest. */
  exposure(hm, x, z) {
    const r = W.ridge_sample_m;
    let mean = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mean += hm.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
    }
    const above = hm.heightAt(x, z) - mean / 8;
    return smooth(-W.ridge_full_m, W.ridge_full_m, above);
  }

  /** Steady wind at an altitude and exposure, m/s, without gusts. */
  windSpeed(altitude, exposure, s = this.current) {
    const k = smooth(W.wind_low_alt, W.wind_high_alt, altitude);
    const base = lerp(W.wind_low_m_s, W.wind_high_m_s, k) * s.wind;
    return base * lerp(W.sheltered_mult, 1.3, exposure);
  }

  /** Gust multiplier now, about 1 (lulls a little under) to 1 + 2 × gust_strength. */
  gustFactor() {
    const t = this.realTime;
    const g = 0.6 * noise1(t / 2.5, this.seed) + 0.4 * noise1(t / 0.7, this.seed + 1);
    return 1 + W.gust_strength * Math.max(g * 1.6, -0.4);
  }

  /** Avalanche danger, 0..1, for snow at an altitude and hour. */
  avalancheDanger(altitude, hour, s = this.current) {
    const fresh = this.freshCm / W.danger_fresh_cm;
    const warm = smooth(-6, 1, this.airTemperature(altitude, hour, s)) * (1 - s.cloud * 0.5) * Math.min(this.freshCm / 15, 1);
    return clamp(fresh * 0.75 + W.danger_wind_weight * this.windSlab + W.danger_warm_weight * warm + 0.05, 0, 1);
  }

  /**
   * Everything about the weather where the climber is, for the HUD, the survival
   * systems and the climber's own movement.
   */
  conditionsAt(hm, position, hour) {
    const s = this.current;
    const alt = position.y;
    const exposure = this.exposure(hm, position.x, position.z);
    const steady = this.windSpeed(alt, exposure);
    const gust = steady * this.gustFactor();
    const fromDeg = this.windFromDeg();
    const toRad = ((fromDeg + 180) * Math.PI) / 180;
    // The cloud band: cloud sits around the middle of the mountain on cloudy days.
    const inCloud = s.cloud > 0.5 ? smooth(W.cloud_base_m - 150, W.cloud_base_m + 100, alt) * (1 - smooth(W.cloud_top_m - 100, W.cloud_top_m + 150, alt)) * smooth(0.5, 0.8, s.cloud) : 0;
    let visibility = Math.exp(lerp(Math.log(s.visibility), Math.log(Math.min(s.visibility, W.in_cloud_visibility_m)), inCloud));
    // Fog and cloud drift through: visibility comes and goes over minutes.
    const drift = noise1(this.time / 240, this.seed + 5) * 0.7 + noise1(this.time / 60, this.seed + 6) * 0.3;
    const murky = smooth(20000, 2000, visibility);
    visibility *= Math.exp(W.flicker * murky * drift * 1.5);
    // Spindrift: strong wind lifts loose snow off ridges.
    const spindrift = smooth(W.spindrift_from_m_s, W.spindrift_from_m_s * 1.8, gust) * Math.min(this.freshCm / 10 + 0.3, 1) * smooth(5200, 6000, alt);
    visibility = Math.exp(lerp(Math.log(visibility), Math.log(Math.min(visibility, W.spindrift_visibility_m)), spindrift));
    const airC = this.airTemperature(alt, hour);
    const danger = this.avalancheDanger(alt, hour);
    return {
      key: s.key,
      label: s.label,
      cloud: s.cloud,
      snowfall: s.snow,
      inCloud,
      visibility: clamp(visibility, 5, 80000),
      airC,
      windChillC: windChill(airC, steady),
      wind: steady,
      gust,
      windFromDeg: fromDeg,
      windX: Math.sin(toRad),
      windZ: -Math.cos(toRad),
      exposure,
      spindrift,
      freshCm: this.freshCm,
      avalancheDanger: danger,
      avalancheLabel: dangerLabel(danger),
    };
  }

  /**
   * The radio forecast from a camp for the next hours: what is coming and roughly
   * when. The timing is a few hours off, the same way each time you ask.
   */
  forecast(seconds, hours = W.forecast_hours) {
    this._extend(seconds + hours * 3600);
    const out = [];
    for (const s of this.spells) {
      if (s.end <= seconds || s.start > seconds + hours * 3600) continue;
      const err = noise1(s.start / 3600, this.seed + 11) * W.forecast_error_hours * 3600;
      const from = s.start <= seconds ? seconds : Math.max(seconds, s.start + err);
      out.push({ key: s.key, label: W.conditions[s.key].label, from, to: s.end + err });
    }
    return out;
  }

  /** The forecast as one line of text. */
  forecastText(seconds) {
    const parts = [];
    for (const f of this.forecast(seconds).slice(0, 4)) {
      if (parts.length && parts[parts.length - 1].key === f.key) continue;
      const day = Math.floor(f.from / 86400) + 1;
      const hh = String(Math.floor((f.from % 86400) / 3600)).padStart(2, '0');
      parts.push({ key: f.key, text: f.from <= seconds + 60 ? `${f.label.toLowerCase()} now` : `${f.label.toLowerCase()} from about ${hh}:00 on day ${day}` });
    }
    const text = parts.map((p) => p.text).join(', then ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}
