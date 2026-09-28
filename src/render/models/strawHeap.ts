import * as THREE from 'three';
import { lumpify, Parts, rng } from './parts';

/**
 * Mini-heap of straw (belt items, carried hay, intake bundles): a lumpy orange-gold core covered by thin straws
 * lying across it and poking out, like the small straw balls riding the belts in the reference. Base at y = 0,
 * centred in X/Z, about 0.34 × 0.24 × 0.32 m. Built with Parts (vertex colours + solid atlas UVs) so it renders
 * with paletteMaterial() / modelMaterial(). ~200 triangles.
 */

const CORE = [0xb86c24, 0xc47a2a, 0xa9621f];
const STRAW = [0xd08a36, 0xe0a24c, 0xeebd6a, 0xa8662a, 0xc27a2c, 0x8f5620, 0xf2cd86];

/** Straw ribbon from a to b, width w, both windings (visible from any side). */
function ribbon(a: THREE.Vector3, b: THREE.Vector3, w: number, up: THREE.Vector3): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a).normalize();
  const side = new THREE.Vector3().crossVectors(d, up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize().multiplyScalar(w / 2);
  const p = [a.clone().add(side), a.clone().sub(side), b.clone().add(side.clone().multiplyScalar(0.6)), b.clone().sub(side.clone().multiplyScalar(0.6))];
  const n = new THREE.Vector3().crossVectors(side, d).normalize();
  if (n.dot(up) < 0) n.negate();
  const pos: number[] = [], nor: number[] = [];
  const quad = [0, 2, 1, 1, 2, 3];
  for (const i of quad) { pos.push(p[i].x, p[i].y, p[i].z); nor.push(n.x, n.y, n.z); }
  for (const i of [...quad].reverse()) { pos.push(p[i].x, p[i].y, p[i].z); nor.push(-n.x, -n.y, -n.z); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function strawHeapGeometry(variant = 0): THREE.BufferGeometry {
  const r = rng(101 + variant * 37);
  const p = new Parts();
  const sx = 1.05 + r() * 0.2, sy = 0.72 + r() * 0.12, sz = 0.92 + r() * 0.16;
  const R = 0.15;
  const core = lumpify(new THREE.IcosahedronGeometry(R, 1), 0.2, 7 + variant);
  core.scale(sx, sy, sz);
  core.translate(0, R * sy * 0.92, 0);
  p.add('matte', core, CORE[variant % CORE.length]);
  // a smaller lump on top/side so the silhouettes differ
  const lump = lumpify(new THREE.IcosahedronGeometry(0.075 + r() * 0.03, 0), 0.25, 13 + variant);
  const la = r() * Math.PI * 2;
  lump.translate(Math.cos(la) * 0.07, R * sy * 1.45, Math.sin(la) * 0.06);
  p.add('matte', lump, CORE[(variant + 1) % CORE.length]);
  // straws over the surface: start on the ellipsoid, run mostly tangentially, a few stick out
  const c = new THREE.Vector3(0, R * sy * 0.92, 0);
  const up = new THREE.Vector3();
  for (let i = 0; i < 34; i++) {
    const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 1.7); // skip the very bottom
    const n = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const a = new THREE.Vector3(n.x * R * sx, n.y * R * sy, n.z * R * sz).multiplyScalar(1.02).add(c);
    const t = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5);
    t.addScaledVector(n, -t.dot(n)).normalize();
    const out = r() < 0.12 ? 0.3 + r() * 0.3 : 0.03;
    const len = 0.08 + r() * 0.1;
    const b = a.clone().addScaledVector(t, len).addScaledVector(n, len * out);
    const a0 = a.clone().addScaledVector(t, -len * 0.35);
    up.copy(n);
    p.add('matte', ribbon(a0, b, 0.012 + r() * 0.008, up), STRAW[Math.floor(r() * STRAW.length)]);
  }
  const g = p.build().main!;
  // ambient-occlusion-ish: darker near the base, lighter on top
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const top = R * sy * 2;
  for (let i = 0; i < pos.count; i++) {
    const f = 0.72 + 0.4 * Math.min(1, Math.max(0, pos.getY(i) / top)) + (r() - 0.5) * 0.08;
    col.setXYZ(i, Math.min(1, col.getX(i) * f), Math.min(1, col.getY(i) * f), Math.min(1, col.getZ(i) * f));
  }
  g.computeBoundingSphere();
  return g;
}

/** Number of distinct mini-heap shapes used for belt items. */
export const STRAW_HEAP_VARIANTS = 3;
