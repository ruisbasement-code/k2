extends Node3D
## Boots the K2 scene: loads the heightmap, builds the terrain, ropes and camps,
## and puts the climber at Base Camp.
##
## For automated screenshots: godot -- --shot=out.png [--place=N] [--yaw=deg]
## [--pitch=deg] [--dist=m] [--fp] [--rope]

const SUN_DIR := Vector3(-0.55, 0.62, 0.55)

var hm: Heightmap
var places: Array = []
var _shot := {}
var _frames := 0

@onready var climber: Node3D = $Climber


func _ready() -> void:
	Controls.install()
	hm = Heightmap.load_default()
	var route: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/route.json"))
	places = route.places
	$Terrain.build(hm)
	$FixedRopes.build(hm, route.fixed_ropes)
	$Camps.build(hm, places)
	climber.setup(hm, $FixedRopes, $Camera3D)
	$HUD.setup(hm, climber, places)
	$BreathAudio.body = climber.body
	$Sun.look_at_from_position(Vector3.ZERO, -SUN_DIR.normalized(), Vector3.UP)
	teleport(0)
	climber.message.emit("K2 Base Camp, 5,000 m. The fixed ropes start at Advanced Base Camp (2).")
	_parse_args()


func teleport(i: int) -> void:
	if i < 0 or i >= places.size():
		return
	var p: Dictionary = places[i]
	var w := hm.grid_to_world(p.r, p.c)
	var target := Vector3.ZERO if p.name != "Summit" else Vector3(0, 0, 1000)
	climber.place_at(Vector3(w.x, 0, w.y), target)
	climber.message.emit("%s: %s" % [p.name, p.note])


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var k: int = event.physical_keycode
		if k >= KEY_1 and k <= KEY_9:
			teleport(k - KEY_1)
	if event.is_action_pressed("mute"):
		$BreathAudio.muted = not $BreathAudio.muted


func _process(_dt: float) -> void:
	# Keep the shadow camera on the climber.
	$Sun.global_position = climber.position
	if _shot.is_empty():
		return
	_frames += 1
	if _frames == 3:
		_apply_shot_view()
	if _frames == int(_shot.get("frames", "40")):
		var path: String = _shot.shot
		get_viewport().get_texture().get_image().save_png(path)
		print("saved ", path)
		get_tree().quit()


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		_shot[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if not _shot.has("shot"):
		_shot.clear()


func _apply_shot_view() -> void:
	if _shot.has("place"):
		teleport(int(_shot.place))
	if _shot.has("rope"):
		climber.toggle_clip()
	if _shot.has("yaw"):
		climber.yaw = deg_to_rad(float(_shot.yaw))
	if _shot.has("pitch"):
		climber.pitch = deg_to_rad(float(_shot.pitch))
	if _shot.has("dist"):
		climber.cam_distance = float(_shot.dist)
	if _shot.has("fp"):
		climber.first_person = true
	if _shot.has("fly"):
		climber.toggle_fly()
		climber.position.y += float(_shot.fly)
