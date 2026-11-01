// The climber: a high-altitude mountaineer in a one-piece down suit, helmet and
// goggles, harness, big double boots with crampons, mitts, a pack with a foam pad,
// an ice axe and a jumar. Built from three.js primitives, with the down baffles
// made by lathing a bumpy profile.
//
// The body is a joint hierarchy so it can be posed (and later ragdolled) one bone
// at a time:
//
//   pelvis ─ spine ─ neck ─ head
//          │       ├ shoulderL ─ elbowL ─ wristL
//          │       └ shoulderR ─ elbowR ─ wristR
//          ├ hipL ─ kneeL ─ ankleL
//          └ hipR ─ kneeR ─ ankleR
//
// Each joint is a THREE.Group at the joint centre; its child bone hangs along -y
// (or +y for the spine and neck). `joints` maps the names above to the groups and
// `bones` lists them parent-first with their lengths. Positive rotation.x swings a
// limb forward (the climber faces -z).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const SUIT = 0xd8361f; // red down suit
const SUIT_DARK = 0x1b1d22; // black side and knee panels
const ACCENT = 0xf2b705;

/** Bone lengths in metres. */
export const BONES = {
  pelvisHeight: 0.98,
  spine: 0.46,
  neck: 0.1,
  upperArm: 0.3,
  forearm: 0.27,
  thigh: 0.44,
  shin: 0.42,
  ankleHeight: 0.1,
};

/**
 * A puffy tube along -y from 0 to -len, radius r0 at the top to r1 at the bottom,
 * with `baffles` stitched bulges and rounded ends.
 */
function puffy(r0, r1, len, baffles, bulge = 0.012) {
  const pts = [];
  const steps = baffles * 6;
  pts.push(new THREE.Vector2(0.0001, 0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cap = Math.sin(Math.min(t, 1 - t, 0.08) / 0.08 * Math.PI / 2); // round the ends
    const r = (r0 + (r1 - r0) * t) * (0.55 + 0.45 * cap) + bulge * Math.sin(t * baffles * Math.PI) ** 2;
    pts.push(new THREE.Vector2(r, -t * len));
  }
  pts.push(new THREE.Vector2(0.0001, -len));
  return new THREE.LatheGeometry(pts, 14);
}

export class ClimberModel extends THREE.Group {
  constructor() {
    super();
    const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
    const M = {
      suit: new THREE.MeshPhysicalMaterial({ color: SUIT, roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xff9a80), sheenRoughness: 0.4 }),
      panel: mat(SUIT_DARK, { roughness: 0.8 }),
      accent: mat(ACCENT, { roughness: 0.6 }),
      balaclava: mat(0x2a2c31, { roughness: 0.95 }),
      helmet: mat(0xf4f1ea, { roughness: 0.35 }),
      lens: new THREE.MeshStandardMaterial({ color: 0xff8a1c, roughness: 0.05, metalness: 0.9, emissive: 0x401800 }),
      harness: mat(0x1f2a44, { roughness: 0.8 }),
      metal: mat(0xc0c4ca, { roughness: 0.3, metalness: 0.85 }),
      steel: mat(0x6b7178, { roughness: 0.4, metalness: 0.8 }),
      pack: mat(0x23304a, { roughness: 0.85 }),
      pad: mat(0xe8c11c, { roughness: 0.9 }),
      mitt: mat(0x1b1d22, { roughness: 0.9 }),
      boot: mat(0xf2b705, { roughness: 0.6 }),
      sole: mat(0x111214, { roughness: 0.9 }),
      axe: mat(0x1f6fe0, { roughness: 0.35, metalness: 0.4 }),
      grip: mat(0x15161a, { roughness: 0.95 }),
      head: mat(0xc4cad2, { roughness: 0.3, metalness: 0.35 }),
      pole: mat(0x2a2d33, { roughness: 0.4, metalness: 0.6 }),
      poleBand: mat(0xff7a1a, { roughness: 0.45, metalness: 0.3 }),
    };
    const part = (parent, geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const joint = (parent, name, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      this.joints[name] = g;
      return g;
    };
    this.joints = {};

    // Pelvis: hips of the suit, harness waist belt and leg loops, gear loops.
    const pelvis = joint(this, 'pelvis', 0, BONES.pelvisHeight, 0);
    const hipsGeo = puffy(0.17, 0.15, 0.2, 1, 0.01);
    part(pelvis, hipsGeo, M.suit, 0, 0.1, 0).scale.set(1.12, 1, 0.85);
    part(pelvis, new THREE.TorusGeometry(0.175, 0.025, 6, 20), M.harness, 0, 0.05, 0, Math.PI / 2).scale.set(1.08, 0.85, 1);
    part(pelvis, new THREE.TorusGeometry(0.03, 0.007, 4, 10), M.metal, 0.12, -0.0, -0.13, 0, 0.6); // carabiners on the gear loop
    part(pelvis, new THREE.TorusGeometry(0.03, 0.007, 4, 10), M.metal, -0.13, -0.0, -0.11, 0, -0.6);
    part(pelvis, new THREE.TorusGeometry(0.026, 0.007, 4, 10), M.accent, 0.17, -0.01, 0.02, 0, 1.5);

    // Spine: down jacket torso with dark side panels, chest harness strap, pack.
    const spine = joint(pelvis, 'spine', 0, 0.08, 0);
    const torso = part(spine, puffy(0.2, 0.17, 0.5, 5, 0.014), M.suit, 0, 0.5, 0);
    torso.scale.set(1.12, 1, 0.82);
    for (const s of [-1, 1]) part(spine, new THREE.BoxGeometry(0.02, 0.3, 0.16), M.panel, s * 0.215, 0.22, 0);
    part(spine, new THREE.BoxGeometry(0.03, 0.4, 0.01), M.panel, 0, 0.24, -0.165); // front zip
    for (const s of [-1, 1]) part(spine, new THREE.BoxGeometry(0.04, 0.34, 0.012), M.harness, s * 0.1, 0.24, -0.16, 0, 0, s * 0.08); // pack shoulder straps
    part(spine, new THREE.BoxGeometry(0.26, 0.03, 0.012), M.harness, 0, 0.33, -0.165); // sternum strap
    // Rucksack: body, lid, foam pad under the lid, side straps, axe holster.
    const pack = new THREE.Group();
    pack.position.set(0, 0.26, 0.22);
    spine.add(pack);
    part(pack, new RoundedBoxGeometry(0.34, 0.52, 0.22, 3, 0.06), M.pack);
    part(pack, new RoundedBoxGeometry(0.33, 0.1, 0.23, 2, 0.04), M.panel, 0, 0.28, 0.01);
    part(pack, new THREE.CylinderGeometry(0.07, 0.07, 0.5, 12), M.pad, 0, 0.36, -0.02, 0, 0, Math.PI / 2);
    for (const s of [-1, 1]) part(pack, new THREE.BoxGeometry(0.012, 0.03, 0.23), M.harness, s * 0.17, 0.05 - 0.15 * (s + 1), 0);
    part(pack, new THREE.BoxGeometry(0.28, 0.035, 0.02), M.harness, 0, -0.08, 0.115);
    this.stowedAxe = part(pack, new THREE.CylinderGeometry(0.016, 0.016, 0.66, 8), M.axe, 0.1, 0.02, 0.13, 0, 0, 0.05);
    part(this.stowedAxe, new THREE.BoxGeometry(0.3, 0.035, 0.022), M.metal, 0, -0.34, 0);
    // Trekking poles, collapsed and strapped down the side of the pack.
    this.stowedPoles = new THREE.Group();
    this.stowedPoles.position.set(-0.19, 0.02, 0.02);
    this.stowedPoles.rotation.set(0.08, 0, 0.06);
    pack.add(this.stowedPoles);
    for (const dz of [-0.03, 0.03]) {
      part(this.stowedPoles, new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), M.poleBand, 0, 0, dz);
      part(this.stowedPoles, new THREE.CylinderGeometry(0.02, 0.018, 0.12, 8), M.grip, 0, 0.36, dz);
      part(this.stowedPoles, new THREE.CylinderGeometry(0.035, 0.035, 0.008, 10), M.grip, 0, -0.26, dz);
    }

    // Neck: puffy hood collar. Head: balaclava, helmet with a stripe, wraparound goggles.
    const neck = joint(spine, 'neck', 0, BONES.spine, 0);
    part(neck, new THREE.TorusGeometry(0.11, 0.05, 8, 16), M.suit, 0, 0.03, 0.01, Math.PI / 2 - 0.15).scale.set(1, 1.1, 1);
    const head = joint(neck, 'head', 0, BONES.neck, 0);
    part(head, new THREE.SphereGeometry(0.11, 18, 14), M.balaclava, 0, 0.06, 0).scale.set(0.95, 1.12, 1);
    part(head, new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), M.helmet, 0, 0.1, 0.012).scale.set(1, 0.95, 1.08);
    part(head, new THREE.TorusGeometry(0.128, 0.009, 4, 24, Math.PI), M.panel, 0, 0.1, 0.012, 0, Math.PI / 2, Math.PI / 2); // centre ridge
    part(head, new THREE.CylinderGeometry(0.117, 0.117, 0.06, 20, 1, true, Math.PI * 0.62, Math.PI * 0.76), M.lens, 0, 0.075, 0, 0, Math.PI, 0).scale.set(0.98, 1, 1.02);
    part(head, new THREE.TorusGeometry(0.115, 0.01, 4, 24), M.panel, 0, 0.075, 0.004, Math.PI / 2); // goggle strap
    part(head, new THREE.CylinderGeometry(0.04, 0.05, 0.045, 10), M.panel, 0, 0.0, -0.105, Math.PI / 2 + 0.25); // breathing mask
    // Headlamp on the helmet front; its lens glows in the lamp's colour when lit.
    part(head, new RoundedBoxGeometry(0.07, 0.04, 0.03, 2, 0.008), M.panel, 0, 0.15, -0.128, -0.35);
    this.lampLens = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.2, emissive: 0x000000 });
    part(head, new THREE.CylinderGeometry(0.014, 0.014, 0.008, 12), this.lampLens, 0, 0.147, -0.146, Math.PI / 2 - 0.35);

    // Arms: puffy sleeves, dark elbow patches, gauntlet mitts.
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const shoulder = joint(spine, `shoulder${side}`, s * 0.25, 0.42, 0);
      part(shoulder, new THREE.SphereGeometry(0.085, 12, 10), M.suit, 0, -0.01, 0);
      part(shoulder, puffy(0.08, 0.068, BONES.upperArm + 0.03, 3), M.suit);
      const elbow = joint(shoulder, `elbow${side}`, 0, -BONES.upperArm, 0);
      part(elbow, new THREE.SphereGeometry(0.066, 10, 8), M.panel);
      part(elbow, puffy(0.066, 0.056, BONES.forearm, 3), M.suit);
      const wrist = joint(elbow, `wrist${side}`, 0, -BONES.forearm, 0);
      part(wrist, new THREE.CylinderGeometry(0.06, 0.058, 0.08, 10), M.panel, 0, -0.01, 0); // gauntlet cuff
      part(wrist, new THREE.SphereGeometry(0.058, 12, 10), M.mitt, 0, -0.08, -0.005).scale.set(0.8, 1.25, 1.05);
      part(wrist, new THREE.CapsuleGeometry(0.022, 0.04, 4, 6), M.mitt, s * -0.04, -0.06, -0.035, 0.5, 0, s * -0.4); // thumb
    }
    // Ice axe in the right mitt, jumar in the left.
    const hand = new THREE.Group();
    hand.position.set(0, -0.09, 0);
    this.joints.wristR.add(hand);
    this.axe = new THREE.Group();
    hand.add(this.axe);
    // Head at the origin, shaft hanging along -y: a bright blue shaft with a rubber
    // grip at the spike end, a steel head with a long drooping pick forward (-z),
    // a broad adze behind, and a leash loop. Big enough to read from a distance.
    part(this.axe, new THREE.CylinderGeometry(0.019, 0.017, 0.66, 8), M.axe, 0, -0.33, 0);
    part(this.axe, new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), M.grip, 0, -0.56, 0);
    part(this.axe, new THREE.ConeGeometry(0.017, 0.08, 6), M.steel, 0, -0.7, 0, Math.PI); // spike
    part(this.axe, new THREE.BoxGeometry(0.03, 0.06, 0.07), M.head, 0, 0.005, 0); // head
    part(this.axe, new THREE.BoxGeometry(0.014, 0.035, 0.2), M.head, 0, -0.015, -0.12, -0.25); // pick
    part(this.axe, new THREE.ConeGeometry(0.012, 0.06, 4), M.head, 0, -0.06, -0.225, -Math.PI / 2 - 0.6); // pick tip
    part(this.axe, new THREE.BoxGeometry(0.06, 0.012, 0.12), M.head, 0, 0.01, 0.09, 0.15); // adze
    part(this.axe, new THREE.TorusGeometry(0.05, 0.006, 4, 12), M.poleBand, 0, -0.38, 0.03, 0, Math.PI / 2); // leash
    // Trekking poles, one per mitt, grip at the hand and hanging along -y.
    this.poles = ['L', 'R'].map((side) => {
      const g = new THREE.Group();
      g.position.set(0, -0.08, -0.01);
      this.joints[`wrist${side}`].add(g);
      part(g, new THREE.CylinderGeometry(0.022, 0.02, 0.14, 8), M.grip, 0, 0.01, 0); // foam grip
      part(g, new THREE.TorusGeometry(0.045, 0.006, 4, 12), M.poleBand, 0, 0.09, 0, 0, Math.PI / 2); // wrist strap
      part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.46, 6), M.poleBand, 0, -0.29, 0); // upper section
      part(g, new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6), M.pole, 0, -0.76, 0); // lower section
      part(g, new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6), M.grip, 0, -0.52, 0); // lever lock
      part(g, new THREE.CylinderGeometry(0.045, 0.045, 0.01, 10), M.grip, 0, -0.95, 0); // snow basket
      part(g, new THREE.ConeGeometry(0.008, 0.05, 6), M.steel, 0, -1.03, 0, Math.PI); // carbide tip
      return g;
    });
    /** What's in the hands, set from outside before posing: { axe, poles }. */
    this.held = { axe: false, poles: false };
    this.jumar = new THREE.Group();
    this.jumar.position.set(0, -0.1, -0.02);
    this.joints.wristL.add(this.jumar);
    part(this.jumar, new THREE.BoxGeometry(0.03, 0.18, 0.05), M.accent, 0, 0.02, 0);
    part(this.jumar, new THREE.BoxGeometry(0.02, 0.12, 0.03), M.metal, 0, 0.1, -0.02);
    // Tether from the harness to the jumar, drawn as a line updated each frame.
    this.tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe23b2e }));
    this.tether.frustumCulled = false;
    this.add(this.tether);

    // Legs: puffy suit legs, dark knee panels, gaitered double boots with crampons.
    const crampon = new THREE.Group();
    part(crampon, new THREE.BoxGeometry(0.1, 0.012, 0.28), M.steel, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) part(crampon, new THREE.ConeGeometry(0.008, 0.035, 4), M.steel, s * 0.045, -0.02, -0.11 + i * 0.055, Math.PI);
    }
    part(crampon, new THREE.ConeGeometry(0.01, 0.05, 4), M.steel, -0.02, -0.005, -0.16, -Math.PI / 2 - 0.4);
    part(crampon, new THREE.ConeGeometry(0.01, 0.05, 4), M.steel, 0.02, -0.005, -0.16, -Math.PI / 2 - 0.4);
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      const hip = joint(pelvis, `hip${side}`, s * 0.1, -0.02, 0);
      part(hip, puffy(0.1, 0.085, BONES.thigh + 0.04, 4, 0.012), M.suit, 0, 0.02, 0);
      part(hip, new THREE.TorusGeometry(0.095, 0.014, 5, 14), M.harness, 0, -0.06, 0, Math.PI / 2 - 0.15); // leg loop
      const knee = joint(hip, `knee${side}`, 0, -BONES.thigh, 0);
      part(knee, new THREE.SphereGeometry(0.08, 10, 8), M.panel, 0, 0, -0.01).scale.set(1, 1, 0.9);
      part(knee, puffy(0.08, 0.075, 0.2, 2), M.suit);
      // Gaiter up the shin, boot below.
      part(knee, new THREE.CylinderGeometry(0.075, 0.08, 0.26, 12), M.boot, 0, -0.27, 0);
      part(knee, new THREE.TorusGeometry(0.076, 0.012, 4, 14), M.panel, 0, -0.15, 0, Math.PI / 2);
      const ankle = joint(knee, `ankle${side}`, 0, -BONES.shin, 0);
      part(ankle, new RoundedBoxGeometry(0.13, 0.12, 0.3, 2, 0.04), M.boot, 0, -0.02, -0.05);
      part(ankle, new RoundedBoxGeometry(0.135, 0.04, 0.31, 2, 0.015), M.sole, 0, -0.08, -0.05);
      part(ankle, new THREE.BoxGeometry(0.135, 0.02, 0.12), M.panel, 0, 0.02, -0.12); // lace cover
      const c = crampon.clone();
      c.position.set(0, -0.105, -0.05);
      ankle.add(c);
    }

    // Hidden in first person: the head and collar (the camera is in them) and the
    // chest and pack, which would otherwise fill the view looking down. Arms and
    // legs stay, so you see your own mitts and boots.
    this.fpHidden = [this.joints.neck, ...this.joints.spine.children.filter((c) => c.isMesh), pack];

    this.bones = [
      ['pelvis', null, 0.1], ['spine', 'pelvis', BONES.spine], ['neck', 'spine', BONES.neck], ['head', 'neck', 0.24],
      ['shoulderL', 'spine', BONES.upperArm], ['elbowL', 'shoulderL', BONES.forearm], ['wristL', 'elbowL', 0.12],
      ['shoulderR', 'spine', BONES.upperArm], ['elbowR', 'shoulderR', BONES.forearm], ['wristR', 'elbowR', 0.12],
      ['hipL', 'pelvis', BONES.thigh], ['kneeL', 'hipL', BONES.shin], ['ankleL', 'kneeL', 0.1],
      ['hipR', 'pelvis', BONES.thigh], ['kneeR', 'hipR', BONES.shin], ['ankleR', 'kneeR', 0.1],
    ].map(([name, parent, length]) => ({ name, parent, length, joint: this.joints[name] }));
    // Pose blending: last frame's joint rotations, eased toward each new pose.
    this._from = this.bones.map(() => new THREE.Quaternion());
    this._pelvisFrom = new THREE.Vector3();
    this._lastPose = null;
    this._blend = 0;
  }

  /** Hip and shoulder pivots, which the ragdoll flails during a tumble. */
  get limbs() {
    const j = this.joints;
    return [j.hipL, j.hipR, j.shoulderL, j.shoulderR];
  }

  /** Lights the headlamp lens in a colour, or darkens it with null. */
  setLamp(color) {
    this.lampLens.emissive.setHex(color ?? 0x000000);
    this.lampLens.emissiveIntensity = color == null ? 0 : 4;
  }

  /** In first person the camera sits in the head: hide it (and the chest) so you see your own limbs. */
  set firstPerson(on) {
    this._fp = on;
    for (const o of this.fpHidden) o.visible = !on;
  }

  /** Puts every joint back to standing straight. */
  resetPose() {
    for (const { joint } of this.bones) joint.rotation.set(0, 0, 0);
    this.joints.pelvis.position.set(0, BONES.pelvisHeight, 0);
  }

  /**
   * Poses the body, easing from the last pose rather than snapping to the new one:
   * quickly within a gait, more slowly when the pose changes (walking to climbing,
   * standing to sliding, getting up after a fall).
   *
   * @param mode 'walk' | 'climb' | 'axe' | 'rope' | 'rest' | 'kneel' | 'lie' | 'slide' | 'fly'
   * @param o {dt, stride, swing, arrest, time, grip}: dt in real seconds (0 or
   *   missing snaps straight to the pose); stride 0..1 how long the steps are;
   *   swing 0..1 through an axe swing; arrest digging the axe in a slide; time for
   *   flailing; grip 0..100 on the axe
   */
  pose(mode, phase, moving, rise = 0, o = {}) {
    const dt = o.dt ?? 0;
    this.bones.forEach(({ joint }, i) => this._from[i].copy(joint.quaternion));
    this._pelvisFrom.copy(this.joints.pelvis.position);
    if (mode !== this._lastPose) {
      this._blend = this._lastPose == null ? 0 : 1;
      this._lastPose = mode;
    }
    this._blend = Math.max(0, this._blend - dt / 0.5);
    if (mode === 'slide' || mode === 'fly') this._poseFK(mode, o);
    else this._poseIK(mode, phase, moving, rise, o);
    if (dt <= 0) return;
    // Within a pose a light touch takes the edge off; across a change, a real blend.
    const tau = 0.03 + 0.2 * this._blend;
    const k = 1 - Math.exp(-dt / tau);
    this.bones.forEach(({ joint }, i) => joint.quaternion.slerpQuaternions(this._from[i], joint.quaternion.clone(), k));
    this.joints.pelvis.position.lerpVectors(this._pelvisFrom, this.joints.pelvis.position.clone(), k);
  }

  /** Ease toward the next pose from wherever the body is now (after the ragdoll, say). */
  get blending() {
    return this._blend;
  }

  /**
   * Poses the body on the ground under it. Feet (and on steep ground, hands) are
   * placed on the slope with two-bone IK, the body leans into the hill, and the
   * pelvis drops so no leg has to stretch past its length.
   *
   * @param mode 'walk' | 'climb' | 'rope' | 'rest' | 'slide' | 'fly'
   * @param phase gait phase in radians
   * @param moving whether the climber is moving
   * @param rise ground rise per metre in the direction the climber faces
   *   (tan of the slope; positive uphill, negative downhill)
   */
  _poseIK(mode, phase, moving, rise, o) {
    const j = this.joints;
    const th = Math.atan(rise);
    const up = Math.max(th, 0);
    // Points on the slope in the sagittal plane, as [y, z] (the climber faces -z):
    // s metres up the surface and n metres out from it.
    const onSlope = (s, n) => [s * Math.sin(th) + n * Math.cos(th), -s * Math.cos(th) + n * Math.sin(th)];
    const sw = moving ? Math.sin(phase) : 0;
    const step = (i) => phase + i * Math.PI; // left and right limbs half a cycle apart
    let pelvis, pt, sp, feet, hands = null, footMax, head = 0.1, spread = 0.12, tool = 'axe';
    let armsFK = [[0, 0.1], [0, 0.1]];
    let wrists = null;
    // Shorter, quicker-looking steps when you're crawling along up high.
    const stride = Math.min(Math.max(o.stride ?? 1, 0.35), 1);

    switch (mode) {
      case 'walk': {
        // Stride along the ground, lifting the foot as it swings through.
        feet = [0, 1].map((i) => {
          const z = moving ? -0.28 * stride * Math.sin(step(i)) : (i ? 0.06 : -0.06);
          // The foot clears the snow as it swings through, highest just past mid-swing.
          const swing = Math.max(0, Math.cos(step(i) - 0.35));
          const lift = moving ? swing * swing * (0.06 + 0.06 * stride) : 0;
          return [-z * rise + BONES.ankleHeight + lift, z];
        });
        // Down onto each heavy boot as it lands, up as you pass over it.
        pelvis = [0.96 + (moving ? (Math.abs(Math.cos(phase)) - 0.5) * 0.035 * stride : 0), 0.02];
        pt = -0.05 - 0.25 * up + 0.1 * Math.min(th, 0) - (moving ? 0.04 * stride : 0);
        sp = -0.1 - 0.35 * up;
        armsFK = [[-sw * 0.4 * stride + 0.1, 0.35 + 0.15 * Math.max(0, -sw)], [sw * 0.4 * stride + 0.25, 0.5 + 0.15 * Math.max(0, sw)]];
        // Poles: elbows bent, each pole planted with the opposite foot's stride.
        if (this.held.poles) armsFK = [[-sw * 0.35 * stride + 0.2, 0.75], [sw * 0.35 * stride + 0.2, 0.75]];
        // The axe carried like a cane in the uphill hand.
        else if (this.held.axe) armsFK[1] = [sw * 0.2 + 0.25, 0.7];
        if (this._fp) armsFK = this._fpArms(sw, armsFK);
        footMax = 0.45;
        head = 0.1 + 0.4 * up;
        break;
      }
      case 'climb': {
        // Facing into the slope: body leaning in, crampons kicked into the surface,
        // mitts and axe on the slope above, moving one limb at a time.
        // Hips over the feet but held off the slope, chest leaning in.
        pelvis = [0.8, 0.2 * Math.sin(up)];
        pt = -0.15 * up;
        sp = -0.3 * up - 0.05;
        feet = [0, 1].map((i) => {
          const c = step(i);
          return onSlope(moving ? 0.14 * stride * Math.sin(c) : (i ? -0.08 : 0.04), 0.09 + (moving ? Math.max(0, Math.cos(c)) ** 2 * 0.1 : 0));
        });
        hands = [0, 1].map((i) => {
          const c = step(i + 1); // each hand moves with the opposite foot
          return onSlope(1.15 + (moving ? 0.13 * stride * Math.sin(c) : (i ? 0.08 : -0.04)), 0.1 + (moving ? Math.max(0, Math.cos(c)) ** 2 * 0.14 : 0));
        });
        // The body sways toward the foot that's bearing weight.
        pelvis[1] += moving ? 0.015 * Math.sin(phase) : 0;
        footMax = 0.6;
        head = 0.25 + 0.6 * up;
        spread = 0.22;
        break;
      }
      case 'axe': {
        // Hanging on the axe on a wall too steep to walk. Each swing: pull on the
        // planted axe, rip it out, swing it back overhead and strike higher, while
        // the feet kick in one after the other. Between swings you hang, arms
        // shaking as the grip goes.
        const p = o.swing ?? 0;
        const ease = (x) => x * x * (3 - 2 * x);
        const e = ease(p);
        const win = (a, b) => ease(Math.min(Math.max((p - a) / (b - a), 0), 1));
        pelvis = [0.78, 0.22 * Math.sin(up)];
        pt = -0.15 * up;
        sp = -0.3 * up - 0.08 + 0.1 * Math.sin(Math.PI * win(0.25, 0.75)); // lean back to swing
        feet = [0, 1].map((i) => {
          const w = win(0.2 + 0.35 * i, 0.55 + 0.35 * i);
          return onSlope((i ? -0.1 : 0.04) + 0.25 * (w - e), 0.09 + 0.12 * Math.sin(Math.PI * w));
        });
        // The axe hand: [progress, up the slope, out from it, wrist].
        const keys = [[0, 1.2, 0.34, 0.7], [0.3, 0.95, 0.36, 0.7], [0.55, 1.45, 0.6, 1.1], [0.78, 1.25, 0.32, 0.5], [1, 1.2, 0.34, 0.7]];
        let a = keys[0];
        let b = keys[1];
        for (let k = 1; k < keys.length; k++) {
          a = keys[k - 1];
          b = keys[k];
          if (p <= b[0]) break;
        }
        const f = ease(Math.min(Math.max((p - a[0]) / (b[0] - a[0]), 0), 1));
        const axeHand = [1, 2, 3].map((n) => a[n] + (b[n] - a[n]) * f);
        // The other mitt presses into the slope and moves up after the axe.
        const w = win(0.6, 0.95);
        const shake = (o.grip ?? 100) < 35 && p === 0 ? 0.012 * Math.sin((o.time ?? 0) * 47) : 0;
        hands = [
          onSlope(1.0 + 0.3 * (w - e), 0.1 + 0.1 * Math.sin(Math.PI * w) + shake),
          onSlope(axeHand[0], axeHand[1] + shake),
        ];
        wrists = [-0.4, axeHand[2]];
        footMax = 0.6;
        head = 0.35 + 0.6 * up + 0.25 * Math.sin(Math.PI * win(0.4, 0.85)); // eyes on the placement
        spread = 0.2;
        tool = 'axeSwing';
        break;
      }
      case 'kneel': {
        // Buckled in the snow: on the knees, slumped forward, arms hanging.
        feet = [[BONES.ankleHeight, 0.3], [BONES.ankleHeight, 0.26]];
        pelvis = [0.48, 0.12];
        pt = 0.25;
        sp = -0.55;
        armsFK = [[0.15, 0.25], [0.05, 0.35]];
        footMax = 1.2;
        head = -0.5;
        spread = 0.06;
        break;
      }
      case 'lie': {
        // Stretched out where you fell (the model is laid flat around this).
        feet = [[BONES.ankleHeight - 0.05, 0.04], [BONES.ankleHeight - 0.02, -0.06]];
        pelvis = [0.96, 0];
        pt = 0;
        sp = -0.05;
        armsFK = [[2.6, 0.5], [0.3, 0.3]];
        footMax = 1.4;
        head = -0.4;
        spread = 0.2;
        break;
      }
      case 'rope': {
        // Jumaring: left mitt slides the jumar up the rope, right hand holds the
        // rope below it, stepping up the slope.
        pelvis = [0.84, 0.18 * Math.sin(up)];
        pt = -0.12 * up;
        sp = -0.22 * up - 0.05;
        feet = [0, 1].map((i) => {
          const c = step(i);
          return onSlope(moving ? 0.15 * Math.sin(c) : (i ? -0.06 : 0.06), 0.09 + (moving ? Math.max(0, Math.cos(c)) * 0.08 : 0));
        });
        hands = [
          onSlope(1.45 + (moving ? 0.1 * Math.sin(phase) : 0), 0.42),
          onSlope(0.8, 0.38),
        ];
        footMax = 0.6;
        head = 0.25 + 0.5 * up;
        tool = 'jumar';
        break;
      }
      default: {
        // Resting: bent over, hands on knees, back heaving with each breath.
        const breath = Math.sin(phase) * 0.05;
        feet = [[0.06 * rise + BONES.ankleHeight, -0.06], [-0.06 * rise + BONES.ankleHeight, 0.06]];
        pelvis = [0.84, 0.08];
        pt = -0.15;
        sp = -0.6 - breath;
        armsFK = [[0.9, -0.05], [0.9, -0.05]];
        // Leaning on the poles, or on the axe planted in front.
        if (this.held.poles) armsFK = [[0.55, 0.5], [0.55, 0.5]];
        else if (this.held.axe) armsFK[1] = [0.6, 0.45];
        if (this._fp) armsFK = this._fpArms(0, armsFK);
        footMax = 0.45;
        head = 0.55;
        spread = 0.16;
      }
    }

    // Lower the pelvis until both feet are within reach.
    const reach = (BONES.thigh + BONES.shin) * 0.985;
    for (const [fy, fz] of feet) {
      const dz = fz - pelvis[1];
      pelvis[0] = Math.min(pelvis[0], fy + Math.sqrt(Math.max(reach * reach - dz * dz, 0)) + 0.02);
    }
    j.pelvis.position.set(0, pelvis[0], pelvis[1]);
    // Hips rock and the shoulders counter-rotate with the stride.
    j.pelvis.rotation.set(pt, mode === 'walk' && moving ? sw * 0.08 * stride : 0, mode === 'walk' && moving ? sw * 0.05 : 0);
    j.spine.rotation.set(sp, mode === 'walk' && moving ? -sw * 0.14 * stride : 0, 0);
    // Look up the slope rather than at it.
    const look = head - (pt + sp);
    j.neck.rotation.set(look * 0.4, 0, 0);
    j.head.rotation.set(look * 0.6, 0, 0);

    const hip = [pelvis[0] - 0.02 * Math.cos(pt), pelvis[1] - 0.02 * Math.sin(pt)];
    const footAbs = Math.min(Math.max(th, -footMax), footMax);
    ['L', 'R'].forEach((side, i) => {
      const [a, k] = twoBone(hip, feet[i], BONES.thigh, BONES.shin, -1);
      j[`hip${side}`].rotation.set(a - pt, 0, 0);
      j[`knee${side}`].rotation.set(k, 0, 0);
      j[`ankle${side}`].rotation.set(footAbs - (a + k), 0, 0); // sole flat on the slope
    });

    const tilt = pt + sp;
    const shoulder = [
      pelvis[0] + 0.08 * Math.cos(pt) + 0.42 * Math.cos(tilt),
      pelvis[1] + 0.08 * Math.sin(pt) + 0.42 * Math.sin(tilt),
    ];
    ['L', 'R'].forEach((side, i) => {
      let [a, e] = armsFK[i];
      if (hands) {
        const [ha, he] = twoBone(shoulder, hands[i], BONES.upperArm, BONES.forearm + 0.06, 1);
        a = ha - tilt;
        e = he;
      }
      j[`shoulder${side}`].rotation.set(a, 0, (i ? 1 : -1) * spread);
      j[`elbow${side}`].rotation.set(e, 0, 0);
      j[`wrist${side}`].rotation.set(wrists ? wrists[i] : hands ? -0.4 : 0, 0, 0);
    });

    this._tools(tool);
    // Held upright rather than along the forearm: undo the arm's lean so the pole
    // tips reach the ground a little behind the hands, and the axe is a cane.
    const lean = (side) => pt + sp + j[`shoulder${side}`].rotation.x + j[`elbow${side}`].rotation.x + j[`wrist${side}`].rotation.x;
    const fwd = this._fp ? 0.6 : 0; // tilted out ahead in first person, so you see them
    if (this.held.poles) {
      ['L', 'R'].forEach((side, i) => {
        const plant = mode === 'walk' && moving ? -0.3 + (i ? 1 : -1) * sw * 0.2 : mode === 'climb' ? 0.4 : -0.12;
        this.poles[i].rotation.set(plant + fwd - lean(side), 0, (i ? -1 : 1) * spread * 0.8);
      });
    }
    if (tool === 'axe' && !hands) {
      this.axe.rotation.set(-0.15 - lean('R'), 0, -spread * 0.8);
      if (this._fp) {
        // In first person: gripped by the shaft below the head, head leaning out ahead
        // and turned side-on, so the pick shows in profile above your mitt.
        this.axe.rotation.set(-0.5 - lean('R'), 1.2, 0, 'XYZ');
        _v.set(0, 0.22, 0).applyEuler(this.axe.rotation);
        this.axe.position.add(_v);
      }
    }
  }

  /** First person: hold what's in your hands up in front of you, where you can see it. */
  _fpArms(sw, arms) {
    if (this.held.poles) return [[1.4 - sw * 0.1, 0.35], [1.4 + sw * 0.1, 0.35]];
    if (this.held.axe) return [arms[0], [1.45 + sw * 0.06, 0.3]];
    return arms;
  }

  /** Simple forward-kinematics poses for sliding and scout flying. */
  _poseFK(mode, o = {}) {
    const j = this.joints;
    this.resetPose();
    if (mode === 'slide' && o.arrest) {
      // Self-arrest: chest down on the axe, pick by the right shoulder, left mitt
      // on the shaft by the hip, legs apart and toes digging in.
      const dig = Math.sin((o.time ?? 0) * 13) * 0.04;
      j.hipL.rotation.set(-0.1, 0, -0.22); j.kneeL.rotation.x = -0.35 + dig;
      j.hipR.rotation.set(-0.1, 0, 0.22); j.kneeR.rotation.x = -0.35 - dig;
      j.ankleL.rotation.x = 0.5; j.ankleR.rotation.x = 0.5;
      j.shoulderR.rotation.set(1.9, 0, 0.35); j.elbowR.rotation.x = 1.9;
      j.shoulderL.rotation.set(1.0, 0, 0.5); j.elbowL.rotation.x = 1.3;
      j.wristR.rotation.x = -0.6;
      j.spine.rotation.x = 0.1;
      j.head.rotation.x = 0.35;
    } else if (mode === 'slide') {
      // Sliding helpless: arms reaching up the slope, legs scrabbling.
      const t = o.time ?? 0;
      j.hipL.rotation.x = -0.15 + 0.25 * Math.sin(t * 8); j.kneeL.rotation.x = -0.6 - 0.35 * Math.sin(t * 8 + 1);
      j.hipR.rotation.x = -0.05 + 0.25 * Math.sin(t * 8 + Math.PI); j.kneeR.rotation.x = -0.6 - 0.35 * Math.sin(t * 8 + 1 + Math.PI);
      j.shoulderL.rotation.set(2.8 + 0.25 * Math.sin(t * 6.3), 0, -0.25 - 0.15 * Math.sin(t * 4.1)); j.elbowL.rotation.x = 0.4 + 0.3 * Math.sin(t * 5.2);
      j.shoulderR.rotation.set(2.7 + 0.25 * Math.sin(t * 5.7 + 2), 0, 0.25 + 0.15 * Math.sin(t * 3.7)); j.elbowR.rotation.x = 0.6 + 0.3 * Math.sin(t * 4.6 + 1);
      j.spine.rotation.x = 0.15;
      j.head.rotation.x = -0.3;
    } else {
      j.shoulderL.rotation.z = -0.12;
      j.shoulderR.rotation.z = 0.12;
    }
    this._tools('axe');
  }

  /** The axe is held by its head, shaft down, so on steep ground it plunges into
   * the slope; on fixed ropes it's stowed on the pack and the jumar comes out. */
  _tools(tool) {
    const j = this.joints;
    if (tool === 'axeSwing') {
      // Swinging: gripped near the spike, head out past the mitt, pick forward.
      this.axe.position.set(0, -0.6, 0);
      this.axe.rotation.set(Math.PI, 0, 0);
      tool = 'axe';
    } else {
      this.axe.position.set(0, 0.03, 0);
      this.axe.rotation.set(0, 0, 0);
    }
    this.axe.visible = tool === 'axe';
    this.stowedAxe.visible = tool !== 'axe';
    // Poles out in both hands, unless you're on the jumar.
    const poles = this.held.poles && tool !== 'jumar';
    for (const p of this.poles) {
      p.visible = poles;
      p.rotation.set(0, 0, 0);
    }
    this.stowedPoles.visible = this.held.stowedPoles || (this.held.poles && !poles);
    this.jumar.visible = tool === 'jumar';
    this.tether.visible = tool === 'jumar';
    if (this.tether.visible) {
      this.updateMatrixWorld(true);
      const a = new THREE.Vector3(0, 0.02, -0.15).applyMatrix4(j.pelvis.matrixWorld);
      const b = new THREE.Vector3(0, -0.04, 0).applyMatrix4(this.jumar.matrixWorld);
      const inv = this.matrixWorld.clone().invert();
      this.tether.geometry.setFromPoints([a.applyMatrix4(inv), b.applyMatrix4(inv)]);
    }
  }
}

/**
 * Two-bone IK in the sagittal plane. Points are [y, z]; angles are measured from
 * straight down, positive forward (-z). bend -1 bends the middle joint backward
 * (a knee), +1 forward (an elbow). Returns [first bone angle, middle joint angle].
 */
const _v = new THREE.Vector3();

function twoBone(root, target, l1, l2, bend) {
  const dy = target[0] - root[0];
  const dz = target[1] - root[1];
  const d = Math.min(Math.max(Math.hypot(dy, dz), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
  const phi = Math.atan2(-dz, -dy);
  const clamp1 = (x) => Math.min(Math.max(x, -1), 1);
  const b = Math.acos(clamp1((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const g = Math.acos(clamp1((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)));
  return [phi - bend * b, bend * (Math.PI - g)];
}
