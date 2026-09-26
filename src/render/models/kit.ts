import * as THREE from 'three';
import { BUILDABLES } from '../../config/buildables';
import { WORLD } from '../../config/world';
import { portDefsOf } from '../../sim/grid';
import type { BuildingType, Dir, PortDef } from '../../sim/types';
import { DIR_DX, DIR_DZ } from '../../sim/types';
import { COLORS } from '../palette';
import type { RegionName } from './atlas';
import { mapPlanarXZ, rng, shade, taperBox, type Channel, type Parts, type V3 } from './parts';
import type { LampSpec } from './statusLamp';

/**
 * Shared machine "kit": the recurring pieces that make every machine read as part of one product line —
 * port intakes and spouts (always exactly on the sim's port cells at belt height), skids, lamp masts,
 * name plates, railings. All functions draw in MODEL space (origin = footprint centre on the floor, +X fwd).
 */

export const BH = WORLD.beltHeight;
export const LEVEL_H = WORLD.levelHeight;

export const C = {
  steel: COLORS.steel,
  steelDark: COLORS.steelDark,
  steelLight: 0x8a949a,
  frame: 0x3f474c,
  black: COLORS.black,
  rubber: COLORS.rubber,
  white: COLORS.white,
  bolt: 0xb9c0c4,
  hay: COLORS.hay,
  hayLight: COLORS.hayLight,
  hayDark: COLORS.hayDark,
  copper: COLORS.copper,
  gold: COLORS.gold,
  extraction: COLORS.extraction,
  logistics: COLORS.logistics,
  detection: COLORS.detection,
  processing: COLORS.processing,
  storage: COLORS.storage,
  power: COLORS.power,
  factory: COLORS.factory,
  hole: 0x121314,
  portIn: 0x2f5f8c,
  portOut: 0x3f8a3a,
} as const;

/** Footprint size of a building type. */
export function footprint(type: BuildingType): [number, number] {
  return BUILDABLES[type].footprint;
}

/** Local centre (x, z) of footprint cell (i, j). */
export function cellCentre(w: number, d: number, i: number, j: number): [number, number] {
  return [i + 0.5 - w / 2, j + 0.5 - d / 2];
}

/** Face point (centre of the cell edge in direction `dir`) and outward normal. */
export function portFace(w: number, d: number, cell: readonly [number, number], dir: Dir): { x: number; z: number; nx: number; nz: number } {
  const [cx, cz] = cellCentre(w, d, cell[0], cell[1]);
  const nx = DIR_DX[dir], nz = DIR_DZ[dir];
  return { x: cx + nx * 0.5, z: cz + nz * 0.5, nx, nz };
}

/** Transform helper: point in a port-local frame (x = tangent, y = up, z = outward, z=0 on the face). */
function faceXf(f: { x: number; z: number; nx: number; nz: number }, lx: number, ly: number, lz: number, levelY: number): V3 {
  // tangent = up × normal  (matches Parts' normal/up basis so decals read left-to-right from outside)
  const tx = f.nz, tz = -f.nx;
  return [f.x + tx * lx + f.nx * lz, levelY + ly, f.z + tz * lx + f.nz * lz];
}

export interface PortStyle {
  /** Frame colour of the intake / spout housing. */
  accent: number;
  /** Extra depth (m) of the housing into the machine (covers gaps to a recessed body wall). */
  depth?: number;
  /** Draw the IN / OUT label plate. */
  label?: boolean;
  /** Bone for rigged builders. */
  bone?: number;
}

/**
 * Intake mouth for an IN port: framed dark opening at belt height with rubber flap curtain and an IN
 * plate. Occupies z ∈ [-(0.2+depth), 0] in the port-local frame (never outside the footprint).
 */
export function intake(p: Parts, w: number, d: number, cell: readonly [number, number], dir: Dir, style: PortStyle, levelY = 0): void {
  const f = portFace(w, d, cell, dir);
  const n: V3 = [f.nx, 0, f.nz];
  const dep = 0.2 + (style.depth ?? 0);
  const bone = style.bone ?? 0;
  const at = (lx: number, ly: number, lz: number): V3 => faceXf(f, lx, ly, lz, levelY);
  const frame = style.accent;
  // housing shell (back + top + sides) — reads as a chunky port module
  p.bev('paint', [0.18, 0.78, dep], 0.03, frame, { pos: at(-0.45, BH + 0.3, -dep / 2), normal: n, bone });
  p.bev('paint', [0.18, 0.78, dep], 0.03, frame, { pos: at(0.45, BH + 0.3, -dep / 2), normal: n, bone });
  p.bev('paint', [1.04, 0.16, dep + 0.02], 0.035, frame, { pos: at(0, BH + 0.66, -dep / 2 - 0.01), normal: n, bone });
  // dark throat + back wall
  p.box('matte', [0.74, 0.58, 0.04], C.hole, { pos: at(0, BH + 0.28, -dep + 0.03), normal: n, bone });
  p.box('matte', [0.74, 0.02, dep - 0.02], shade(C.hole, 1.6), { pos: at(0, BH + 0.575, -dep / 2), normal: n, bone });
  // steel sill flush with the belt surface
  p.bev('metal', [0.9, 0.05, dep + 0.02], 0.012, C.steelLight, { pos: at(0, BH - 0.03, -dep / 2 - 0.01), normal: n, bone });
  // rubber flap curtain
  for (let k = 0; k < 5; k++) {
    p.box('matte', [0.135, 0.36, 0.012], k % 2 ? 0x2c2c2c : 0x242424, { pos: at(-0.29 + k * 0.145, BH + 0.37, -0.05), normal: n, bone });
  }
  p.bolts(at(-0.45, BH + 0.62, 0.0), at(-0.45, BH + 0.02, 0.0), 3, n, 0.018, C.bolt, bone);
  p.bolts(at(0.45, BH + 0.62, 0.0), at(0.45, BH + 0.02, 0.0), 3, n, 0.018, C.bolt, bone);
  if (style.label !== false) p.decal('in', 0.34, 0.17, { pos: at(0, BH + 0.66, 0.002), normal: n, bone });
}

/**
 * Output spout for an OUT port: hooded chute with a sloped steel tray ending flush with the footprint edge
 * at belt height, green OUT plate and an arrow on the tray.
 */
export function spout(p: Parts, w: number, d: number, cell: readonly [number, number], dir: Dir, style: PortStyle, levelY = 0): void {
  const f = portFace(w, d, cell, dir);
  const n: V3 = [f.nx, 0, f.nz];
  const dep = 0.3 + (style.depth ?? 0);
  const bone = style.bone ?? 0;
  const at = (lx: number, ly: number, lz: number): V3 => faceXf(f, lx, ly, lz, levelY);
  // hood
  p.bev('paint', [0.96, 0.2, dep], 0.04, style.accent, { pos: at(0, BH + 0.66, -dep / 2), normal: n, bone });
  p.bev('paint', [0.12, 0.62, dep], 0.03, style.accent, { pos: at(-0.42, BH + 0.3, -dep / 2), normal: n, bone });
  p.bev('paint', [0.12, 0.62, dep], 0.03, style.accent, { pos: at(0.42, BH + 0.3, -dep / 2), normal: n, bone });
  p.box('matte', [0.72, 0.56, 0.04], C.hole, { pos: at(0, BH + 0.3, -dep + 0.03), normal: n, bone });
  // sloped tray: from BH+0.1 at the back to BH+0.015 at the face
  const tray = taperBox(0.74, dep, 0.74, dep, 0.04);
  tray.rotateX(0.3 * (0.1 / dep));
  p.add('metal', tray, C.steelLight, { pos: at(0, BH - 0.01, -dep / 2), normal: n, bone });
  p.box('metal', [0.72, 0.06, 0.06], shade(C.steelLight, 0.8), { pos: at(0, BH - 0.02, -0.035), normal: n, bone });
  p.decal('chevron', 0.3, 0.3, { pos: at(0, BH + 0.04, -dep * 0.45), normal: [0, 1, 0], up: [f.nx, 0, f.nz], bone }, 0x9dff8a);
  if (style.label !== false) p.decal('out', 0.34, 0.17, { pos: at(0, BH + 0.66, 0.002), normal: n, bone });
}

/** Draws every port of a type (variant) with the machine's accent colour. `skip` filters ports. */
export function ports(p: Parts, type: BuildingType, variant: string | undefined, style: PortStyle, skip?: (pd: PortDef, index: number) => boolean): void {
  const def = BUILDABLES[type];
  const [w, d] = def.footprint;
  portDefsOf(def, variant).forEach((pd, index) => {
    if (skip?.(pd, index)) return;
    const y = (pd.levelOffset ?? 0) * LEVEL_H;
    if (pd.kind === 'in') intake(p, w, d, pd.cell, pd.dir, style, y);
    else spout(p, w, d, pd.cell, pd.dir, style, y);
  });
}

/** Chunky base skid (footprint inset by `inset`), with chamfered top, dark feet and corner bolts. */
export function skid(p: Parts, w: number, d: number, opts: { h?: number; inset?: number; color?: number; hazard?: boolean } = {}): void {
  const h = opts.h ?? 0.14;
  const ins = opts.inset ?? 0.06;
  const col = opts.color ?? C.frame;
  const sw = w - ins * 2, sd = d - ins * 2;
  p.bev('metal', [sw, h, sd], 0.03, col, { pos: [0, h / 2, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.box('matte', [0.2, 0.04, 0.2], C.black, { pos: [sx * (sw / 2 - 0.12), 0.02, sz * (sd / 2 - 0.12)] });
    p.bolt([sx * (sw / 2 - 0.1), h, sz * (sd / 2 - 0.1)], [0, 1, 0], 0.024);
  }
  if (opts.hazard) {
    for (const s of [-1, 1]) {
      p.hazard(sw - 0.1, h * 0.55, { pos: [0, h * 0.5, s * (sd / 2 + 0.002)], normal: [0, 0, s] });
      p.hazard(sd - 0.1, h * 0.55, { pos: [s * (sw / 2 + 0.002), h * 0.5, 0], normal: [s, 0, 0] });
    }
  }
}

/** Short lamp mast with a protective cage; returns the lamp spec for the bulb on top. */
export function lampMast(p: Parts, base: V3, height: number, opts: { size?: number; beacon?: boolean; color?: number } = {}): LampSpec {
  const r = opts.size ?? 0.085;
  const col = opts.color ?? C.frame;
  if (height > 0.02) p.cyl('metal', 0.03, 0.035, height, col, { pos: [base[0], base[1] + height / 2, base[2]] }, 8);
  const top = base[1] + height;
  p.cyl('paint', r * 1.25, r * 1.35, 0.05, C.black, { pos: [base[0], top + 0.025, base[2]] }, 12);
  // cage
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    p.rod('metal', [base[0] + Math.cos(a) * r * 1.2, top + 0.05, base[2] + Math.sin(a) * r * 1.2],
      [base[0] + Math.cos(a) * r * 1.2, top + 0.05 + r * 1.9, base[2] + Math.sin(a) * r * 1.2], 0.008, C.black, 4);
  }
  p.cyl('paint', r * 0.5, r * 1.25, 0.03, C.black, { pos: [base[0], top + 0.05 + r * 1.95, base[2]] }, 10);
  return { pos: [base[0], top + 0.05, base[2]], size: r, beacon: opts.beacon };
}

/** Name plate: dark backing board with the atlas label on its front face. */
export function namePlate(p: Parts, name: RegionName, centre: V3, normal: V3, w: number, h: number, back: number = C.black, bone = 0): void {
  p.bev('paint', [w + 0.04, h + 0.04, 0.03], 0.01, back, { pos: centre, normal, bone });
  p.decal(name, w, h, { pos: [centre[0] + normal[0] * 0.017, centre[1] + normal[1] * 0.017, centre[2] + normal[2] * 0.017], normal, bone });
}

/** Handrail through points (posts at each point, top + mid rails). */
export function railing(p: Parts, pts: readonly V3[], height: number, color: number = C.factory, ch: Channel = 'paint'): void {
  for (const q of pts) p.rod(ch, [q[0], q[1], q[2]], [q[0], q[1] + height, q[2]], 0.025, color, 6);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    p.rod(ch, [a[0], a[1] + height, a[2]], [b[0], b[1] + height, b[2]], 0.028, color, 6);
    p.rod(ch, [a[0], a[1] + height * 0.5, a[2]], [b[0], b[1] + height * 0.5, b[2]], 0.018, color, 6);
  }
}

/** Vent grille decal on a wall. */
export function vent(p: Parts, centre: V3, normal: V3, w: number, h: number, bone = 0): void {
  p.decal('vent', w, h, { pos: centre, normal, bone });
}

/** Horizontal hazard band on a vertical face. */
export function hazardBand(p: Parts, centre: V3, normal: V3, len: number, h: number, bone = 0): void {
  p.hazard(len, h, { pos: centre, normal, bone });
}

/**
 * Lumpy hay mound (unit-ish footprint w×d, peak height h) planar-mapped with the straw atlas region.
 * Edges sit at y=0 so the mound can be scaled to any container cross-section.
 */
export function hayMound(w: number, d: number, h: number, seg: number, seed: number, round = false): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const rnd = rng(seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), z = pos.getZ(i) / (d / 2);
    const r = round ? Math.min(1, Math.hypot(x, z)) : Math.min(1, Math.max(Math.abs(x), Math.abs(z)) * 0.55 + Math.hypot(x, z) * 0.45);
    const edge = Math.max(Math.abs(x), Math.abs(z)) > 0.999 || (round && Math.hypot(x, z) > 0.999);
    const bump = edge ? 0 : (rnd() - 0.5) * h * 0.35;
    const y = edge ? 0 : Math.max(0, h * Math.pow(1 - r * r, 0.7) + bump * (1 - r));
    if (round && Math.hypot(x, z) > 1) {
      const k = 1 / Math.hypot(x, z);
      pos.setXYZ(i, pos.getX(i) * k, 0, pos.getZ(i) * k);
    } else pos.setY(i, y);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return mapPlanarXZ(g, 'straw', 1);
}

/**
 * Flexible corrugated hose: `rings` rings, each skinned 100% to its own bone (bone index boneStart + i).
 * Every ring is authored around its bone origin in the bone's local Y-Z plane, so the hose follows any
 * curve the bones are laid on (see HoseLayout). Two sub-rings per bone give the accordion corrugation.
 */
export function hoseGeometry(rings: number, radius: number, boneStart: number, radial = 8): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const sub: [number, number][] = [[-0.035, 0.86], [0.035, 1]];
  const total = rings * sub.length;
  for (let r = 0; r < rings; r++) {
    for (const [ox, rs] of sub) {
      for (let k = 0; k < radial; k++) {
        const a = (k / radial) * Math.PI * 2;
        const cy = Math.cos(a), cz = Math.sin(a);
        pos.push(ox, cy * radius * rs, cz * radius * rs);
        nor.push(0, cy, cz);
        si.push(boneStart + r, 0, 0, 0);
        sw.push(1, 0, 0, 0);
      }
    }
  }
  for (let s = 0; s < total - 1; s++) {
    for (let k = 0; k < radial; k++) {
      const a = s * radial + k, b = s * radial + ((k + 1) % radial);
      const c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  return g;
}

const _hx = new THREE.Vector3(1, 0, 0);
const _ht = new THREE.Vector3();
const _hp = new THREE.Vector3();

/** Lays hose ring bones along a cubic Bezier (model space). Allocation-free. */
export class HoseLayout {
  readonly p0 = new THREE.Vector3();
  readonly p1 = new THREE.Vector3();
  readonly p2 = new THREE.Vector3();
  readonly p3 = new THREE.Vector3();

  apply(bones: readonly THREE.Bone[], start: number, count: number, wobble = 0, time = 0): void {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const u = 1 - t;
      const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
      _hp.set(0, 0, 0).addScaledVector(this.p0, b0).addScaledVector(this.p1, b1).addScaledVector(this.p2, b2).addScaledVector(this.p3, b3);
      const d0 = -3 * u * u, d1 = 3 * u * u - 6 * u * t, d2 = 6 * u * t - 3 * t * t, d3 = 3 * t * t;
      _ht.set(0, 0, 0).addScaledVector(this.p0, d0).addScaledVector(this.p1, d1).addScaledVector(this.p2, d2).addScaledVector(this.p3, d3);
      if (_ht.lengthSq() < 1e-8) _ht.set(1, 0, 0); else _ht.normalize();
      const bone = bones[start + i];
      if (wobble > 0) _hp.y += Math.sin(time * 31 + i * 1.7) * wobble * Math.sin(Math.PI * t);
      bone.position.copy(_hp);
      bone.quaternion.setFromUnitVectors(_hx, _ht);
    }
  }
}
