extends Control
## A ring that swells on each inhale, faster and redder as breathing gets harder.

var body: ClimberBody


func _process(_dt: float) -> void:
	queue_redraw()


func _draw() -> void:
	if body == null:
		return
	var p := body.breath_phase
	var fill := sin(p / 0.4 * PI * 0.5) if p < 0.4 else cos((p - 0.4) / 0.6 * PI * 0.5)
	fill = clampf(fill, 0.0, 1.0)
	var hard := body.breathlessness()
	var c := size * 0.5
	var r := minf(size.x, size.y) * 0.5
	var col := Color(0.55, 0.8, 1.0).lerp(Color(1.0, 0.35, 0.25), hard)
	draw_circle(c, r * (0.35 + 0.6 * fill), Color(col, 0.35))
	draw_arc(c, r * (0.35 + 0.6 * fill), 0.0, TAU, 40, col, 2.0, true)
