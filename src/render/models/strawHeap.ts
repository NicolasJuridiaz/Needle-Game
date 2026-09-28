import * as THREE from 'three';

/**
 * Straw mini-heap: a small pile made ONLY of straw sticks leaning and lying on each other (no core blob). Used for
 * hay on belts, ramps and splitters, the SELL HAY bundles and the hay held in the hands / on tools. Base at y = 0,
 * centred in X/Z. One merged geometry per variant (vertex colours, flat facets), drawn instanced by the callers, so
 * a belt full of hay is still one draw call per variant.
 *
 * Each stick is a thin 3-sided prism (6 triangles + no caps): straight, 0.12-0.30 m long, 7-13 mm thick, with a
 * darker underside and a lit top edge so single straws read at arm's length. Sticks are stacked in layers: the
 * bottom layer lies flat and radial, upper layers cross it at steeper angles, so the silhouette is a loose, messy
 * cone of straws.
 */

export interface StrawHeapOptions {
  /** Footprint radius (m). */
  radius?: number;
  /** Heap height (m). */
  height?: number;
  /** Number of sticks. */
  sticks?: number;
  /** Stick length range (m). */
  len?: [number, number];
  /** Stick thickness range (m). */
  thick?: [number, number];
}

/** Straw colours (sRGB): pale straw, gold, amber, a few brown / greyed stems. */
const STRAW = [0xe8c070, 0xd9a64d, 0xc98f3a, 0xf0d18a, 0xb97b30, 0xa36a2a, 0xdcb462, 0x8e6a3c];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _c = new THREE.Color();

export function strawHeapGeometry(variant = 0, o: StrawHeapOptions = {}): THREE.BufferGeometry {
  const r = rng(0x5eed + variant * 7919);
  const R = (o.radius ?? 0.17) * (0.9 + r() * 0.2);
  const H = (o.height ?? 0.25) * (0.85 + r() * 0.3);
  const N = o.sticks ?? 64;
  const [l0, l1] = o.len ?? [0.1, 0.25];
  const [t0, t1] = o.thick ?? [0.011, 0.019];
  // slightly off-centre, squashed heap so the variants differ in silhouette
  const sx = 0.8 + r() * 0.45, sz = 0.8 + r() * 0.45, ox = (r() - 0.5) * 0.25 * R, oz = (r() - 0.5) * 0.25 * R;
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const push = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); col.push(c.r, c.g, c.b); };

  for (let i = 0; i < N; i++) {
    const layer = i / N; // 0 = bottom layer, 1 = top
    // position on a cone: lower sticks spread wide, upper sticks near the top
    const rr = R * (1 - 0.75 * layer) * Math.pow(r(), 0.7);
    const th = r() * Math.PI * 2;
    const cx = ox + Math.cos(th) * rr * sx, cz = oz + Math.sin(th) * rr * sz;
    const cone = 1 - Math.min(1, Math.hypot(cx / sx, cz / sz) / R);
    const cy = H * (0.08 + 0.9 * cone * (0.45 + 0.55 * layer)) * (0.85 + r() * 0.3);
    // direction: mostly radial-ish and flat at the bottom, steeper and random on top; resting on the heap slope
    const yaw = layer < 0.35 ? th + (r() - 0.5) * 1.2 : r() * Math.PI * 2;
    const inward = th + Math.PI + (r() - 0.5) * 0.8; // teepee sticks point at the heap axis
    // a third of the sticks lean inwards and up like a teepee: that is what gives the heap its volume
    const lean = r() < 0.34 ? 0.55 + r() * 0.5 : 0;
    const pitch = lean > 0 ? lean : (r() - 0.5) * (0.35 + 1.1 * layer) + (layer > 0.6 && r() < 0.35 ? (r() < 0.5 ? 1 : -1) * 0.6 : 0);
    const dy = lean > 0 ? inward : yaw;
    _d.set(Math.cos(dy) * Math.cos(pitch), Math.sin(pitch), Math.sin(dy) * Math.cos(pitch)).normalize();
    const len = l0 + r() * (l1 - l0);
    _a.set(cx, cy, cz).addScaledVector(_d, -len / 2);
    _b.set(cx, cy, cz).addScaledVector(_d, len / 2);
    if (_a.y < 0.004) _a.y = 0.004;
    if (_b.y < 0.004) _b.y = 0.004;
    _d.subVectors(_b, _a).normalize();
    // prism frame: u = horizontal side, v = up-ish
    _u.set(-_d.z, 0, _d.x);
    if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0);
    _u.normalize();
    _v.crossVectors(_d, _u).normalize();
    if (_v.y < 0) { _v.negate(); _u.negate(); }
    const w = (t0 + r() * (t1 - t0)) / 2;
    const base = new THREE.Color(STRAW[Math.floor(r() * STRAW.length)]).multiplyScalar(0.9 + r() * 0.18);
    // 3 edges of the prism around the axis: top, lower-left, lower-right
    const ang = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3];
    const shade = [1.12, 0.78, 0.9];
    for (let k = 0; k < 3; k++) {
      const a0 = ang[k], a1 = ang[(k + 1) % 3], am = (a0 + a1 + (k === 2 ? Math.PI * 2 : 0)) / 2;
      const e0 = new THREE.Vector3().addScaledVector(_u, Math.cos(a0) * w).addScaledVector(_v, Math.sin(a0) * w);
      const e1 = new THREE.Vector3().addScaledVector(_u, Math.cos(a1) * w).addScaledVector(_v, Math.sin(a1) * w);
      _n.set(0, 0, 0).addScaledVector(_u, Math.cos(am)).addScaledVector(_v, Math.sin(am)).normalize();
      // face lighting baked a little (top faces brighter) + base-of-heap darkening (contact shadow)
      const ao = 0.55 + 0.45 * Math.min(1, ((_a.y + _b.y) / 2) / (H * 0.7));
      _c.copy(base).multiplyScalar(shade[k] * ao);
      const p0 = _a.clone().add(e0), p1 = _b.clone().add(e0), p2 = _b.clone().add(e1), p3 = _a.clone().add(e1);
      // outward winding
      const fn = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
      if (fn.dot(_n) >= 0) { push(p0, _n, _c); push(p1, _n, _c); push(p2, _n, _c); push(p0, _n, _c); push(p2, _n, _c); push(p3, _n, _c); }
      else { push(p0, _n, _c); push(p2, _n, _c); push(p1, _n, _c); push(p0, _n, _c); push(p3, _n, _c); push(p2, _n, _c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** Number of distinct mini-heap shapes used for belt items. */
export const STRAW_HEAP_VARIANTS = 5;

/**
 * Hay mound inside machines (rake / arm trays, hoppers, generator fuel, wheelbarrow, chute top): same stick-pile
 * look, authored in a 1 × 1 footprint of height `h` like the old kit `hayMound`, so callers keep their transforms.
 */
export function strawMound(h: number, seed: number): THREE.BufferGeometry {
  return strawHeapGeometry(seed, { radius: 0.5, height: h, sticks: 80, len: [0.28, 0.55], thick: [0.03, 0.05] });
}
