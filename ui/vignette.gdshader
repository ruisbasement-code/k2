shader_type canvas_item;
// Darkens and tunnels the edge of vision as the climber runs out of breath,
// pulsing with each breath.

uniform float strength : hint_range(0.0, 1.0) = 0.0;
uniform float pulse : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	vec2 d = UV - 0.5;
	d.x *= 1.6;
	float r = length(d);
	float inner = mix(0.95, 0.32, strength) - pulse * 0.05 * strength;
	float a = smoothstep(inner, inner + 0.45, r) * (0.25 + 0.65 * strength);
	COLOR = vec4(0.02, 0.03, 0.06, a);
}
