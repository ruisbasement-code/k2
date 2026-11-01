// Other players on the mountain: a climber model for each, drawn from the state
// their game sends a few times a second (where the body is and how it's turned,
// the pose, what they carry and hold, their headlamp), eased between updates so
// they move smoothly. A name tag floats over each one.

import * as THREE from 'three';
import { ClimberModel } from '../player/climberModel.js';

/** How far a name tag can be read through the weather, at most (metres). */
const TAG_RANGE = 3000;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Teammates extends THREE.Group {
  /**
   * @param layer the element name tags go in (one is made if not given)
   */
  constructor(layer = null) {
    super();
    this.layer = layer ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mate-tags' }));
    /** id -> {id, name, model, state, tag, phase, phaseRate, at} */
    this.mates = new Map();
  }

  add(id, name) {
    if (this.mates.has(id)) return this.mates.get(id);
    const model = new ClimberModel();
    model.visible = false;
    super.add(model);
    const tag = document.createElement('div');
    tag.className = 'mate-tag';
    this.layer.appendChild(tag);
    const m = { id, name, model, state: null, tag, phase: 0, phaseRate: 0, lastPhase: null, lastAt: 0, shown: false, html: '' };
    this.mates.set(id, m);
    return m;
  }

  remove(id) {
    const m = this.mates.get(id);
    if (!m) return;
    super.remove(m.model);
    m.model.traverse((o) => o.geometry?.dispose?.());
    m.tag.remove();
    this.mates.delete(id);
  }

  get list() {
    return [...this.mates.values()];
  }

  /** A state message from a player's game. */
  receive(id, name, s) {
    const m = this.add(id, name);
    m.name = name;
    const now = performance.now() / 1000;
    // How fast their legs are cycling, so they keep walking between updates.
    const ph = s.pose?.phase ?? 0;
    if (m.lastPhase != null && now > m.lastAt) {
      const rate = (ph - m.lastPhase) / (now - m.lastAt);
      m.phaseRate = Math.abs(rate) < 40 ? rate : 0;
    }
    m.lastPhase = ph;
    m.lastAt = now;
    if (!m.state || Math.hypot(s.p[0] - m.model.position.x, s.p[1] - m.model.position.y, s.p[2] - m.model.position.z) > 20) {
      // First sight or a jump (a teleport, a rescue): put them there at once.
      m.model.position.fromArray(s.p);
      m.model.quaternion.fromArray(s.q);
      m.phase = ph;
    }
    m.state = s;
  }

  /**
   * Each frame: ease every teammate toward their last state, pose them, and put
   * their name tags over their heads.
   * @param camera for the name tags
   * @param visibility metres you can see in the weather here
   */
  update(dt, camera, visibility = 80000) {
    const k = 1 - Math.exp(-dt * 10);
    const w = innerWidth, h = innerHeight;
    for (const m of this.mates.values()) {
      const s = m.state;
      if (!s) continue;
      const model = m.model;
      model.visible = true;
      model.position.lerp(_v.fromArray(s.p), k);
      model.quaternion.slerp(_q.fromArray(s.q), k);
      const p = s.pose ?? { mode: 'walk', phase: 0, moving: false, rise: 0, stride: 1 };
      // Run the gait on locally, pulled back toward where their game says it is.
      m.phase += m.phaseRate * dt;
      m.phase += (p.phase - m.phase) * k * 0.3;
      model.held = { axe: !!s.held?.axe, poles: !!s.held?.poles, stowedPoles: !!s.held?.stowedPoles };
      model.setGear(s.look ?? {});
      model.pose(p.mode, m.phase, p.moving, p.rise, { dt, stride: p.stride, arrest: p.arrest, time: performance.now() / 1000 });
      if (model.axe) model.axe.visible = !!s.held?.axe;
      if (model.stowedAxe) model.stowedAxe.visible = !!s.axe && !s.held?.axe;
      model.setLamp(s.lamp ?? null);

      // The name tag, over the head.
      _v.copy(model.position);
      _v.y += 2.2;
      const dist = camera.position.distanceTo(_v);
      _v.project(camera);
      const show = _v.z < 1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2 && dist < Math.min(TAG_RANGE, Math.max(60, visibility * 1.5));
      if (show !== m.shown) {
        m.tag.style.display = show ? '' : 'none';
        m.shown = show;
      }
      if (!show) continue;
      m.tag.style.transform = `translate(${((_v.x + 1) / 2) * w}px, ${((1 - _v.y) / 2) * h}px) translate(-50%, -100%)`;
      const status = s.dead ? ' · dead' : s.collapsed != null ? ' · collapsed!' : '';
      const html = `${escapeHtml(m.name)}<small>${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`}${status}</small>`;
      if (html !== m.html) {
        m.tag.innerHTML = m.html = html;
        m.tag.classList.toggle('down', s.collapsed != null || !!s.dead);
      }
    }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
