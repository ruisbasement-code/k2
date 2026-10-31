extends Control
## Shaded-relief map of the whole heightmap with the route camps and the climber.

const RES := 321

var hm: Heightmap
var climber: Node3D
var places: Array = []
var _tex: ImageTexture


func setup(heightmap: Heightmap, player: Node3D, place_list: Array) -> void:
	hm = heightmap
	climber = player
	places = place_list
	var img := Image.create(RES, RES, false, Image.FORMAT_RGB8)
	var step := float(hm.n - 1) / (RES - 1)
	for y in RES:
		for x in RES:
			var r := int(y * step)
			var c := int(x * step)
			var h := hm.at(r, c)
			var shade := clampf(0.6 + ((hm.at(r, c - 2) - h) + (hm.at(r - 2, c) - h)) * 0.006, 0.0, 1.0)
			var v := ((60.0 + (h - 4600.0) / 4000.0 * 170.0) * shade + 25.0) / 255.0
			img.set_pixel(x, y, Color(v, v * 1.02, minf(v * 1.08 + 0.03, 1.0)))
	_tex = ImageTexture.create_from_image(img)


func _process(_dt: float) -> void:
	queue_redraw()


func _draw() -> void:
	if _tex == null:
		return
	var s := size.x
	draw_texture_rect(_tex, Rect2(Vector2.ZERO, size), false)
	var k := s / hm.size
	var to_map := func(x: float, z: float) -> Vector2: return Vector2((x + hm.size * 0.5) * k, (z + hm.size * 0.5) * k)
	for p in places:
		var w := hm.grid_to_world(p.r, p.c)
		draw_circle(to_map.call(w.x, w.y), 2.5, Color(1, 0.83, 0.3) if p.name == "Summit" else Color(1, 1, 1, 0.8))
	var pos: Vector2 = to_map.call(climber.position.x, climber.position.z)
	var a: float = -climber.yaw
	var tri := PackedVector2Array([Vector2(0, -8), Vector2(5, 6), Vector2(0, 3), Vector2(-5, 6)])
	for i in tri.size():
		tri[i] = pos + tri[i].rotated(a)
	draw_colored_polygon(tri, Color(1.0, 0.42, 0.1))
	draw_polyline(tri + PackedVector2Array([tri[0]]), Color.BLACK, 1.5)
	draw_string(get_theme_default_font(), Vector2(s * 0.5 - 4, 14), "N", HORIZONTAL_ALIGNMENT_LEFT, -1, 13)
