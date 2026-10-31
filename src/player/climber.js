// The player's climber: slope-aware movement (walk, climb, very steep), clipping
// into fixed ropes, and stamina and breathing.
//
// Clipping in does not lock you to the rope. You move freely within a leash of the
// rope; moving along it gets the jumar's speed, the rope steers you gently back
// toward its line, and it catches you instead of letting you slip.
//
// Fixed ropes are the only aid. You walk below 25°, scramble (slowly, tiring
// fast, with a chance of slipping) up to 35°, and above that only on a rope.
// Unroped, ground steeper than the surface can hold (ice least) makes you slide.
// A slide builds speed under gravity and the surface's friction; hold Space early
// to self-arrest. Too fast, too late or a hard hit and you tumble. Damage comes
// from how hard you hit the ground and from scraping over rock, not from distance.
// Lose all your health and you die; you are then rescued to the last camp you
// reached. Falls run in real seconds, not mountain time.
//
// Movement has momentum: you speed up and slow down gradually, and running down
// steep ground can trip you. On scrambling ground each step is a placement that
// can slip, more so when careless, turning or going down; loose holds crumble and
// send rocks down. Rocks and ice also fall by themselves, most in the warm
// afternoon. Snow comes as powder, firm snow, wind crust and afternoon slush; you
// sink in and leave a trail that packs it. Up high you need several breaths per
// step, and outpacing your breathing makes you stop and gasp. A slip on the rope
// drops you until it comes tight. How you land in a slide (front or back, head or
// feet first) decides how well you can self-arrest.
//
// Weather (when a Weather is attached): strong wind pushes you downwind and
// slows you into it, and a hard gust can throw you off steep ground. Avalanches
// come down from loaded slopes above, or break under your feet, and sweep you
// away; ice breaks off the serac above the Bottleneck in the warmth of the day.
// `conditions` holds the weather where you are (temperature, wind chill, wind,
// visibility, avalanche danger) for the HUD and the body's survival systems.
//
// Movement is simulated in mountain time: the world clock runs timeScale times
// faster than real time, so a realistic 400 m per hour still gets you somewhere.
// This class has no rendering in it, so tests can drive it directly.

import * as THREE from 'three';
import * as Pace from '../sim/paceModel.js';
import { ClimberBody } from '../sim/climberBody.js';
import { SnowTrail, Rockfall, isLoose, ledgeAt } from '../sim/hazards.js';
import { weatherTuning as W } from '../sim/weather.js';
import { Avalanches, isSlabSlope } from '../sim/avalanche.js';

const { tuning } = Pace;
const DEG = 180 / Math.PI;
const SNOW = new Set(['soft_snow', 'firm_snow', 'crust', 'slush', 'glacier']);

export const Mode = { WALK: 'walk', CLIMB: 'climb', STEEP: 'steep', ROPE: 'rope', FALL: 'fall', DEAD: 'dead', FLY: 'fly' };
const MODE_NAMES = {
  walk: 'Walking',
  climb: 'Scrambling',
  steep: 'Very steep',
  rope: 'Climbing on the rope',
  fall: 'Falling!',
  dead: 'Dead',
  fly: 'Scout fly',
};
export const CLIP_RANGE = 5;

export class Climber {
  /** @param places camps from route.json, for rescue and resting */
  constructor(hm, ropes, places = []) {
    this.hm = hm;
    this.ropes = ropes;
    this.places = places.filter((p) => p.tents > 0).map((p) => {
      const [x, z] = hm.gridToWorld(p.r, p.c);
      return { name: p.name, x, z };
    });
    /** The highest camp reached; you are rescued to it if you die. */
    this.lastCamp = this.places[0] ?? null;
    this.health = 100;
    this.velocity = new THREE.Vector3();
    this.surface = Pace.surfaceAt(5000, 0);
    /** The fall in progress or the last one: start height, distance, top speed, worst hit. */
    this.fall = null;
    this.deathCause = '';
    this.body = new ClimberBody();
    this.position = new THREE.Vector3();
    this.mode = Mode.WALK;
    this.groundMode = Mode.WALK;
    this.timeScale = tuning.default_time_scale;
    /** Seconds since midnight on day 1, mountain time. */
    this.mountainSeconds = tuning.start_hour * 3600;
    /** Camera yaw; movement is relative to it. */
    this.yaw = 0;
    /** Direction the climber faces. */
    this.heading = 0;
    this.ropeId = -1;
    this.ropeS = 0;
    /** Effort this frame (0 resting, 1 steady climbing, more when pushing). */
    this.effort = 0;
    /** Slope under the climber, degrees. */
    this.slope = 0;
    /** Vertical speed right now and over the last mountain hour, m per hour. */
    this.verticalNow = 0;
    this.verticalAvg = 0;
    this.pushing = false;
    this.blocked = false;
    this.moving = false;
    /** Current ground speed (m per mountain second) and direction, for momentum. */
    this.pace = 0;
    this.moveDir = new THREE.Vector3(0, 0, -1);
    /** Progress through the current step, 0..1; 1 means the next step is due. */
    this.stepPhase = 1;
    this._stepDir = new THREE.Vector3();
    this._leftFoot = false;
    /** How deep you are in the snow, metres. */
    this.sink = 0;
    this.packing = 0;
    /** Breaths owed: steps taken faster than you can breathe for them. */
    this.breathDebt = 0;
    this.gasping = false;
    /** Shake for the camera and body, 0..1, after a jolt or near miss. Real seconds. */
    this.shake = 0;
    this.trail = new SnowTrail();
    this.rockfall = new Rockfall(hm);
    /** The mountain's weather (sim/weather.js), or null for none. */
    this.weather = null;
    /** The weather where the climber is, from Weather.conditionsAt; null without weather. */
    this.conditions = null;
    this.avalanches = new Avalanches(hm);
    const [sr, sc] = W.serac_grid;
    const [sx, sz] = hm.gridToWorld(sr, sc);
    this.serac = new THREE.Vector3(sx, hm.heightAt(sx, sz), sz);
    this.onMessage = () => {};
    this._altLog = [];
    this._logTimer = 0;
  }

  placeAt(x, z, faceX, faceZ) {
    this.unclip();
    if (this.mode === Mode.FLY || this.mode === Mode.FALL || this.mode === Mode.DEAD) this.mode = Mode.WALK;
    this.position.set(x, this.hm.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
    this.pace = 0;
    this.stepPhase = 1;
    this.breathDebt = 0;
    this.gasping = false;
    this.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
    this.heading = this.yaw;
    this._altLog = [];
    this._noteCamp();
  }

  cycleTimeScale() {
    const scales = tuning.time_scales;
    this.timeScale = scales[(scales.indexOf(this.timeScale) + 1) % scales.length];
    this.onMessage(`Time: 1 real second = ${this.timeScale} mountain seconds`);
  }

  toggleClip() {
    if (this.ropeId >= 0) {
      this.unclip();
      this.onMessage('Unclipped from the fixed rope');
      return;
    }
    if (this.mode === Mode.FLY || this.mode === Mode.FALL || this.mode === Mode.DEAD) return;
    const near = this.ropes.nearest(this._ropeProbe());
    if (near.rope < 0 || near.distance > CLIP_RANGE) {
      this.onMessage('No fixed rope within reach');
      return;
    }
    this.ropeId = near.rope;
    this.ropeS = near.s;
    if (this.groundMode !== Mode.WALK) this.mode = Mode.ROPE;
    this.onMessage(`Clipped into the ${this.ropes.names[this.ropeId]}`);
  }

  toggleFly() {
    if (this.mode === Mode.DEAD) return;
    this.unclip();
    this.mode = this.mode === Mode.FLY ? Mode.WALK : Mode.FLY;
    if (this.mode === Mode.WALK) this.position.y = this.hm.heightAt(this.position.x, this.position.z);
  }

  get clipped() {
    return this.ropeId >= 0;
  }

  unclip() {
    this.ropeId = -1;
    if (this.mode === Mode.ROPE) this.mode = this.groundMode;
  }

  /** The steepest ground you can go up right now. */
  get maxClimbDeg() {
    return this.clipped ? 90 : tuning.no_rope_max_deg;
  }

  get falling() {
    return this.mode === Mode.FALL;
  }

  /** Falling out of control, after the slide got away from you. */
  get tumbling() {
    return this.falling && this.fall.phase === 'tumble';
  }

  get dead() {
    return this.mode === Mode.DEAD;
  }

  /** After dying: carried down to the last camp you reached, hurt, hours later. */
  rescue() {
    if (!this.dead || !this.lastCamp) return;
    const camp = this.lastCamp;
    this.mode = Mode.WALK;
    this.placeAt(camp.x + 6, camp.z + 6, 0, 0);
    this.health = 40;
    this.body.stamina = 30;
    this.body.exhausted = false;
    this.mountainSeconds += tuning.rescue_hours * 3600;
    this.onMessage(`Rescued and carried to ${camp.name} after ${tuning.rescue_hours} hours. Rest here to heal.`);
  }

  /** Distance to the nearest rope, for the HUD prompt. */
  ropeDistance() {
    return this.ropeId >= 0 ? 0 : this.ropes.nearest(this._ropeProbe()).distance;
  }

  _ropeProbe() {
    return new THREE.Vector3(this.position.x, this.position.y + 0.3, this.position.z);
  }

  modeName() {
    if (this.falling) {
      if (this.fall.rope) return 'Falling on the rope!';
      if (this.tumbling) return 'Tumbling!';
      if (this.fall.arresting) return 'Self-arresting';
      if (this.runaway) return 'Sliding out of control!';
      return `Sliding ${this.slideHow()}!`;
    }
    if (this.mode === Mode.DEAD || this.mode === Mode.FLY) return MODE_NAMES[this.mode];
    if (this.body.exhausted) return 'Exhausted';
    if (this.gasping) return 'Gasping for breath';
    if (this.clipped) return `${MODE_NAMES[this.groundMode]}, clipped in`;
    return MODE_NAMES[this.mode];
  }

  /** The slope your feet actually meet: flatter on a ledge. */
  _footingSlope(slope, onLedge) {
    return onLedge ? Math.max(0, slope - tuning.ledge_relief_deg) : slope;
  }

  /** Sliding with no chance to dig in yet: too fast to self-arrest. */
  get runaway() {
    return this.falling && !this.tumbling && !this.fall.rope && this.velocity.length() >= this._arrestTool().maxSpeed;
  }

  /** How you are sliding, e.g. "head-first on your back". */
  slideHow() {
    const o = this.fall?.orient;
    if (!o) return '';
    return `${o.head ? 'head-first' : 'feet-first'} on your ${o.back ? 'back' : 'front'}`;
  }

  /** Breaths needed per step uphill here. */
  get breathsPerStep() {
    return Pace.breathsPerStep(this.position.y);
  }

  /** Expedition day, starting at 1. */
  get day() {
    return Math.floor(this.mountainSeconds / 86400) + 1;
  }

  /** Hour of the day, 0 to 24 with fractions. */
  get hour() {
    return (this.mountainSeconds % 86400) / 3600;
  }

  clockText() {
    const total = Math.floor(this.mountainSeconds / 60);
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * Advance one frame.
   * @param dt real seconds
   * @param input {x, y, push, up, down}: x right, y forward, each -1..1
   */
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    const dtM = dt * this.timeScale;
    this.mountainSeconds += dtM;
    this.pushing = !!input.push;
    this.blocked = false;
    this.moving = false;
    const startY = this.position.y;
    const wasFalling = this.falling;

    if (this.mode === Mode.FLY) {
      this._weatherStep(dt, dtM, false);
      this._fly(dt, input);
      this.effort = 0;
      return;
    }
    if (this.mode === Mode.DEAD) {
      this.effort = 0;
      this.verticalNow = 0;
      return;
    }
    if (this.mode === Mode.FALL) {
      this._fallStep(dt, !!input.arrest);
      this.effort = 0.6;
    } else {
      this._moveOnGround(dtM, input, dt);
      this._heal(dtM);
      this._noteCamp();
    }
    this._rocks(dt, dtM);
    this._weatherStep(dt, dtM, wasFalling);
    this.shake *= Math.exp(-dt * 2.5);
    if (this.dead) return;
    this.body.step(dtM / 3600, this.effort, this.position.y, dt);
    this.verticalNow = this.falling ? 0 : ((this.position.y - startY) / Math.max(dtM, 1e-4)) * 3600;
    this._trackVertical(dt);
  }

  _worldDir(input) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return new THREE.Vector3(fx * input.y + rx * input.x, 0, fz * input.y + rz * input.x);
  }

  _updateGroundMode(s) {
    const hy = tuning.mode_hysteresis_deg;
    const climbAt = tuning.climb_start_deg + (this.groundMode === Mode.WALK ? hy : -hy);
    const steepAt = tuning.very_steep_deg + (this.groundMode === Mode.STEEP ? -hy : hy);
    this.groundMode = s < climbAt ? Mode.WALK : s < steepAt ? Mode.CLIMB : Mode.STEEP;
    this.mode = this.groundMode;
  }

  _moveOnGround(dtM, input, dt) {
    const t = tuning;
    const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
    this.slope = Math.atan(Math.hypot(gx, gz)) * DEG;
    this._updateGroundMode(this.slope);
    this.surface = Pace.surfaceAt(this.position.y, this.slope, this.hm.glacierAt(this.position.x, this.position.z), this.hour);
    this.packing = SNOW.has(this.surface.key) ? this.trail.packing(this.position.x, this.position.z) : 0;
    // A small ledge underfoot gives you somewhere flatter to stand.
    this.onLedge = !!ledgeAt(this.position.x, this.position.z, this.slope);
    const footing = this._footingSlope(this.slope, this.onLedge);
    this.sink = this.surface.sink_m * (1 - this.packing);
    const clipped = this.clipped;
    // On steep ground, clipped in means jumaring.
    if (clipped && this.groundMode !== Mode.WALK) this.mode = Mode.ROPE;
    if (!clipped && footing > this.surface.stand_deg) {
      // Too steep for this surface to hold you without a rope.
      this._startFall(gx, gz, `Too steep to stand on ${this.surface.label.toLowerCase()}. You're sliding! Hold Space to self-arrest.`);
      return;
    }

    // Where you want to go, and how fast that would be.
    let dir = this._worldDir(input);
    const amount = Math.min(dir.length(), 1);
    const wants = amount >= 0.05 && !this.gasping;
    let target = 0;
    if (wants) {
      dir.normalize();
      const rope = clipped ? this._ropeFrame() : null;
      if (rope) dir = this._guide(dir, rope);
      const grade = gx * dir.x + gz * dir.z;
      if (this.slope > this.maxClimbDeg && grade > 0) {
        this.blocked = true;
        this.pace = 0;
      } else {
        const climbing = this.groundMode !== Mode.WALK;
        let ground = this.surface.speed;
        if (this.surface.sink_m > 0) ground += (t.packed_speed - ground) * this.packing;
        target = Pace.groundSpeed(climbing, this.slope, grade, this.position.y) * ground;
        if (rope) target = this._ropeAssist(target, dir, grade, rope);
        target *= amount * this.body.speedFactor();
        if (this.pushing) target *= Pace.pushFactor(this.position.y);
        target *= this._windPace(dir);
      }
      // Turning sharply costs the speed you had built up.
      const turn = dir.dot(this.moveDir);
      if (this.pace > 0 && turn < 0.999) this.pace *= Math.max(0.3, turn);
      this.moveDir.copy(dir);
    } else {
      dir = this.moveDir.clone();
    }

    // Momentum: speed builds and fades over a moment, in real time.
    this.pace += (target - this.pace) * (1 - Math.exp(-dt / t.momentum_s));
    if (this.blocked || (target === 0 && this.pace < 0.02)) this.pace = 0;
    const grade = gx * dir.x + gz * dir.z;
    if (this.pace > 0 && this.slope > this.maxClimbDeg && grade > 0) {
      this.pace = 0;
      this.blocked = true;
    }
    const climbing = this.groundMode !== Mode.WALK;
    this.effort = wants && target > 0 ? Pace.effort(climbing, grade, this.pushing) * (1 + t.sink_effort * this.sink) : 0;
    if (this.gasping) this.effort = 0.3;
    this.moving = this.pace > 0;
    this._breathPace(dtM, grade, climbing);
    if (!this.moving) {
      this.stepPhase = 1;
      if (!this.onLedge) this._maybeSlip(dtM, gx, gz, false);
      return;
    }

    // Steps: on steep ground each one is a deliberate move, so you go in pulses.
    const stepLen = climbing ? t.step_climb_m : t.step_walk_m;
    if (this.stepPhase >= 1) {
      this.stepPhase = 0;
      if (this._placeStep(dir, grade, gx, gz)) return;
    }
    const pulse = climbing ? 1 - Math.cos(2 * Math.PI * this.stepPhase) : 1;
    const travel = this.pace * dtM;
    this.stepPhase = Math.min(this.stepPhase + travel / stepLen, 1);
    this.position.addScaledVector(dir, travel * pulse);
    this.hm.clampInside(this.position);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
    this.heading = Math.atan2(-dir.x, -dir.z);
    if (clipped) this._keepOnLeash();
    this._maybeTrip(dtM, gx, gz, grade);
  }

  /**
   * Up high every step uphill needs several breaths. Pushing the pace skips some
   * of them; the debt builds until you have to stop and gasp.
   */
  _breathPace(dtM, grade, climbing) {
    const t = tuning;
    const stepLen = climbing ? t.step_climb_m : t.step_walk_m;
    const uphill = Math.min(Math.max(grade / 0.45, 0.2), 1);
    const needed = ((this.pace * 60) / stepLen) * this.breathsPerStep * uphill;
    const perMin = this.moving && this.pushing ? needed * t.push_breath_skip
      : -(this.moving ? t.breath_payback_moving_per_min : this.body.breathRate / 3);
    this.breathDebt = Math.max(0, this.breathDebt + (perMin * dtM) / 60);
    if (!this.gasping && this.breathDebt > t.gasp_debt) {
      this.gasping = true;
      this.pace = 0;
      this.onMessage(`Gasping! Up here every step takes ${this.breathsPerStep.toFixed(1)} breaths, and you rushed them. Stop and breathe.`);
    } else if (this.gasping && this.breathDebt <= t.gasp_release) {
      this.gasping = false;
    }
  }

  /**
   * A new step lands. Leaves a footprint in snow; on steep ground it can slip,
   * and a loose hold can crumble. Returns true if the step started a fall.
   */
  _placeStep(dir, grade, gx, gz) {
    const t = tuning;
    const p = this.position;
    if (SNOW.has(this.surface.key)) {
      this._leftFoot = !this._leftFoot;
      const side = this._leftFoot ? -0.14 : 0.14;
      this.trail.tread(p.x - dir.z * side, p.z + dir.x * side, Math.atan2(-dir.x, -dir.z), this._leftFoot);
    }
    const turning = this._stepDir.lengthSq() > 0 && this._stepDir.dot(dir) < Math.cos(t.turn_step_deg / DEG);
    this._stepDir.copy(dir);
    this._maybeTriggerSlab();
    if (this._footingSlope(this.slope, this.onLedge) <= t.climb_start_deg) return false;

    const clipped = this.clipped;
    const why = (what) => clipped ? `${what} The rope will catch you.` : `${what} Hold Space to self-arrest.`;
    if (this.slope > 20 && isLoose(p.x, p.z, this.surface.key) && Math.random() < t.crumble_chance) {
      // The hold breaks away and goes down the slope.
      const down = new THREE.Vector3(-gx, 0, -gz).normalize();
      for (let i = 0; t.rockfall_enabled && i < 1 + Math.floor(Math.random() * 3); i++) {
        const at = p.clone().addScaledVector(down, 0.6 + i * 0.4);
        this.rockfall.release(at, down.clone().multiplyScalar(1.5), 0.08 + Math.random() * 0.15);
      }
      this.shake = Math.max(this.shake, 0.6);
      const slips = Math.random() < t.crumble_slip_chance * (clipped ? t.rope_slip_mult : 1);
      if (slips) return this._slip(gx, gz, why('A hold crumbled under you!'));
      this.onMessage('A loose hold crumbled under your foot.');
      return false;
    }
    const slope = clipped ? Math.min(this.slope, t.no_rope_max_deg) : this.slope;
    let chance = Pace.slipChancePerStep(slope, {
      surface: this.surface.key, careless: this.pushing, turning, downhill: grade < -0.05,
    });
    if (SNOW.has(this.surface.key)) chance *= 1 - 0.5 * this.packing;
    if (clipped) chance *= t.rope_slip_mult;
    if (Math.random() < chance) {
      const what = grade < -0.05 ? 'You slipped stepping down' : 'You slipped';
      return this._slip(gx, gz, why(`${what} on the ${this.surface.label.toLowerCase()}!`));
    }
    return false;
  }

  /** A slip: a slide unroped, a short drop onto the rope when clipped in. */
  _slip(gx, gz, why) {
    if (this.clipped) this._startRopeFall(why);
    else this._startFall(gx, gz, why);
    return true;
  }

  /** Running down steep ground, a foot can catch and pitch you forward. */
  _maybeTrip(dtM, gx, gz, grade) {
    if (this.clipped || grade >= -0.05 || this.groundMode !== Mode.WALK) return;
    const perMin = Pace.tripChancePerMin(this.slope, this.pushing);
    if (perMin > 0 && Math.random() < (perMin * dtM) / 60) {
      this._startFall(gx, gz, 'You tripped running downhill and pitched forward! Hold Space to self-arrest.', { head: true, back: false, speed: this.pace });
    }
  }

  /** Unroped on very steep ground, any minute can be the one you slip. */
  _maybeSlip(dtM, gx, gz, moving) {
    if (this.clipped) return;
    const perMin = Pace.slipChancePerMin(this.slope, this.pushing, this.surface.key, moving);
    if (perMin <= 0) return;
    if (Math.random() < (perMin * dtM) / 60) {
      this._startFall(gx, gz, `You slipped on the ${this.surface.label.toLowerCase()}! Hold Space to self-arrest.`);
    }
  }

  /**
   * Start a slide down the fall line. How you end up depends on which way you
   * were facing: facing into the slope you slip off on your front, feet first;
   * facing down or across it you sit back onto your back.
   */
  _startFall(gx, gz, why, how = {}) {
    const down = new THREE.Vector3(-gx, 0, -gz);
    if (down.lengthSq() > 1e-6) down.normalize();
    const facing = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const facingUphill = facing.dot(down) < -0.3;
    const orient = { back: how.back ?? !facingUphill, head: how.head ?? false };
    this.unclip();
    this.mode = Mode.FALL;
    this.pace = 0;
    // Start moving down the fall line, along the slope rather than off it.
    down.y = -Math.hypot(gx, gz);
    if (down.lengthSq() > 1e-6) down.normalize();
    this.velocity.copy(down).multiplyScalar(Math.max(2, how.speed ?? 0));
    this.fall = {
      startY: this.position.y, distance: 0, topSpeed: 0, worstHit: 0, time: 0,
      phase: 'slide', arresting: false, orient, turning: 0, rope: null,
      air: 0, contact: 0, spin: 0,
    };
    this.shake = Math.max(this.shake, 0.8);
    this.onMessage(why);
  }

  /**
   * Slipping while clipped in: the jumar locks on the rope, and you drop (and
   * swing, if you were off to the side) until the rope comes tight.
   */
  _startRopeFall(why) {
    const id = this.ropeId;
    const near = this.ropes.nearestOn(id, this._ropeProbe());
    const anchor = this.ropes.pointAt(id, near.s).clone();
    const length = Math.max(this.position.distanceTo(anchor), 0.5) + tuning.rope_slack_m;
    const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
    this._startFall(gx, gz, why);
    this.velocity.multiplyScalar(0.5);
    this.fall.rope = { id, anchor, length };
  }

  /**
   * What you self-arrest with. For now bare hands and boots; an ice axe (later)
   * will return a higher maxSpeed and grip here.
   */
  _arrestTool() {
    return { name: 'hands', maxSpeed: tuning.self_arrest_below_m_s, grip: 1 };
  }

  /** How well you can dig in, from how you are lying in the slide. */
  _arrestEffect() {
    const o = this.fall.orient;
    return tuning.arrest_effect[`${o.back ? 'back' : 'front'}_${o.head ? 'head' : 'feet'}`];
  }

  /** Gravity, bounces off the terrain, friction and self-arrest, in small real-time steps. */
  _fallStep(dt, arrest) {
    const t = tuning;
    const v = this.velocity;
    const p = this.position;
    const n = new THREE.Vector3();
    const steps = Math.ceil(dt / 0.004);
    const h = dt / steps;
    let touching = false;
    const f = this.fall;
    for (let i = 0; i < steps; i++) {
      v.y -= t.gravity * h;
      // Air drag on a falling body: terminal speed is about 55 m/s low down, more up high.
      const rho = 1.225 * Math.exp(-p.y / 8500);
      const sp = v.length();
      v.multiplyScalar(Math.max(0, 1 - ((0.5 * rho * t.body_drag_area_m2) / t.body_mass_kg) * sp * h));
      // Each bounce and scrape of a tumble costs energy, short hops included.
      if (f.phase === 'tumble') v.multiplyScalar(Math.max(0, 1 - t.tumble_drag * sp * h));
      const before = p.clone();
      p.addScaledVector(v, h);
      this.hm.clampInside(p);
      const ground = this.hm.heightAt(p.x, p.z);
      const hitGround = p.y <= ground;
      // Skimming just above the slope still counts as on it; only a real drop is airborne.
      if (p.y - ground > 0.4) {
        f.air += h;
        f.contact = 0;
        if (f.air > t.tumble_airborne_s && !f.rope) this._tumble('You went over the edge!');
      } else {
        f.air = 0;
        f.contact += h;
      }
      if (hitGround) {
        p.y = ground;
        touching = true;
        this.hm.normalAt(p.x, p.z, n);
        const slope = Math.acos(Math.min(n.y, 1)) * DEG;
        const surface = Pace.surfaceAt(p.y, slope, this.hm.glacierAt(p.x, p.z), this.hour);
        this.surface = surface;
        const ledge = !f.rope && ledgeAt(p.x, p.z, slope);
        if (f.phase === 'tumble' && f.contact > t.tumble_settle_s && slope < t.tumble_slope_deg) this._settle();
        else if (!f.rope && slope > t.tumble_slope_deg && v.length() > t.tumble_min_speed_m_s) this._tumble('Over the steep ground, you start to cartwheel!');
        const into = v.dot(n);
        if (into < 0) {
          const hit = -into;
          if (hit > t.safe_impact_m_s) {
            this._hurt((hit - t.safe_impact_m_s) ** 2 * t.impact_damage * surface.impact);
            this.fall.worstHit = Math.max(this.fall.worstHit, hit);
          }
          if (hit > t.tumble_on_hit_m_s && !f.rope) this._tumble();
          // Hard hits bounce a little; soft contact just follows the slope.
          v.addScaledVector(n, -into * (hit > 3 ? 1 + t.bounce : 1));
        }
        // Friction from the ground, plus self-arrest while you still have control.
        const speed = v.length();
        if (speed > 1e-4) {
          let mu = surface.friction;
          // A cartwheeling body hits and scrapes, losing speed much faster than a slide.
          if (f.phase === 'tumble') mu = Math.max(mu, t.tumble_friction);
          if (ledge) mu += t.ledge_friction;
          const tool = this._arrestTool();
          f.arresting = arrest && f.phase === 'slide' && !f.rope && speed < tool.maxSpeed;
          if (f.arresting) mu += surface.arrest * tool.grip * this._arrestEffect();
          else if (f.phase === 'slide' && speed > tool.maxSpeed) f.spin += speed * 0.08 * h;
          // A sliding body ploughs through snow and loses speed with it.
          if (f.phase === 'slide') v.multiplyScalar(Math.max(0, 1 - surface.slide_drag * speed * h));
          const decel = mu * t.gravity * n.y * h;
          v.multiplyScalar(Math.max(0, 1 - decel / speed));
          if (surface.key === 'rock' && speed > t.slide_damage_above_m_s) this._hurt(t.rock_slide_damage * speed * h);
        }
      }
      if (this.fall.rope && this._ropeConstraint(p, v, h)) touching = true;
      if (arrest && this.fall.phase === 'slide') this._rollOver(h);
      const speed = v.length();
      if (speed > t.max_fall_speed_m_s) v.multiplyScalar(t.max_fall_speed_m_s / speed);
      this.fall.distance += p.distanceTo(before);
      this.fall.topSpeed = Math.max(this.fall.topSpeed, speed);
      if (this.dead) return;
    }
    this.fall.time += dt;
    this.slope = this.hm.slopeDeg(p.x, p.z);
    if (this.fall.rope) {
      if (this.fall.time > 0.3 && v.length() < t.stand_up_below_m_s && touching) this._caughtByRope();
      return;
    }
    this.onLedge = !!ledgeAt(p.x, p.z, this.slope);
    const standable = this._footingSlope(this.slope, this.onLedge) < this.surface.stand_deg;
    if (touching && v.length() < t.stand_up_below_m_s && standable) {
      v.set(0, 0, 0);
      const how = this.fall.phase === 'slide' && this.fall.arresting ? 'You self-arrested'
        : this.onLedge ? 'You caught on a ledge' : 'You came to a stop';
      this.mode = Mode.WALK;
      this._updateGroundMode(this.slope);
      const drop = Math.round(this.fall.startY - p.y);
      this.onMessage(`${how} ${drop} m lower. Health ${Math.round(this.health)}.`);
    }
  }

  /** Holding Space, you roll onto your front, then swing your feet round downhill. */
  _rollOver(h) {
    const f = this.fall;
    f.turning += h;
    if (f.orient.back && f.turning > tuning.roll_over_s) {
      f.orient.back = false;
      f.turning = 0;
    } else if (!f.orient.back && f.orient.head && f.turning > tuning.swing_round_s) {
      f.orient.head = false;
    }
  }

  /**
   * Keep a rope fall within the rope's length of the anchor. When it comes tight,
   * the jolt stops your fall along the rope and can hurt. Returns true while taut.
   */
  _ropeConstraint(p, v, h) {
    const t = tuning;
    const { anchor, length } = this.fall.rope;
    const d = p.clone().sub(anchor);
    const dist = d.length();
    if (dist <= length) return false;
    d.divideScalar(dist);
    p.copy(anchor).addScaledVector(d, length);
    p.y = Math.max(p.y, this.hm.heightAt(p.x, p.z));
    const out = v.dot(d);
    if (out > 0) {
      v.addScaledVector(d, -out);
      if (out > t.rope_safe_jolt_m_s) {
        this.fall.worstHit = Math.max(this.fall.worstHit, out);
        this._hurt((out - t.rope_safe_jolt_m_s) ** 2 * t.rope_jolt_damage);
      }
      if (out > 1) this.shake = 1;
    }
    // Hanging and swinging on the rope damps out.
    v.multiplyScalar(Math.exp(-h * 2));
    return true;
  }

  _caughtByRope() {
    const { id } = this.fall.rope;
    this.velocity.set(0, 0, 0);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
    this.mode = Mode.WALK;
    this._updateGroundMode(this.slope);
    this.ropeId = id;
    this.ropeS = this.ropes.nearestOn(id, this._ropeProbe()).s;
    if (this.groundMode !== Mode.WALK) this.mode = Mode.ROPE;
    const drop = Math.max(0, this.fall.startY - this.position.y).toFixed(1);
    this.onMessage(`The rope caught you after a ${drop} m drop. Health ${Math.round(this.health)}.`);
  }

  /** Rocks and ice coming down: the ones you knocked loose, and natural falls from above. */
  _rocks(dt, dtM) {
    const t = tuning;
    if (this.mode === Mode.FLY) return;
    if (t.rockfall_enabled && !this.dead && Math.random() < (t.rockfall_per_min * this._rockfallHourFactor() * dtM) / 60) {
      const rocks = this.rockfall.releaseAbove(this.position.x, this.position.z);
      if (rocks.length) {
        this.onMessage(rocks[0].ice ? 'Ice is breaking off above you! Watch the slope.' : 'Rockfall! Stones are coming down from above.');
      }
    }
    if (!this.rockfall.rocks.length) return;
    const body = this.position.clone();
    body.y += 0.9;
    for (const { rock, speed } of this.rockfall.step(dt, this.dead ? null : body)) this._rockHit(rock, speed);
  }

  /** Rock and ice fall comes most in the warm afternoon, least at night when it's frozen. */
  _rockfallHourFactor() {
    const [a, b] = tuning.rockfall_peak_hours;
    const hr = this.hour;
    if (hr >= a && hr <= b) return 1;
    if (hr < 6 || hr > 20) return tuning.rockfall_night_mult;
    return 0.4;
  }

  _rockHit(rock, speed) {
    const t = tuning;
    const damage = Math.min(100, t.rock_hit_damage * speed * speed * (rock.size / 0.25) ** 3);
    if (damage < 1) return;
    this.shake = 1;
    const what = rock.ice ? 'A chunk of ice' : 'A falling rock';
    this.onMessage(`${what} hit you! Health ${Math.round(Math.max(0, this.health - damage))}.`);
    this._hurt(damage, `${what} hit you.`);
    if (this.dead || this.falling || damage < t.rock_knockoff_damage || this.slope < t.climb_start_deg) return;
    const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
    this._slip(gx, gz, `${what} knocked you off your feet!`);
  }

  /**
   * The weather around you: wind pushing and gusting, avalanches and serac fall.
   * Wind and debris move in real seconds; the chance of a slide or calving is per
   * mountain hour.
   */
  _weatherStep(dt, dtM, wasFalling) {
    const w = this.weather;
    if (w) {
      w.update(this.mountainSeconds, dt);
      this.conditions = w.conditionsAt(this.hm, this.position, this.hour);
    }
    const fly = this.mode === Mode.FLY;
    const c = this.conditions;
    if (w && !this.dead && !fly) {
      if (!this.falling) this._wind(dt, c);
      const natural = W.natural_per_hour * c.avalancheDanger ** 2;
      if (Math.random() < (natural * dtM) / 3600) {
        const slide = this.avalanches.releaseAbove(this.position.x, this.position.z, this.hour);
        if (slide) this._announceSlide(slide);
      }
      this._seracFall(dtM, c);
    }
    if (this.avalanches.active) {
      const body = this.position.clone();
      body.y += 0.9;
      const hit = this.avalanches.step(dt, this.dead || fly ? null : body);
      if (hit) this._caughtInAvalanche(hit);
      // Debris carries you along with it.
      if (this.falling && this.fall.avalanche) {
        const blob = this.avalanches.nearestMoving(this.position, 20);
        if (blob) this.velocity.lerp(blob.velocity, 1 - Math.exp(-dt * 1.5));
      }
    }
    if (wasFalling && !this.falling && !this.dead && this.fall?.avalanche) {
      this.fall.avalanche = false;
      if (Math.random() < W.burial_chance) {
        this._hurt(W.burial_damage, 'You were buried by the avalanche.');
        this.mountainSeconds += 1200;
        if (!this.dead) this.onMessage(`Buried! It took twenty minutes to dig yourself out of the debris. Health ${Math.round(this.health)}.`);
      }
    }
  }

  /** Strong wind pushes you downwind; a hard gust can throw you off steep ground. */
  _wind(dt, c) {
    const over = c.gust - W.push_from_m_s;
    if (over <= 0 || this.dead) return;
    const steep = this.slope > tuning.climb_start_deg;
    const push = over * W.push_m_s_per_m_s * (this.clipped ? 1 / 3 : 1) * (steep && !this.moving ? 1.5 : 1);
    this.position.x += c.windX * push * dt;
    this.position.z += c.windZ * push * dt;
    this.hm.clampInside(this.position);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
    if (this.clipped) this._keepOnLeash();
    const hard = c.gust - W.knockdown_m_s;
    if (hard > 0 && !this.clipped && steep && Math.random() < W.knockdown_per_s * (hard / 6) * dt) {
      const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
      this._slip(gx, gz, 'A gust threw you off balance! Hold Space to self-arrest.');
    }
  }

  /** Walking into the wind slows you; with it at your back, a little faster. */
  _windPace(dir) {
    const c = this.conditions;
    if (!c) return 1;
    const along = dir.x * c.windX + dir.z * c.windZ;
    const into = Math.max(0, -along) * c.wind;
    return Math.min(Math.max(1 - W.headwind_slow_per_m_s * into + 0.004 * Math.max(0, along) * c.wind, 0.3), 1.1);
  }

  /** A step onto a loaded slope can break the slab you're standing on. */
  _maybeTriggerSlab() {
    const c = this.conditions;
    if (!c || !isSlabSlope(this.hm, this.position.x, this.position.z, this.hour)) return;
    if (Math.random() >= W.trigger_per_step * c.avalancheDanger ** 2) return;
    const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
    const g = Math.hypot(gx, gz) || 1;
    const [w0, w1] = W.slab_width_m;
    const slide = this.avalanches.release(this.position.x + (gx / g) * 12, this.position.z + (gz / g) * 12, w0 + (w1 - w0) * Math.random());
    if (slide) {
      this.shake = 1;
      this.onMessage('Whumpf! The slope fractured under your feet. Avalanche!');
    }
  }

  _announceSlide(slide) {
    const d = slide.origin.distanceTo(this.position);
    if (d > 1200) return;
    this.shake = Math.max(this.shake, Math.min(1, 300 / d));
    const above = slide.origin.y > this.position.y + 20;
    this.onMessage(above ? `Avalanche! A slope ${Math.round(d)} m above you has broken loose.` : `An avalanche thunders down ${Math.round(d)} m away.`);
  }

  /** Ice calves off the serac above the Bottleneck, most in the warm afternoon. */
  _seracFall(dtM, c) {
    if (!W.serac_enabled) return;
    const s = this.serac;
    const near = Math.hypot(s.x - this.position.x, s.z - this.position.z);
    if (near > W.serac_near_m) return;
    const warm = Math.max(0, 1 - Math.abs(this.hour - 14) / 5);
    if (Math.random() >= (W.serac_per_hour * (1 + W.serac_warm_mult * warm) * dtM) / 3600) return;
    const [gx, gz] = this.hm.gradient(s.x, s.z);
    const g = Math.hypot(gx, gz) || 1;
    const down = new THREE.Vector3(-gx / g, 0, -gz / g);
    const n = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const at = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 1, (Math.random() - 0.5) * 20));
      this.rockfall.release(at, down.clone().multiplyScalar(2 + Math.random() * 3), 0.4 + Math.random() * 1.0, true);
    }
    this.shake = Math.max(this.shake, 0.4);
    this.onMessage('A crack like a gunshot: the serac above is calving! Ice is coming down the Bottleneck.');
  }

  /** Hit by avalanche debris: swept away, or held on the rope while it pours over you. */
  _caughtInAvalanche(blob) {
    this.shake = 1;
    if (this.clipped) {
      this._hurt(W.rope_hold_damage, 'You were battered by an avalanche on the rope.');
      if (!this.dead) this.onMessage(`The avalanche poured over you, but the rope held. Health ${Math.round(this.health)}.`);
      return;
    }
    if (!this.falling) {
      const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
      this._startFall(gx, gz, 'Avalanche! You are swept away. Fight to stay on top!');
    }
    this.velocity.copy(blob.velocity);
    this.fall.phase = 'tumble';
    this.fall.arresting = false;
    this.fall.avalanche = true;
    this._hurt(W.catch_damage, 'You were swept away by an avalanche.');
  }

  _tumble(why = "You're tumbling out of control!") {
    if (this.fall.phase === 'tumble') return;
    this.fall.phase = 'tumble';
    this.fall.arresting = false;
    this.fall.contact = 0;
    this.onMessage(why);
  }

  /** Back on gentler ground the tumble flattens out into a slide, any way up. */
  _settle() {
    const f = this.fall;
    f.phase = 'slide';
    f.orient = { back: Math.random() < 0.5, head: Math.random() < 0.5 };
    f.turning = 0;
    if (this.velocity.length() < this._arrestTool().maxSpeed * 1.5) {
      this.onMessage(`Sliding ${this.slideHow()}. Hold Space to dig in as you slow!`);
    }
  }

  _hurt(amount, cause = null) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      const drop = Math.round(this.falling ? this.fall.startY - this.position.y : 0);
      this.mode = Mode.DEAD;
      this.deathCause = cause ?? (drop > 0 ? `You fell ${drop} m.` : 'You were badly hurt.');
      this.velocity.set(0, 0, 0);
      this.onMessage(`${this.deathCause} You did not survive.`);
    }
  }

  /** Injuries heal slowly when resting, faster in a camp. */
  _heal(dtM) {
    if (this.moving || this.health >= 100) return;
    const rate = this._campNearby() ? tuning.camp_health_regen_per_hour : tuning.health_regen_per_hour;
    this.health = Math.min(100, this.health + (rate * dtM) / 3600);
  }

  _campNearby() {
    return this.places.find((c) => Math.hypot(c.x - this.position.x, c.z - this.position.z) < tuning.camp_radius_m);
  }

  _noteCamp() {
    const camp = this._campNearby();
    if (camp && camp !== this.lastCamp) {
      const height = (c) => this.hm.heightAt(c.x, c.z);
      if (!this.lastCamp || height(camp) > height(this.lastCamp)) this.lastCamp = camp;
    }
  }

  /** Where the rope is relative to the climber: nearest point, flat direction up it, distance. */
  _ropeFrame() {
    const near = this.ropes.nearestOn(this.ropeId, this._ropeProbe());
    this.ropeS = near.s;
    const t = this.ropes.tangentAt(this.ropeId, near.s);
    const up = new THREE.Vector3(t.x, 0, t.z);
    if (up.lengthSq() > 1e-6) up.normalize();
    const toRope = new THREE.Vector3(near.point.x - this.position.x, 0, near.point.z - this.position.z);
    return { up, incline: Math.asin(Math.min(Math.max(t.y, -1), 1)), toRope, distance: toRope.length() };
  }

  /** Steer gently along the rope, and back toward its line the further you drift. */
  _guide(dir, rope) {
    const along = dir.dot(rope.up);
    const guided = dir.clone();
    guided.addScaledVector(rope.up, Math.sign(along) * Math.abs(along) * tuning.rope_guide);
    if (rope.distance > 0.01) {
      const drift = Math.min(Math.max((rope.distance - 1.5) / (tuning.rope_leash_m - 1.5), 0), 1);
      const across = 1 - Math.abs(along);
      // Pull toward the line, less when you are deliberately moving across it.
      guided.addScaledVector(rope.toRope.clone().normalize(), drift * tuning.rope_pull * (1 - 0.7 * across));
    }
    return guided.lengthSq() > 1e-6 ? guided.normalize() : dir;
  }

  /** Moving along the rope gets the jumar's speed, fading out as you move across it or away. */
  _ropeAssist(speed, dir, grade, rope) {
    const align = Math.abs(dir.dot(rope.up));
    const close = 1 - Math.min(Math.max((rope.distance - 2) / (tuning.rope_leash_m - 2), 0), 1);
    const incline = Math.atan(grade);
    const jumar = Pace.ropeSpeed((incline * 180) / Math.PI, grade >= 0, this.position.y) * Math.cos(incline);
    return Math.max(speed, speed + (jumar - speed) * align * close);
  }

  /** The clip slides along the rope, but you cannot get further than the leash from it. */
  _keepOnLeash() {
    const rope = this._ropeFrame();
    const leash = tuning.rope_leash_m;
    if (rope.distance <= leash) return;
    const length = this.ropes.lengthOf(this.ropeId);
    if (this.ropeS <= 0.5 || this.ropeS >= length - 0.5) {
      const atTop = this.ropeS >= length - 0.5;
      this.unclip();
      this.onMessage(atTop ? "Top of the fixed rope. You're on your own from here." : 'Bottom of the fixed rope');
      return;
    }
    this.position.addScaledVector(rope.toRope, (rope.distance - leash) / rope.distance);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
  }

  _fly(dt, input) {
    const speed = this.pushing ? 600 : 120;
    this.position.addScaledVector(this._worldDir(input), speed * dt);
    this.position.y += ((input.up ? 1 : 0) - (input.down ? 1 : 0)) * speed * 0.6 * dt;
    this.hm.clampInside(this.position);
    this.position.y = Math.max(this.position.y, this.hm.heightAt(this.position.x, this.position.z) + 2);
  }

  /** Rolling average of vertical speed over the last mountain hour (shorter if there is less). */
  _trackVertical(dt) {
    this._logTimer += dt;
    if (this._logTimer < 0.25) return;
    this._logTimer = 0;
    const log = this._altLog;
    log.push([this.mountainSeconds, this.position.y]);
    while (log.length > 2 && this.mountainSeconds - log[0][0] > 3600) log.shift();
    const span = this.mountainSeconds - log[0][0];
    this.verticalAvg = span > 60 ? ((this.position.y - log[0][1]) / span) * 3600 : this.verticalNow;
  }
}
