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
// Movement is simulated in mountain time: the world clock runs timeScale times
// faster than real time, so a realistic 400 m per hour still gets you somewhere.
// This class has no rendering in it, so tests can drive it directly.

import * as THREE from 'three';
import * as Pace from '../sim/paceModel.js';
import { ClimberBody } from '../sim/climberBody.js';

const { tuning } = Pace;
const DEG = 180 / Math.PI;

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
    this.onMessage = () => {};
    this._altLog = [];
    this._logTimer = 0;
  }

  placeAt(x, z, faceX, faceZ) {
    this.unclip();
    if (this.mode === Mode.FLY || this.mode === Mode.FALL || this.mode === Mode.DEAD) this.mode = Mode.WALK;
    this.position.set(x, this.hm.heightAt(x, z), z);
    this.velocity.set(0, 0, 0);
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
    if (this.falling) return this.tumbling ? 'Tumbling!' : this.fall.arresting ? 'Self-arresting' : 'Sliding!';
    if (this.mode === Mode.DEAD || this.mode === Mode.FLY) return MODE_NAMES[this.mode];
    if (this.body.exhausted) return 'Exhausted';
    if (this.clipped) return `${MODE_NAMES[this.groundMode]}, clipped in`;
    return MODE_NAMES[this.mode];
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

    if (this.mode === Mode.FLY) {
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
      this._moveOnGround(dtM, input);
      this._heal(dtM);
      this._noteCamp();
    }
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

  _moveOnGround(dtM, input) {
    const [gx, gz] = this.hm.gradient(this.position.x, this.position.z);
    this.slope = Math.atan(Math.hypot(gx, gz)) * DEG;
    this._updateGroundMode(this.slope);
    this.surface = Pace.surfaceAt(this.position.y, this.slope, this.hm.glacierAt(this.position.x, this.position.z));
    const clipped = this.clipped;
    // On steep ground, clipped in means jumaring.
    if (clipped && this.groundMode !== Mode.WALK) this.mode = Mode.ROPE;
    if (!clipped && this.slope > this.surface.stand_deg) {
      // Too steep for this surface to hold you without a rope.
      this._startFall(gx, gz, `Too steep to stand on ${this.surface.label.toLowerCase()}. You're sliding! Hold Space to self-arrest.`);
      return;
    }
    let dir = this._worldDir(input);
    const amount = Math.min(dir.length(), 1);
    if (amount < 0.05) {
      this.effort = 0;
      this._maybeSlip(dtM, gx, gz, false);
      return;
    }
    dir.normalize();
    const rope = clipped ? this._ropeFrame() : null;
    if (rope) dir = this._guide(dir, rope);
    const grade = gx * dir.x + gz * dir.z;
    const climbing = this.groundMode !== Mode.WALK;
    if (this.slope > this.maxClimbDeg && grade > 0) {
      this.blocked = true;
      this.effort = 0;
      return;
    }
    const sf = this.body.speedFactor();
    let speed = Pace.groundSpeed(climbing, this.slope, grade, this.position.y) * this.surface.speed;
    if (rope) speed = this._ropeAssist(speed, dir, grade, rope);
    speed *= amount * sf;
    if (this.pushing) speed *= Pace.pushFactor(this.position.y);
    this.effort = sf > 0 ? Pace.effort(climbing, grade, this.pushing) : 0;
    this.moving = speed > 0;
    this.position.addScaledVector(dir, speed * dtM);
    this.hm.clampInside(this.position);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
    this.heading = Math.atan2(-dir.x, -dir.z);
    if (clipped) this._keepOnLeash();

    if (speed > 0) this._maybeSlip(dtM, gx, gz, true);
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

  _startFall(gx, gz, why) {
    const down = new THREE.Vector3(-gx, 0, -gz);
    if (down.lengthSq() > 1e-6) down.normalize();
    this.unclip();
    this.mode = Mode.FALL;
    this.velocity.copy(down).multiplyScalar(2);
    this.fall = { startY: this.position.y, distance: 0, topSpeed: 0, worstHit: 0, time: 0, phase: 'slide', arresting: false };
    this.onMessage(why);
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
    for (let i = 0; i < steps; i++) {
      v.y -= t.gravity * h;
      const before = p.clone();
      p.addScaledVector(v, h);
      this.hm.clampInside(p);
      const ground = this.hm.heightAt(p.x, p.z);
      if (p.y <= ground) {
        p.y = ground;
        touching = true;
        this.hm.normalAt(p.x, p.z, n);
        const slope = Math.acos(Math.min(n.y, 1)) * DEG;
        const surface = Pace.surfaceAt(p.y, slope, this.hm.glacierAt(p.x, p.z));
        this.surface = surface;
        const into = v.dot(n);
        if (into < 0) {
          const hit = -into;
          if (hit > t.safe_impact_m_s) {
            this._hurt((hit - t.safe_impact_m_s) ** 2 * t.impact_damage * surface.impact);
            this.fall.worstHit = Math.max(this.fall.worstHit, hit);
          }
          if (hit > t.tumble_on_hit_m_s) this._tumble();
          // Hard hits bounce a little; soft contact just follows the slope.
          v.addScaledVector(n, -into * (hit > 3 ? 1 + t.bounce : 1));
        }
        // Friction from the ground, plus self-arrest while you still have control.
        const speed = v.length();
        if (speed > 1e-4) {
          let mu = surface.friction;
          this.fall.arresting = arrest && this.fall.phase === 'slide' && speed < t.self_arrest_below_m_s;
          if (this.fall.arresting) mu += surface.arrest;
          const decel = mu * t.gravity * n.y * h;
          v.multiplyScalar(Math.max(0, 1 - decel / speed));
          if (surface.key === 'rock' && speed > t.slide_damage_above_m_s) this._hurt(t.rock_slide_damage * speed * h);
        }
      }
      const speed = v.length();
      if (speed > t.max_fall_speed_m_s) v.multiplyScalar(t.max_fall_speed_m_s / speed);
      if (speed > t.tumble_above_m_s) this._tumble();
      this.fall.distance += p.distanceTo(before);
      this.fall.topSpeed = Math.max(this.fall.topSpeed, speed);
      if (this.dead) return;
    }
    this.fall.time += dt;
    // Missed the moment to arrest: the slide gets away from you.
    if (this.fall.phase === 'slide' && this.fall.time > t.arrest_window_s && v.length() > 3) this._tumble();
    this.slope = this.hm.slopeDeg(p.x, p.z);
    const standable = this.slope < this.surface.stand_deg;
    if (touching && v.length() < t.stand_up_below_m_s && standable) {
      v.set(0, 0, 0);
      const how = this.fall.phase === 'slide' && this.fall.arresting ? 'You self-arrested' : 'You came to a stop';
      this.mode = Mode.WALK;
      this._updateGroundMode(this.slope);
      const drop = Math.round(this.fall.startY - p.y);
      this.onMessage(`${how} ${drop} m lower. Health ${Math.round(this.health)}.`);
    }
  }

  _tumble() {
    if (this.fall.phase === 'tumble') return;
    this.fall.phase = 'tumble';
    this.fall.arresting = false;
    this.onMessage("You're tumbling out of control!");
  }

  _hurt(amount) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.mode = Mode.DEAD;
      const drop = Math.round(this.fall ? this.fall.startY - this.position.y : 0);
      this.deathCause = drop > 0 ? `You fell ${drop} m.` : 'You were badly hurt.';
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
