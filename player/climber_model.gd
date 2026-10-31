extends Node3D
## Grey-box climber: an orange down suit with a pack, posed for walking, climbing,
## jumaring a fixed rope and resting.

var hips: Node3D
var legs: Array[Node3D] = []
var arms: Array[Node3D] = []


func _ready() -> void:
	var suit := _mat(Color(1.0, 0.42, 0.1), 0.7)
	var dark := _mat(Color(0.13, 0.16, 0.19), 0.8)
	var pack := _mat(Color(0.18, 0.36, 0.62), 0.8)
	var goggles := _mat(Color(0.5, 0.8, 1.0), 0.1)
	goggles.metallic = 0.6

	hips = Node3D.new()
	hips.position.y = 0.85
	add_child(hips)
	_part(hips, _capsule(0.25, 0.85), suit, Vector3(0, 0.32, 0))
	_part(hips, _sphere(0.16), dark, Vector3(0, 0.83, 0))
	_part(hips, _box(Vector3(0.22, 0.07, 0.06)), goggles, Vector3(0, 0.85, -0.14))
	_part(hips, _box(Vector3(0.4, 0.55, 0.24)), pack, Vector3(0, 0.4, 0.27))
	for s in [-1.0, 1.0]:
		var leg := Node3D.new()
		leg.position = Vector3(0.11 * s, 0.85, 0)
		add_child(leg)
		_part(leg, _capsule(0.1, 0.8), dark, Vector3(0, -0.4, 0))
		legs.append(leg)
		var arm := Node3D.new()
		arm.position = Vector3(0.31 * s, 0.57, 0)
		hips.add_child(arm)
		_part(arm, _capsule(0.08, 0.62), suit, Vector3(0, -0.3, 0))
		arms.append(arm)


## Pose for a mode name ("walk", "climb", "rope", "rest", "fly"), gait phase in radians,
## and how steep the ground is ahead (lean).
func pose(mode: String, phase: float, moving: bool, lean: float) -> void:
	var sw := sin(phase) if moving else 0.0
	var t := 0.0
	match mode:
		"walk":
			hips.rotation.x = -0.25 * lean
			_pose_pair(legs, sw * 0.55, -sw * 0.55)
			_pose_pair(arms, -sw * 0.6, sw * 0.6)
		"climb":
			# Facing into the slope, swinging the axe and kicking crampons in.
			hips.rotation.x = -0.45
			_pose_pair(legs, -0.5 + sw * 0.45, -0.5 - sw * 0.45)
			_pose_pair(arms, -2.2 + sw * 0.6, -1.0 - sw * 0.6)
		"rope":
			# Left hand on the jumar, right arm on the rope below it.
			hips.rotation.x = -0.35
			_pose_pair(legs, -0.3 + sw * 0.4, -0.3 - sw * 0.4)
			_pose_pair(arms, -2.6 + sw * 0.25, -1.3)
		"rest":
			# Bent over, hands on knees, catching your breath.
			t = sin(phase) * 0.04
			hips.rotation.x = -0.75 - t
			_pose_pair(legs, -0.25, -0.25)
			_pose_pair(arms, 0.35, 0.35)
		_:
			hips.rotation.x = 0.0
			_pose_pair(legs, 0.0, 0.0)
			_pose_pair(arms, 0.0, 0.0)


func _pose_pair(pair: Array[Node3D], a: float, b: float) -> void:
	pair[0].rotation.x = a
	pair[1].rotation.x = b


func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	parent.add_child(mi)


func _mat(c: Color, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


func _capsule(radius: float, height: float) -> CapsuleMesh:
	var m := CapsuleMesh.new()
	m.radius = radius
	m.height = height
	return m


func _sphere(radius: float) -> SphereMesh:
	var m := SphereMesh.new()
	m.radius = radius
	m.height = radius * 2.0
	return m


func _box(size: Vector3) -> BoxMesh:
	var m := BoxMesh.new()
	m.size = size
	return m
