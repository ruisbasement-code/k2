extends CanvasLayer
## Altimeter, slope and pace, stamina and breathing, the mountain clock, prompts
## and the minimap.

const VIGNETTE_SHADER := preload("res://ui/vignette.gdshader")
const KEYS_TEXT := "WASD move · Shift push pace · C clip/unclip rope · Mouse look (click) · Wheel zoom · V view · T time speed · 1-9 jump to camp · F scout fly · M mute"

var hm: Heightmap
var climber: Node3D
var summit_height := 0.0

var _vignette: ColorRect
var _alt: Label
var _rows := {}
var _stamina: ProgressBar
var _stamina_cap: ColorRect
var _breath: Control
var _breath_label: Label
var _prompt: Label
var _message: Label
var _message_time := 0.0
var _slow_timer := 0.0


func setup(heightmap: Heightmap, player: Node3D, places: Array) -> void:
	hm = heightmap
	climber = player
	summit_height = hm.height_at(0.0, 0.0)
	climber.message.connect(show_message)

	_vignette = ColorRect.new()
	_vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var vm := ShaderMaterial.new()
	vm.shader = VIGNETTE_SHADER
	_vignette.material = vm
	add_child(_vignette)

	var panel := _panel(Vector2(14, 14))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 3)
	panel.add_child(box)
	_alt = _label(box, "— m", 26)
	for key in ["Terrain", "Slope", "Vertical", "Avg (1 h)", "Clock", "To summit"]:
		var row := HBoxContainer.new()
		row.custom_minimum_size.x = 250
		box.add_child(row)
		var name_label := _label(row, key, 14, Color(0.65, 0.7, 0.78))
		name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_rows[key] = _label(row, "—", 14)

	box.add_child(HSeparator.new())
	_label(box, "Stamina", 13, Color(0.65, 0.7, 0.78))
	var bar_holder := Control.new()
	bar_holder.custom_minimum_size = Vector2(250, 14)
	box.add_child(bar_holder)
	_stamina = ProgressBar.new()
	_stamina.show_percentage = false
	_stamina.set_anchors_preset(Control.PRESET_FULL_RECT)
	_stamina.max_value = 100.0
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(0.45, 0.8, 0.55)
	fill.set_corner_radius_all(3)
	var track := StyleBoxFlat.new()
	track.bg_color = Color(1, 1, 1, 0.12)
	track.set_corner_radius_all(3)
	_stamina.add_theme_stylebox_override("fill", fill)
	_stamina.add_theme_stylebox_override("background", track)
	bar_holder.add_child(_stamina)
	_stamina_cap = ColorRect.new()
	_stamina_cap.color = Color(1, 1, 1, 0.8)
	_stamina_cap.size = Vector2(2, 14)
	bar_holder.add_child(_stamina_cap)

	var breath_row := HBoxContainer.new()
	box.add_child(breath_row)
	_breath = preload("res://ui/breath_indicator.gd").new()
	_breath.body = climber.body
	_breath.custom_minimum_size = Vector2(34, 34)
	breath_row.add_child(_breath)
	_breath_label = _label(breath_row, "", 14)

	var map_panel := _panel(Vector2.ZERO)
	_place(map_panel, Control.PRESET_TOP_RIGHT, Vector2(-14 - 200, 14), Vector2(200, 200))
	var map := preload("res://ui/minimap.gd").new()
	map.custom_minimum_size = Vector2(180, 180)
	map_panel.add_child(map)
	map.setup(hm, climber, places)

	_prompt = _label(self, "", 18, Color(1.0, 0.85, 0.5))
	_prompt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_prompt, Control.PRESET_CENTER_BOTTOM, Vector2(-400, -120), Vector2(800, 26))
	_message = _label(self, "", 18)
	_message.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_message, Control.PRESET_CENTER_BOTTOM, Vector2(-450, -88), Vector2(900, 26))
	var keys := _label(self, KEYS_TEXT, 12, Color(0.75, 0.8, 0.86))
	keys.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(keys, Control.PRESET_CENTER_BOTTOM, Vector2(-600, -30), Vector2(1200, 20))


func show_message(text: String) -> void:
	_message.text = text
	_message_time = 4.0


func _process(dt: float) -> void:
	if climber == null:
		return
	var body: ClimberBody = climber.body
	_message_time -= dt
	_message.modulate.a = clampf(_message_time, 0.0, 1.0)

	var strain := clampf(1.0 - body.stamina / 60.0, 0.0, 1.0) * 0.7 + body.breathlessness() * 0.3
	if climber.mode == climber.Mode.FLY:
		strain = 0.0
	_vignette.material.set_shader_parameter("strength", strain)
	var p := body.breath_phase
	_vignette.material.set_shader_parameter("pulse", sin(p * PI) if p < 1.0 else 0.0)

	_stamina.value = body.stamina
	_stamina.modulate = Color(1, 0.4, 0.3) if body.exhausted or body.stamina < 25.0 else Color.WHITE
	_stamina_cap.position.x = _stamina.size.x * body.stamina_cap(climber.position.y) / 100.0 - 1.0

	_slow_timer -= dt
	if _slow_timer > 0.0:
		return
	_slow_timer = 0.1
	_alt.text = "%s m" % _thousands(climber.position.y)
	_rows["Terrain"].text = climber.mode_name()
	_rows["Slope"].text = "%d°" % roundi(climber.slope)
	_rows["Vertical"].text = "%+d m/h" % roundi(climber.vertical_now)
	_rows["Avg (1 h)"].text = "%+d m/h" % roundi(climber.vertical_avg)
	_rows["Clock"].text = "%s  ×%d" % [climber.clock_text(), int(climber.time_scale)]
	var d := Vector3(climber.position.x, climber.position.y - summit_height, climber.position.z).length()
	_rows["To summit"].text = ("%.2f km" % (d / 1000.0)) if d > 1000.0 else ("%d m" % roundi(d))
	var breath_word := "calm" if body.breath_rate < 22 else ("heavy" if body.breath_rate < 38 else "gasping")
	_breath_label.text = "  Breathing %d/min, %s" % [roundi(body.breath_rate), breath_word]

	_prompt.text = _prompt_text()


func _prompt_text() -> String:
	var body: ClimberBody = climber.body
	if climber.mode == climber.Mode.FLY:
		return "Scout fly: E/Space up, Q down, Shift fast. F to land."
	if body.exhausted:
		return "Exhausted. Stand still and breathe."
	if climber.blocked:
		return "Too steep to climb without a rope"
	if climber.mode == climber.Mode.ROPE:
		return "Clipped in. W/S moves along the rope, C unclips."
	if climber.rope_distance() < climber.CLIP_RANGE:
		return "Fixed rope here. Press C to clip in."
	if climber.mode == climber.Mode.STEEP:
		return "Very steep and unroped: one slip and you slide."
	if body.stamina < 25.0:
		return "Nearly spent. Stop and rest."
	return ""


## Anchor a control to a screen edge, offset from that anchor.
func _place(c: Control, preset: Control.LayoutPreset, offset: Vector2, box: Vector2) -> void:
	c.set_anchors_preset(preset)
	c.offset_left = offset.x
	c.offset_top = offset.y
	c.offset_right = offset.x + box.x
	c.offset_bottom = offset.y + box.y


func _panel(pos: Vector2) -> PanelContainer:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.07, 0.1, 0.72)
	sb.border_color = Color(1, 1, 1, 0.14)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(10)
	panel.add_theme_stylebox_override("panel", sb)
	panel.position = pos
	add_child(panel)
	return panel


func _label(parent: Node, text: String, font_size: int, color := Color(0.93, 0.95, 0.97)) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	l.add_theme_constant_override("shadow_offset_x", 1)
	l.add_theme_constant_override("shadow_offset_y", 1)
	parent.add_child(l)
	return l


static func _thousands(v: float) -> String:
	var s := str(roundi(v))
	return s.substr(0, s.length() - 3) + "," + s.substr(s.length() - 3) if s.length() > 3 else s
