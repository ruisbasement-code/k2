// The player's climber: slope-aware movement (walk, climb, very steep), clipping
// into fixed ropes, and stamina and breathing.
//
// Movement is simulated in mountain time: the world clock runs timeScale times
// faster than real time, so a realistic 400 m per hour still gets you somewhere.
// This class has no rendering in it, so tests can drive it directly.

import * as THREE from 'three';
import * as Pace from '../sim/paceModel.js';
import { ClimberBody } from '../sim/climberBody.js';

const { tuning } = Pace;
const DEG = 180 / Math.PI;

export const Mode = { WALK: 'walk', CLIMB: 'climb', STEEP: 'steep', ROPE: 'rope', FLY: 'fly' };
const MODE_NAMES = {
  walk: 'Walking',
  climb: 'Climbing',
  steep: 'Very steep',
  rope: 'On fixed rope',
  fly: 'Scout fly',
};
export const CLIP_RANGE = 5;

export class Climber {
  constructor(hm, ropes) {
    this.hm = hm;
    this.ropes = ropes;
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
    this.slideTime = 0;
    this.slideVelocity = new THREE.Vector3();
    this.onMessage = () => {};
    this._altLog = [];
    this._logTimer = 0;
  }

  placeAt(x, z, faceX, faceZ) {
    this.unclip();
    if (this.mode === Mode.FLY) this.mode = Mode.WALK;
    this.position.set(x, this.hm.heightAt(x, z), z);
    this.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
    this.heading = this.yaw;
    this.slideTime = 0;
    this._altLog = [];
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
    if (this.mode === Mode.FLY) return;
    const near = this.ropes.nearest(this._ropeProbe());
    if (near.rope < 0 || near.distance > CLIP_RANGE) {
      this.onMessage('No fixed rope within reach');
      return;
    }
    this.ropeId = near.rope;
    this.ropeS = near.s;
    this.mode = Mode.ROPE;
    this.onMessage(`Clipped into the ${this.ropes.names[this.ropeId]}`);
  }

  toggleFly() {
    this.unclip();
    this.mode = this.mode === Mode.FLY ? Mode.WALK : Mode.FLY;
    if (this.mode === Mode.WALK) this.position.y = this.hm.heightAt(this.position.x, this.position.z);
  }

  unclip() {
    this.ropeId = -1;
    if (this.mode === Mode.ROPE) this.mode = this.groundMode;
  }

  /** Distance to the nearest rope, for the HUD prompt. */
  ropeDistance() {
    return this.ropeId >= 0 ? 0 : this.ropes.nearest(this._ropeProbe()).distance;
  }

  _ropeProbe() {
    return new THREE.Vector3(this.position.x, this.position.y + 0.3, this.position.z);
  }

  modeName() {
    if (this.mode !== Mode.FLY && this.slideTime > 0) return 'Sliding!';
    if (this.mode !== Mode.FLY && this.body.exhausted) return 'Exhausted';
    return MODE_NAMES[this.mode];
  }

  clockText() {
    const total = Math.floor(this.mountainSeconds / 60);
    const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const mm = String(total % 60).padStart(2, '0');
    return `Day ${Math.floor(total / 1440) + 1}  ${hh}:${mm}`;
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
    if (this.slideTime > 0) {
      this._slide(dt);
      this.effort = 0.4;
    } else if (this.mode === Mode.ROPE) {
      this._moveOnRope(dtM, input);
    } else {
      this._moveOnGround(dtM, input);
    }
    this.body.step(dtM / 3600, this.effort, this.position.y, dt);
    this.verticalNow = this.slideTime > 0 ? 0 : ((this.position.y - startY) / Math.max(dtM, 1e-4)) * 3600;
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
    const dir = this._worldDir(input);
    const amount = Math.min(dir.length(), 1);
    if (amount < 0.05) {
      this.effort = 0;
      return;
    }
    dir.normalize();
    const grade = gx * dir.x + gz * dir.z;
    const climbing = this.mode !== Mode.WALK;
    if (this.mode === Mode.STEEP && this.slope > tuning.no_rope_max_deg && grade > 0) {
      this.blocked = true;
      this.effort = 0;
      return;
    }
    const sf = this.body.speedFactor();
    let speed = Pace.groundSpeed(climbing, this.slope, grade, this.position.y) * amount * sf;
    if (this.pushing) speed *= Pace.pushFactor(this.position.y);
    this.effort = sf > 0 ? Pace.effort(climbing, grade, this.pushing) : 0;
    this.moving = speed > 0;
    this.position.addScaledVector(dir, speed * dtM);
    this.hm.clampInside(this.position);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
    this.heading = Math.atan2(-dir.x, -dir.z);

    if (this.mode === Mode.STEEP && speed > 0) {
      const chance = (Pace.slipChancePerMin(this.slope, this.body.stamina, this.pushing) * dtM) / 60;
      if (Math.random() < chance) this._startSlip(gx, gz);
    }
  }

  _startSlip(gx, gz) {
    const down = new THREE.Vector3(-gx, 0, -gz).normalize();
    const dist = tuning.slip_min_m + Math.random() * (tuning.slip_max_m - tuning.slip_min_m);
    this.slideTime = 1.2;
    this.slideVelocity.copy(down).multiplyScalar(dist / this.slideTime);
    this.body.stamina = Math.max(0, this.body.stamina - tuning.slip_stamina_cost);
    this.onMessage('You slipped! Very steep ground is much safer on a fixed rope (C).');
  }

  _slide(dt) {
    this.slideTime -= dt;
    this.position.addScaledVector(this.slideVelocity, dt);
    this.hm.clampInside(this.position);
    this.position.y = this.hm.heightAt(this.position.x, this.position.z);
  }

  _moveOnRope(dtM, input) {
    const tangent = this.ropes.tangentAt(this.ropeId, this.ropeS);
    this.slope = Math.asin(Math.min(Math.max(tangent.y, -1), 1)) * DEG;
    const flat = new THREE.Vector3(tangent.x, 0, tangent.z);
    const dir = this._worldDir(input);
    let along = input.y;
    if (flat.length() > 0.05 && dir.length() > 0.05) along = dir.dot(flat.clone().normalize());
    if (Math.abs(along) < 0.2) {
      this.effort = 0;
      return;
    }
    const up = along > 0;
    const sf = this.body.speedFactor();
    let speed = Pace.ropeSpeed(this.slope, up, this.position.y) * Math.min(Math.abs(along), 1) * sf;
    if (this.pushing) speed *= Pace.pushFactor(this.position.y);
    this.effort = sf > 0 ? Pace.effort(true, up ? 1 : -1, this.pushing) : 0;
    this.moving = speed > 0;
    this.ropeS += (up ? 1 : -1) * speed * dtM;
    const length = this.ropes.lengthOf(this.ropeId);
    const p = this.ropes.pointAt(this.ropeId, this.ropeS);
    this.position.set(p.x, this.hm.heightAt(p.x, p.z), p.z);
    this.heading = up ? Math.atan2(-flat.x, -flat.z) : Math.atan2(flat.x, flat.z);
    if (this.ropeS <= 0 || this.ropeS >= length) {
      const atTop = this.ropeS >= length;
      this.unclip();
      this.onMessage(atTop ? "Top of the fixed rope. You're on your own from here." : 'Bottom of the fixed rope');
    }
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
