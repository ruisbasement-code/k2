// Altimeter, slope and pace, stamina and breathing, the mountain clock, prompts,
// the minimap and the darkening at the edge of vision.

import { Mode, CLIP_RANGE } from '../player/climber.js';
import { partOfDay } from '../world/sky.js';
import { tuning } from '../sim/paceModel.js';
import { compass, dangerLabel } from '../sim/weather.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(hm, climber, places) {
    this.hm = hm;
    this.climber = climber;
    this.places = places;
    this.summitHeight = hm.heightAt(0, 0);
    this.messageTime = 0;
    this.slowTimer = 0;
    this.lastHealth = climber.health;
    /** Red flash from the latest hit, fading over a second. */
    this.flash = 0;
    this._buildMinimap();
  }

  showMessage(text) {
    $('message').textContent = text;
    this.messageTime = 4;
  }

  /** Fade to black and back, for a night's sleep. */
  showSleep() {
    this.sleepTime = 2.5;
    this.messageTime = 6;
  }

  update(dt) {
    const c = this.climber;
    const body = c.body;
    this.messageTime -= dt;
    $('message').style.opacity = Math.min(Math.max(this.messageTime, 0), 1);
    this.sleepTime = Math.max((this.sleepTime ?? 0) - dt, 0);
    $('sleep').style.opacity = Math.min(this.sleepTime / 1.2, 1).toFixed(3);

    // Breath ring and vision: every frame so the pulse is smooth.
    const p = body.breathPhase;
    const fill = p < 0.4 ? Math.sin((p / 0.4) * Math.PI * 0.5) : Math.cos(((p - 0.4) / 0.6) * Math.PI * 0.5);
    const hard = body.breathlessness();
    const ring = $('breath-ring');
    ring.style.transform = `scale(${0.35 + 0.6 * Math.max(fill, 0)})`;
    ring.style.background = `hsla(${200 - 190 * hard}, 85%, 65%, 0.45)`;
    let strain = Math.min(Math.max(1 - body.stamina / 60, 0), 1) * 0.7 + hard * 0.3;
    if (c.mode === Mode.FLY) strain = 0;
    const v = $('vignette');
    v.style.setProperty('--inner', `${(55 - 35 * strain - 3 * fill * strain).toFixed(1)}%`);
    v.style.opacity = (0.25 + 0.7 * strain).toFixed(3);

    this._injury(dt);
    const blur = c.mods.blur;
    this.canvas ??= document.getElementById('c');
    this.canvas.style.filter = blur > 0.05 ? `blur(${(blur * 2.5).toFixed(2)}px) saturate(${(1 - blur * 0.5).toFixed(2)})` : '';
    $('health-fill').style.width = `${c.health}%`;
    $('health-cap').style.left = `${c.maxHealth}%`;
    $('health-cap').hidden = c.maxHealth >= 100;
    $('stamina-fill').style.width = `${body.stamina}%`;
    $('stamina-fill').classList.toggle('low', body.exhausted || body.stamina < 25);
    $('stamina-cap').style.left = `${body.staminaCap(c.breathAltitude)}%`;
    $('food-fill').style.width = `${c.phys.food}%`;
    $('water-fill').style.width = `${c.phys.hydration}%`;
    this._drawMap();

    this.slowTimer -= dt;
    if (this.slowTimer > 0) return;
    this.slowTimer = 0.1;
    $('alt').textContent = `${Math.round(c.position.y).toLocaleString('en-US')} m`;
    $('terrain').textContent = c.modeName();
    $('slope').textContent = `${Math.round(c.slope)}°`;
    $('vnow').textContent = signed(c.verticalNow) + ' m/h';
    $('vavg').textContent = signed(c.verticalAvg) + ' m/h';
    $('surface').textContent = this._surfaceText();
    $('bps').textContent = c.breathsPerStep < 0.95 ? 'easy' : `${c.breathsPerStep.toFixed(1)} per step`;
    $('day-num').textContent = `Day ${c.day}`;
    $('day-time').textContent = c.clockText();
    $('day-part').textContent = partOfDay(c.hour);
    $('day-speed').textContent = `×${c.timeScale}`;
    $('day-turn').textContent = `Turn ${String(c.turnaroundHour).padStart(2, '0')}:00`;
    $('day-turn').classList.toggle('late', c.pastTurnaround);
    this._body();
    $('death').hidden = !c.dead;
    if (c.dead) {
      $('death-cause').textContent = c.deathCause;
      $('death-camp').textContent = c.lastCamp?.name ?? 'Base Camp';
    }
    const d = Math.hypot(c.position.x, c.position.y - this.summitHeight, c.position.z);
    $('dist').textContent = d > 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`;
    const word = body.breathRate < 22 ? 'calm' : body.breathRate < 38 ? 'heavy' : 'gasping';
    $('breath-text').textContent = `Breathing ${Math.round(body.breathRate)}/min, ${word}`;
    $('prompt').textContent = this._prompt();
    this._weather();
  }

  /** Weather where you are, and the radio forecast while you are in a camp. */
  _weather() {
    const c = this.climber;
    const w = c.conditions;
    if (!w) return;
    $('wx').textContent = w.inCloud > 0.5 && w.key === 'cloudy' ? 'In the cloud' : w.label;
    $('wx-temp').textContent = `${Math.round(w.airC)} °C`;
    $('wx-chill').textContent = `${Math.round(w.windChillC)} °C`;
    $('wx-wind').textContent = `${Math.round(w.gust * 3.6)} km/h ${compass(w.windFromDeg)}`;
    const v = w.visibility;
    $('wx-vis').textContent = v >= 10000 ? `${Math.round(v / 1000)} km` : v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v / 10) * 10 || 5} m`;
    const aval = $('wx-aval');
    aval.textContent = dangerLabel(w.avalancheDanger);
    aval.className = `danger-${Math.min(5, Math.floor(w.avalancheDanger * 5) + 1)}`;
    const camp = c._campNearby();
    const box = $('forecast');
    box.hidden = !camp || !c.weather;
    if (!box.hidden && (this._forecastAt ?? -1e9) < c.mountainSeconds - 1800) {
      this._forecastAt = c.mountainSeconds;
      box.innerHTML = `<b>Radio forecast</b> · ${c.weather.forecastText(c.mountainSeconds)}`;
    }
  }

  _body() {
    const c = this.climber;
    const ph = c.phys;
    const pack = c.pack;
    const air = ph.air;
    $('core').textContent = `${ph.core.toFixed(1)} °C${ph.shivering ? ', shivering' : ''}`;
    $('air').textContent = `${Math.round(air.airTempC)} °C, ${Math.round(air.feelsLikeC)} °C`;
    const left = pack.bottles.length ? Math.round((pack.bottles[0] / tuning.pack.oxygen.litres) * 100) : 0;
    $('o2').textContent = pack.bottles.length
      ? `${ph.flow ? `${ph.flow} L/min` : 'off'} · ${left}% · ${pack.bottles.length} btl`
      : 'none';
    $('effalt').textContent = `${Math.round(ph.effectiveAltitude).toLocaleString('en-US')} m`;
    $('acclim').textContent = `${Math.round(ph.acclimatized).toLocaleString('en-US')} m`;
    $('packkg').textContent = `${pack.kg.toFixed(1)} kg`;
    $('inventory').textContent = `Snacks ${pack.snack} · Meals ${pack.meal} · Gas ${pack.count('gas')} · Water ${pack.water.toFixed(1)} L · Dex ${pack.dex}`;
    const list = ph.conditions();
    for (const e of c.effects.values()) list.push({ label: e.label, severity: 0.5 });
    if (c.permanentInjuries.length) for (const i of c.permanentInjuries) list.push({ label: i.label, severity: 1 });
    const html = list.map((x) => `<span class="${x.severity >= 0.66 ? 'bad' : ''}">${x.label}</span>`).join('');
    if (html !== this._condHtml) $('conditions').innerHTML = this._condHtml = html;
  }

  _prompt() {
    const c = this.climber;
    const body = c.body;
    if (c.mode === Mode.FLY) return 'Scout fly: E/Space up, Q down, Shift fast. F to land.';
    if (c.dead) return '';
    if (c.tumbling) return 'Tumbling!';
    if (c.falling && c.fall.rope) return 'Falling onto the rope…';
    if (c.falling) {
      if (c.fall.arresting) return 'Digging in… keep holding Space';
      if (c.runaway) return 'Sliding too fast to dig in. Hold Space as soon as you slow down or reach flatter ground.';
      const o = c.fall.orient;
      if (o.back || o.head) return `Sliding ${c.slideHow()}! Hold Space: roll onto your front and swing your feet downhill.`;
      return 'Sliding! Hold Space to self-arrest before you pick up speed.';
    }
    if (body.exhausted) return 'Exhausted. Stand still and breathe.';
    if (c.gasping) return 'Gasping. Stand and breathe until it settles. Shift rushes your breaths.';
    if (c.rockfall.rocks.some((r) => r.velocity.length() > 2 && r.position.distanceTo(c.position) < tuning.rock_warn_m && r.position.y > c.position.y))
      return 'Rocks coming down! Get out of the fall line.';
    if (c.phys.hace >= 0.3 || c.phys.hape >= 0.3) return 'Altitude illness! Go down now. Oxygen (O) and dex (P) buy time.';
    if (c.blocked) return 'Too steep to climb without a fixed rope';
    if (c.clipped) return 'Clipped in: move freely. The rope speeds you along it and catches slips. C unclips.';
    if (c.ropeDistance() < CLIP_RANGE) return 'Fixed rope here. Press C to clip in.';
    if (c.canSleep()) {
      const plan = c.sleepPlan();
      return plan.night ? 'Tent here. Z to sleep until morning, K to cook.' : `Tent here. Z for a ${plan.hours} h nap, K to cook.`;
    }
    if (c.slope > tuning.climb_start_deg) return `Steep ${c.surface.label.toLowerCase()} and unroped: one slip and you slide.`;
    const ph = c.phys;
    if (c.pastTurnaround) return `Past your ${c.turnaroundHour}:00 turnaround. Head down.`;
    if (ph.core < tuning.hypothermia_mild_c) return 'Hypothermic. Keep moving, or get into a tent and sleep.';
    if (ph.hydration < 30) return 'Dehydrated. Drink (H), or melt snow in a tent (K).';
    if (ph.food < tuning.low_sugar_below) return 'Low on energy. Eat a snack (B).';
    const w = c.conditions;
    if (w && w.visibility < 40) return 'Whiteout: you can barely see your feet. Stay on the rope or wait it out.';
    if (w && w.gust > 22 && c.slope > tuning.climb_start_deg && !c.clipped) return 'Violent gusts on steep ground: clip in or get off the ridge.';
    if (c.health < 50) return 'Injured. Rest to heal, faster in a camp, or sleep in a tent.';
    if (body.stamina < 25) return 'Nearly spent. Stop and rest.';
    return '';
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
    const hurt = c.dead ? 1 : Math.min(Math.max((70 - c.health) / 70, 0), 1);
    const inner = 70 - 50 * hurt; // the clear middle shrinks from 70% to 20%
    const red = $('hurt');
    red.style.setProperty('--inner', `${inner.toFixed(1)}%`);
    red.style.setProperty('--red', (0.25 + 0.6 * hurt + this.flash).toFixed(3));
    red.style.setProperty('--flash', (this.flash * 0.45).toFixed(3));
    red.style.opacity = hurt > 0 || this.flash > 0.01 ? 1 : 0;
    const blur = $('hurt-blur');
    blur.style.setProperty('--inner', `${inner.toFixed(1)}%`);
    blur.style.setProperty('--blur', `${(6 * hurt + 4 * this.flash).toFixed(1)}px`);
    blur.style.opacity = hurt > 0.05 || this.flash > 0.05 ? 1 : 0;
  }

  _surfaceText() {
    const c = this.climber;
    let text = c.surface.label;
    if (c.sink > 0.25) text += ', knee-deep';
    else if (c.sink > 0.1) text += ', ankle-deep';
    if (c.packing > 0) text += ', trodden';
    if (c.onLedge) text += ', on a ledge';
    return text;
  }

  _buildMinimap() {
    const hm = this.hm;
    const n = hm.n;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = n;
    const bx = this.base.getContext('2d');
    const img = bx.createImageData(n, n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const h = hm.h[i];
        const shade = Math.min(Math.max(0.6 + ((hm.at(r, c - 1) - h) + (hm.at(r - 1, c) - h)) * 0.012, 0), 1);
        const v = (60 + ((h - 4600) / 4000) * 170) * shade + 25;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v * 1.02;
        img.data[i * 4 + 2] = v * 1.08 + 8;
        img.data[i * 4 + 3] = 255;
      }
    }
    bx.putImageData(img, 0, 0);
    this.mapCtx = $('map').getContext('2d');
  }

  _drawMap() {
    const mx = this.mapCtx;
    const S = mx.canvas.width;
    const hm = this.hm;
    const k = S / hm.size;
    const toMap = (x, z) => [(x + hm.size / 2) * k, (z + hm.size / 2) * k];
    mx.drawImage(this.base, 0, 0, S, S);
    for (const p of this.places) {
      const [x, z] = hm.gridToWorld(p.r, p.c);
      const [px, py] = toMap(x, z);
      mx.fillStyle = p.name === 'Summit' ? '#ffd34d' : 'rgba(255,255,255,.85)';
      mx.beginPath();
      mx.arc(px, py, p.name === 'Summit' ? 5 : 3, 0, 7);
      mx.fill();
    }
    const c = this.climber;
    const [px, py] = toMap(c.position.x, c.position.z);
    mx.save();
    mx.translate(px, py);
    mx.rotate(-c.yaw);
    mx.fillStyle = '#ff6a1a';
    mx.strokeStyle = '#000';
    mx.lineWidth = 2;
    mx.beginPath();
    mx.moveTo(0, -13); mx.lineTo(8, 9); mx.lineTo(0, 4); mx.lineTo(-8, 9);
    mx.closePath();
    mx.stroke();
    mx.fill();
    mx.restore();
    mx.fillStyle = '#fff';
    mx.font = 'bold 20px system-ui';
    mx.fillText('N', S / 2 - 7, 22);
  }
}

function signed(v) {
  const r = Math.round(v);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('en-US');
}
