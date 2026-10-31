// A procedural ragdoll for falls: the whole body tumbles with the fall's speed and
// direction, rolls when it scrapes along the ground, and the limbs flail loosely.
//
// It works with any climber model: it tumbles the model as a whole around its middle,
// and if the model lists its limb pivots in `model.limbs` (Object3D, hanging down at
// rest) they flail too.

import * as THREE from 'three';

const CENTRE = 0.9; // metres above the feet that the body tumbles around
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _centre = new THREE.Vector3();

export class Ragdoll {
  constructor(model) {
    this.model = model;
    this.active = false;
    this.spin = new THREE.Vector3(); // angular velocity, radians per second
    this.orientation = new THREE.Quaternion();
    this.targets = [];
    this.retarget = 0;
  }

  start() {
    this.active = true;
    this.orientation.copy(this.model.quaternion);
    this.spin.set(0, 0, 0);
    this.retarget = 0;
  }

  /**
   * @param position where the climber's feet are now (the body's lowest point)
   * @param velocity fall velocity, m/s
   * @param lying true once dead and still: the body settles flat
   */
  update(dt, position, velocity, lying = false) {
    if (!this.active) this.start();
    const speed = velocity.length();
    // Tumble about the horizontal axis across the direction of travel, faster when faster.
    _axis.set(velocity.z, 0, -velocity.x);
    if (_axis.lengthSq() > 1e-6 && !lying) {
      _axis.normalize().multiplyScalar(Math.min(speed / CENTRE, 14) * 0.6);
      this.spin.lerp(_axis, 1 - Math.exp(-dt * 3));
    } else {
      this.spin.multiplyScalar(Math.exp(-dt * 4));
    }
    const angle = this.spin.length() * dt;
    if (angle > 1e-5) {
      _q.setFromAxisAngle(_axis.copy(this.spin).normalize(), angle);
      this.orientation.premultiply(_q);
    }
    if (lying) {
      // Settle on the back, facing the sky.
      _q.setFromEuler(new THREE.Euler(-Math.PI / 2, this.model.rotation.y, 0, 'YXZ'));
      this.orientation.slerp(_q, 1 - Math.exp(-dt * 2));
    }
    this.model.quaternion.copy(this.orientation);
    // Keep the middle of the body above the ground point, whatever the rotation.
    _centre.set(0, CENTRE, 0).applyQuaternion(this.orientation);
    this.model.position.set(position.x, position.y + (lying ? 0.25 : CENTRE), position.z).sub(_centre);

    // Limbs flail toward new random angles a few times a second.
    const limbs = this.model.limbs ?? [];
    this.retarget -= dt;
    if (this.retarget <= 0 || this.targets.length !== limbs.length) {
      this.retarget = 0.15 + Math.random() * 0.25;
      const amp = lying ? 0.3 : Math.min(0.6 + speed * 0.12, 2.6);
      this.targets = limbs.map(() => [(Math.random() * 2 - 1) * amp, (Math.random() * 2 - 1) * amp * 0.6]);
    }
    limbs.forEach((limb, i) => {
      const k = 1 - Math.exp(-dt * (lying ? 3 : 10));
      limb.rotation.x += (this.targets[i][0] - limb.rotation.x) * k;
      limb.rotation.z += (this.targets[i][1] - limb.rotation.z) * k;
    });
  }

  /** Back on your feet: upright again, limbs straight. */
  stop() {
    if (!this.active) return;
    this.active = false;
    const yaw = new THREE.Euler().setFromQuaternion(this.model.quaternion, 'YXZ').y;
    this.model.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0));
    for (const limb of this.model.limbs ?? []) limb.rotation.z = 0;
  }
}
