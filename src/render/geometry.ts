import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export type Euler3 = readonly [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _x = new THREE.Vector3(1, 0, 0);
const _c = new THREE.Color();

/** Writes a flat colour into a geometry's `color` attribute (linear working space). */
export function paint(geo: THREE.BufferGeometry, color: number | THREE.Color): THREE.BufferGeometry {
  if (color instanceof THREE.Color) _c.copy(color); else _c.setHex(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Accumulates coloured primitives in world (or group-local) space and merges them into ONE
 * non-indexed geometry with position / normal / uv / color — one draw call on a vertex-coloured material.
 * Construction-time only (allocates freely).
 */
export class GeometryBuilder {
  private parts: THREE.BufferGeometry[] = [];

  get isEmpty(): boolean { return this.parts.length === 0; }

  /** Adds a geometry (consumed), painted with `color` unless it already has colours and color is null. */
  add(geo: THREE.BufferGeometry, color: number | THREE.Color | null, matrix?: THREE.Matrix4): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (color !== null || !g.getAttribute('color')) paint(g, color ?? 0xffffff);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();
    this.parts.push(g);
    return this;
  }

  private place(geo: THREE.BufferGeometry, x: number, y: number, z: number, color: number | THREE.Color, rot?: Euler3, scale?: Euler3): this {
    _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0);
    _q.setFromEuler(_e);
    _s.set(scale?.[0] ?? 1, scale?.[1] ?? 1, scale?.[2] ?? 1);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    return this.add(geo, color, _m);
  }

  /** Axis-aligned (then rotated) box centred at (x,y,z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number | THREE.Color, rot?: Euler3): this {
    return this.place(new THREE.BoxGeometry(w, h, d), x, y, z, color, rot);
  }

  roundedBox(w: number, h: number, d: number, radius: number, x: number, y: number, z: number, color: number | THREE.Color, rot?: Euler3): this {
    const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    return this.place(new RoundedBoxGeometry(w, h, d, 2, Math.max(r, 1e-3)), x, y, z, color, rot);
  }

  cylinder(rTop: number, rBottom: number, h: number, seg: number, x: number, y: number, z: number, color: number | THREE.Color, rot?: Euler3, open = false): this {
    return this.place(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open), x, y, z, color, rot);
  }

  sphere(r: number, x: number, y: number, z: number, color: number | THREE.Color, detail = 1, scale?: Euler3): this {
    return this.place(new THREE.IcosahedronGeometry(r, detail), x, y, z, color, undefined, scale);
  }

  cone(r: number, h: number, seg: number, x: number, y: number, z: number, color: number | THREE.Color, rot?: Euler3): this {
    return this.place(new THREE.ConeGeometry(r, h, seg), x, y, z, color, rot);
  }

  /** Rectangular-section beam from a to b. `w` across (horizontal), `h` vertical thickness. */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number, color: number | THREE.Color): this {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    if (len < 1e-4) return this;
    _dir.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_x, _dir);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    return this.add(new THREE.BoxGeometry(len, h, w), color, _m);
  }

  /** Round rod (cylinder) from a to b. */
  rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, seg: number, color: number | THREE.Color): this {
    _a.set(ax, ay, az); _b.set(bx, by, bz);
    _dir.subVectors(_b, _a);
    const len = _dir.length();
    if (len < 1e-4) return this;
    _dir.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_p.set(0, 1, 0), _dir);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1, true), color, _m);
  }

  /** Quad from 4 corners (counter-clockwise when seen from the front). */
  quad(p0: THREE.Vector3Like, p1: THREE.Vector3Like, p2: THREE.Vector3Like, p3: THREE.Vector3Like, color: number | THREE.Color, uv?: readonly number[]): this {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const u = uv ?? [0, 0, 1, 0, 1, 1, 0, 1];
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u[0], u[1], u[2], u[3], u[4], u[5], u[0], u[1], u[4], u[5], u[6], u[7]]), 2));
    g.computeVertexNormals();
    return this.add(g, color);
  }

  /** Merges everything added so far. The builder is emptied. */
  build(): THREE.BufferGeometry {
    if (!this.parts.length) throw new Error('GeometryBuilder.build: nothing to merge');
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('GeometryBuilder.build: incompatible parts');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/**
 * Box-projected world UVs: every vertex takes the two world axes perpendicular to its dominant normal axis.
 * `metres` = world size of one texture repeat. Faces facing -X/+Z get mirrored U so text-free textures
 * (ribs, grain) keep their orientation on all walls.
 */
export function boxProjectUVs(geo: THREE.BufferGeometry, metres: number): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const k = 1 / metres;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let u: number, v: number;
    if (ax >= ay && ax >= az) { u = nx > 0 ? -z : z; v = y; }
    else if (ay >= az) { u = x; v = z; }
    else { u = nz > 0 ? x : -x; v = y; }
    uv[i * 2] = u * k;
    uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Multiplies vertex colours by a per-vertex factor (e.g. height gradients, grime near the floor). */
export function shadeVertexColors(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number): void {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const f = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  col.needsUpdate = true;
}

/** Recursively disposes geometries and materials of a subtree (materials in `keep` are left alone). */
export function disposeObject(root: THREE.Object3D, keep?: ReadonlySet<THREE.Material>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const x of Array.isArray(mat) ? mat : [mat]) if (!keep?.has(x)) x.dispose();
  });
}
