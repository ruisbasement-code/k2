class_name Heightmap
extends RefCounted
## K2 elevation grid from the Copernicus GLO-30 DSM: 641 x 641 posts, 31.25 m apart,
## row 0 at the north edge. World space has x pointing east, z pointing south and
## y in metres above sea level, with the origin at the grid centre (the summit).

const DATA_PATH := "res://world/data/k2_heightmap.f32"
const META_PATH := "res://world/data/k2_heightmap_meta.json"

var n: int
var cell: float
var half: float
var size: float
var meta: Dictionary
var h: PackedFloat32Array


static func load_default() -> Heightmap:
	var hm := Heightmap.new()
	hm.meta = JSON.parse_string(FileAccess.get_file_as_string(META_PATH))
	hm.n = int(hm.meta.N)
	hm.cell = float(hm.meta.cell)
	hm.half = (hm.n - 1) * 0.5
	hm.size = (hm.n - 1) * hm.cell
	hm.h = FileAccess.get_file_as_bytes(DATA_PATH).to_float32_array()
	assert(hm.h.size() == hm.n * hm.n, "heightmap size does not match its metadata")
	return hm


func at(r: int, c: int) -> float:
	return h[clampi(r, 0, n - 1) * n + clampi(c, 0, n - 1)]


## World (x, z) of a grid position.
func grid_to_world(r: float, c: float) -> Vector2:
	return Vector2((c - half) * cell, (r - half) * cell)


## Height of the rendered triangle surface at world (x, z).
func height_at(x: float, z: float) -> float:
	var fc := clampf(x / cell + half, 0.0, n - 1.0001)
	var fr := clampf(z / cell + half, 0.0, n - 1.0001)
	var c := int(fc)
	var r := int(fr)
	var fx := fc - c
	var fz := fr - r
	var i := r * n + c
	var h00 := h[i]
	var h01 := h[i + 1]
	var h10 := h[i + n]
	var h11 := h[i + n + 1]
	if fx + fz < 1.0:
		return h00 + (h01 - h00) * fx + (h10 - h00) * fz
	return h11 + (h10 - h11) * (1.0 - fx) + (h01 - h11) * (1.0 - fz)


## Surface gradient (dh/dx, dh/dz), sampled d metres either side so it does not
## jump at every triangle edge.
func gradient(x: float, z: float, d := 12.0) -> Vector2:
	return Vector2(
		(height_at(x + d, z) - height_at(x - d, z)) / (2.0 * d),
		(height_at(x, z + d) - height_at(x, z - d)) / (2.0 * d))


func slope_deg(x: float, z: float) -> float:
	return rad_to_deg(atan(gradient(x, z).length()))


func clamp_inside(p: Vector3, margin := 2.0) -> Vector3:
	var lim := size * 0.5 - margin
	return Vector3(clampf(p.x, -lim, lim), p.y, clampf(p.z, -lim, lim))


func latitude(z: float) -> float:
	return meta.lat0 - z / meta.mlat


func longitude(x: float) -> float:
	return meta.lon0 + x / meta.mlon
