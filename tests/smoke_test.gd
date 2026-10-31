extends SceneTree
## Loads the real game scene headless and drives the climber with simulated key
## presses: walk at Base Camp, jumar up the first fixed rope, rest, and slide off
## very steep ground. Run with:
##   godot --headless --script res://tests/smoke_test.gd

var main: Node3D
var climber: Node3D
var _frame := 0
var _step := 0
var _mark := {}
var _fails := 0


func _initialize() -> void:
	main = load("res://main.tscn").instantiate()
	root.add_child(main)


func _check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		_fails += 1


func _face_rope_up() -> void:
	var t: Vector3 = climber.ropes.tangent_at(climber.rope_id, climber.rope_s)
	climber.yaw = atan2(-t.x, -t.z)


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < 3:
		return false
	climber = main.climber
	match _step:
		0:
			main.teleport(0)
			climber.yaw = 0.0
			_mark = {"pos": climber.position, "frame": _frame}
			Input.action_press("move_forward")
			_step = 1
		1:
			if _frame - _mark.frame >= 120:
				Input.action_release("move_forward")
				var moved: float = (climber.position - _mark.pos).length()
				print("  walked %.0f m at Base Camp, mode %s" % [moved, climber.mode_name()])
				_check(moved > 5.0, "WASD walks the climber across Base Camp")
				main.teleport(1)
				climber.toggle_clip()
				_check(climber.rope_id == 0, "C clips into the fixed rope at Advanced Base Camp")
				_face_rope_up()
				_mark = {"pos": climber.position, "frame": _frame, "stamina": climber.body.stamina, "clock": climber.mountain_seconds}
				Input.action_press("move_forward")
				_step = 2
		2:
			_face_rope_up()
			if _frame - _mark.frame >= 600:
				Input.action_release("move_forward")
				var gained: float = climber.position.y - _mark.pos.y
				var hours: float = (climber.mountain_seconds - _mark.clock) / 3600.0
				print("  rope: gained %.0f m in %.2f mountain hours (%.0f m/h), stamina %.0f -> %.0f" \
						% [gained, hours, gained / hours, _mark.stamina, climber.body.stamina])
				_check(gained > 5.0, "holding W climbs the rope")
				_check(gained / hours > 250.0 and gained / hours < 500.0, "rope pace at ~5,400 m is 250-500 m/h")
				_check(climber.body.stamina < _mark.stamina, "climbing drains stamina")
				_mark = {"frame": _frame, "stamina": climber.body.stamina}
				_step = 3
		3:
			if _frame - _mark.frame >= 300:
				_check(climber.body.stamina > _mark.stamina, "standing still recovers stamina")
				_check(climber.vertical_now == 0.0, "vertical rate reads 0 when stopped")
				climber.toggle_clip()
				_check(climber.rope_id == -1, "C unclips again")
				_step = 4
		4:
			# Find the steepest ground near Camp 1 and try to walk straight up it, unroped.
			var hm: Heightmap = main.hm
			var best := Vector3.ZERO
			var best_s := 0.0
			var c1 := hm.grid_to_world(379, 366)
			for dx in range(-300, 300, 15):
				for dz in range(-300, 300, 15):
					var s := hm.slope_deg(c1.x + dx, c1.y + dz)
					if s > best_s and s < 64.0:
						best_s = s
						best = Vector3(c1.x + dx, 0, c1.y + dz)
			climber.place_at(best, best)
			var g := hm.gradient(best.x, best.z)
			climber.yaw = atan2(g.x, g.y)
			climber.body.stamina = 10.0
			_mark = {"frame": _frame, "pos": climber.position, "slope": best_s, "slipped": false}
			climber.message.connect(func(t: String): if t.begins_with("You slipped"): _mark.slipped = true)
			Input.action_press("move_forward")
			Input.action_press("push_pace")
			_step = 5
		5:
			if _frame - _mark.frame == 2:
				print("  unroped on %.0f° ground: mode %s" % [_mark.slope, climber.mode_name()])
				_check(climber.mode == climber.Mode.STEEP, "ground over 45° counts as very steep")
			if _mark.slipped or _frame - _mark.frame >= 1500:
				Input.action_release("move_forward")
				Input.action_release("push_pace")
				_check(_mark.slipped, "pushing tired up very steep ground unroped ends in a slip")
				print("\n%s" % ("ALL CHECKS PASSED" if _fails == 0 else "%d CHECK(S) FAILED" % _fails))
				quit(_fails)
				return true
	return false
