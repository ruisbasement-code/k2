# K2 Climbing

A 3D open-world climbing survival game on a real-scale K2, built in **Godot 4.3**.
The terrain is the real mountain from the Copernicus GLO-30 elevation model
(20 × 20 km around the summit, 31.25 m grid).

This first step is about how it feels to move up the mountain.

## Play it

1. Install [Godot 4.3](https://godotengine.org/download) (the standard build, no .NET needed).
2. Open Godot, choose **Import**, and pick `project.godot` in this folder.
3. Press **F5** (or the ▶ button) to play.

### In the browser

Every merge to `main` builds a web version and publishes it to GitHub Pages
(see `.github/workflows/web.yml`). To turn this on once: repo **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The game is then at
`https://ruisbasement-code.github.io/k2/`. The web build is heavier than a normal
page (about 40 MB) and runs best in Chrome or Edge; click the page to start audio.

To try a web build on your own machine: in Godot, **Project → Export → Web →
Export Project** into `build/web`, then serve that folder, for example
`cd build/web && python3 -m http.server 8000`, and open http://localhost:8000.
(Opening `index.html` straight from disk does not work; it has to be served.)

### Controls

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Shift | Push the pace: faster, but stamina drains much quicker (and helps little up high) |
| C | Clip into / unclip from a fixed rope (within 5 m) |
| Mouse (click to capture), wheel | Look around, zoom |
| V | First / third person |
| T | Time speed: 1×, 5×, 10× (default), 20×, 60× |
| 1 – 9 | Jump to Base Camp, ABC, Camps 1–4, Bottleneck, Summit, Broad Peak |
| F | Scout fly (dev tool; E/Space up, Q down) |
| M | Mute breathing |
| Esc | Release the mouse |

## How movement works

**Time.** The mountain clock runs faster than real time (10× by default), so a
realistic pace still gets you somewhere. All the speeds below are in mountain time.

**Terrain modes**, from the slope under your feet:

- **Walking** below 30°. Speed follows Tobler's hiking function: about 5 km/h on
  the flat at sea level, much slower uphill.
- **Climbing** from 30° to 45°: crampons and axe. Each metre costs a traverse time
  plus the time to gain its height, so going straight up is slow and traversing is slower still.
- **Very steep** above 45°. You can still climb unroped, but every minute carries a
  chance of slipping and sliding 15 to 40 m, which grows with steepness, tiredness
  and pushing the pace. Above 65° you cannot go up without a rope.
- **On a fixed rope**: press **C** near the orange rope. W/S then moves you up or
  down the rope (jumaring up, faster on the way down), with no risk of slipping.
  There are two ropes: the Abruzzi Spur from Advanced Base Camp to Camp 4, and the
  Bottleneck and Traverse from above Camp 4 to about 8,450 m. Grey stakes mark the anchors.

**Altitude.** Pace is scaled by an altitude curve for an acclimatized climber without
bottled oxygen. Steady climbing pace while moving (from `tests/run_tests.gd`):

| Altitude | Walk 25° | Climb 40° | Rope 45° up | Rope 45° down |
| --- | --- | --- | --- | --- |
| 5,000 m | 436 m/h | 363 m/h | 412 m/h | 740 m/h |
| 6,000 m | 376 | 313 | 355 | 687 |
| 7,000 m | 275 | 229 | 260 | 588 |
| 8,000 m | 156 | 130 | 147 | 442 |
| 8,400 m | 104 | 87 | 98 | 362 |
| 8,600 m | 83 | 69 | 79 | 324 |

With rests, a steady climber takes about 13 hours of climbing from ABC to Camp 4,
and about 10 hours from 7,900 m to the top of the Traverse, close to a real summit morning.

**Stamina and breathing.** Stamina drains when your effort is above what you can
sustain (steady climbing, and much faster when pushing) and recovers when you rest
or walk easily. Thin air drains it faster and refills it slower, and above 7,000 m it
cannot refill completely: the white tick on the stamina bar is the most you can
recover at your altitude (about 65% near the summit). Below 30% you slow down; at 0
you stop, gasping, until you have recovered a little. Your breathing rate follows
effort and altitude: you see it in the pulsing ring and the edge of your vision
darkens as you run out, and you hear it (M mutes).

The HUD shows your altitude, slope, terrain mode, vertical speed now and over the
last mountain hour, the mountain clock, and distance to the summit.

All of these numbers live in [`data/tuning.json`](data/tuning.json), so tuning is
editing numbers, not code.

## Terrain

The terrain shader blends rock, scree, glacier, snow and ice from slope, altitude and
curvature: snow collects in hollows and on slopes under about 50°, wind strips the
high ridges, hard blue ice shows on steep faces above 5,700 m, and the Godwin-Austen
Glacier around Base Camp is rubble-covered ice streaked along its flow. Procedural
detail and bump fade with distance, and distant terrain sits in haze.

## Project layout

```
data/      route.json (camps, fixed-rope lines), tuning.json (all movement numbers)
sim/       pace_model.gd, climber_body.gd: pure rules, no graphics
world/     heightmap.gd, terrain.gd + terrain.gdshader, fixed_ropes.gd, camps.gd, data/
player/    climber.gd (movement, ropes, camera), climber_model.gd, breath_audio.gd, controls.gd
ui/        hud.gd, minimap, breath indicator, vision vignette
tests/     run_tests.gd (pace and stamina numbers), smoke_test.gd (drives the real scene)
```

## Tests

```sh
godot --headless --import                                  # once, after cloning
godot --headless --script res://tests/run_tests.gd         # pace, stamina, simulated climbs
godot --headless --fixed-fps 30 --script res://tests/smoke_test.gd   # plays the real scene
```

Screenshots for review: `godot -- --shot=out.png --place=3 --rope`
(also `--yaw=`, `--pitch=`, `--dist=`, `--fp`, `--fly=<metres>`).

## Data

Copernicus GLO-30 DSM tile N35 E076 (ESA, 2021 release), resampled to 641 × 641.
`world/data/k2_heightmap.f32` is little-endian float32 metres, row 0 at the north edge.
Camp positions are approximate and still need checking against a guidebook.
