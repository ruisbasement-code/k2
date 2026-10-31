// The air around the climber: temperature and wind by altitude and time of day,
// and how cold that feels.
//
// This is a simple fair-weather model for a K2 summer. The weather can replace it:
// anything set on climber.environment (airTempC, windMs, wet, ...) wins over it.

import { tuning } from './paceModel.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

/** Fair-weather air temperature (°C) and wind (m/s) at an altitude and hour. */
export function defaultAir(altitude, hour) {
  const t = tuning;
  const daily = Math.cos(((hour - t.air_warmest_hour) / 24) * Math.PI * 2);
  const airTempC = t.air_base_camp_mean_c + t.air_daily_swing_c * daily - (t.lapse_c_per_km * (altitude - 5000)) / 1000;
  const k = clamp((altitude - t.wind_rise_from_m) / (8611 - t.wind_rise_from_m), 0, 1);
  const windMs = t.wind_low_m_s + (t.wind_summit_m_s - t.wind_low_m_s) * k;
  return { airTempC, windMs };
}

/** Wind chill (the North American formula), °C. Calm or warm air feels as it is. */
export function windChill(tempC, windMs) {
  const v = windMs * 3.6;
  if (tempC > 10 || v < 4.8) return tempC;
  const p = Math.pow(v, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * p + 0.3965 * tempC * p;
}

/** The air here, with any overrides from the weather. */
export function airAt(altitude, hour, overrides = {}) {
  const base = defaultAir(altitude, hour);
  const air = { wet: 0, ...base };
  for (const [k, v] of Object.entries(overrides)) if (v != null) air[k] = v;
  air.feelsLikeC = windChill(air.airTempC, air.windMs);
  return air;
}
