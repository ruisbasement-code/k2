extends AudioStreamPlayer
## Procedural breathing: filtered noise shaped into inhale and exhale, following
## the climber's breath rate. Louder and rougher the harder they breathe.

const MIX_RATE := 22050.0

var body: ClimberBody
var muted := false
var _playback: AudioStreamGeneratorPlayback
var _phase := 0.0
var _lp := 0.0


func _ready() -> void:
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = MIX_RATE
	gen.buffer_length = 0.2
	stream = gen
	volume_db = -8.0
	play()
	_playback = get_stream_playback()


func _process(_dt: float) -> void:
	if body == null or _playback == null:
		return
	var frames := _playback.get_frames_available()
	var rate := body.breath_rate / 60.0 / MIX_RATE
	var hard := body.breathlessness()
	var gain := 0.0 if muted else 0.12 + 0.5 * hard
	for i in frames:
		_phase = fmod(_phase + rate, 1.0)
		var env := 0.0
		var cutoff := 0.10
		if _phase < 0.4:
			env = sin(_phase / 0.4 * PI) * 0.7
			cutoff = 0.06 + 0.06 * hard
		elif _phase > 0.45 and _phase < 0.95:
			env = sin((_phase - 0.45) / 0.5 * PI)
			cutoff = 0.12 + 0.1 * hard
		var noise := randf() * 2.0 - 1.0
		_lp += (noise - _lp) * cutoff
		var s := _lp * env * env * gain * 3.0
		_playback.push_frame(Vector2(s, s))
	if frames > 0:
		# Keep the HUD pulse in step with what you hear.
		body.breath_phase = _phase
