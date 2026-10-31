class_name PaceModel
extends RefCounted
## How fast a climber moves on K2, and how hard it is.
##
## Speeds are metres per second of mountain time. Walking follows Tobler's hiking
## function; climbing uses a vertical rate per slope angle plus a traverse rate;
## both are scaled down with altitude. All numbers come from data/tuning.json.

const TUNING_PATH := "res://data/tuning.json"

static var _tuning: Dictionary = {}


static func tuning() -> Dictionary:
	if _tuning.is_empty():
		_tuning = JSON.parse_string(FileAccess.get_file_as_string(TUNING_PATH))
	return _tuning


## Piecewise linear lookup in a list of [x, y] pairs sorted by x.
static func curve(points: Array, x: float) -> float:
	if x <= points[0][0]:
		return points[0][1]
	for i in range(1, points.size()):
		if x <= points[i][0]:
			var a: Array = points[i - 1]
			var b: Array = points[i]
			return lerpf(a[1], b[1], (x - a[0]) / (b[0] - a[0]))
	return points[-1][1]


## Air pressure (and so oxygen) relative to sea level. About 0.34 on the summit.
static func oxygen_ratio(altitude: float) -> float:
	return exp(-altitude / tuning().scale_height_m)


## Oxygen relative to Base Camp, where the stamina numbers are calibrated.
static func oxygen_vs_reference(altitude: float) -> float:
	return oxygen_ratio(altitude) / oxygen_ratio(tuning().reference_altitude)


static func altitude_factor(altitude: float) -> float:
	return curve(tuning().altitude_pace, altitude)


## Altitude slows descents less than ascents.
static func altitude_factor_for(altitude: float, grade: float) -> float:
	var f := altitude_factor(altitude)
	if grade < -0.05:
		f = pow(f, tuning().descent_altitude_exponent)
	return f


## Horizontal walking speed at sea level for a grade (rise over run).
static func walk_speed(grade: float) -> float:
	return tuning().tobler_kmh * exp(-3.5 * absf(grade + 0.05)) / 3.6


## Horizontal climbing speed at sea level on a slope, moving at a grade.
## Every horizontal metre costs a traverse time plus the time to gain or lose its height.
static func climb_speed(slope_deg: float, grade: float) -> float:
	var t := tuning()
	var vertical: float = curve(t.climb_vertical_m_per_h, slope_deg) / 3600.0
	if grade < 0.0:
		vertical *= t.downclimb_mult
	var traverse: float = t.climb_traverse_kmh / 3.6
	return 1.0 / (1.0 / traverse + absf(grade) / vertical)


## Horizontal ground speed, scaled for altitude.
static func ground_speed(climbing: bool, slope_deg: float, grade: float, altitude: float) -> float:
	var v := climb_speed(slope_deg, grade) if climbing else walk_speed(grade)
	return v * altitude_factor_for(altitude, grade) * tuning().load_factor


## Speed along a fixed rope that rises at incline_deg, going up or down it.
static func rope_speed(incline_deg: float, up: bool, altitude: float) -> float:
	var t := tuning()
	var a := deg_to_rad(clampf(absf(incline_deg), 0.0, 85.0))
	var grade := tan(a) * (1.0 if up else -1.0)
	var slope := maxf(absf(incline_deg), t.climb_start_deg)
	var along := climb_speed(slope, grade) / cos(a)
	var bonus: float = t.rope_up_bonus if up else t.rope_down_bonus
	return along * bonus * altitude_factor_for(altitude, grade) * t.load_factor


## Vertical metres per hour for a horizontal speed and grade, for the HUD.
static func vertical_rate(horizontal_speed: float, grade: float) -> float:
	return horizontal_speed * grade * 3600.0


## Pushing the pace helps less as the air thins.
static func push_factor(altitude: float) -> float:
	var t := tuning()
	var rel := clampf(altitude_factor(altitude) / altitude_factor(t.reference_altitude), 0.0, 1.0)
	return 1.0 + t.push_speed_bonus * rel


## Effort relative to a steady uphill pace (1.0). Resting is 0.
static func effort(climbing: bool, grade: float, push: bool) -> float:
	var t := tuning()
	var e: float = t.effort_flat
	if grade > 0.03:
		e = lerpf(t.effort_flat, t.effort_uphill, clampf(grade / t.effort_uphill_full_grade, 0.0, 1.0))
	elif grade < -0.03:
		e = t.effort_downhill
	if climbing:
		e = maxf(e, t.effort_climb_min)
	return e * (t.push_effort if push else 1.0)


## Chance per mountain minute of slipping when moving unroped on very steep ground.
static func slip_chance_per_min(slope_deg: float, stamina: float, push: bool) -> float:
	var t := tuning()
	var over: float = maxf(0.0, slope_deg - t.very_steep_deg) / (60.0 - t.very_steep_deg)
	var tired: float = 1.0 + 2.0 * (1.0 - stamina / 100.0)
	return t.slip_per_min_at_60deg * over * over * tired * (2.0 if push else 1.0)
