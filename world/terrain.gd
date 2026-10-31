extends MeshInstance3D
## Builds the K2 terrain mesh from the heightmap.
##
## Besides position and normal, each vertex carries surface data for the shader in
## its colour: r = slope (0 to 1 for 0 to 90 degrees), g = glacier mask,
## b = curvature (above 0.5 is a hollow where snow collects, below is a ridge).

const TERRAIN_SHADER := preload("res://world/terrain.gdshader")


func build(hm: Heightmap) -> void:
	var n := hm.n
	var cell := hm.cell
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var colors := PackedColorArray()
	verts.resize(n * n)
	normals.resize(n * n)
	colors.resize(n * n)
	for r in n:
		for c in n:
			var i := r * n + c
			var y := hm.h[i]
			verts[i] = Vector3((c - hm.half) * cell, y, (r - hm.half) * cell)
			var gx := (hm.at(r, c + 1) - hm.at(r, c - 1)) / (2.0 * cell)
			var gz := (hm.at(r + 1, c) - hm.at(r - 1, c)) / (2.0 * cell)
			normals[i] = Vector3(-gx, 1.0, -gz).normalized()
			var slope := rad_to_deg(atan(Vector2(gx, gz).length()))
			# Glaciers are wide, flat and low: judge flatness over ~190 m so the mask is not spotty.
			var wx := (hm.at(r, c + 3) - hm.at(r, c - 3)) / (6.0 * cell)
			var wz := (hm.at(r + 3, c) - hm.at(r - 3, c)) / (6.0 * cell)
			var wide_slope := rad_to_deg(atan(Vector2(wx, wz).length()))
			var glacier := _smooth(5650.0, 5250.0, y) * _smooth(17.0, 8.0, wide_slope)
			var lap := (hm.at(r, c + 2) + hm.at(r, c - 2) + hm.at(r + 2, c) + hm.at(r - 2, c) - 4.0 * y) \
					/ (4.0 * cell * cell)
			var curvature := clampf(0.5 + lap * 25.0, 0.0, 1.0)
			colors[i] = Color(slope / 90.0, glacier, curvature, 1.0)

	# Godot treats clockwise triangles (seen from the front) as front faces.
	var idx := PackedInt32Array()
	idx.resize((n - 1) * (n - 1) * 6)
	var k := 0
	for r in n - 1:
		for c in n - 1:
			var a := r * n + c
			var b := a + 1
			var d := a + n
			var e := d + 1
			idx[k] = a; idx[k + 1] = b; idx[k + 2] = d
			idx[k + 3] = b; idx[k + 4] = e; idx[k + 5] = d
			k += 6

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	var mat := ShaderMaterial.new()
	mat.shader = TERRAIN_SHADER
	am.surface_set_material(0, mat)
	mesh = am
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF

	# Low ground beyond the edge of the data, so the horizon is not a void.
	var outer := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(200000, 200000)
	outer.mesh = plane
	var omat := ShaderMaterial.new()
	omat.shader = TERRAIN_SHADER
	omat.set_shader_parameter("flat_ground", true)
	outer.material_override = omat
	outer.position.y = 4550.0
	outer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(outer)


static func _smooth(edge0: float, edge1: float, x: float) -> float:
	return smoothstep(edge0, edge1, x) if edge0 < edge1 else 1.0 - smoothstep(edge1, edge0, x)
