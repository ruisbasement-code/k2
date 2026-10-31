// How fast a climber moves on K2, and how hard it is.
//
// Speeds are metres per second of mountain time. Walking follows Tobler's hiking
// function; climbing uses a vertical rate per slope angle plus a traverse rate;
// both are scaled down with altitude. All numbers come from src/data/tuning.json.

import tuning from '../data/tuning.json';

export { tuning };

const rad = (d) => (d * Math.PI) / 180;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const lerp = (a, b, t) => a + (b - a) * t;

/** Piecewise linear lookup in a list of [x, y] pairs sorted by x. */
export function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return points[points.length - 1][1];
}

/** Air pressure (and so oxygen) relative to sea level. About 0.34 on the summit. */
export function oxygenRatio(altitude) {
  return Math.exp(-altitude / tuning.scale_height_m);
}

/** Oxygen relative to Base Camp, where the stamina numbers are calibrated. */
export function oxygenVsReference(altitude) {
  return oxygenRatio(altitude) / oxygenRatio(tuning.reference_altitude);
}

export function altitudeFactor(altitude) {
  return curve(tuning.altitude_pace, altitude);
}

/** Altitude slows descents less than ascents. */
export function altitudeFactorFor(altitude, grade) {
  const f = altitudeFactor(altitude);
  return grade < -0.05 ? Math.pow(f, tuning.descent_altitude_exponent) : f;
}

/** Horizontal walking speed at sea level for a grade (rise over run). */
export function walkSpeed(grade) {
  return (tuning.tobler_kmh * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6;
}

/**
 * Horizontal climbing speed at sea level on a slope, moving at a grade.
 * Every horizontal metre costs a traverse time plus the time to gain or lose its height.
 */
export function climbSpeed(slopeDeg, grade) {
  let vertical = curve(tuning.climb_vertical_m_per_h, slopeDeg) / 3600;
  if (grade < 0) vertical *= tuning.downclimb_mult;
  const traverse = tuning.climb_traverse_kmh / 3.6;
  return 1 / (1 / traverse + Math.abs(grade) / vertical);
}

/** Horizontal ground speed, scaled for altitude. */
export function groundSpeed(climbing, slopeDeg, grade, altitude) {
  const v = climbing ? climbSpeed(slopeDeg, grade) : walkSpeed(grade);
  return v * altitudeFactorFor(altitude, grade) * tuning.load_factor;
}

/** Speed along a fixed rope that rises at inclineDeg, going up or down it. */
export function ropeSpeed(inclineDeg, up, altitude) {
  const a = rad(clamp(Math.abs(inclineDeg), 0, 85));
  const grade = Math.tan(a) * (up ? 1 : -1);
  const slope = Math.max(Math.abs(inclineDeg), tuning.climb_start_deg);
  const along = climbSpeed(slope, grade) / Math.cos(a);
  const bonus = up ? tuning.rope_up_bonus : tuning.rope_down_bonus;
  return along * bonus * altitudeFactorFor(altitude, grade) * tuning.load_factor;
}

/** Vertical metres per hour for a horizontal speed and grade, for the HUD. */
export function verticalRate(horizontalSpeed, grade) {
  return horizontalSpeed * grade * 3600;
}

/** Pushing the pace helps less as the air thins. */
export function pushFactor(altitude) {
  const rel = clamp(altitudeFactor(altitude) / altitudeFactor(tuning.reference_altitude), 0, 1);
  return 1 + tuning.push_speed_bonus * rel;
}

/** Effort relative to a steady uphill pace (1.0). Resting is 0. */
export function effort(climbing, grade, push) {
  let e = tuning.effort_flat;
  if (grade > 0.03) {
    e = lerp(tuning.effort_flat, tuning.effort_uphill, clamp(grade / tuning.effort_uphill_full_grade, 0, 1));
  } else if (grade < -0.03) {
    e = tuning.effort_downhill;
  }
  if (climbing) e = Math.max(e, tuning.effort_climb_min);
  return e * (push ? tuning.push_effort : 1);
}

/**
 * What the ground is made of, from altitude and slope. A simple version of what the
 * terrain shader paints, without its noise: deep soft snow on gentle slopes, firm
 * wind-packed snow on steeper ones, hard ice on steep faces high up, rock where
 * nothing sticks, scree and glacier low down.
 */
/**
 * How warm the afternoon sun has made the snow, 0 (frozen) to 1 (soft), at an hour
 * of the day and altitude. High up it never softens.
 */
export function sunWarmth(hour, altitude) {
  if (hour == null || altitude > tuning.soften_below_m) return 0;
  const k = 1 - Math.abs(hour - tuning.sun_peak_hour) / tuning.sun_soft_hours;
  return Math.min(Math.max(k, 0), 1);
}

/**
 * The ground underfoot. Open snow slopes are wind crust up high, powder on the flat
 * and firm snow between; afternoon sun turns low snow to slush.
 */
export function surfaceAt(altitude, slopeDeg, glacier = 0, hour = null) {
  let key = 'rock';
  if (glacier > 0.5) key = 'glacier';
  else if (altitude < 5400 && slopeDeg < 32) key = 'scree';
  else if (altitude > 5700 && slopeDeg >= 30 && slopeDeg < 55) key = 'ice';
  else if (altitude > 4900 && slopeDeg < 20) key = 'soft_snow';
  else if (altitude > 4900 && slopeDeg < 45) key = 'firm_snow';
  if (altitude > tuning.crust_above_m && (key === 'firm_snow' || (key === 'soft_snow' && slopeDeg > 8))) key = 'crust';
  if ((key === 'firm_snow' || key === 'soft_snow') && sunWarmth(hour, altitude) > 0.5) key = 'slush';
  return { key, ...tuning.surfaces[key] };
}

/** Chance per mountain minute of slipping when unroped on steep ground. */
export function slipChancePerMin(slopeDeg, push, surface = 'firm_snow', moving = true) {
  const over = Math.max(0, slopeDeg - tuning.climb_start_deg) / (tuning.no_rope_max_deg - tuning.climb_start_deg);
  const s = tuning.surfaces[surface]?.slip ?? 1;
  return tuning.slip_per_min_at_limit * Math.pow(over, 1.5) * (push ? 2 : 1) * s
    * (moving ? 1 : tuning.slip_standing_mult);
}

/**
 * Chance of slipping on one step on steep unroped ground (or on the rope, scaled
 * down). Careless steps and steps down are riskier.
 */
export function slipChancePerStep(slopeDeg, { surface = 'firm_snow', careless = false, turning = false, downhill = false } = {}) {
  const over = Math.max(0, slopeDeg - tuning.climb_start_deg) / (tuning.no_rope_max_deg - tuning.climb_start_deg);
  const s = tuning.surfaces[surface]?.slip ?? 1;
  return tuning.slip_per_step_at_limit * Math.pow(over, 1.5) * s
    * (careless ? tuning.careless_step_mult : 1)
    * (turning ? tuning.turn_step_mult : 1)
    * (downhill ? tuning.descent_slip_mult : 1);
}

/** Chance per mountain minute of tripping while going downhill. */
export function tripChancePerMin(slopeDeg, push) {
  const over = Math.max(0, slopeDeg - tuning.trip_start_deg) / (tuning.climb_start_deg - tuning.trip_start_deg);
  return tuning.trip_per_min_at_climb_start * over * over * (push ? 1 : tuning.trip_careful_mult);
}

/** Breaths a climber needs for each step uphill at this altitude. */
export function breathsPerStep(altitude) {
  return curve(tuning.breaths_per_step, altitude);
}
