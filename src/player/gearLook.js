// What the climber visibly carries and holds, as a small plain object the model
// draws (ClimberModel.setGear). It's plain data on purpose: in multiplayer each
// player can send theirs and the other games draw it on that climber's model.
//
//   suit        'down' (red down suit) or 'shell' (no down suit packed)
//   goggles     wearing goggles
//   crampons    0 none, 1 crampons, 2 steel-front crampons
//   axeTech     the technical axe rather than the standard one
//   pack        'pack45' | 'pack70'
//   rope, screws, pickets, shovel, probe, bivy, radio, whistle, monitor: carried
//   tent        null | 'tent' | 'tent_ul'
//   strobe      0 none, 1 carried, 2 flashing
//   oxygen      bottles carried (the first one feeds the mask)
//   o2          oxygen flowing: mask on and hose to the bottle
//   hand        what's in the left mitt: a device held up ('gps', 'monitor',
//               'map'), or for a moment what you just used ('snack', 'water',
//               'dex', 'firstaid', 'warmers', 'flare', 'whistle'); null for nothing

import { hasGear } from '../sim/gear.js';

/** How long something you used stays in your hand, in real seconds. */
const SHOW_S = { snack: 2.2, water: 2.2, dex: 1.6, firstaid: 2.8, warmers: 1.8, flare: 2.2, whistle: 2 };

export class GearLook {
  constructor() {
    this._last = null;
    this._using = null;
    this._usingT = 0;
    this._whistleAt = null;
  }

  /**
   * The look this frame.
   * @param c the Climber
   * @param device the device held up on the HUD ('gps' | 'monitor' | 'map' | null)
   * @param dt real seconds since the last frame
   * @param quiet true while the pack is open: items leaving it there are being
   *   left at a camp or moved about, not used
   */
  update(c, device, dt, quiet = false) {
    const p = c.pack;
    const g = p.gear;
    // Something used since last frame shows in the hand for a moment: watch the
    // counts drop rather than hooking every key and menu that can use it.
    const now = { snack: p.snack, water: p.water, dex: p.dex, firstaid: p.extra.firstaid ?? 0, warmers: p.extra.warmers ?? 0, flare: p.extra.flares ?? 0 };
    if (this._last && !quiet) {
      for (const k of Object.keys(now)) if (now[k] < this._last[k] - 1e-6) this.use(k);
    }
    this._last = now;
    const w = c.signals?.whistle;
    if (w && w.local && w.at !== this._whistleAt) {
      if (this._whistleAt !== null) this.use('whistle');
      this._whistleAt = w.at;
    } else if (this._whistleAt === null) this._whistleAt = w?.at ?? -1;
    this._usingT = Math.max(0, this._usingT - dt);
    if (this._usingT <= 0) this._using = null;

    return {
      suit: g.has('down_suit') ? 'down' : 'shell',
      goggles: g.has('goggles'),
      crampons: g.has('crampons_pro') ? 2 : g.has('crampons') ? 1 : 0,
      axeTech: g.has('axe_tech'),
      pack: p.size,
      rope: g.has('rope'),
      screws: g.has('screws'),
      pickets: g.has('pickets'),
      shovel: g.has('shovel'),
      probe: g.has('probe'),
      bivy: g.has('bivy'),
      tent: g.has('tent_ul') ? 'tent_ul' : g.has('tent') ? 'tent' : null,
      radio: g.has('radio'),
      whistle: g.has('whistle'),
      monitor: hasGear(p, 'monitor'),
      strobe: g.has('strobe') ? (c.signals?.strobeOn ? 2 : 1) : 0,
      oxygen: p.bottles.length,
      o2: p.bottles.length > 0 && (c.phys?.flow ?? 0) > 0,
      hand: this._using ?? device ?? null,
    };
  }

  /** Show an item in the hand for a moment. */
  use(id) {
    this._using = id;
    this._usingT = SHOW_S[id] ?? 2;
  }
}
