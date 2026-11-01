// Shared pieces for drawing rope and the metal it hangs from: a tube that follows
// a line of points exactly, a braided-sheath texture, and small instanced parts
// (carabiners, pitons, pickets, ice screws, knots) built from simple shapes.

import * as THREE from 'three';

const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _prevT = new THREE.Vector3();
const _axis = new THREE.Vector3();

/**
 * A tube of the given radius through points (THREE.Vector3[]), with u along its
 * length in metres / uScale and v around it, so a repeating texture keeps its size
 * however long the rope is. The frames are carried along the line (parallel
 * transport) so the tube never twists.
 */
export function tubeAlong(points, radius, radial = 6, uScale = 1) {
  const n = points.length;
  const pos = new Float32Array(n * (radial + 1) * 3);
  const nor = new Float32Array(n * (radial + 1) * 3);
  const uv = new Float32Array(n * (radial + 1) * 2);
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, n - 1)];
    _t.subVectors(b, a).normalize();
    if (i === 0) {
      // Any normal at right angles to the first tangent.
      _n.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.9) _n.set(1, 0, 0);
      _n.addScaledVector(_t, -_n.dot(_t)).normalize();
    } else {
      // Turn the last normal by the turn of the tangent.
      _axis.crossVectors(_prevT, _t);
      const s = _axis.length();
      if (s > 1e-6) {
        _axis.divideScalar(s);
        _n.applyAxisAngle(_axis, Math.atan2(s, _prevT.dot(_t)));
      }
      _n.addScaledVector(_t, -_n.dot(_t)).normalize();
      along += points[i].distanceTo(points[i - 1]);
    }
    _prevT.copy(_t);
    _b.crossVectors(_t, _n);
    const p = points[i];
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const c = Math.cos(ang), sn = Math.sin(ang);
      const k = (i * (radial + 1) + j);
      const nx = _n.x * c + _b.x * sn, ny = _n.y * c + _b.y * sn, nz = _n.z * c + _b.z * sn;
      pos[k * 3] = p.x + nx * radius;
      pos[k * 3 + 1] = p.y + ny * radius;
      pos[k * 3 + 2] = p.z + nz * radius;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      uv[k * 2] = along / uScale;
      uv[k * 2 + 1] = j / radial;
    }
  }
  const index = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The woven sheath of a kernmantle rope: diagonal strands in the rope's colour
 * with a fleck of a second colour, mipmapped so from a distance it averages out to
 * a plain, slightly darker line rather than shimmering.
 */
export function braidTexture(base, fleck, wear = 0) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const g = c.getContext('2d');
  const col = new THREE.Color(base);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, 64, 32);
  // Strands spiralling both ways round the core.
  for (let k = -4; k < 8; k++) {
    for (const dir of [1, -1]) {
      g.strokeStyle = dir > 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.10)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(k * 8, dir > 0 ? 0 : 32);
      g.lineTo(k * 8 + 32, dir > 0 ? 32 : 0);
      g.stroke();
    }
  }
  // A tracer strand of a second colour.
  if (fleck !== undefined) {
    g.strokeStyle = `#${new THREE.Color(fleck).getHexString()}`;
    g.lineWidth = 2.5;
    for (const x0 of [0, 64]) {
      g.beginPath();
      g.moveTo(x0 - 16, 0);
      g.lineTo(x0 + 16, 32);
      g.stroke();
    }
  }
  // Old rope: bleached patches and fuzz.
  if (wear > 0) {
    for (let i = 0; i < 160 * wear; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,250,235' : '40,35,30'},${0.08 + 0.12 * Math.random()})`;
      g.fillRect(Math.random() * 64, Math.random() * 32, 1 + 3 * Math.random(), 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Rope material: matte nylon with the braid. */
export function ropeMaterial(base, fleck, wear = 0) {
  return new THREE.MeshStandardMaterial({ map: braidTexture(base, fleck, wear), roughness: 0.85 + 0.15 * wear, metalness: 0 });
}

const metal = (color, rough = 0.35) => new THREE.MeshStandardMaterial({ color, metalness: 0.8, roughness: rough });

/** Each part as {geo, mat}, built once and shared. Origin where it meets the surface or the rope. */
export const Parts = {
  // A carabiner: an oval ring, its long axis along +y.
  carabiner: () => ({
    geo: new THREE.TorusGeometry(0.04, 0.006, 5, 14).scale(0.62, 1, 1),
    mat: metal(0xb9bec4, 0.3),
  }),
  // A piton: a flat steel blade, mostly in the crack, its eye sticking out along +y.
  piton: () => {
    const blade = new THREE.BoxGeometry(0.03, 0.11, 0.006).translate(0, -0.035, 0);
    const eye = new THREE.TorusGeometry(0.018, 0.005, 4, 10).translate(0, 0.035, 0);
    return { geo: merge([blade, eye]), mat: metal(0x7d7f80, 0.55) };
  },
  // An old piton, rusted.
  rustyPiton: () => {
    const blade = new THREE.BoxGeometry(0.028, 0.1, 0.006).translate(0, -0.03, 0);
    const eye = new THREE.TorusGeometry(0.017, 0.005, 4, 10).translate(0, 0.035, 0);
    return { geo: merge([blade, eye]), mat: new THREE.MeshStandardMaterial({ color: 0x6a4630, metalness: 0.3, roughness: 0.9 }) };
  },
  // A snow picket: an aluminium angle stake, top along +y, with a hole near the top.
  picket: () => {
    const a = new THREE.BoxGeometry(0.045, 0.6, 0.004).translate(0, -0.18, 0.02);
    const b = new THREE.BoxGeometry(0.004, 0.6, 0.045).translate(0.02, -0.18, 0);
    return { geo: merge([a, b]), mat: metal(0xc9ced4, 0.4) };
  },
  // An ice screw: a threaded tube along +y with a hanger at the head.
  screw: () => {
    const tube = new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8).translate(0, -0.05, 0);
    const head = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8).translate(0, 0.035, 0);
    const hanger = new THREE.TorusGeometry(0.016, 0.004, 4, 10).translate(0, 0.06, 0);
    return { geo: merge([tube, head, hanger]), mat: metal(0xa9b2bd, 0.3) };
  },
  // A knot: a lump of rope (coloured per instance).
  knot: () => ({
    geo: new THREE.SphereGeometry(1, 7, 5).scale(0.035, 0.028, 0.055),
    mat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
  }),
};

/** Merge simple non-indexed-compatible geometries into one. */
export function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
