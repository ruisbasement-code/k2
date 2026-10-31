extends SceneTree
## Headless checks for the pace and stamina model, plus simulated climbs of the
## Abruzzi Spur. Run with:
##   godot --headless --import            (once, after cloning)
##   godot --headless --script res://tests/run_tests.gd

const FixedRopes := preload("res://world/fixed_ropes.gd")

var _fails := 0


func _init() -> void:
	_pace_targets()
	_stamina_behaviour()
	_simulated_climbs()
	print("\n%s" % ("ALL CHECKS PASSED" if _fails == 0 else "%d CHECK(S) FAILED" % _fails))
	quit(_fails)


func _check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		_fails += 1


func _pace_targets() -> void:
	print("Vertical pace while moving (m/h), steady effort, no rests:")
	print("  altitude   walk 25°   climb 40°   rope 45°   rope down 45°")
	var rates := {}
	for h in [5000, 6000, 7000, 7600, 8000, 8200, 8400, 8600]:
		var walk := PaceModel.vertical_rate(PaceModel.ground_speed(false, 25.0, tan(deg_to_rad(25.0)), h), tan(deg_to_rad(25.0)))
		var climb := PaceModel.vertical_rate(PaceModel.ground_speed(true, 40.0, tan(deg_to_rad(40.0)), h), tan(deg_to_rad(40.0)))
		var rope := PaceModel.rope_speed(45.0, true, h) * sin(deg_to_rad(45.0)) * 3600.0
		var down := PaceModel.rope_speed(45.0, false, h) * sin(deg_to_rad(45.0)) * 3600.0
		rates[h] = [walk, climb, rope, down]
		print("  %5d m   %7d    %8d    %7d    %10d" % [h, walk, climb, rope, down])
	_check(rates[5000][0] >= 300 and rates[5000][0] <= 500, "walking up 25° at 5,000 m is 300-500 m/h")
	_check(rates[5000][2] >= 300 and rates[5000][2] <= 500, "jumaring a 45° rope at 5,000 m is 300-500 m/h")
	_check(rates[8400][1] < 100 and rates[8400][2] < 110, "near the summit (8,400 m) is about 100 m/h or less")
	_check(rates[8600][1] < 80, "the last metres to the summit are under 80 m/h")
	var falling := true
	for i in range(1, rates.size()):
		falling = falling and rates.values()[i][2] < rates.values()[i - 1][2]
	_check(falling, "pace falls steadily with altitude")
	_check(rates[8000][3] > rates[8000][2] * 2.0, "descending a rope is more than twice as fast as climbing it")
	var flat := PaceModel.walk_speed(0.0) * 3.6
	_check(flat > 4.5 and flat < 5.5, "flat walking at sea level is about 5 km/h (%.1f)" % flat)


func _stamina_behaviour() -> void:
	print("\nStamina:")
	for h in [5000.0, 7000.0, 8400.0]:
		var b := ClimberBody.new()
		var climb := _minutes_until(b, 1.0, h, func(): return b.stamina <= 0.0)
		b.stamina = 100.0
		var push := _minutes_until(b, 1.6, h, func(): return b.stamina <= 0.0)
		b.stamina = 0.0
		b.exhausted = true
		var rest := _minutes_until(b, 0.0, h, func(): return b.stamina >= b.stamina_cap(h) * 0.8)
		print("  %5d m: steady climbing empties it in %3d min, pushing in %3d min, resting refills 80%% in %3d min (cap %d)" \
				% [h, climb, push, rest, b.stamina_cap(h)])
		if h == 5000.0:
			_check(climb >= 60 and climb <= 150, "at Base Camp altitude you can climb steadily for 1-2.5 hours")
			_check(push < climb / 2, "pushing the pace drains stamina more than twice as fast")
			_check(rest <= 20, "a short rest refills you at Base Camp altitude")
		if h == 8400.0:
			_check(climb < 45, "above 8,000 m stamina goes quickly")
			_check(rest >= 30, "above 8,000 m recovery is slow")
			_check(b.stamina_cap(h) < 75, "above 8,000 m you never fully recover")
	var b := ClimberBody.new()
	for i in 600:
		b.step(1.0 / 3600.0, 0.45, 5000.0, 0.1)
	_check(b.stamina >= 99.0, "walking on the flat at an easy pace does not drain stamina")
	var calm := ClimberBody.new()
	var hard := ClimberBody.new()
	for i in 200:
		calm.step(0.0, 0.0, 5000.0, 0.1)
		hard.step(0.0, 1.6, 8400.0, 0.1)
	print("  breathing: resting at 5,000 m %d/min, pushing at 8,400 m %d/min" % [calm.breath_rate, hard.breath_rate])
	_check(calm.breath_rate < 22.0 and hard.breath_rate > 40.0, "breathing rate follows effort and altitude")


func _minutes_until(b: ClimberBody, effort: float, h: float, done: Callable) -> int:
	for m in 600:
		if done.call():
			return m
		b.step(1.0 / 60.0, effort, h, 0.0)
	return 600


## A careful player on the fixed ropes: climb steadily, stop when stamina is nearly
## gone, rest until it is back to 70% of what the altitude allows.
func _simulated_climbs() -> void:
	print("\nSimulated climbs (steady pace, resting when spent):")
	var hm := Heightmap.load_default()
	var route: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/route.json"))
	var ropes := FixedRopes.new()
	ropes.build(hm, route.fixed_ropes)
	var hours := []
	for r in ropes.ropes.size():
		var b := ClimberBody.new()
		var s := 0.0
		var t := 0.0
		var resting := false
		var dt := 10.0
		var length: float = ropes.length_of(r)
		var bottom: float = ropes.point_at(r, 0.0).y
		var top: float = ropes.point_at(r, length).y
		while s < length and t < 48.0 * 3600.0:
			var p: Vector3 = ropes.point_at(r, s)
			if resting or b.exhausted or b.stamina < 5.0:
				resting = b.stamina < b.stamina_cap(p.y) * 0.7
				b.step(dt / 3600.0, 0.0, p.y, dt)
			else:
				var incline := rad_to_deg(asin(ropes.tangent_at(r, s).y))
				s += PaceModel.rope_speed(incline, true, p.y) * b.speed_factor() * dt
				b.step(dt / 3600.0, 1.0, p.y, dt)
			t += dt
		hours.append(t / 3600.0)
		print("  %s: %d m to %d m (%d m of rope) in %.1f hours, %d m/h overall" \
				% [ropes.rope_names[r], bottom, top, length, t / 3600.0, (top - bottom) / (t / 3600.0)])
	ropes.free()
	_check(hours[0] >= 8.0 and hours[0] <= 22.0, "Advanced Base Camp to Camp 4 on the ropes takes 8-22 hours of climbing")
	_check(hours[1] >= 6.0 and hours[1] <= 12.0, "the Bottleneck and Traverse ropes (7,900 to 8,450 m) take 6-12 hours, like a real summit morning")
