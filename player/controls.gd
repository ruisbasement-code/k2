class_name Controls
extends RefCounted
## Input actions, registered at startup so the bindings live in one readable place.

const BINDINGS := {
	"move_forward": [KEY_W, KEY_UP],
	"move_back": [KEY_S, KEY_DOWN],
	"move_left": [KEY_A, KEY_LEFT],
	"move_right": [KEY_D, KEY_RIGHT],
	"push_pace": [KEY_SHIFT],
	"clip_rope": [KEY_C],
	"toggle_view": [KEY_V],
	"time_scale": [KEY_T],
	"scout_fly": [KEY_F],
	"fly_up": [KEY_E, KEY_SPACE],
	"fly_down": [KEY_Q],
	"mute": [KEY_M],
	"release_mouse": [KEY_ESCAPE],
}


static func install() -> void:
	for action in BINDINGS:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for key in BINDINGS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)
