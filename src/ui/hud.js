// What's on screen: health and stamina, the clock, the key prompts for what you
// can do right here, short messages, the darkening and red edge of vision, and
// the devices you hold up from your pack: the Wympr GPS, the vitals monitor and
// the paper map.

import { Mode, CLIP_RANGE } from '../player/climber.js';
import { tuning } from '../sim/paceModel.js';
import { compass, dangerLabel } from '../sim/weather.js';
import { hasGear } from '../sim/gear.js';
import { hotbarItems } from './inventory.js';
import { icon } from './icons.js';
import route from '../data/route.json';
import featureDefs from '../data/features.json';

const $ = (id) => document.getElementById(id);

/** The part of the heightmap the paper map covers (grid rows and columns). */
const MAP = { r0: 285, c0: 255, n: 310, px: 2 };

export class Hud {
  constructor(hm, climber, places, expedition) {
    this.hm = hm;
    this.climber = climber;
    this.places = places;
    this.ex = expedition;
    this.summitHeight = hm.heightAt(0, 0);
    this.messageTime = 0;
    this.slowTimer = 0;
    this.lastHealth = climber.health;
    /** Red flash from the latest hit, fading over a second. */
    this.flash = 0;
    /** The device in your hand: 'gps', 'monitor', 'map' or null. */
    this.held = null;
    this._buildDevices();
  }

  showMessage(text) {
    // Just the first sentence: the screen stays quiet.
    const first = String(text).match(/^.*?[.!?…](?=\s|$)/)?.[0] ?? text;
    $('message').textContent = first.replace(/[.]$/, '');
    this.messageTime = 3;
  }

  /** Fade to black and back, for a night's sleep. */
  showSleep() {
    this.sleepTime = 2.5;
    this.messageTime = 5;
  }

  /** Hold a device up, or put it away. */
  hold(id) {
    this.held = this.held === id ? null : id;
    for (const [k, el] of Object.entries(this.devices)) el.classList.toggle('up', k === this.held);
    this.slowTimer = 0;
  }

  update(dt) {
    const c = this.climber;
    const body = c.body;
    this.messageTime -= dt;
    $('message').style.opacity = Math.min(Math.max(this.messageTime, 0), 1);
    this.sleepTime = Math.max((this.sleepTime ?? 0) - dt, 0);
    $('sleep').style.opacity = Math.min(this.sleepTime / 1.2, 1).toFixed(3);
    // Put a device away if it's gone from the pack.
    if (this.held && !c.pack.gear.has(this.held)) this.hold(this.held);

    // Vision: every frame so the pulse with your breathing is smooth.
    const p = body.breathPhase;
    const fill = p < 0.4 ? Math.sin((p / 0.4) * Math.PI * 0.5) : Math.cos(((p - 0.4) / 0.6) * Math.PI * 0.5);
    const hard = body.breathlessness();
    let strain = Math.min(Math.max(1 - body.stamina / 60, 0), 1) * 0.7 + hard * 0.3;
    if (c.mode === Mode.FLY) strain = 0;
    const v = $('vignette');
    v.style.setProperty('--inner', `${(55 - 35 * strain - 3 * fill * strain).toFixed(1)}%`);
    v.style.opacity = (0.25 + 0.7 * strain).toFixed(3);

    const hurtFilter = this._injury(dt);
    const blur = c.mods.blur;
    this.canvas ??= document.getElementById('c');
    const sick = blur > 0.05 ? `blur(${(blur * 2.5).toFixed(2)}px) saturate(${(1 - blur * 0.5).toFixed(2)})` : '';
    this.canvas.style.filter = [sick, hurtFilter].filter(Boolean).join(' ');
    $('health-fill').style.width = `${c.health}%`;
    $('health-cap').style.left = `${c.maxHealth}%`;
    $('health-cap').hidden = c.maxHealth >= 100;
    $('stamina-fill').style.width = `${body.stamina}%`;
    $('stamina-fill').classList.toggle('low', body.exhausted || body.stamina < 25);
    $('stamina-cap').style.left = `${body.staminaCap(c.breathAltitude)}%`;
    // Grip, only while you hang off the axe or are getting it back.
    const showGrip = c.onAxeWall || c.grip < 99;
    $('grip-row').hidden = !showGrip;
    if (showGrip) {
      $('grip-fill').style.width = `${c.grip}%`;
      $('grip-fill').classList.toggle('low', c.grip < 30);
    }
    // Quiet when all is well, clear when it isn't.
    const fine = c.health > 90 && body.stamina > 85 && !body.exhausted && !showGrip;
    $('vitals').classList.toggle('quiet', fine);
    if (this.held === 'map') this._drawMap();
    if (this.held === 'monitor') this._pulse(fill, hard);

    this.slowTimer -= dt;
    if (this.slowTimer > 0) return;
    this.slowTimer = 0.1;
    $('day-num').textContent = `Day ${c.day}`;
    $('day-time').textContent = c.clockText();
    $('day-speed').textContent = c.timeScale !== 10 ? `×${c.timeScale}` : '';
    $('death').hidden = !c.dead;
    if (c.dead) {
      $('death-cause').textContent = c.deathCause;
    }
    this._prompt();
    this._chips();
    this._hotbar();
    if (this.held === 'gps') this._gps();
    if (this.held === 'monitor') this._monitor();
  }

  /** The quick slots along the bottom: keys 1 to 9 hold or use what's in them. */
  _hotbar() {
    const c = this.climber;
    this.hot = hotbarItems(c);
    const html = this.hot.map((it, i) => {
      const on = it.id === this.held || ((it.id === 'axe' || it.id === 'axe_tech') && c.axe.inHand) || (it.id === 'oxygen' && c.phys.flow > 0);
      return `<div class="hs${on ? ' on' : ''}" title="${it.label}"><b>${i + 1}</b>${icon(it.id)}${it.count !== undefined ? `<span>${it.count}</span>` : ''}</div>`;
    }).join('');
    if (html !== this._hotHtml) $('hotbar').innerHTML = this._hotHtml = html;
  }

  /** Serious conditions as small tags over the health bar. */
  _chips() {
    const c = this.climber;
    const list = c.phys.conditions().filter((x) => x.severity >= 0.66);
    for (const e of c.effects.values()) if (e.label) list.push({ label: e.label, severity: 0.5 });
    const html = list.map((x) => `<span class="${x.severity >= 0.66 ? 'bad' : ''}">${x.label}</span>`).join('');
    if (html !== this._chipHtml) $('vital-chips').innerHTML = this._chipHtml = html;
  }

  // ---- Prompts: a short warning and the keys that do something here. ----

  _prompt() {
    const { alert, actions } = this._what();
    const html = actions.map(([k, label]) => `<span class="act"><kbd>${k}</kbd>${label}</span>`).join('');
    if (html !== this._actHtml) $('actions').innerHTML = this._actHtml = html;
    $('alert').textContent = alert;
  }

  _what() {
    const c = this.climber;
    const body = c.body;
    const ex = this.ex;
    const pack = c.pack;
    const acts = [];
    const out = (alert = '') => ({ alert, actions: acts });
    if (c.mode === Mode.FLY) { acts.push(['F', 'Land']); return out(); }
    if (c.dead) return out();
    if (c.tumbling) return out('Tumbling');
    if (c.falling && (c.fall.rope || c.fall.hole)) return out('Falling');
    if (c.falling) {
      if (c.axe.have && !c.axeReady) {
        if (!c.axe.inHand) acts.push(['I', 'Axe']);
        else if (c.axe.dangling > 0) return out('Grabbing the axe');
      }
      if (c.fall.arresting) return out('Digging in');
      if (c.runaway) return out('Too fast to arrest');
      acts.push(['Space', 'Self-arrest']);
      return out();
    }
    if (c.mode === Mode.HOLE) {
      const up = Math.round(c.inHole.rim - c.position.y);
      if (!body.exhausted) acts.push(['W', 'Climb out']);
      return out(body.exhausted ? 'Exhausted' : `${up} m down`);
    }
    let alert = '';
    if (body.exhausted) alert = 'Exhausted';
    else if (c.gasping) alert = 'Catch your breath';
    if (c.rockfall.rocks.some((r) => r.velocity.length() > 2 && r.position.distanceTo(c.position) < tuning.rock_warn_m && r.position.y > c.position.y)) alert = 'Rockfall';
    const ice = c.features?.icefall.rocks;
    if (ice?.some((r) => r.velocity.length() > 2 && r.position.distanceTo(c.position) < tuning.icefall_warn_m && r.position.y > c.position.y)) alert = 'Icefall';
    if (c.phys.hace >= 0.3 || c.phys.hape >= 0.3) {
      alert ||= 'Altitude sickness: go down';
      if (pack.bottles.length && !c.phys.flow) acts.push(['O', 'Oxygen']);
      if (pack.dex) acts.push(['P', 'Dex']);
    }
    if (c.blockedByIce) alert ||= 'Ice wall';
    if (c.onAxeWall) {
      acts.push(['Click', 'Swing'], ['S + Click', 'Down']);
      if (c.grip < 30) alert ||= 'Grip failing';
    }
    if (c.blocked) {
      const axeGround = ['soft_snow', 'firm_snow', 'crust', 'slush', 'glacier', 'ice'].includes(c.surface.key);
      if (axeGround && !c.axeReady && c.slope < tuning.axe_climb_max_deg && c.axe.have) acts.push(['I', 'Axe']);
      else alert ||= 'Too steep';
    }

    // Ropes and protection.
    if (c.clipped) acts.push(['C', 'Unclip']);
    else if (c.ropeDistance() < CLIP_RANGE) acts.push(['C', 'Clip in']);
    else if (!ex.protectedNow) {
      const pr = ex.canProtect();
      if (pr.kind) acts.push(['E', pr.kind === 'screw' ? 'Ice screw' : 'Picket']);
    }

    // Camps, tents and shelter.
    const camp = c._campNearby();
    if (c.canSleep()) {
      acts.push(['Z', c.sleepPlan().night ? 'Sleep' : 'Nap']);
      if (ex.canCookHere()) acts.push(['K', 'Cook']);
      if (ex.ownTentNearby()) acts.push(['G', 'Strike tent']);
    } else {
      const sh = ex.shelterOption();
      const w = c.conditions;
      const rough = (w && (w.visibility < 300 || w.gust > 15)) || c.hour >= tuning.night_from_hour || c.hour < 5 || body.exhausted || c.health < 50;
      if (sh && rough && !camp) acts.push(['Z', sh.label]);
    }
    if (camp && !ex.ownTentNearby()) acts.push(['G', camp.name === 'Base Camp' ? 'Gear up' : 'Restock']);

    if (c.features && this.hm.glacierAt(c.position.x, c.position.z) > 0.4 && c.features.trailDistance(c.position.x, c.position.z) > 15
      && (hasGear(pack, 'probe') || c.axe.have)) acts.push(['X', 'Probe']);

    const ph = c.phys;
    if (c.pastTurnaround) alert ||= 'Turn back';
    if (ph.core < tuning.hypothermia_mild_c) alert ||= 'Freezing';
    if (ph.hydration < 30) { if (pack.water > 0) acts.push(['H', 'Drink']); else alert ||= 'Thirsty'; }
    if (ph.food < tuning.low_sugar_below && pack.snack > 0) acts.push(['B', 'Eat']);
    const w = c.conditions;
    if (w && w.visibility < 40) alert ||= 'Whiteout';
    if (c.health < 50) alert ||= 'Injured';
    if (body.stamina < 25 && !body.exhausted) alert ||= 'Rest';
    return { alert, actions: acts.slice(0, 4) };
  }

  /**
   * A red flash each time you are hurt, bigger for bigger hits. Below about 70%
   * health the edge of the screen stays red and blurred, closing in as it drops.
   */
  _injury(dt) {
    const c = this.climber;
    const lost = this.lastHealth - c.health;
    if (lost > 0.3) this.flash = Math.min(0.55, this.flash + 0.12 + lost / 40);
    else if (c.health > this.lastHealth + 20) this.flash = 0; // rescued or healed in a jump
    this.lastHealth = c.health;
    this.flash *= Math.exp(-dt * 2.2);
    // Vision closes in from 80 health down: red, dark, blurred edges, and near
    // death a narrow, pulsing tunnel with everything dim and grey.
    const hurt = c.dead ? 1 : Math.min(Math.max((80 - c.health) / 75, 0), 1);
    const deep = hurt * hurt;
    this.beat = (this.beat ?? 0) + dt * (1.2 + 1.6 * hurt);
    const pulse = deep * 0.5 * (1 + Math.sin(this.beat * Math.PI * 2)) * 0.5;
    const inner = Math.max(2, 65 - 60 * hurt - 6 * pulse); // the clear middle shrinks from 65% to a few %
    const red = $('hurt');
    red.style.setProperty('--inner', `${inner.toFixed(1)}%`);
    red.style.setProperty('--red', Math.min(1, 0.3 + 0.7 * hurt + this.flash).toFixed(3));
    red.style.setProperty('--dark', Math.min(0.97, 0.9 * deep + 0.15 * pulse).toFixed(3));
    red.style.setProperty('--flash', (this.flash * 0.45).toFixed(3));
    red.style.opacity = hurt > 0 || this.flash > 0.01 ? 1 : 0;
    const blur = $('hurt-blur');
    blur.style.setProperty('--inner', `${Math.max(0, inner - 25).toFixed(1)}%`);
    blur.style.setProperty('--blur', `${(24 * hurt + 6 * this.flash).toFixed(1)}px`);
    blur.style.opacity = hurt > 0.05 || this.flash > 0.05 ? 1 : 0;
    // The whole view dims, loses colour and goes soft as well.
    if (hurt < 0.02) return '';
    return `blur(${(1.5 * hurt + 5 * deep).toFixed(2)}px) brightness(${(1 - 0.55 * deep).toFixed(2)}) saturate(${(1 - 0.8 * hurt).toFixed(2)}) contrast(${(1 - 0.25 * deep).toFixed(2)})`;
  }

  // ---- Devices ----

  _buildDevices() {
    const held = $('held');
    const row = (id, label) => `<div class="r"><span>${label}</span><b id="${id}">—</b></div>`;
    const gps = document.createElement('div');
    gps.className = 'device gps';
    gps.innerHTML = `<div class="brand">WYMPR</div><div class="screen">
      <div class="alt" id="g-alt">—</div><div class="sub" id="g-place"></div>
      ${row('g-vnow', 'Vert')}${row('g-vavg', 'Avg 1 h')}${row('g-slope', 'Slope')}${row('g-surface', 'Surface')}${row('g-terrain', 'Moving')}${row('g-dist', 'Summit')}
      <div class="sep"></div>
      ${row('g-wx', 'Sky')}${row('g-temp', 'Air')}${row('g-wind', 'Wind')}${row('g-vis', 'Vis')}${row('g-aval', 'Aval')}${row('g-turn', 'Turn')}
      <div class="fc" id="g-fc"></div></div>
      <div class="btns"><i></i><i></i><i></i></div>`;
    const mon = document.createElement('div');
    mon.className = 'device monitor';
    mon.innerHTML = `<div class="brand">VITALS</div><div class="screen">
      <div class="top"><canvas id="m-pulse" width="200" height="60"></canvas><div><div class="big" id="m-br">—</div><small>breaths/min</small></div></div>
      <div class="meters"><div><span>Food</span><div class="m"><div id="m-food"></div></div></div><div><span>Water</span><div class="m"><div id="m-water"></div></div></div></div>
      ${row('m-core', 'Core')}${row('m-air', 'Feels')}${row('m-o2', 'O₂')}${row('m-eff', 'Lungs at')}${row('m-acc', 'Acclim.')}${row('m-pack', 'Pack')}
      <div class="conds" id="m-cond"></div></div>`;
    const map = document.createElement('div');
    map.className = 'device map';
    map.innerHTML = `<canvas id="map" width="${MAP.n * MAP.px}" height="${MAP.n * MAP.px}"></canvas>`;
    held.append(gps, mon, map);
    this.devices = { gps, monitor: mon, map };
    this.pulse = $('m-pulse').getContext('2d');
    this._pulseTrace = new Array(100).fill(0.5);
    this._buildMap();
  }

  _gps() {
    const c = this.climber;
    $('g-alt').textContent = `${Math.round(c.position.y).toLocaleString('en-US')} m`;
    $('g-place').textContent = c.placeName || c._campNearby()?.name || '';
    $('g-vnow').textContent = signed(c.verticalNow) + ' m/h';
    $('g-vavg').textContent = signed(c.verticalAvg) + ' m/h';
    $('g-slope').textContent = `${Math.round(c.slope)}°`;
    $('g-surface').textContent = this._surfaceText();
    $('g-terrain').textContent = c.modeName();
    const d = Math.hypot(c.position.x, c.position.y - this.summitHeight, c.position.z);
    $('g-dist').textContent = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
    $('g-turn').textContent = `${String(c.turnaroundHour).padStart(2, '0')}:00`;
    $('g-turn').classList.toggle('late', c.pastTurnaround);
    const w = c.conditions;
    if (!w) return;
    $('g-wx').textContent = w.inCloud > 0.5 && w.key === 'cloudy' ? 'In cloud' : w.label;
    $('g-temp').textContent = `${Math.round(w.airC)} / ${Math.round(w.windChillC)} °C`;
    $('g-wind').textContent = `${Math.round(w.gust * 3.6)} km/h ${compass(w.windFromDeg)}`;
    const v = w.visibility;
    $('g-vis').textContent = v >= 10000 ? `${Math.round(v / 1000)} km` : v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v / 10) * 10 || 5} m`;
    const aval = $('g-aval');
    aval.textContent = dangerLabel(w.avalancheDanger);
    aval.className = `danger-${Math.min(5, Math.floor(w.avalancheDanger * 5) + 1)}`;
    // The forecast comes over the radio, or from the camp's radio.
    const fc = $('g-fc');
    const canHear = c.weather && (c.pack.gear.has('radio') || c._campNearby());
    if (canHear && (this._forecastAt ?? -1e9) < c.mountainSeconds - 1800) {
      this._forecastAt = c.mountainSeconds;
      fc.textContent = c.weather.forecastText(c.mountainSeconds);
    } else if (!canHear) {
      fc.textContent = '';
      this._forecastAt = -1e9;
    }
  }

  _monitor() {
    const c = this.climber;
    const ph = c.phys;
    const pack = c.pack;
    const air = ph.air;
    $('m-br').textContent = Math.round(c.body.breathRate);
    $('m-food').style.width = `${ph.food}%`;
    $('m-water').style.width = `${ph.hydration}%`;
    $('m-core').textContent = `${ph.core.toFixed(1)} °C`;
    $('m-air').textContent = air ? `${Math.round(air.feelsLikeC)} °C` : '—';
    const left = pack.bottles.length ? Math.round((pack.bottles[0] / tuning.pack.oxygen.litres) * 100) : 0;
    $('m-o2').textContent = pack.bottles.length ? `${ph.flow ? `${ph.flow} L/min` : 'off'} · ${left}% · ${pack.bottles.length}` : 'none';
    $('m-eff').textContent = `${Math.round(ph.effectiveAltitude).toLocaleString('en-US')} m`;
    $('m-acc').textContent = `${Math.round(ph.acclimatized).toLocaleString('en-US')} m`;
    $('m-pack').textContent = `${pack.kg.toFixed(1)} kg`;
    const list = ph.conditions();
    for (const e of c.effects.values()) if (e.label) list.push({ label: e.label, severity: 0.5 });
    for (const i of c.permanentInjuries) list.push({ label: i.label, severity: 1 });
    const html = list.map((x) => `<span class="${x.severity >= 0.66 ? 'bad' : ''}">${x.label}</span>`).join('');
    if (html !== this._condHtml) $('m-cond').innerHTML = this._condHtml = html;
  }

  /** A breathing trace scrolling across the monitor. */
  _pulse(fill, hard) {
    const t = this._pulseTrace;
    t.shift();
    t.push(Math.max(fill, 0));
    const x = this.pulse;
    const { width: w, height: h } = x.canvas;
    x.clearRect(0, 0, w, h);
    x.strokeStyle = `hsl(${150 - 140 * hard}, 80%, 60%)`;
    x.lineWidth = 3;
    x.beginPath();
    t.forEach((v, i) => { const px = (i / (t.length - 1)) * w, py = h - 6 - v * (h - 12); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.stroke();
  }

  _surfaceText() {
    const c = this.climber;
    let text = c.surface.label;
    if (c.sink > 0.25) text += ', deep';
    if (c.onLedge) text += ', ledge';
    return text;
  }

  /** The printed map: hillshade, contours, glacier, the route and the camps. Drawn once. */
  _buildMap() {
    const hm = this.hm;
    const { r0, c0, n, px } = MAP;
    const S = n * px;
    const base = document.createElement('canvas');
    base.width = base.height = S;
    const bx = base.getContext('2d');
    const img = bx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const rr = r0 + y / px, cc = c0 + x / px;
        const h = sample(hm, rr, cc);
        const hx = sample(hm, rr, cc + 1) - sample(hm, rr, cc - 1);
        const hz = sample(hm, rr + 1, cc) - sample(hm, rr - 1, cc);
        const slope = Math.atan(Math.hypot(hx, hz) / (2 * hm.cell)) * 57.3;
        const shade = Math.min(Math.max(0.78 + (-hx - hz) * 0.004, 0.45), 1.12);
        const [wx, wz] = hm.gridToWorld(rr, cc);
        const glacier = hm.glacierAt(wx, wz);
        // Paper, then ice blue on glaciers, white snowfields high up, rock grey on cliffs.
        let col = [236, 228, 206];
        if (h > 6000) col = mix(col, [246, 247, 248], Math.min((h - 6000) / 600, 1));
        col = mix(col, [208, 226, 236], glacier);
        col = mix(col, [176, 160, 140], Math.min(Math.max((slope - 35) / 20, 0), 1) * 0.8);
        // Contours every 100 m, bolder every 500.
        const step = 100;
        const band = Math.floor(h / step);
        const right = Math.floor(sample(hm, rr, cc + 1 / px) / step), down = Math.floor(sample(hm, rr + 1 / px, cc) / step);
        let line = 0;
        if (band !== right || band !== down) line = (Math.max(band, right, down) * step) % 500 === 0 ? 0.75 : 0.35;
        col = mix(col.map((v) => v * shade), glacier > 0.5 ? [70, 120, 170] : [150, 95, 50], line);
        const i = (y * S + x) * 4;
        img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
      }
    }
    bx.putImageData(img, 0, 0);
    const toMap = (r, c) => [(c - c0) * px, (r - r0) * px];
    // Kilometre grid, faint.
    bx.strokeStyle = 'rgba(40, 90, 150, .18)';
    bx.lineWidth = 1;
    const kmCells = 1000 / hm.cell;
    for (let k = 0; k * kmCells * px < S; k++) {
      const o = k * kmCells * px;
      bx.beginPath(); bx.moveTo(o, 0); bx.lineTo(o, S); bx.moveTo(0, o); bx.lineTo(S, o); bx.stroke();
    }
    // The wanded trail and the fixed ropes.
    const path = (pts, color, dash, w) => {
      bx.strokeStyle = color; bx.lineWidth = w; bx.setLineDash(dash);
      bx.beginPath();
      pts.forEach(([r, c], i) => { const [x, y] = toMap(r, c); i ? bx.lineTo(x, y) : bx.moveTo(x, y); });
      bx.stroke(); bx.setLineDash([]);
    };
    if (featureDefs.wand_trail) path(featureDefs.wand_trail.points, '#2b2b2b', [6, 4], 2);
    for (const rope of route.fixed_ropes) path(rope.points, '#c62828', [8, 3], 3);
    // Camps and peaks.
    bx.font = '600 13px Georgia, serif';
    bx.textBaseline = 'middle';
    for (const p of this.places) {
      const [x, y] = toMap(p.r, p.c);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      const peak = p.tents === 0 && (p.name === 'Summit' || p.name === 'Broad Peak');
      bx.fillStyle = peak ? '#222' : '#c62828';
      bx.beginPath();
      if (peak) { bx.moveTo(x, y - 7); bx.lineTo(x + 6, y + 4); bx.lineTo(x - 6, y + 4); } else bx.arc(x, y, 4, 0, 7);
      bx.closePath();
      bx.fill();
      const name = p.name === 'Summit' ? 'K2 8611' : p.name === 'Broad Peak' ? 'Broad Peak 8051' : p.name === 'Advanced Base Camp' ? 'ABC' : p.name;
      bx.lineWidth = 3;
      bx.strokeStyle = 'rgba(240, 234, 214, .85)';
      bx.strokeText(name, x + 8, y);
      bx.fillStyle = peak ? '#111' : '#7a1a1a';
      bx.fillText(name, x + 8, y);
    }
    // Title block and north arrow.
    bx.fillStyle = 'rgba(240, 234, 214, .92)';
    bx.fillRect(10, S - 54, 200, 44);
    bx.strokeStyle = '#333'; bx.lineWidth = 1; bx.strokeRect(10, S - 54, 200, 44);
    bx.fillStyle = '#222';
    bx.font = '700 15px Georgia, serif';
    bx.fillText('K2 · Abruzzi Spur', 18, S - 40);
    bx.font = '12px Georgia, serif';
    bx.fillText('Karakoram · contours 100 m · grid 1 km', 18, S - 22);
    bx.font = '700 16px Georgia, serif';
    bx.fillText('N', S - 24, 22);
    bx.beginPath(); bx.moveTo(S - 19, 34); bx.lineTo(S - 13, 52); bx.lineTo(S - 25, 52); bx.closePath(); bx.fill();
    this.mapBase = base;
    this.mapCtx = $('map').getContext('2d');
  }

  /** The map with where you are pencilled on. */
  _drawMap() {
    const mx = this.mapCtx;
    mx.drawImage(this.mapBase, 0, 0);
    const c = this.climber;
    const hm = this.hm;
    const x = (c.position.x / hm.cell + hm.half - MAP.c0) * MAP.px;
    const y = (c.position.z / hm.cell + hm.half - MAP.r0) * MAP.px;
    mx.save();
    mx.translate(x, y);
    mx.strokeStyle = '#d0021b';
    mx.lineWidth = 2.5;
    mx.beginPath(); mx.arc(0, 0, 9, 0, 7); mx.stroke();
    mx.rotate(-c.yaw);
    mx.beginPath(); mx.moveTo(0, -9); mx.lineTo(0, -20); mx.stroke();
    mx.restore();
  }
}

function sample(hm, r, c) {
  const r0 = Math.floor(r), c0 = Math.floor(c);
  const fr = r - r0, fc = c - c0;
  const a = hm.at(r0, c0), b = hm.at(r0, c0 + 1), d = hm.at(r0 + 1, c0), e = hm.at(r0 + 1, c0 + 1);
  return (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function signed(v) {
  const r = Math.round(v);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-US');
}
