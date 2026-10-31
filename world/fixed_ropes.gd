extends Node3D
## Fixed ropes on the Abruzzi Spur. Each rope is a polyline hugging the terrain,
## ordered from its bottom end to its top end.

const ROPE_HEIGHT := 0.35
const SPACING := 6.0
const ANCHOR_EVERY := 60.0

var rope_names: PackedStringArray = []
var ropes: Array[PackedVector3Array] = []
## Cumulative distance along each rope at each point.
var lengths: Array[PackedFloat32Array] = []


func build(hm: Heightmap, defs: Array) -> void:
	for def in defs:
		var pts := PackedVector3Array()
		var wps: Array = def.points
		for i in wps.size() - 1:
			var a := hm.grid_to_world(wps[i][0], wps[i][1])
			var b := hm.grid_to_world(wps[i + 1][0], wps[i + 1][1])
			var steps := maxi(1, ceili(a.distance_to(b) / SPACING))
			for s in steps:
				var p := a.lerp(b, float(s) / steps)
				pts.append(Vector3(p.x, hm.height_at(p.x, p.y) + ROPE_HEIGHT, p.y))
		var last := hm.grid_to_world(wps[-1][0], wps[-1][1])
		pts.append(Vector3(last.x, hm.height_at(last.x, last.y) + ROPE_HEIGHT, last.y))
		var cum := PackedFloat32Array()
		cum.resize(pts.size())
		for i in range(1, pts.size()):
			cum[i] = cum[i - 1] + pts[i].distance_to(pts[i - 1])
		rope_names.append(def.name)
		ropes.append(pts)
		lengths.append(cum)
		_add_mesh(pts, cum)


func length_of(rope: int) -> float:
	return lengths[rope][-1]


func _segment(rope: int, s: float) -> int:
	var cum := lengths[rope]
	var i := cum.bsearch(clampf(s, 0.0, cum[-1]))
	return clampi(i - 1, 0, cum.size() - 2)


func point_at(rope: int, s: float) -> Vector3:
	var i := _segment(rope, s)
	var cum := lengths[rope]
	var t := clampf((s - cum[i]) / maxf(cum[i + 1] - cum[i], 0.001), 0.0, 1.0)
	return ropes[rope][i].lerp(ropes[rope][i + 1], t)


## Unit direction up the rope at distance s.
func tangent_at(rope: int, s: float) -> Vector3:
	var i := _segment(rope, s)
	return (ropes[rope][i + 1] - ropes[rope][i]).normalized()


## Nearest rope to p: {rope, s, distance}. rope is -1 when there are none.
func nearest(p: Vector3) -> Dictionary:
	var best := {"rope": -1, "s": 0.0, "distance": INF}
	for r in ropes.size():
		var pts := ropes[r]
		for i in pts.size() - 1:
			var a := pts[i]
			var ab := pts[i + 1] - a
			var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
			var d := p.distance_to(a + ab * t)
			if d < best.distance:
				best = {"rope": r, "s": lengths[r][i] + ab.length() * t, "distance": d}
	return best


## The rope as two crossed ribbons (visible from any side) plus anchor stakes.
func _add_mesh(pts: PackedVector3Array, cum: PackedFloat32Array) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var w := 0.05
	for i in pts.size() - 1:
		var a := pts[i]
		var b := pts[i + 1]
		var side := (b - a).cross(Vector3.UP).normalized() * w
		var up := Vector3.UP * w
		for off in [side, up]:
			st.add_vertex(a - off); st.add_vertex(a + off); st.add_vertex(b + off)
			st.add_vertex(a - off); st.add_vertex(b + off); st.add_vertex(b - off)
	var rope_mat := StandardMaterial3D.new()
	rope_mat.albedo_color = Color(0.95, 0.28, 0.08)
	rope_mat.emission_enabled = true
	rope_mat.emission = Color(0.5, 0.1, 0.02)
	rope_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = rope_mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

	var stake := CylinderMesh.new()
	stake.top_radius = 0.03
	stake.bottom_radius = 0.03
	stake.height = 0.7
	var stake_mat := StandardMaterial3D.new()
	stake_mat.albedo_color = Color(0.7, 0.72, 0.75)
	stake_mat.metallic = 0.8
	stake_mat.roughness = 0.35
	stake.material = stake_mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = stake
	var count := int(cum[-1] / ANCHOR_EVERY) + 1
	mm.instance_count = count
	for k in count:
		var s := k * ANCHOR_EVERY
		var i := clampi(cum.bsearch(s) - 1, 0, pts.size() - 2)
		var p := pts[i].lerp(pts[i + 1], clampf((s - cum[i]) / maxf(cum[i + 1] - cum[i], 0.001), 0.0, 1.0))
		mm.set_instance_transform(k, Transform3D(Basis(), p - Vector3(0, ROPE_HEIGHT - 0.3, 0)))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)
