import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { paintGeometry } from '../palette';
import { region, regionCentre, type RegionName, type SolidName } from './atlas';

/**
 * Geometry toolkit for the procedural models.
 *
 * A `Parts` collects small primitive geometries, bakes their colour into the vertex `color` attribute,
 * points their UVs into the decal atlas (plain parts sample a solid block, decals their label region),
 * transforms them into model / bone space and finally merges everything into ONE opaque geometry
 * (+ one glass geometry when used). Surface finish per part comes from the channel:
 *   paint  = painted steel/plastic      metal  = bare steel        chrome = polished (MK2, needles)
 *   matte  = rubber / fabric / hay      decal  = atlas label (needs uv)   glass = transparent panes
 *   glow*  = self-lit block (bulbs, screens, fire)
 * A rigged `Parts` additionally writes skinIndex/skinWeight so all moving pieces of a machine render as
 * one SkinnedMesh (parts are authored in their bone's LOCAL frame).
 */

export type V3 = readonly [number, number, number];
export type GlowChannel = 'glowWarm' | 'glowCyan' | 'glowRed' | 'glowGreen' | 'glowFire' | 'glowWhite' | 'glowAmber';
export type Channel = 'paint' | 'metal' | 'chrome' | 'matte' | 'decal' | 'glass' | GlowChannel;

const SOLID_OF: Record<Exclude<Channel, 'decal' | 'glass'>, SolidName> = {
  paint: 'solidPaint', metal: 'solidMetal', chrome: 'solidChrome', matte: 'solidMatte',
  glowWarm: 'glowWarm', glowCyan: 'glowCyan', glowRed: 'glowRed', glowGreen: 'glowGreen',
  glowFire: 'glowFire', glowWhite: 'glowWhite', glowAmber: 'glowAmber',
};

export interface Xf {
  pos?: V3;
  /** Euler angles (radians, XYZ order). Ignored when `normal` is given. */
  rot?: V3;
  scale?: V3 | number;
  /** Orient the part so its local +Z points along `normal` and local +Y along `up` (default +Y or +X). */
  normal?: V3;
  up?: V3;
  /** Bone index for rigged builders (default 0). */
  bone?: number;
}

export type ColorLike = number | THREE.Color;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();

export function xfMatrix(xf: Xf | undefined, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  if (!xf) return out;
  const sc = xf.scale;
  if (sc === undefined) _s.set(1, 1, 1);
  else if (typeof sc === 'number') _s.set(sc, sc, sc);
  else _s.set(sc[0], sc[1], sc[2]);
  if (xf.normal) {
    _bz.set(xf.normal[0], xf.normal[1], xf.normal[2]).normalize();
    const up = xf.up ?? (Math.abs(_bz.y) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    _by.set(up[0], up[1], up[2]);
    _by.addScaledVector(_bz, -_by.dot(_bz)).normalize();
    _bx.crossVectors(_by, _bz);
    out.makeBasis(_bx, _by, _bz);
    _q.setFromRotationMatrix(out);
  } else if (xf.rot) {
    _q.setFromEuler(_e.set(xf.rot[0], xf.rot[1], xf.rot[2]));
  } else {
    _q.identity();
  }
  _p.set(xf.pos?.[0] ?? 0, xf.pos?.[1] ?? 0, xf.pos?.[2] ?? 0);
  return out.compose(_p, _q, _s);
}

/** Converts a non-indexed geometry into an indexed one (sequential index) so all parts can be merged. */
function ensureIndexed(g: THREE.BufferGeometry): void {
  if (g.index) return;
  const n = g.getAttribute('position').count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
}

/** Reverses triangle winding (and normals) — used for inner walls of hollow shapes and mirrored parts. */
export function flipFaces(g: THREE.BufferGeometry): THREE.BufferGeometry {
  ensureIndexed(g);
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  const n = g.getAttribute('normal');
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

const KEEP = new Set(['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight']);

/** Multiplies vertex colours by a factor that fades from `min` at y0 to 1 at y0+height (fake contact AO). */
export function groundShade(g: THREE.BufferGeometry, y0: number, height: number, min: number): void {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  if (!col) return;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.smoothstep(pos.getY(i), y0, y0 + height);
    const f = min + (1 - min) * t;
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
}

/** Colour helpers (all derived from the shared palette so the art stays coherent). */
export function shade(color: number, f: number): number {
  const c = new THREE.Color(color);
  c.r = Math.min(1, c.r * f); c.g = Math.min(1, c.g * f); c.b = Math.min(1, c.b * f);
  return c.getHex();
}
export function mix(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

// ---------------------------------------------------------------------------------------------
// Primitive geometries
// ---------------------------------------------------------------------------------------------

/** Flat-shaded polyhedron from convex polygons (each polygon's winding is fixed to face `outward`). */
export function polyhedron(polys: number[][][], centre?: V3): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let cx = 0, cy = 0, cz = 0;
  if (centre) { [cx, cy, cz] = centre; } else {
    let n = 0;
    for (const p of polys) for (const v of p) { cx += v[0]; cy += v[1]; cz += v[2]; n++; }
    cx /= n; cy /= n; cz /= n;
  }
  for (const pts of polys) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let mx = 0, my = 0, mz = 0;
    for (const v of pts) { mx += v[0]; my += v[1]; mz += v[2]; }
    mx /= pts.length; my /= pts.length; mz /= pts.length;
    const outward = nx * (mx - cx) + ny * (my - cy) + nz * (mz - cz) >= 0;
    const ordered = outward ? pts : [...pts].reverse();
    if (!outward) { nx = -nx; ny = -ny; nz = -nz; }
    const len = Math.hypot(nx, ny, nz) || 1;
    const base = pos.length / 3;
    for (const v of ordered) { pos.push(v[0], v[1], v[2]); nor.push(nx / len, ny / len, nz / len); }
    for (let i = 1; i < ordered.length - 1; i++) idx.push(base, base + i, base + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Box with 45° chamfered edges and flat normals (44 triangles). Crisp bevel highlights for the stylised
 * low-poly look at a fraction of a RoundedBoxGeometry's cost.
 */
export function chamferBox(w: number, h: number, d: number, bevel: number): THREE.BufferGeometry {
  const he = [w / 2, h / 2, d / 2];
  const b = Math.max(0.0005, Math.min(bevel, he[0] * 0.95, he[1] * 0.95, he[2] * 0.95));
  const corner = (s: number[], push: number): number[] => {
    const p = [s[0] * (he[0] - b), s[1] * (he[1] - b), s[2] * (he[2] - b)];
    p[push] = s[push] * he[push];
    return p;
  };
  const polys: number[][][] = [];
  const S = [-1, 1];
  for (let a = 0; a < 3; a++) {
    const b1 = (a + 1) % 3, b2 = (a + 2) % 3;
    for (const s of S) {
      const pts: number[][] = [];
      for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const sg = [0, 0, 0]; sg[a] = s; sg[b1] = p; sg[b2] = q;
        pts.push(corner(sg, a));
      }
      polys.push(pts);
    }
  }
  for (let a = 0; a < 3; a++) {
    const bAx = (a + 1) % 3, cAx = (a + 2) % 3;
    for (const sa of S) for (const sb of S) {
      const sg0 = [0, 0, 0]; sg0[a] = sa; sg0[bAx] = sb; sg0[cAx] = -1;
      const sg1 = [0, 0, 0]; sg1[a] = sa; sg1[bAx] = sb; sg1[cAx] = 1;
      polys.push([corner(sg0, a), corner(sg1, a), corner(sg1, bAx), corner(sg0, bAx)]);
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S) {
    const sg = [sx, sy, sz];
    polys.push([corner(sg, 0), corner(sg, 1), corner(sg, 2)]);
  }
  return polyhedron(polys, [0, 0, 0]);
}

/**
 * Tapered box (frustum) from a bottom rectangle to a top rectangle, both centred on the Y axis, with an
 * optional top offset along X/Z. Base at y=0. Flat shaded. Funnels, chutes, hoods, roofs.
 */
export function taperBox(wb: number, db: number, wt: number, dt: number, h: number, offX = 0, offZ = 0): THREE.BufferGeometry {
  const b = [[-wb / 2, 0, -db / 2], [wb / 2, 0, -db / 2], [wb / 2, 0, db / 2], [-wb / 2, 0, db / 2]];
  const t = [[-wt / 2 + offX, h, -dt / 2 + offZ], [wt / 2 + offX, h, -dt / 2 + offZ], [wt / 2 + offX, h, dt / 2 + offZ], [-wt / 2 + offX, h, dt / 2 + offZ]];
  const polys = [b, t];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; polys.push([b[i], b[j], t[j], t[i]]); }
  return polyhedron(polys, [offX / 2, h / 2, offZ / 2]);
}

/** Right-angle wedge: full height at -X, zero at +X (ramps, chute lips, stair stringers). Base at y=0. */
export function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const polys = [
    [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]],
    [[x0, 0, z0], [x0, h, z0], [x0, h, z1], [x0, 0, z1]],
    [[x0, h, z0], [x1, 0, z0], [x1, 0, z1], [x0, h, z1]],
    [[x0, 0, z0], [x1, 0, z0], [x0, h, z0]],
    [[x0, 0, z1], [x1, 0, z1], [x0, h, z1]],
  ];
  return polyhedron(polys, [x0 + w / 3, h / 3, 0]);
}

/** Extruded 2D outline (XY plane) along +Z by `depth`, centred on Z. Flat caps, no bevel. */
export function prism(outline: readonly (readonly [number, number])[], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.deleteAttribute('uv');
  return g;
}

/**
 * Tube along a polyline (Catmull-Rom smoothed), open ends. Used for hoses, pipes, handrails and twine.
 */
export function tubeAlong(points: readonly V3[], radius: number, radial = 6, smooth = 0.2, segsPerSpan = 4): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', smooth);
  const g = new THREE.TubeGeometry(curve, Math.max(2, (points.length - 1) * segsPerSpan), radius, radial, false);
  g.deleteAttribute('uv');
  return g;
}

/** Plane quad (facing +Z) with UVs mapped into an atlas rect [u0,v0]-[u1,v1]. */
export function atlasQuad(w: number, h: number, u0: number, v0: number, u1: number, v1: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  return g;
}

/**
 * Planar-maps a geometry's XZ extent into an atlas region (e.g. straw on hay surfaces).
 * `tiles` < 1 samples a sub-rect so large surfaces keep a sensible strand size.
 */
export function mapPlanarXZ(g: THREE.BufferGeometry, name: RegionName, tiles = 1): THREE.BufferGeometry {
  const r = region(name);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = Math.max(1e-6, bb.max.x - bb.min.x), sz = Math.max(1e-6, bb.max.z - bb.min.z);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const span = Math.min(1, tiles);
  for (let i = 0; i < pos.count; i++) {
    const u = (pos.getX(i) - bb.min.x) / sx, v = (pos.getZ(i) - bb.min.z) / sz;
    uv[i * 2] = r.u0 + (r.u1 - r.u0) * u * span;
    uv[i * 2 + 1] = r.v0 + (r.v1 - r.v0) * v * span;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Deterministic pseudo-random generator for cosmetic jitter baked into geometry. */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Pushes vertices radially by deterministic noise (organic hay lumps). Keeps shared vertices together. */
export function lumpify(g: THREE.BufferGeometry, amount: number, seed: number, minY = -Infinity): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const r = rng(seed);
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y <= minY) continue;
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f = cache.get(key);
    if (f === undefined) { f = 1 + (r() - 0.5) * 2 * amount; cache.set(key, f); }
    pos.setXYZ(i, x * f, y * (1 + (f - 1) * 0.6), z * f);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

interface Pending { g: THREE.BufferGeometry; bone: number }
export interface BuiltParts { main?: THREE.BufferGeometry; glass?: THREE.BufferGeometry }

export class Parts {
  private readonly opaque: Pending[] = [];
  private readonly glassList: Pending[] = [];

  constructor(readonly rigged = false) {}

  /** Adds an arbitrary geometry (consumed: it is transformed in place and disposed after merging). */
  add(ch: Channel, geo: THREE.BufferGeometry, color: ColorLike | null, xf?: Xf): void {
    const g = geo;
    ensureIndexed(g);
    for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (ch === 'decal') {
      if (!g.getAttribute('uv')) throw new Error('decal parts need uv');
    } else if (ch === 'glass') {
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
    } else {
      const [u, v] = regionCentre(SOLID_OF[ch]);
      const n = g.getAttribute('position').count;
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = u; uv[i * 2 + 1] = v; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (color !== null || !g.getAttribute('color')) paintGeometry(g, color ?? 0xffffff);
    xfMatrix(xf, _m);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) flipFaces(g);
    (ch === 'glass' ? this.glassList : this.opaque).push({ g, bone: xf?.bone ?? 0 });
  }

  box(ch: Channel, size: V3, color: ColorLike, xf?: Xf): void {
    this.add(ch, new THREE.BoxGeometry(size[0], size[1], size[2]), color, xf);
  }

  /** Chamfered box (see chamferBox). */
  bev(ch: Channel, size: V3, bevel: number, color: ColorLike, xf?: Xf): void {
    this.add(ch, chamferBox(size[0], size[1], size[2], bevel), color, xf);
  }

  /** Smoothly rounded box (RoundedBoxGeometry) for soft hero shapes. */
  round(ch: Channel, size: V3, radius: number, color: ColorLike, xf?: Xf, segments = 2): void {
    this.add(ch, new RoundedBoxGeometry(size[0], size[1], size[2], segments, radius), color, xf);
  }

  /** Cylinder / cone frustum. `axis` = the cylinder's long axis before `xf` is applied. */
  cyl(ch: Channel, rTop: number, rBot: number, h: number, color: ColorLike, xf?: Xf, seg = 12, axis: 'x' | 'y' | 'z' = 'y', open = false): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    this.add(ch, g, color, xf);
  }

  sphere(ch: Channel, r: number, color: ColorLike, xf?: Xf, ws = 10, hs = 6, thetaLen = Math.PI): void {
    this.add(ch, new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen), color, xf);
  }

  /** Torus in the XY plane (axis +Z) before `xf`. */
  torus(ch: Channel, R: number, r: number, color: ColorLike, xf?: Xf, radial = 6, tubular = 16, arc = Math.PI * 2): void {
    this.add(ch, new THREE.TorusGeometry(R, r, radial, tubular, arc), color, xf);
  }

  tube(ch: Channel, points: readonly V3[], radius: number, color: ColorLike, radial = 6, bone = 0, smooth = 0.2): void {
    this.add(ch, tubeAlong(points, radius, radial, smooth), color, { bone });
  }

  /**
   * Hollow open-top frustum (funnels, bins, chutes): outer walls, inner walls (visible from above), a flat
   * rim of thickness `t` and an inner floor. Base at y=0 before `xf`.
   */
  shell(ch: Channel, color: ColorLike, wb: number, db: number, wt: number, dt: number, h: number, t: number, xf?: Xf, innerColor?: ColorLike, floor = true): void {
    const side = (w0: number, d0: number, w1: number, d1: number, y0: number, y1: number): number[][][] => {
      const b = [[-w0 / 2, y0, -d0 / 2], [w0 / 2, y0, -d0 / 2], [w0 / 2, y0, d0 / 2], [-w0 / 2, y0, d0 / 2]];
      const u = [[-w1 / 2, y1, -d1 / 2], [w1 / 2, y1, -d1 / 2], [w1 / 2, y1, d1 / 2], [-w1 / 2, y1, d1 / 2]];
      const out: number[][][] = [];
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; out.push([b[i], b[j], u[j], u[i]]); }
      return out;
    };
    this.add(ch, polyhedron([...side(wb, db, wt, dt, 0, h), [[-wb / 2, 0, -db / 2], [wb / 2, 0, -db / 2], [wb / 2, 0, db / 2], [-wb / 2, 0, db / 2]]], [0, h / 2, 0]), color, xf);
    const iw0 = wb - t * 2, id0 = db - t * 2, iw1 = wt - t * 2, id1 = dt - t * 2;
    this.add(ch, flipFaces(polyhedron(side(iw0, id0, iw1, id1, t, h), [0, h / 2, 0])), innerColor ?? color, xf);
    const rim: number[][][] = [];
    const o = [[-wt / 2, -dt / 2], [wt / 2, -dt / 2], [wt / 2, dt / 2], [-wt / 2, dt / 2]];
    const inn = [[-iw1 / 2, -id1 / 2], [iw1 / 2, -id1 / 2], [iw1 / 2, id1 / 2], [-iw1 / 2, id1 / 2]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      rim.push([[o[i][0], h, o[i][1]], [o[j][0], h, o[j][1]], [inn[j][0], h, inn[j][1]], [inn[i][0], h, inn[i][1]]]);
    }
    this.add(ch, polyhedron(rim, [0, h - 1, 0]), color, xf);
    if (floor) {
      this.add(ch, polyhedron([[[-iw0 / 2, t, -id0 / 2], [iw0 / 2, t, -id0 / 2], [iw0 / 2, t, id0 / 2], [-iw0 / 2, t, id0 / 2]]], [0, t - 1, 0]), innerColor ?? color, xf);
    }
  }

  /** Straight rod between two points (pipes, struts, rails). */
  rod(ch: Channel, a: V3, b: V3, r: number, color: ColorLike, seg = 6, bone = 0): void {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    g.rotateX(Math.PI / 2); // axis -> +Z
    this.add(ch, g, color, { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], normal: [dx, dy, dz], bone });
  }

  /** Hexagonal bolt head: axis along `normal` (default +Y). */
  bolt(pos: V3, normal: V3 = [0, 1, 0], r = 0.025, color: ColorLike = 0xb9c0c4, bone = 0): void {
    const g = new THREE.CylinderGeometry(r, r, r * 0.8, 6);
    g.rotateX(Math.PI / 2); // axis -> +Z so `normal` orientation applies
    g.translate(0, 0, r * 0.4);
    this.add('metal', g, color, { pos, normal, bone });
  }

  /** Row of bolts from a to b (inclusive). */
  bolts(a: V3, b: V3, n: number, normal: V3 = [0, 1, 0], r = 0.022, color: ColorLike = 0xb9c0c4, bone = 0): void {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      this.bolt([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], normal, r, color, bone);
    }
  }

  /** Atlas decal quad. `xf.normal` = facing direction (default +Z), `xf.up` = text/arrow up. */
  decal(name: RegionName, w: number, h: number, xf: Xf, tint: ColorLike = 0xffffff, uvSpan?: [number, number]): void {
    const r = region(name);
    const u0 = uvSpan ? r.u0 + (r.u1 - r.u0) * uvSpan[0] : r.u0;
    const u1 = uvSpan ? r.u0 + (r.u1 - r.u0) * uvSpan[1] : r.u1;
    this.add('decal', atlasQuad(w, h, u0, r.v0, u1, r.v1), tint, xf);
  }

  /**
   * Hazard stripe band of length `len` and height `h` keeping 45° stripes (splits into several quads when
   * the band is longer than the atlas strip). Oriented like `decal`: local X = along the band.
   */
  hazard(len: number, h: number, xf: Xf, name: RegionName = 'hazard'): void {
    const r = region(name);
    const periodsInRegion = r.w / r.h; // one stripe period per region height
    const periods = len / h;
    const pieces = Math.max(1, Math.ceil(periods / periodsInRegion));
    const pieceLen = len / pieces;
    const span = Math.min(1, (pieceLen / h) / periodsInRegion);
    const base = xfMatrix(xf, new THREE.Matrix4());
    for (let i = 0; i < pieces; i++) {
      const g = atlasQuad(pieceLen, h, r.u0, r.v0, r.u0 + (r.u1 - r.u0) * span, r.v1);
      g.translate(-len / 2 + pieceLen * (i + 0.5), 0, 0);
      g.applyMatrix4(base);
      this.add('decal', g, 0xffffff, { bone: xf.bone });
    }
  }

  get isEmpty(): boolean { return this.opaque.length === 0 && this.glassList.length === 0; }

  /** Merge into one opaque (+ one glass) geometry. Parts are disposed. */
  build(): BuiltParts {
    const out: BuiltParts = {};
    const opaque = this.merge(this.opaque, true);
    if (opaque) out.main = opaque;
    const glass = this.merge(this.glassList, false);
    if (glass) out.glass = glass;
    return out;
  }

  private merge(list: Pending[], withUv: boolean): THREE.BufferGeometry | undefined {
    if (list.length === 0) return undefined;
    for (const { g, bone } of list) {
      const n = g.getAttribute('position').count;
      if (withUv && !g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      if (!withUv && g.getAttribute('uv')) g.deleteAttribute('uv');
      if (!g.getAttribute('color')) paintGeometry(g, 0xffffff);
      if (this.rigged && !g.getAttribute('skinIndex')) {
        const si = new Uint16Array(n * 4);
        const sw = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      }
    }
    const merged = mergeGeometries(list.map((p) => p.g), false);
    if (!merged) throw new Error('model part merge failed (attribute mismatch)');
    for (const p of list) p.g.dispose();
    list.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Triangle count of a geometry (indexed or not). */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
