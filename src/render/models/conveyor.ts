import * as THREE from 'three';
import { BH, C, LEVEL_H } from './kit';
import { Parts, shade } from './parts';

/**
 * Conveyor tile geometry (shared by BeltView instancing, the conveyor / ramp models and the build ghost).
 *
 * Tile frame: origin = centre of the tile footprint on the floor of its level, travel along local +X.
 *   straight  1 cell, x ∈ [-0.5, 0.5]
 *   curveL    fed from the local LEFT (-Z) edge, exits +X   (anim.curve = -1): quarter arc around (+0.5, -0.5)
 *   curveR    fed from the local RIGHT (+Z) edge, exits +X  (anim.curve = +1): quarter arc around (+0.5, +0.5)
 *   ramp      3 cells, x ∈ [-1.5, 1.5], rises one level (belt at BH at -X, LEVEL_H + BH at +X)
 *   rampDown  3 cells, falls one level (belt at LEVEL_H + BH at -X, BH at +X)
 *   legs      support legs for a level-1 tile: from -LEVEL_H (floor below) up to the frame (belt = empty)
 * Belt surface sits exactly at WORLD.beltHeight. Belt UVs: u = 0..1 across the belt (left→right of travel),
 * v = distance along the path in TILES (straight 0..1, curves 0..π/4, ramps 0..3) and increases in the
 * travel direction, so scrolling the texture by `time × belt.speed` matches item speed. The frame carries
 * vertex colours + atlas UVs (works with paletteMaterial() and modelMaterial()).
 */

export type ConveyorGeometryKind = 'straight' | 'curveL' | 'curveR' | 'ramp' | 'rampDown' | 'legs';

const HALF_W = 0.4;
const RAIL = C.logistics;
const RAIL_DK = shade(C.logistics, 0.62);
const BED = 0x2b2f33;
const LEG = C.frame;

interface Sample { p: THREE.Vector3; t: THREE.Vector3; l: THREE.Vector3; u: THREE.Vector3; v: number }

function finishSamples(pts: THREE.Vector3[], vs: number[], lateral?: (i: number) => THREE.Vector3): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(b, a).normalize();
    const l = lateral ? lateral(i) : new THREE.Vector3(-t.z, 0, t.x).normalize();
    const u = new THREE.Vector3().crossVectors(l, t).normalize();
    out.push({ p: pts[i], t, l, u, v: vs[i] });
  }
  return out;
}

function straightSamples(): Sample[] {
  return finishSamples([new THREE.Vector3(-0.5, BH, 0), new THREE.Vector3(0.5, BH, 0)], [0, 1]);
}

function curveSamples(side: -1 | 1, n = 10): Sample[] {
  // side -1: fed from -Z (curveL), +1: fed from +Z (curveR)
  const pts: THREE.Vector3[] = [];
  const vs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector3(0.5 - 0.5 * Math.cos(f), BH, side * 0.5 - side * 0.5 * Math.sin(f)));
    vs.push((i / n) * (Math.PI / 4));
  }
  return finishSamples(pts, vs);
}

/** Smoothed linear rise over [-1.25, 1.25] (kneed ends), 0..1. */
function rampProfile(x: number): number {
  const a = -1.25, b = 1.25, w = 0.45, k = 12;
  let s = 0;
  for (let i = 0; i < k; i++) {
    const xx = x - w / 2 + (w * (i + 0.5)) / k;
    s += Math.max(0, Math.min(1, (xx - a) / (b - a)));
  }
  return s / k;
}

/** Belt surface height (model space) of a ramp tile at local x. */
export function rampBeltY(x: number, down: boolean): number {
  return BH + LEVEL_H * rampProfile(down ? -x : x);
}

function rampSamples(down: boolean, n = 24): Sample[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const x = -1.5 + (3 * i) / n;
    const f = rampProfile(down ? -x : x);
    pts.push(new THREE.Vector3(x, BH + LEVEL_H * f, 0));
  }
  const vs: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { total += pts[i].distanceTo(pts[i - 1]); vs.push(total); }
  for (let i = 0; i < vs.length; i++) vs[i] = (vs[i] / total) * 3;
  return finishSamples(pts, vs, () => new THREE.Vector3(0, 0, 1));
}

/** Belt ribbon (top surface) along the samples. */
function beltRibbon(s: Sample[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const { p, l, u, v } = s[i];
    for (const [side, uu] of [[-1, 0], [1, 1]] as const) {
      pos.push(p.x + l.x * HALF_W * side, p.y + l.y * HALF_W * side, p.z + l.z * HALF_W * side);
      nor.push(u.x, u.y, u.z);
      uv.push(uu, v);
      col.push(1, 1, 1);
    }
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  // make sure the winding faces the belt normal
  const n = new THREE.Vector3();
  const pa = new THREE.Vector3(pos[0], pos[1], pos[2]), pb = new THREE.Vector3(pos[3], pos[4], pos[5]), pc = new THREE.Vector3(pos[6], pos[7], pos[8]);
  n.crossVectors(pb.clone().sub(pa), pc.clone().sub(pa));
  if (n.dot(s[0].u) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    g.setIndex(idx);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Sweeps a closed 2D profile (lateral, up) — listed counter-clockwise when seen looking along the travel
 * direction with lateral to the right — along the samples. Each profile edge gets its own vertices
 * (crisp edges), smooth along the path. End caps are flat polygons.
 */
function sweep(s: Sample[], prof: readonly (readonly [number, number])[], caps = true): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const at = (i: number, k: number): number[] => {
    const { p, l, u } = s[i];
    const [a, b] = prof[k];
    return [p.x + l.x * a + u.x * b, p.y + l.y * a + u.y * b, p.z + l.z * a + u.z * b];
  };
  const m = prof.length;
  for (let k = 0; k < m; k++) {
    const k2 = (k + 1) % m;
    const base = pos.length / 3;
    for (let i = 0; i < s.length; i++) { pos.push(...at(i, k), ...at(i, k2)); }
    for (let i = 0; i < s.length - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (caps) {
    for (const i of [0, s.length - 1]) {
      const base = pos.length / 3;
      for (let k = 0; k < m; k++) pos.push(...at(i, k));
      for (let k = 1; k < m - 1; k++) idx.push(base, base + k, base + k + 1);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = g.toNonIndexed();
  // orient every triangle outward from the local path centre so winding is always right
  const P = g.getAttribute('position') as THREE.BufferAttribute;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3();
  const pc = profCentre(prof);
  for (let t = 0; t < P.count; t += 3) {
    va.fromBufferAttribute(P, t); vb.fromBufferAttribute(P, t + 1); vc.fromBufferAttribute(P, t + 2);
    n.crossVectors(vb.clone().sub(va), vc.clone().sub(va));
    const mid = va.clone().add(vb).add(vc).multiplyScalar(1 / 3);
    // nearest sample → local profile centre
    let best = 0, bd = Infinity;
    for (let i = 0; i < s.length; i++) { const d = s[i].p.distanceToSquared(mid); if (d < bd) { bd = d; best = i; } }
    const S = s[best];
    cen.copy(S.p).addScaledVector(S.l, pc[0]).addScaledVector(S.u, pc[1]);
    let out = mid.clone().sub(cen);
    // cap triangles: use the path tangent
    const isCap = Math.abs(n.clone().normalize().dot(S.t)) > 0.95;
    if (isCap) out = S.t.clone().multiplyScalar(best === 0 ? -1 : 1);
    if (n.dot(out) < 0) { P.setXYZ(t + 1, vc.x, vc.y, vc.z); P.setXYZ(t + 2, vb.x, vb.y, vb.z); }
  }
  g.computeVertexNormals();
  return g;
}

function profCentre(prof: readonly (readonly [number, number])[]): [number, number] {
  let a = 0, b = 0;
  for (const [x, y] of prof) { a += x; b += y; }
  return [a / prof.length, b / prof.length];
}

const box2 = (l0: number, l1: number, u0: number, u1: number): [number, number][] => [[l0, u0], [l1, u0], [l1, u1], [l0, u1]];

/** Frame parts common to every belt path: side rails with a lip, the bed under the belt and edge trims. */
function frameAlong(p: Parts, s: Sample[]): void {
  for (const side of [-1, 1]) {
    const l0 = side * (HALF_W + 0.005), l1 = side * (HALF_W + 0.075);
    p.add('paint', sweep(s, box2(Math.min(l0, l1), Math.max(l0, l1), -0.2, 0.055)), RAIL);
    // dark inner lip strip (reads as the channel's return)
    const i0 = side * (HALF_W - 0.02), i1 = side * (HALF_W + 0.006);
    p.add('metal', sweep(s, box2(Math.min(i0, i1), Math.max(i0, i1), 0.035, 0.055)), RAIL_DK);
  }
  p.add('matte', sweep(s, box2(-HALF_W, HALF_W, -0.14, -0.012)), BED);
}

function legPair(p: Parts, x: number, z: number, lat: [number, number], yTop: number, yBot = 0): void {
  const [lx, lz] = lat;
  for (const s of [-1, 1]) {
    const px = x + lx * s * 0.36, pz = z + lz * s * 0.36;
    p.box('metal', [0.06, yTop - yBot, 0.06], LEG, { pos: [px, (yTop + yBot) / 2, pz] });
    p.box('matte', [0.14, 0.03, 0.14], C.black, { pos: [px, yBot + 0.015, pz] });
  }
  p.rod('metal', [x - lx * 0.4, yTop - 0.03, z - lz * 0.4], [x + lx * 0.4, yTop - 0.03, z + lz * 0.4], 0.03, LEG, 4);
  p.rod('metal', [x - lx * 0.36, 0.08, z - lz * 0.36], [x + lx * 0.36, yTop - 0.08, z + lz * 0.36], 0.014, LEG, 4);
}

function buildFrame(kind: ConveyorGeometryKind): THREE.BufferGeometry {
  const p = new Parts();
  if (kind === 'legs') {
    const y0 = -LEVEL_H, y1 = BH - 0.2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.box('metal', [0.07, y1 - y0, 0.07], LEG, { pos: [sx * 0.3, (y0 + y1) / 2, sz * 0.4] });
      p.box('matte', [0.16, 0.03, 0.16], C.black, { pos: [sx * 0.3, y0 + 0.015, sz * 0.4] });
    }
    for (const sz of [-1, 1]) {
      p.rod('metal', [-0.3, y0 + 0.2, sz * 0.4], [0.3, y1 - 0.2, sz * 0.4], 0.02, LEG, 5);
      p.box('metal', [0.66, 0.06, 0.06], LEG, { pos: [0, y1 - 0.03, sz * 0.4] });
    }
    for (const sx of [-1, 1]) p.box('metal', [0.06, 0.06, 0.86], LEG, { pos: [sx * 0.3, y1 - 0.03, 0] });
    return p.build().main!;
  }
  let s: Sample[];
  if (kind === 'straight') s = straightSamples();
  else if (kind === 'curveL') s = curveSamples(-1);
  else if (kind === 'curveR') s = curveSamples(1);
  else s = rampSamples(kind === 'rampDown');
  frameAlong(p, s);
  if (kind === 'straight') {
    legPair(p, 0, 0, [0, 1], BH - 0.2);
    for (const x of [-0.5, 0.5]) p.cyl('metal', 0.045, 0.045, 0.8, C.steelLight, { pos: [x * 0.94, BH - 0.06, 0] }, 8, 'z');
    for (const sz of [-1, 1]) p.bolts([-0.35, BH - 0.07, sz * (HALF_W + 0.078)], [0.35, BH - 0.07, sz * (HALF_W + 0.078)], 3, [0, 0, sz], 0.016);
  } else if (kind === 'curveL' || kind === 'curveR') {
    const mid = s[Math.floor(s.length / 2)];
    legPair(p, mid.p.x, mid.p.z, [mid.l.x, mid.l.z], BH - 0.2);
  } else {
    // ramp supports: pairs of posts under the frame, cross-braced
    for (const x of [-1.2, -0.4, 0.4, 1.2]) {
      let i = 0;
      while (i < s.length - 1 && s[i].p.x < x) i++;
      const yTop = s[i].p.y - 0.2;
      for (const sz of [-1, 1]) {
        p.box('metal', [0.08, yTop, 0.08], LEG, { pos: [x, yTop / 2, sz * 0.42] });
        p.box('matte', [0.18, 0.03, 0.18], C.black, { pos: [x, 0.015, sz * 0.42] });
      }
      if (yTop > 0.6) {
        p.box('metal', [0.06, 0.06, 0.9], LEG, { pos: [x, Math.min(yTop - 0.05, 0.5), 0] });
        p.rod('metal', [x, 0.25, -0.42], [x, yTop - 0.1, 0.42], 0.018, LEG, 5);
      }
    }
    // end rollers
    p.cyl('metal', 0.05, 0.05, 0.82, C.steelLight, { pos: [s[0].p.x + 0.04, s[0].p.y - 0.06, 0] }, 8, 'z');
    const e = s[s.length - 1];
    p.cyl('metal', 0.05, 0.05, 0.82, C.steelLight, { pos: [e.p.x - 0.04, e.p.y - 0.06, 0] }, 8, 'z');
  }
  return p.build().main!;
}

function buildBelt(kind: ConveyorGeometryKind): THREE.BufferGeometry {
  if (kind === 'legs') {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([], 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    return g;
  }
  if (kind === 'straight') return beltRibbon(straightSamples());
  if (kind === 'curveL') return beltRibbon(curveSamples(-1, 12));
  if (kind === 'curveR') return beltRibbon(curveSamples(1, 12));
  return beltRibbon(rampSamples(kind === 'rampDown', 36));
}

/** Fresh frame + belt geometries for a tile kind (caller owns them). */
export function buildConveyorGeometry(kind: ConveyorGeometryKind): { frame: THREE.BufferGeometry; belt: THREE.BufferGeometry } {
  return { frame: buildFrame(kind), belt: buildBelt(kind) };
}
