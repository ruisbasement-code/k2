// Grey-box climber: an orange down suit with a pack, posed for walking, climbing,
// jumaring a fixed rope and resting.

import * as THREE from 'three';

export class ClimberModel extends THREE.Group {
  constructor() {
    super();
    const suit = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.8 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x2d5d9f, roughness: 0.8 });
    const goggles = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.6 });
    const part = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.hips = new THREE.Group();
    this.hips.position.y = 0.85;
    this.add(this.hips);
    part(this.hips, new THREE.CapsuleGeometry(0.25, 0.35, 6, 12), suit, 0, 0.32, 0);
    part(this.hips, new THREE.SphereGeometry(0.16, 16, 12), dark, 0, 0.83, 0);
    part(this.hips, new THREE.BoxGeometry(0.22, 0.07, 0.06), goggles, 0, 0.85, -0.14);
    part(this.hips, new THREE.BoxGeometry(0.4, 0.55, 0.24), pack, 0, 0.4, 0.27);
    this.legs = [];
    this.arms = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(0.11 * s, 0.85, 0);
      part(leg, new THREE.CapsuleGeometry(0.1, 0.6, 4, 8), dark, 0, -0.4, 0);
      this.add(leg);
      this.legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(0.31 * s, 0.57, 0);
      part(arm, new THREE.CapsuleGeometry(0.08, 0.46, 4, 8), suit, 0, -0.3, 0);
      this.hips.add(arm);
      this.arms.push(arm);
    }
  }

  /** Limb pivots, for the ragdoll. */
  get limbs() {
    return [...this.legs, ...this.arms];
  }

  /**
   * @param mode 'walk' | 'climb' | 'rope' | 'rest' | 'slide' | 'fly'
   * @param phase gait phase in radians
   * @param lean 0..1, how steep the ground ahead is
   */
  pose(mode, phase, moving, lean) {
    const sw = moving ? Math.sin(phase) : 0;
    const set = (pair, a, b) => { pair[0].rotation.x = a; pair[1].rotation.x = b; };
    // Positive x rotation swings a limb forward (the climber faces -z).
    switch (mode) {
      case 'walk':
        this.hips.rotation.x = -0.25 * lean;
        set(this.legs, sw * 0.55, -sw * 0.55);
        set(this.arms, -sw * 0.6, sw * 0.6);
        break;
      case 'climb':
        // Facing into the slope, swinging the axe and kicking crampons in.
        this.hips.rotation.x = -0.45;
        set(this.legs, 0.5 + sw * 0.45, 0.5 - sw * 0.45);
        set(this.arms, 2.2 + sw * 0.6, 1.0 - sw * 0.6);
        break;
      case 'rope':
        // Left hand up on the jumar, right arm on the rope below it.
        this.hips.rotation.x = -0.35;
        set(this.legs, 0.3 + sw * 0.4, 0.3 - sw * 0.4);
        set(this.arms, 2.6 + sw * 0.25, 1.3);
        break;
      case 'slide':
        // Face-down against the slope, arms up digging in, feet kicking.
        this.hips.rotation.x = -1.25;
        set(this.legs, -0.3, -0.5);
        set(this.arms, 2.9, 2.6);
        break;
      case 'rest':
        // Bent over, hands on knees, catching your breath.
        this.hips.rotation.x = -0.75 - Math.sin(phase) * 0.04;
        set(this.legs, 0.25, 0.25);
        set(this.arms, 0.35, 0.35);
        break;
      default:
        this.hips.rotation.x = 0;
        set(this.legs, 0, 0);
        set(this.arms, 0, 0);
    }
  }
}
