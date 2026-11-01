// Distress signals: hand-fired flares, a whistle and a strobe. A flare goes up in
// a bright arc, hangs under its little parachute and drifts down on the wind,
// burning red for about forty seconds; it can be seen for kilometres, through
// cloud and snow. The whistle's three blasts carry a short way; the strobe on
// your shoulder strap flashes white until you switch it off or the battery dies.
//
// Everything here is plain data and pure functions, so that multiplayer can send
// it later: every signal is announced as a small JSON-safe event (onEvent), and a
// flare's path is fixed by its launch, so another player's game can draw the same
// flare from the event alone (receive). A collapsed climber can still fire one.

/** Flare flight: launch speed, burn, parachute fall, how far it's seen. */
export const FLARE = {
  speed: 90, // m/s off the launcher
  elevation: 70, // degrees above the horizon you aim it
  gravity: 9.81,
  drag: 0.05, // per second, on the way up: tops out near 280 m
  chuteSink: 3.5, // m/s, under the parachute after the top of the arc
  burn: 40, // seconds alight
  windDrift: 0.6, // how much of the wind speed it drifts with
  seenM: 25000, // seen this far on a clear night; weather closes it in less than other things
  seenMinM: 2500, // even in a storm, its glow carries this far
};

/** The whistle: heard this far in still air, less in wind. */
export const WHISTLE = { heardM: 1200, blastS: 3 };
/** The strobe: battery hours, flash period, seen how far. */
export const STROBE = { hours: 60, periodS: 1.2, seenM: 8000 };

/**
 * Where a flare is t seconds after launch. Pure: the same launch always gives the
 * same path, which is what lets a remote game draw it from an event.
 * @param f {at:{x,y,z}, vel:{x,y,z}, wind:{x,z}}
 * @returns {x, y, z, rising}
 */
export function flarePosition(f, t) {
  const { gravity: g, drag: k, chuteSink, windDrift } = FLARE;
  const t1 = apexTime(f);
  const tu = Math.min(Math.max(t, 0), t1);
  // Up: linear drag on all axes, gravity on y. v(t) = (v0 + g/k) e^-kt - g/k.
  const e = (1 - Math.exp(-k * tu)) / k;
  let x = f.at.x + f.vel.x * e;
  let z = f.at.z + f.vel.z * e;
  let y = f.at.y + (f.vel.y + g / k) * e - (g / k) * tu;
  if (t <= t1) return { x, y, z, rising: true };
  // Down: under the parachute, drifting with the wind.
  const td = t - t1;
  x += (f.wind?.x ?? 0) * windDrift * td;
  z += (f.wind?.z ?? 0) * windDrift * td;
  y -= chuteSink * td;
  return { x, y, z, rising: false };
}

/** Seconds from launch to the top of the arc. */
export function apexTime(f) {
  const { gravity: g, drag: k } = FLARE;
  return Math.max(0, Math.log(1 + (k * f.vel.y) / g) / k);
}

/** How far a flare can be seen in this visibility (metres): far beyond what you can see of the ground. */
export function flareSeenM(visibility = 80000) {
  return Math.min(FLARE.seenM, Math.max(FLARE.seenMinM, visibility * 6));
}

let nextId = 1;
const round = (v) => Math.round(v * 100) / 100;

export class Signals {
  /**
   * @param who who fires these signals (a name, later a player id)
   */
  constructor(who = 'You') {
    this.who = who;
    /** Seconds on this game's own clock (real time, not mountain time). */
    this.time = 0;
    /** Flares in the air: {id, by, at, vel, wind, start, local}. */
    this.flares = [];
    /** Strobes flashing: by → {by, x, y, z, since}. Yours follows you. */
    this.strobes = new Map();
    /** Strobe battery left, hours. */
    this.strobeHours = STROBE.hours;
    /** Last whistle: {by, x, y, z, at}. */
    this.whistle = null;
    this._listeners = [];
  }

  /** Listen for every signal this game makes, e.g. to send it to other players. */
  onEvent(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((f) => f !== fn); };
  }

  _emit(event) {
    for (const fn of this._listeners) fn(event);
    return event;
  }

  /**
   * Fire a flare from where you are, aimed along yaw (radians, 0 = -z) and steep
   * into the sky. Returns the event, which is all another game needs to draw it.
   * @param at {x, y, z} launch point (your hand)
   * @param wind {x, z} wind velocity in m/s, for the drift under the parachute
   */
  fireFlare(at, yaw = 0, wind = { x: 0, z: 0 }) {
    const el = (FLARE.elevation * Math.PI) / 180;
    const h = Math.cos(el) * FLARE.speed;
    const vel = { x: -Math.sin(yaw) * h, y: Math.sin(el) * FLARE.speed, z: -Math.cos(yaw) * h };
    const event = {
      type: 'signal',
      kind: 'flare',
      id: `${this.who}#${nextId++}`,
      by: this.who,
      at: { x: round(at.x), y: round(at.y), z: round(at.z) },
      vel: { x: round(vel.x), y: round(vel.y), z: round(vel.z) },
      wind: { x: round(wind.x ?? 0), z: round(wind.z ?? 0) },
      time: this.time,
    };
    this.receive(event, 0, true);
    return this._emit(event);
  }

  /**
   * A signal from another game (or this one). age is how many seconds ago it was
   * fired, for a late arrival. Flares, strobes and whistles all come through here.
   */
  receive(event, age = 0, local = false) {
    if (event?.type !== 'signal') return;
    if (event.kind === 'flare') {
      if (this.flares.some((f) => f.id === event.id)) return;
      this.flares.push({ id: event.id, by: event.by, at: event.at, vel: event.vel, wind: event.wind, start: this.time - age, local });
    } else if (event.kind === 'strobe') {
      if (event.on) this.strobes.set(event.by, { by: event.by, x: event.at.x, y: event.at.y, z: event.at.z, since: this.time - age, local });
      else this.strobes.delete(event.by);
    } else if (event.kind === 'whistle') {
      this.whistle = { by: event.by, ...event.at, at: this.time - age, local };
    }
  }

  /** Three blasts on the whistle. Returns the event. */
  blowWhistle(at) {
    const event = { type: 'signal', kind: 'whistle', by: this.who, at: { x: round(at.x), y: round(at.y), z: round(at.z) }, time: this.time };
    this.receive(event, 0, true);
    return this._emit(event);
  }

  /** Is your strobe flashing? */
  get strobeOn() {
    return this.strobes.has(this.who);
  }

  /** Switch your strobe on or off. Returns the event, or null if the battery is flat. */
  toggleStrobe(at) {
    const on = !this.strobeOn;
    if (on && this.strobeHours <= 0) return null;
    const event = { type: 'signal', kind: 'strobe', by: this.who, on, at: { x: round(at.x), y: round(at.y), z: round(at.z) }, time: this.time };
    this.receive(event, 0, true);
    return this._emit(event);
  }

  /**
   * Each frame.
   * @param dt real seconds
   * @param dtMountain mountain seconds, for the strobe battery
   * @param me {x, y, z} where you are, so your strobe goes with you
   */
  update(dt, dtMountain = dt, me = null) {
    this.time += dt;
    this.flares = this.flares.filter((f) => this.time - f.start < FLARE.burn);
    const mine = this.strobes.get(this.who);
    if (mine) {
      if (me) Object.assign(mine, { x: me.x, y: me.y, z: me.z });
      this.strobeHours -= dtMountain / 3600;
      if (this.strobeHours <= 0) {
        this.strobeHours = 0;
        this.toggleStrobe(mine);
      }
    }
  }

  /** Every flare alight now, with where it is: [{id, by, x, y, z, age, left, rising}]. */
  activeFlares() {
    return this.flares.map((f) => {
      const age = this.time - f.start;
      return { id: f.id, by: f.by, local: f.local, ...flarePosition(f, age), age, left: FLARE.burn - age };
    });
  }

  /**
   * The signals someone standing at pos could make out now, nearest first: what a
   * searching player would see and hear. [{kind, id, by, distance, bearing, x, y, z}]
   * bearing is degrees from north (−z), clockwise.
   * @param visibility metres, from the weather where they stand
   * @param wind m/s, which drowns out a whistle
   */
  noticedFrom(pos, { visibility = 80000, wind = 0, ignore = null } = {}) {
    const out = [];
    const add = (kind, s) => {
      const dx = s.x - pos.x, dz = s.z - pos.z;
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      out.push({ kind, id: s.id ?? `${kind}:${s.by}`, by: s.by, x: s.x, y: s.y, z: s.z, distance: Math.hypot(dx, s.y - pos.y, dz), bearing });
    };
    for (const f of this.activeFlares()) if (f.by !== ignore && Math.hypot(f.x - pos.x, f.y - pos.y, f.z - pos.z) < flareSeenM(visibility)) add('flare', f);
    for (const s of this.strobes.values()) {
      if (s.by !== ignore && Math.hypot(s.x - pos.x, s.y - pos.y, s.z - pos.z) < Math.min(STROBE.seenM, Math.max(300, visibility * 2))) add('strobe', s);
    }
    const w = this.whistle;
    if (w && w.by !== ignore && this.time - w.at < WHISTLE.blastS) {
      const heard = WHISTLE.heardM / (1 + Math.max(0, wind) / 8);
      if (Math.hypot(w.x - pos.x, w.y - pos.y, w.z - pos.z) < heard) add('whistle', w);
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}

/** A bearing in degrees as a compass point, e.g. 'NE'. */
export function compassPoint(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
