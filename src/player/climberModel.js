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
      axe: mat(0x2b5fa8, { roughness: 0.4, metalness: 0.5 }),
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
    part(spine, new THREE.BoxGeometry(0.03, 0.44, 0.01), M.panel, 0, 0.26, -0.165); // front zip
    for (const s of [-1, 1]) part(spine, new THREE.BoxGeometry(0.04, 0.42, 0.012), M.harness, s * 0.1, 0.27, -0.16, 0, 0, s * 0.08); // pack shoulder straps
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
    this.stowedAxe = part(pack, new THREE.CylinderGeometry(0.013, 0.013, 0.62, 6), M.axe, 0.1, 0.02, 0.125, 0, 0, 0.05);
    part(this.stowedAxe, new THREE.BoxGeometry(0.26, 0.03, 0.02), M.metal, 0, -0.32, 0);

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
    // Head at the origin, shaft hanging along -y.
    part(this.axe, new THREE.CylinderGeometry(0.014, 0.014, 0.6, 6), M.axe, 0, -0.3, 0);
    part(this.axe, new THREE.BoxGeometry(0.03, 0.03, 0.28), M.metal, 0, 0, -0.04); // head and pick
    part(this.axe, new THREE.ConeGeometry(0.012, 0.06, 6), M.steel, 0, -0.63, 0, Math.PI); // spike
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

    this.bones = [
      ['pelvis', null, 0.1], ['spine', 'pelvis', BONES.spine], ['neck', 'spine', BONES.neck], ['head', 'neck', 0.24],
      ['shoulderL', 'spine', BONES.upperArm], ['elbowL', 'shoulderL', BONES.forearm], ['wristL', 'elbowL', 0.12],
      ['shoulderR', 'spine', BONES.upperArm], ['elbowR', 'shoulderR', BONES.forearm], ['wristR', 'elbowR', 0.12],
      ['hipL', 'pelvis', BONES.thigh], ['kneeL', 'hipL', BONES.shin], ['ankleL', 'kneeL', 0.1],
      ['hipR', 'pelvis', BONES.thigh], ['kneeR', 'hipR', BONES.shin], ['ankleR', 'kneeR', 0.1],
    ].map(([name, parent, length]) => ({ name, parent, length, joint: this.joints[name] }));
  }

  /** Hip and shoulder pivots, which the ragdoll flails during a tumble. */
  get limbs() {
    const j = this.joints;
    return [j.hipL, j.hipR, j.shoulderL, j.shoulderR];
  }

  /** Puts every joint back to standing straight. */
  resetPose() {
    for (const { joint } of this.bones) joint.rotation.set(0, 0, 0);
    this.joints.pelvis.position.set(0, BONES.pelvisHeight, 0);
  }

  /**
   * @param mode 'walk' | 'climb' | 'rope' | 'rest' | 'slide' | 'fly'
   * @param phase gait phase in radians
   * @param lean 0..1, how steep the ground ahead is
   */
  pose(mode, phase, moving, lean) {
    const j = this.joints;
    const sw = moving ? Math.sin(phase) : 0;
    const cw = moving ? Math.cos(phase) : 0;
    // [hip, knee] per leg and [shoulder, elbow] per arm; knees bend backward (negative).
    let legs, arms, spine = 0, pelvisTilt = 0, head = 0, spread = 0.12;
    let tool = 'axe';
    switch (mode) {
      case 'walk': {
        const lift = (c) => Math.max(0, c) * 0.55; // knee bends while the leg swings through
        legs = [[sw * 0.5 + 0.05, -0.12 - lift(cw)], [-sw * 0.5 + 0.05, -0.12 - lift(-cw)]];
        arms = [[-sw * 0.45 + 0.1, 0.35], [sw * 0.45 + 0.25, 0.5]];
        spine = -0.12 - 0.25 * lean;
        pelvisTilt = -0.05;
        head = 0.12 + 0.2 * lean;
        break;
      }
      case 'climb':
        // Facing into the slope: kicking crampons in, swinging the axe high.
        legs = [[0.75 + sw * 0.4, -0.9 - Math.max(0, sw) * 0.4], [0.75 - sw * 0.4, -0.9 - Math.max(0, -sw) * 0.4]];
        arms = [[1.9 - sw * 0.5, 0.5], [2.4 + sw * 0.5, 0.35]];
        spine = -0.35;
        pelvisTilt = -0.2;
        head = 0.45;
        spread = 0.2;
        break;
      case 'rope':
        // Left mitt high on the jumar, right hand on the rope below, stepping up.
        legs = [[0.55 + sw * 0.35, -0.75 - Math.max(0, sw) * 0.35], [0.55 - sw * 0.35, -0.75 - Math.max(0, -sw) * 0.35]];
        arms = [[2.5 + sw * 0.2, 0.25 + Math.max(0, -sw) * 0.4], [0.9, 0.9]];
        spine = -0.3;
        pelvisTilt = -0.15;
        head = 0.4;
        tool = 'jumar';
        break;
      case 'slide':
        // Face-down against the slope, arms up digging the axe in, feet kicking.
        legs = [[-0.15, -0.5], [-0.05, -0.7]];
        arms = [[2.9, 0.4], [2.7, 0.6]];
        spine = 0.15;
        head = -0.3;
        spread = 0.25;
        break;
      case 'rest': {
        // Bent over, hands on knees, back heaving with each breath.
        const breath = Math.sin(phase) * 0.05;
        legs = [[0.45, -0.55], [0.45, -0.55]];
        arms = [[0.9, -0.05], [0.9, -0.05]];
        spine = -0.75 - breath;
        pelvisTilt = -0.15;
        head = 0.7;
        spread = 0.16;
        break;
      }
      default:
        legs = [[0, 0], [0, 0]];
        arms = [[0, 0.1], [0, 0.1]];
    }
    const sides = ['L', 'R'];
    sides.forEach((side, i) => {
      const [hip, knee] = legs[i];
      j[`hip${side}`].rotation.set(hip, 0, 0);
      j[`knee${side}`].rotation.set(knee, 0, 0);
      j[`ankle${side}`].rotation.set(-(hip + knee + pelvisTilt) * 0.85, 0, 0); // keep soles roughly level
      const [shoulder, elbow] = arms[i];
      const s = i ? 1 : -1;
      j[`shoulder${side}`].rotation.set(shoulder, 0, s * spread);
      j[`elbow${side}`].rotation.set(elbow, 0, 0);
      j[`wrist${side}`].rotation.set(0, 0, 0);
    });
    j.pelvis.rotation.set(pelvisTilt, 0, moving && mode === 'walk' ? sw * 0.05 : 0);
    j.spine.rotation.set(spine, moving && mode === 'walk' ? -sw * 0.08 : 0, 0);
    j.neck.rotation.set(head * 0.4, 0, 0);
    j.head.rotation.set(head * 0.6, 0, 0);

    // Drop the pelvis so the lower foot rests on the ground.
    const drop = Math.max(...legs.map(([h, k]) =>
      BONES.thigh * Math.cos(h + pelvisTilt) + BONES.shin * Math.cos(h + k + pelvisTilt)));
    const bob = moving && mode === 'walk' ? Math.abs(cw) * 0.02 : 0;
    j.pelvis.position.y = mode === 'slide' ? BONES.pelvisHeight : drop + BONES.ankleHeight + 0.02 + 0.01 + bob;

    // Walking, the axe is held by its head like a cane; climbing, by the shaft
    // with the pick reaching up into the slope.
    if (mode === 'climb') {
      this.axe.position.set(0, -0.62, 0);
      this.axe.rotation.set(0, 0, Math.PI);
    } else {
      this.axe.position.set(0, 0.03, 0);
      this.axe.rotation.set(0, 0, 0);
    }
    this.axe.visible = tool === 'axe';
    this.stowedAxe.visible = tool !== 'axe';
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
