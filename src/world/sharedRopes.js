// Ropes climbers fix for each other. A lead walks up, puts in an ice screw or a
// snow picket and clips the rope to it, walks on and puts in the next: the rope
// stays running through every piece, so from the second piece on it is a fixed
// line (FixedRopes.fixLine) that the rest of the team can clip into, clip past
// each anchor of, jumar up and rappel down, just like the ropes on the route.
//
// Every change is a plain-data event (onEvent) that multiplayer sends to the
// other players, whose games pass it to receive(): they see the same pieces in
// the same places and can clip into the same line.

/** A new piece further than this from the last one starts a new line: the rope doesn't reach. */
export const LINK_M = 25;

export class SharedRopes {
  /**
   * @param ropes the FixedRopes the lines join
   * @param protection the ProtectionView that draws the pieces
   * @param who your name, as other players see it
   */
  constructor(ropes, protection, who = 'You') {
    this.ropes = ropes;
    this.protection = protection;
    this.who = who;
    /** The line you're leading out: {key, pieces: [piece, ...] bottom to top}, or null. */
    this.lead = null;
    this._count = 0;
    /** Another player's line key -> the piece ids drawn for it here. */
    this._remote = new Map();
    /** Your lines: key -> their pieces, bottom to top. */
    this._mine = new Map();
    /** Called with each event to send to the other players. */
    this.onEvent = () => {};
  }

  /**
   * You put a piece in (protection.place's result). Close enough above the last
   * one, the rope runs on through it and the line grows; otherwise it starts a
   * new one. Returns the line's rope id, or -1 while it's a single piece.
   */
  placed(piece) {
    const top = this.lead?.pieces.at(-1);
    const near = top && this.protection.get(top.id) && Math.hypot(piece.x - top.x, piece.y - top.y, piece.z - top.z) <= LINK_M;
    if (!near) {
      this.lead = { key: `${this.who}:${++this._count}`, pieces: [] };
      this._mine.set(this.lead.key, this.lead.pieces);
    }
    this.lead.pieces.push(piece);
    return this._publish(this.lead);
  }

  /** A piece of yours ripped out (or was cleaned): the line ends at the piece below it. */
  lost(id) {
    for (const [key, pieces] of this._mine) {
      const i = pieces.findIndex((p) => p.id === id);
      if (i < 0) continue;
      pieces.splice(i);
      this._publish({ key, pieces });
      if (!pieces.length) {
        this._mine.delete(key);
        if (this.lead?.key === key) this.lead = null;
      }
      return;
    }
  }

  /** Whether rope id is the line you're leading out. */
  isLead(rope) {
    return !!this.lead && this.ropes.lineIds.get(this.lead.key) === rope;
  }

  _publish(lead) {
    const anchors = lead.pieces.map((p) => ({ x: p.clip.x, y: p.clip.y, z: p.clip.z, kind: p.kind }));
    const r = this.ropes.fixLine(lead.key, { by: this.who, name: 'rope you fixed', anchors });
    this.onEvent({
      type: 'rope',
      key: lead.key,
      by: this.who,
      pieces: lead.pieces.map((p) => ({ x: p.x, z: p.z, kind: p.kind, yaw: p.yaw, normal: p.normal.toArray() })),
    });
    return r;
  }

  /**
   * An event from another player's game: their line as it stands now (no pieces
   * left and it's gone). Returns the line's rope id here, or -1.
   */
  receive(e) {
    if (e?.type !== 'rope' || e.by === this.who) return -1;
    for (const id of this._remote.get(e.key) ?? []) this.protection.remove(id);
    const pieces = (e.pieces ?? []).map((p) => this.protection.place({ ...p, exact: true, owner: e.by }));
    this._remote.set(e.key, pieces.map((p) => p.id));
    const anchors = pieces.map((p) => ({ x: p.clip.x, y: p.clip.y, z: p.clip.z, kind: p.kind }));
    return this.ropes.fixLine(e.key, { by: e.by, name: `${e.by}'s rope`, anchors });
  }

  /** Every line you've fixed, as events: send these to a player who joins late. */
  snapshot() {
    return this.ropes.linesData().filter((l) => l.by === this.who).map((l) => ({
      type: 'rope', key: l.key, by: l.by,
      pieces: (this._mine.get(l.key) ?? []).map((p) => ({ x: p.x, z: p.z, kind: p.kind, yaw: p.yaw, normal: p.normal.toArray() })),
    }));
  }
}
