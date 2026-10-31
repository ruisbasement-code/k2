class_name ClimberBody
extends RefCounted
## Stamina and breathing for one climber.
##
## Stamina drains when effort is above what the climber can sustain and recovers
## below it, both in mountain time; thinner air drains it faster, refills it slower
## and caps it lower. The breath cycle runs in real time so it stays readable at
## any time scale.

var stamina := 100.0
var exhausted := false
## Breaths per minute.
var breath_rate := 14.0
## Position in the current breath, 0 to 1 (inhale first).
var breath_phase := 0.0


func step(dt_hours: float, effort: float, altitude: float, dt_real: float) -> void:
	var t := PaceModel.tuning()
	var o2 := PaceModel.oxygen_vs_reference(altitude)
	var sustain: float = t.sustainable_effort
	if effort > sustain:
		stamina -= t.drain_per_hour * (effort - sustain) / pow(o2, t.drain_o2_exponent) * dt_hours
	else:
		stamina += t.recover_per_hour * pow(o2, t.recover_o2_exponent) * (sustain - effort) / sustain * dt_hours
	var cap := stamina_cap(altitude)
	if stamina > cap:
		# Thin air slowly wears you down to what it allows.
		stamina = maxf(cap, stamina - t.recover_per_hour * 0.25 * dt_hours)
	stamina = clampf(stamina, 0.0, 100.0)
	if stamina <= 0.0:
		exhausted = true
	elif exhausted and stamina >= t.exhausted_recover_to:
		exhausted = false

	var thin := (1.0 - PaceModel.oxygen_ratio(altitude)) / (1.0 - PaceModel.oxygen_ratio(8611.0))
	var target: float = t.breath_rest + t.breath_altitude * thin + t.breath_effort * effort \
			+ t.breath_tired * (1.0 - stamina / 100.0)
	target = minf(target, t.breath_max)
	breath_rate = lerpf(breath_rate, target, 1.0 - exp(-dt_real * 0.8))
	breath_phase = fmod(breath_phase + dt_real * breath_rate / 60.0, 1.0)


## The most stamina the air at this altitude lets you recover to.
func stamina_cap(altitude: float) -> float:
	var t := PaceModel.tuning()
	var k := clampf((altitude - t.cap_start_altitude) / (8611.0 - t.cap_start_altitude), 0.0, 1.0)
	return lerpf(100.0, t.summit_stamina_cap, k)


## Speed multiplier from how tired the climber is. 0 when exhausted.
func speed_factor() -> float:
	var t := PaceModel.tuning()
	if exhausted:
		return 0.0
	if stamina < t.tired_below:
		return lerpf(t.tired_speed, 1.0, stamina / t.tired_below)
	return 1.0


## How hard the climber is breathing, 0 (calm) to 1 (gasping), for HUD and audio.
func breathlessness() -> float:
	return clampf((breath_rate - 12.0) / 40.0, 0.0, 1.0)
