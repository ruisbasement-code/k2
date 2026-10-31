extends Node3D
## The player's climber: slope-aware movement (walk, climb, very steep), clipping
## into fixed ropes, stamina and breathing, and the third-person camera.
##
## Movement is simulated in mountain time: the world clock runs time_scale times
## faster than real time, so a realistic 400 m per hour still gets you somewhere.

signal message(text: String)

enum Mode { WALK, CLIMB, STEEP, ROPE, FLY }

const MODE_NAMES := {
	Mode.WALK: "Walking",
	Mode.CLIMB: "Climbing",
	Mode.STEEP: "Very steep",
	Mode.ROPE: "On fixed rope",
	Mode.FLY: "Scout fly",
}
const CLIP_RANGE := 5.0
const EYE_HEIGHT := 1.65

var hm: Heightmap
var ropes: Node
var camera: Camera3D
var body := ClimberBody.new()
var model: Node3D

var mode := Mode.WALK
var ground_mode := Mode.WALK
var time_scale := 10.0
## Seconds since midnight on day 1, mountain time.
var mountain_seconds := 5.0 * 3600.0

var yaw := 0.0
var pitch := -0.2
var cam_distance := 7.0
var first_person := false

var rope_id := -1
var rope_s := 0.0
## Effort this frame (0 resting, 1 steady climbing, more when pushing).
var effort := 0.0
## Current slope under the climber, degrees.
var slope := 0.0
## Vertical speed right now and averaged over the last mountain hour, m per hour.
var vertical_now := 0.0
var vertical_avg := 0.0
var pushing := false
var blocked := false

var _gait := 0.0
var _heading := 0.0
var _slide_time := 0.0
var _slide_velocity := Vector3.ZERO
var _alt_log: Array[Vector2] = []
var _log_timer := 0.0


func setup(heightmap: Heightmap, fixed_ropes: Node, cam: Camera3D) -> void:
	hm = heightmap
	ropes = fixed_ropes
	camera = cam
	var t := PaceModel.tuning()
	time_scale = t.default_time_scale
	mountain_seconds = t.start_hour * 3600.0
	model = preload("res://player/climber_model.gd").new()
	add_child(model)


func place_at(p: Vector3, face_towards: Vector3) -> void:
	_unclip()
	if mode == Mode.FLY:
		mode = Mode.WALK
	position = Vector3(p.x, hm.height_at(p.x, p.z), p.z)
	var d := face_towards - position
	yaw = atan2(-d.x, -d.z)
	_heading = yaw
	_alt_log.clear()


func cycle_time_scale() -> void:
	var scales: Array = PaceModel.tuning().time_scales
	var i := scales.find(int(time_scale))
	time_scale = scales[(i + 1) % scales.size()]
	message.emit("Time: 1 real second = %d mountain seconds" % int(time_scale))


func toggle_clip() -> void:
	if rope_id >= 0:
		_unclip()
		message.emit("Unclipped from the fixed rope")
		return
	if mode == Mode.FLY:
		return
	var near: Dictionary = ropes.nearest(position + Vector3.UP * 0.3)
	if near.rope < 0 or near.distance > CLIP_RANGE:
		message.emit("No fixed rope within reach")
		return
	rope_id = near.rope
	rope_s = near.s
	mode = Mode.ROPE
	message.emit("Clipped into the %s" % ropes.rope_names[rope_id])


func toggle_fly() -> void:
	_unclip()
	mode = Mode.WALK if mode == Mode.FLY else Mode.FLY


## Distance to the nearest rope, for the HUD prompt (INF when none).
func rope_distance() -> float:
	if rope_id >= 0:
		return 0.0
	return ropes.nearest(position + Vector3.UP * 0.3).distance


func mode_name() -> String:
	if mode != Mode.FLY and _slide_time > 0.0:
		return "Sliding!"
	if body.exhausted and mode != Mode.FLY:
		return "Exhausted"
	return MODE_NAMES[mode]


func clock_text() -> String:
	var total := int(mountain_seconds / 60.0)
	return "Day %d  %02d:%02d" % [total / 1440 + 1, (total / 60) % 24, total % 60]


func _unclip() -> void:
	rope_id = -1
	if mode == Mode.ROPE:
		mode = ground_mode


func _process(dt: float) -> void:
	dt = minf(dt, 0.05)
	var dt_m := dt * time_scale
	mountain_seconds += dt_m
	var input := Input.get_vector("move_left", "move_right", "move_back", "move_forward")
	pushing = Input.is_action_pressed("push_pace")
	var start_y := position.y
	blocked = false

	if mode == Mode.FLY:
		_fly(dt, input)
		effort = 0.0
	elif _slide_time > 0.0:
		_slide(dt)
		effort = 0.4
	elif mode == Mode.ROPE:
		_move_on_rope(dt_m, input)
	else:
		_move_on_ground(dt_m, input)

	if mode != Mode.FLY:
		body.step(dt_m / 3600.0, effort, position.y, dt)
		vertical_now = (position.y - start_y) / maxf(dt_m, 0.0001) * 3600.0 if _slide_time <= 0.0 else 0.0
		_track_vertical(dt)
	_animate(dt, input)
	_update_camera()


func _world_dir(input: Vector2) -> Vector3:
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	return fwd * input.y + right * input.x


func _update_ground_mode(s: float) -> void:
	var t := PaceModel.tuning()
	var hy: float = t.mode_hysteresis_deg
	var climb_at: float = t.climb_start_deg + (hy if ground_mode == Mode.WALK else -hy)
	var steep_at: float = t.very_steep_deg + (-hy if ground_mode == Mode.STEEP else hy)
	ground_mode = Mode.WALK if s < climb_at else (Mode.CLIMB if s < steep_at else Mode.STEEP)
	mode = ground_mode


func _move_on_ground(dt_m: float, input: Vector2) -> void:
	var t := PaceModel.tuning()
	var grad := hm.gradient(position.x, position.z)
	slope = rad_to_deg(atan(grad.length()))
	_update_ground_mode(slope)
	var dir := _world_dir(input)
	var amount := minf(dir.length(), 1.0)
	if amount < 0.05:
		effort = 0.0
		return
	dir = dir.normalized()
	var grade := grad.dot(Vector2(dir.x, dir.z))
	var climbing := mode != Mode.WALK
	if mode == Mode.STEEP and slope > t.no_rope_max_deg and grade > 0.0:
		blocked = true
		effort = 0.0
		return
	var speed := PaceModel.ground_speed(climbing, slope, grade, position.y)
	speed *= amount * body.speed_factor()
	if pushing:
		speed *= PaceModel.push_factor(position.y)
	effort = PaceModel.effort(climbing, grade, pushing) * (1.0 if body.speed_factor() > 0.0 else 0.0)
	var step := dir * speed * dt_m
	position.x += step.x
	position.z += step.z
	position = hm.clamp_inside(position)
	position.y = hm.height_at(position.x, position.z)
	_heading = atan2(-dir.x, -dir.z)

	if mode == Mode.STEEP and speed > 0.0:
		var chance := PaceModel.slip_chance_per_min(slope, body.stamina, pushing) * dt_m / 60.0
		if randf() < chance:
			_start_slip(grad)


func _start_slip(grad: Vector2) -> void:
	var t := PaceModel.tuning()
	var down := Vector3(-grad.x, 0.0, -grad.y).normalized()
	var dist := randf_range(t.slip_min_m, t.slip_max_m)
	_slide_time = 1.2
	_slide_velocity = down * dist / _slide_time
	body.stamina = maxf(0.0, body.stamina - t.slip_stamina_cost)
	message.emit("You slipped! Very steep ground is much safer on a fixed rope (C).")


func _slide(dt: float) -> void:
	_slide_time -= dt
	position += _slide_velocity * dt
	position = hm.clamp_inside(position)
	position.y = hm.height_at(position.x, position.z)


func _move_on_rope(dt_m: float, input: Vector2) -> void:
	var tangent: Vector3 = ropes.tangent_at(rope_id, rope_s)
	slope = rad_to_deg(asin(clampf(tangent.y, -1.0, 1.0)))
	var flat := Vector3(tangent.x, 0.0, tangent.z)
	var dir := _world_dir(input)
	var along := input.y
	if flat.length() > 0.05 and dir.length() > 0.05:
		along = dir.dot(flat.normalized())
	if absf(along) < 0.2:
		effort = 0.0
		return
	var up := along > 0.0
	var speed := PaceModel.rope_speed(slope, up, position.y) * minf(absf(along), 1.0) * body.speed_factor()
	if pushing:
		speed *= PaceModel.push_factor(position.y)
	effort = PaceModel.effort(true, 1.0 if up else -1.0, pushing) * (1.0 if body.speed_factor() > 0.0 else 0.0)
	rope_s += (1.0 if up else -1.0) * speed * dt_m
	var length: float = ropes.length_of(rope_id)
	var p: Vector3 = ropes.point_at(rope_id, rope_s)
	position = Vector3(p.x, hm.height_at(p.x, p.z), p.z)
	_heading = atan2(-flat.x, -flat.z) if up else atan2(flat.x, flat.z)
	if rope_s <= 0.0 or rope_s >= length:
		var at_top := rope_s >= length
		_unclip()
		message.emit("Top of the fixed rope. You're on your own from here." if at_top else "Bottom of the fixed rope")


func _fly(dt: float, input: Vector2) -> void:
	var speed := 600.0 if pushing else 120.0
	position += _world_dir(input) * speed * dt
	position.y += Input.get_axis("fly_down", "fly_up") * speed * 0.6 * dt
	position = hm.clamp_inside(position)
	position.y = maxf(position.y, hm.height_at(position.x, position.z) + 2.0)


## Rolling average of vertical speed over the last mountain hour (shorter if we only have less).
func _track_vertical(dt: float) -> void:
	_log_timer += dt
	if _log_timer < 0.25:
		return
	_log_timer = 0.0
	_alt_log.append(Vector2(mountain_seconds, position.y))
	while _alt_log.size() > 2 and mountain_seconds - _alt_log[0].x > 3600.0:
		_alt_log.pop_front()
	var first: Vector2 = _alt_log[0]
	var span := mountain_seconds - first.x
	vertical_avg = (position.y - first.y) / span * 3600.0 if span > 60.0 else vertical_now


func _animate(dt: float, input: Vector2) -> void:
	var moving := effort > 0.0 and input.length() > 0.05 and _slide_time <= 0.0
	# Cadence is shown at a believable rate no matter how fast mountain time runs.
	var cadence := 0.0
	if moving:
		match mode:
			Mode.WALK: cadence = 5.0
			Mode.CLIMB, Mode.STEEP: cadence = 3.0
			Mode.ROPE: cadence = 2.5
	_gait += dt * cadence
	model.rotation.y = lerp_angle(model.rotation.y, _heading, 1.0 - exp(-dt * 10.0))
	var pose := "walk"
	match mode:
		Mode.CLIMB, Mode.STEEP: pose = "climb"
		Mode.ROPE: pose = "rope"
		Mode.FLY: pose = "fly"
	if not moving and mode != Mode.FLY and (body.stamina < body.stamina_cap(position.y) - 5.0 or body.exhausted):
		pose = "rest"
		_gait += dt * body.breath_rate / 60.0 * TAU
	model.pose(pose, _gait, moving, clampf(slope / 30.0, 0.0, 1.0))
	model.visible = not first_person


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * 0.0025
		pitch = clampf(pitch - event.relative.y * 0.0025, -1.45, 1.2)
	elif event is InputEventMouseButton and event.pressed:
		match event.button_index:
			MOUSE_BUTTON_LEFT: Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
			MOUSE_BUTTON_WHEEL_UP: cam_distance = maxf(2.0, cam_distance * 0.88)
			MOUSE_BUTTON_WHEEL_DOWN: cam_distance = minf(80.0, cam_distance * 1.12)
	elif event.is_action_pressed("release_mouse"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event.is_action_pressed("toggle_view"):
		first_person = not first_person
	elif event.is_action_pressed("clip_rope"):
		toggle_clip()
	elif event.is_action_pressed("time_scale"):
		cycle_time_scale()
	elif event.is_action_pressed("scout_fly"):
		toggle_fly()


func _update_camera() -> void:
	if camera == null:
		return
	var eye := position + Vector3.UP * EYE_HEIGHT
	var dir := Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))
	if first_person:
		camera.global_position = eye
		camera.look_at(eye + dir, Vector3.UP)
		return
	var d := maxf(cam_distance, 25.0) if mode == Mode.FLY else cam_distance
	var p := eye - dir * d
	p.y = maxf(p.y, hm.height_at(p.x, p.z) + 0.6)
	camera.global_position = p
	if p.distance_to(eye) > 0.01:
		camera.look_at(eye, Vector3.UP)
