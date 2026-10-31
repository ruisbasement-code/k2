extends Node3D
## Tents at Base Camp and the camps on the route.

const COLORS := [Color("ffcc33"), Color("ff5533"), Color("33aa66"), Color("f4f4f4"), Color("3377dd")]


func build(hm: Heightmap, places: Array) -> void:
	var dome := SphereMesh.new()
	dome.radius = 1.4
	dome.height = 1.4
	dome.is_hemisphere = true
	dome.radial_segments = 16
	dome.rings = 6
	var mats := []
	for c in COLORS:
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 0.6
		mats.append(m)
	var k := 0
	for p in places:
		var centre := hm.grid_to_world(p.r, p.c)
		for i in int(p.tents):
			var a := i * 2.399
			var rr := 5.0 + sqrt(i) * (9.0 if p.tents > 10 else 4.5)
			var x := centre.x + cos(a) * rr
			var z := centre.y + sin(a) * rr
			var t := MeshInstance3D.new()
			t.mesh = dome
			t.material_override = mats[k % mats.size()]
			k += 1
			t.scale = Vector3(1.0, 1.0, 1.3)
			t.position = Vector3(x, hm.height_at(x, z) + 0.05, z)
			t.rotation.y = a
			add_child(t)
