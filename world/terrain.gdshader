shader_type spatial;
// K2 terrain: rock, snow, ice, scree and glacier blended by slope, altitude and
// curvature, with procedural detail and bump so the ground reads at climbing scale.

uniform bool flat_ground = false;
uniform vec3 fog_color : source_color = vec3(0.70, 0.78, 0.87);
uniform float fog_density = 0.000042;
uniform float snowline = 5100.0;

varying vec3 w_pos;
varying vec3 w_nrm;
varying vec3 surf;

void vertex() {
	w_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	w_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	surf = flat_ground ? vec3(0.0, 0.0, 0.5) : COLOR.rgb;
}

// Sine-free hash, stable at large world coordinates.
float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
			mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p, int octaves) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < octaves; i++) {
		v += a * vnoise(p);
		p = p * 2.03 + vec2(17.1, 9.3);
		a *= 0.5;
	}
	return v;
}

// Noise projected along the axis the surface faces most, so cliffs are not smeared.
float tri_fbm(vec3 p, vec3 n, float scale, int octaves) {
	vec3 w = pow(abs(n), vec3(4.0));
	w /= (w.x + w.y + w.z);
	return fbm(p.zy * scale, octaves) * w.x + fbm(p.xz * scale, octaves) * w.y + fbm(p.xy * scale, octaves) * w.z;
}

// Bump mapping from screen-space derivatives (Mikkelsen 2010).
vec3 perturb(vec3 pos, vec3 n, float height) {
	vec3 dpdx = dFdx(pos);
	vec3 dpdy = dFdy(pos);
	float dhdx = dFdx(height);
	float dhdy = dFdy(height);
	vec3 r1 = cross(dpdy, n);
	vec3 r2 = cross(n, dpdx);
	float det = dot(dpdx, r1);
	vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
	return normalize(abs(det) * n - grad);
}

void fragment() {
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	float dist = length(w_pos - cam);
	vec3 n = normalize(w_nrm);
	float h = w_pos.y;
	float slope = degrees(acos(clamp(n.y, 0.0, 1.0)));
	float glacier = surf.g;
	float hollow = surf.b - 0.5;

	// Detail fades out with distance so far slopes do not shimmer.
	float near = 1.0 - smoothstep(150.0, 1500.0, dist);
	float mid = 1.0 - smoothstep(1500.0, 9000.0, dist);
	float big = fbm(w_pos.xz * 0.0035, 4);
	float medium = tri_fbm(w_pos, n, 0.045, 4);
	float fine = near > 0.0 ? tri_fbm(w_pos, n, 0.7, 3) * 0.7 + tri_fbm(w_pos, n, 3.1, 2) * 0.3 : 0.5;

	// Rock: dark gneiss and warm granite in banded strata.
	float strata = sin(h * 0.03 + medium * 9.0 + big * 5.0) * 0.5 + 0.5;
	vec3 rock = mix(vec3(0.24, 0.23, 0.22), vec3(0.40, 0.35, 0.30), smoothstep(0.2, 0.9, strata) * 0.8 + medium * 0.2);
	rock = mix(rock, vec3(0.14, 0.13, 0.13), smoothstep(6800.0, 7400.0, h) * (1.0 - smoothstep(7400.0, 7700.0, h)) * 0.6);
	rock *= 0.85 + 0.3 * medium * mid + 0.25 * (fine - 0.5) * near;

	// Scree and moraine on gentle low ground.
	vec3 scree = mix(vec3(0.36, 0.33, 0.31), vec3(0.52, 0.48, 0.44), fine * near + medium * (1.0 - near));
	float scree_amt = smoothstep(34.0, 22.0, slope) * smoothstep(5900.0, 5300.0, h);

	// Glacier: rubble-covered ice streaked along the flow (roughly north-south here),
	// with bare blue ice, melt pools and white penitente fields between the streaks.
	float streak = fbm(vec2(w_pos.x * 0.012, w_pos.z * 0.0016), 4);
	float bare = smoothstep(0.48, 0.62, streak + (big - 0.5) * 0.3);
	vec3 rubble = mix(vec3(0.30, 0.28, 0.27), vec3(0.47, 0.44, 0.41), fine * near + 0.4 * (1.0 - near));
	vec3 glacier_ice = mix(vec3(0.56, 0.62, 0.67), vec3(0.80, 0.83, 0.86), smoothstep(0.35, 0.8, medium));
	vec3 glacier_col = mix(rubble, glacier_ice, bare);

	// Snow collects in hollows and on slopes below ~50 degrees; wind strips ridges up high.
	float snow_slope = smoothstep(55.0 + (big - 0.5) * 14.0, 40.0 + (big - 0.5) * 14.0, slope);
	float snow_alt = smoothstep(snowline - 300.0 + big * 500.0, snowline + 250.0 + big * 500.0, h);
	float wind = smoothstep(7000.0, 8000.0, h) * smoothstep(0.0, -0.25, hollow) * 0.5;
	float snow_amt = clamp(snow_slope * snow_alt + hollow * 0.8 * snow_alt - wind, 0.0, 1.0);
	snow_amt = smoothstep(0.3, 0.6, snow_amt + (medium - 0.5) * 0.3);
	vec3 snow = vec3(0.78, 0.81, 0.86) * (0.92 + 0.08 * fine);

	// Hard blue ice on steep faces high up, where snow does not stay.
	float ice_amt = smoothstep(33.0, 40.0, slope) * smoothstep(60.0, 50.0, slope)
			* smoothstep(5700.0, 6300.0, h) * smoothstep(0.5, 0.65, medium + (big - 0.5) * 0.4);

	vec3 col = rock;
	col = mix(col, scree, scree_amt);
	col = mix(col, glacier_col, glacier);
	col = mix(col, snow, snow_amt * (1.0 - glacier * 0.75));
	col = mix(col, vec3(0.58, 0.67, 0.74), ice_amt * (1.0 - snow_amt * 0.5) * 0.85);
	if (flat_ground) {
		// Distant ranges beyond the data: muted so they sit in the haze.
		col = mix(vec3(0.40, 0.39, 0.38), vec3(0.62, 0.66, 0.71), smoothstep(0.4, 0.65, big));
	}

	float snowy = max(snow_amt * (1.0 - glacier * 0.75), glacier * bare);
	float ice_like = max(ice_amt, glacier * bare * 0.6);
	ALBEDO = col;
	ROUGHNESS = mix(mix(0.95, 0.72, snowy), 0.28, ice_like);
	SPECULAR = mix(0.25, 0.55, max(snowy, ice_like));

	// Bump: rough rock, softer snow.
	float bump = (fine * near * mix(1.6, 0.35, snowy) + medium * mid * 6.0) * 0.6;
	vec3 wn = perturb(w_pos, n, bump);
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);

	// Aerial perspective; thinner high up.
	float density = fog_density * exp(-(max(min(h, cam.y), 4500.0) - 4500.0) / 4000.0);
	FOG = vec4(fog_color, 1.0 - exp(-dist * density));
}
