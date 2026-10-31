# K2 Climbing

A 3D open-world climbing survival game on a real-scale K2, built with
[three.js](https://threejs.org) and [Vite](https://vitejs.dev). The terrain is the
real mountain from the Copernicus GLO-30 elevation model (20 × 20 km around the
summit, 31.25 m grid).

This first step is about how it feels to move up the mountain.

![Base Camp](docs/screenshots/base-camp.png)

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```sh
npm install
npm run dev
```

That opens the game at http://localhost:5173. Edits to the code reload the page
as you save.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the game locally with live reload |
| `npm test` | Runs the pace, stamina and movement tests |
| `npm run build` | Builds a static site into `dist/` |
| `npm run preview` | Serves the `dist/` build locally |

Every merge to `main` also tests and publishes the game to GitHub Pages
(`.github/workflows/web.yml`). Turn this on once in the repo's **Settings → Pages →
Build and deployment → Source: GitHub Actions**. The game is then at
https://ruisbasement-code.github.io/k2/.

### Controls

| Key | Action |
| --- | --- |
| W A S D | Move (relative to the camera) |
| Shift | Push the pace: faster, but stamina drains much quicker (and it helps little up high) |
| C | Clip into / unclip from a fixed rope (within 5 m) |
| Space (hold) | Self-arrest when you start sliding |
| R | After dying: be rescued to the highest camp you reached |
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

**Slopes.** Fixed ropes are the only aid for now (gear comes later):

- **Walking** below 25°. Speed follows Tobler's hiking function: about 5 km/h on
  the flat at sea level, much slower uphill.
- **Scrambling** from 25° to 35°: slow and tiring. Every step is a separate
  placement and can slip, more likely the steeper it is, the more slippery the
  surface, and when the step is careless (pushing with Shift), turns sharply, or goes
  downhill (most accidents happen on the way down).
- **Above 35° only on a fixed rope.** Unroped, you can't go up it, and if you stand
  on ground steeper than its surface can hold you, you start to slide.
- **Fixed ropes**: press **C** within 5 m of the orange rope. You are not locked to
  the line: you move freely up to 8 m from it. Moving along the rope gets the jumar's
  speed, the rope gently steers you back toward its line as you drift, it lets you
  climb anything near it, and slips are rarer. If you do slip, the jumar locks and you
  drop (and swing, if you were off to the side) until the rope comes tight; a hard
  jolt hurts. Reach either
  end and you unclip. There are two ropes: the Abruzzi Spur from Advanced Base Camp to
  Camp 4, and the Bottleneck and Traverse from above Camp 4 to about 8,450 m.

**Momentum.** You speed up and slow down over a moment instead of instantly, and a
sharp turn costs the speed you built up. Running downhill (Shift) on ground over
15° can trip you, pitching you head-first.

**Surfaces** grip differently (`surfaces` in `tuning.json`): powder is slow going
but grippy, firm snow holds you to 35°, rock to 37°, scree to 33°, glacier ice to 30°,
and hard ice only to 27°. Ice slides the furthest and is the hardest to stop on.

- **Snow types.** Above 6,800 m open snow is a hard, slippery wind crust. Below
  6,400 m the afternoon sun (roughly 10:30 to 17:30) turns snow to slow, wet slush
  that won't hold steep angles.
- **Sinking and trails.** You sink knee-deep into powder, which slows you and costs
  effort. Every step leaves a footprint that packs the snow, so going back along your
  own trail is faster and you sink less.
- **Loose rock.** Some rock and much of the scree is loose. A step on it can crumble
  the hold, send stones down the slope and make you slip.

**Rock and ice fall.** Stones and ice chunks also come down by themselves from steep
faces above you, most in the warm afternoon and least at night when everything is
frozen. You get a warning, they bounce down the terrain, and a hit hurts (and can
knock you off steep ground). Get out of the fall line.

**Breathing pace.** Up high every step uphill takes several breaths: under one at
Base Camp, about one at 6,500 m, 3–4 at 8,000 m and 7 near the summit (the HUD shows
it). Pushing the pace skips breaths; keep it up and you have to stop and gasp until
your breathing catches up.

**Falls.** A slip or too-steep ground starts a slide. You pick up speed down the
fall line, slowed by the surface's friction. Hold **Space** straight away to
self-arrest: it works while you are still slow (under 8 m/s) and within about 2
seconds, much better on snow than ice. How you landed matters: slipping while facing
into the slope puts you on your front, feet first, the best position; facing out
puts you on your back. Holding Space rolls you onto your front (half a second) and
then swings your feet round downhill (another second), so a head-first slide on your
back is the hardest to stop. Too fast, too late, or a hard hit, and you
tumble out of control (a ragdoll) until the ground eases and friction stops you.
Damage comes from how hard you hit the ground and from scraping over rock at speed,
not from how far you fell, so a long slide on snow can hurt less than a short drop
onto rock. Health heals slowly at rest and faster in a camp. At 0 you die, and **R**
gets you rescued to the highest camp you reached, hours later and still hurt.

**Day counter.** The top of the screen shows the expedition day, time and part of the
day. The sun rises around 05:30, passes high in the south and sets around 19:00, and
nights are dark. You start at 06:00 on day 1.

**Altitude.** Pace is scaled by an altitude curve for an acclimatized climber without
bottled oxygen. Steady pace while moving (`npm test` prints this table):

| Altitude | Walk 25° | Steep 40° | Rope 45° up | Rope 45° down |
| --- | --- | --- | --- | --- |
| 5,000 m | 436 m/h | 363 m/h | 412 m/h | 740 m/h |
| 6,000 m | 377 | 314 | 356 | 688 |
| 7,000 m | 276 | 229 | 260 | 588 |
| 8,000 m | 156 | 130 | 147 | 443 |
| 8,400 m | 104 | 87 | 99 | 362 |
| 8,600 m | 84 | 70 | 79 | 324 |

With rests, a steady climber takes about 13 hours of climbing from ABC to Camp 4,
and about 10 hours from 7,900 m to the top of the Traverse, close to a real summit morning.

**Stamina and breathing.**

- Stamina drains when you work harder than you can sustain: steady climbing drains
  it, and pushing drains it about 3× faster. It recovers when you rest or walk easily.
- Thin air drains it faster and refills it slower. Above 7,000 m it cannot refill
  completely: the white tick on the stamina bar is the most you can recover at your
  altitude (about 65% near the summit).
- Below 30% you slow down. At 0 you stop, gasping, until you have recovered a little.
- Your breathing rate follows effort and altitude. You see it in the pulsing ring,
  the edge of your vision darkens as you run out, and you hear it (M mutes it).

On steep ground the view sways a little with your breathing, and a jolt (a slip, a
crumbling hold, a rock) shakes it.

The HUD shows your altitude, slope, terrain mode, surface (and how deep you sink), breaths per step, vertical speed now and over the
last mountain hour, the mountain clock, and distance to the summit.

All of these numbers live in [`src/data/tuning.json`](src/data/tuning.json), so
tuning is editing numbers, not code.

## Terrain

The terrain shader blends rock, scree, glacier, snow and ice from slope, altitude
and curvature:

- Snow collects in hollows and on slopes under about 50°, and wind strips the high ridges.
- Hard blue ice shows on steep faces above 5,700 m.
- The Godwin-Austen Glacier around Base Camp is rubble-covered ice streaked along its flow.
- Procedural detail and bump mapping fade with distance, and distant terrain sits in haze.

## Project layout

```
index.html            HUD and start screen markup
src/main.js           scene, camera, game loop, key bindings
src/data/             route.json (camps, fixed-rope lines), tuning.json (all movement numbers)
src/sim/              paceModel.js, climberBody.js, hazards.js (loose rock, rockfall, snow trail): pure rules, no graphics
src/world/            heightmap.js, terrain.js (mesh + shader), fixedRopes.js, camps.js, sky.js, hazardMeshes.js
src/player/           climber.js (movement, ropes, falls, health), climberModel.js, ragdoll.js, breathAudio.js, input.js
src/ui/hud.js         HUD, minimap, breath ring, vision vignette
public/data/          the heightmap (float32) and its metadata
tests/                Vitest: pace and stamina, simulated climbs, ropes, slopes, falls, death and rescue, hazards
```

URL parameters set up a view for screenshots and testing, for example
`http://localhost:5173/?start&place=3&rope&pitch=10&dist=8`
(also `yaw=`, `fp`, `fly=<metres>`, `hour=<0-24>`).

## Data

Copernicus GLO-30 DSM tile N35 E076 (ESA, 2021 release), resampled to 641 × 641.
`public/data/k2_heightmap.f32` is little-endian float32 metres, row 0 at the north edge.
Camp positions are approximate and still need checking against a guidebook.
