import * as THREE from 'three';
import type { ModelInstance } from './api';
import { cachedGeometry, cachedTemplate } from './cache';
import { BH, C, lampMast, namePlate, ports, skid, tierKit } from './kit';
import { additiveMaterial } from './materials';
import { shade, type Parts, type V3 } from './parts';
import { af, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Detection family (teal with cyan screens): Needle Scanner MK1 (one lane, side console + needle tray) and
 * MK2 (two lanes, roof needle vault, sleek chrome portals). A cyan scan bar with an additive light sheet
 * sweeps through the tunnel (anim.scan / active); anim.alarm spins the red beacon; found needles appear in
 * the tray (anim.needles); anim.fill drives the buffer gauge; MK2 lane B is barred until anim.lanes = 2.
 */

const TEAL = C.detection;
const TEAL_DK = shade(C.detection, 0.55);
const FELT = 0x7a1f24;

/** Light sheet under a scan bar: unit height (y 0..-1), narrow at the top, lane wide at the bottom. */
function beamGeometry(): THREE.BufferGeometry {
  return cachedGeometry('scanner.beam', () => {
    const g = new THREE.BufferGeometry();
    const top = 0.05, bot = 0.42;
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -top, 0, 0, top, 0, -1, bot,
      0, 0, -top, 0, -1, bot, 0, -1, -bot,
    ], 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Sewing needle lying along X (centre at origin), authored for a bone. */
export function needleParts(p: Parts, len: number, bone: number, pos: V3 = [0, 0, 0], rotY = 0): void {
  const c = Math.cos(rotY), s = -Math.sin(rotY);
  const at = (d: number): V3 => [pos[0] + c * d, pos[1], pos[2] + s * d];
  const r = len * 0.022;
  p.cyl('chrome', r, r, len * 0.82, 0xdfe6ea, { pos: at(-len * 0.05), rot: [0, rotY, 0], bone }, 6, 'x');
  p.cyl('chrome', 0.0005, r, len * 0.14, 0xdfe6ea, { pos: at(len * 0.43), rot: [0, rotY, 0], bone }, 6, 'x');
  p.torus('chrome', r * 1.5, r * 0.45, 0xdfe6ea, { pos: at(-len * 0.44), rot: [Math.PI / 2, 0, 0], bone }, 4, 8);
}

interface ScanBones { scans: number[]; needles: number[]; fill: number; lock?: number }
const BONES = new Map<string, ScanBones>();

function tunnelBits(p: Parts, x0: number, x1: number, z0: number, z1: number, roofY: number): void {
  const len = x1 - x0, cx = (x0 + x1) / 2, wz = z1 - z0, cz = (z0 + z1) / 2;
  for (const z of [z0, z1]) p.bev('paint', [len, roofY - 0.14, 0.08], 0.02, TEAL, { pos: [cx, 0.14 + (roofY - 0.14) / 2, z] });
  p.bev('paint', [len + 0.1, 0.24, wz + 0.16], 0.05, TEAL, { pos: [cx, roofY + 0.1, cz] });
  p.box('matte', [len - 0.04, 0.02, wz - 0.08], 0x0d1414, { pos: [cx, roofY - 0.025, cz] });
  for (const s of [-1, 1]) {
    p.hazard(wz + 0.1, 0.14, { pos: [s < 0 ? x0 - 0.051 : x1 + 0.051, roofY + 0.1, cz], normal: [s, 0, 0] });
    // rubber curtains hanging above the items
    for (let k = 0; k < 6; k++) {
      p.box('matte', [0.012, 0.46, wz / 6 - 0.012], k % 2 ? 0x2c2c2c : 0x222222, { pos: [s < 0 ? x0 + 0.03 : x1 - 0.03, roofY - 0.27, z0 + (wz / 6) * (k + 0.5)] });
    }
  }
}

function laneBed(p: Parts, x0: number, x1: number, z: number): void {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  p.bev('paint', [len, BH - 0.17, 0.95], 0.02, TEAL_DK, { pos: [cx, 0.14 + (BH - 0.17) / 2, z] });
  p.box('matte', [len, 0.03, 0.8], 0x262626, { pos: [cx, BH - 0.015, z] });
  for (const s of [-1, 1]) p.box('paint', [len, 0.1, 0.05], TEAL_DK, { pos: [cx, BH + 0.02, z + s * 0.44] });
}

function scanBar(t: TemplateBuilder, x: number, y: number, z: number): number {
  const b = t.bone(0, [x, y, z]);
  t.r.box('glowCyan', [0.05, 0.035, 0.86], 0xffffff, { bone: b });
  t.r.box('metal', [0.1, 0.03, 0.9], C.frame, { pos: [0, 0.03, 0], bone: b });
  return b;
}

// =============================================================================================
// MK1
// =============================================================================================

const MK1 = { roofY: 1.6, scanY: 1.54 };

function mk1Template(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 2, { h: 0.14, inset: 0.04, hazard: true });
  ports(p, 'scannerMk1', undefined, { accent: TEAL_DK });
  laneBed(p, -1.3, 1.3, -0.5);
  tunnelBits(p, -0.9, 0.9, -0.99, -0.01, MK1.roofY);
  p.round('paint', [1.7, 0.2, 0.9], 0.08, TEAL_DK, { pos: [0, MK1.roofY + 0.28, -0.5] });
  for (const s of [-1, 1]) p.box('glowCyan', [1.7, 0.03, 0.03], 0xffffff, { pos: [0, MK1.roofY - 0.05, -0.5 + s * 0.44] });
  p.decal('jokeHay', 1.5, 0.19, { pos: [0, 1.1, -1.035], normal: [0, 0, -1] });
  // console with a tilted screen
  p.bev('paint', [1.3, 1.0, 0.8], 0.05, TEAL_DK, { pos: [0.35, 0.64, 0.52] });
  const n: V3 = [0, 0.62, 0.78];
  p.bev('paint', [1.0, 0.52, 0.06], 0.02, C.black, { pos: [0.35, 1.3, 0.5], normal: n });
  p.decal('screenScan', 0.88, 0.44, { pos: [0.35, 1.3 + n[1] * 0.032, 0.5 + n[2] * 0.032], normal: n });
  namePlate(p, 'plateScanner', [0.35, 0.55, 0.935], [0, 0, 1], 0.8, 0.2);
  p.decal('vent', 0.5, 0.25, { pos: [1.001, 0.6, 0.52], normal: [1, 0, 0] });
  // needle tray
  p.bev('paint', [0.7, 0.75, 0.8], 0.04, TEAL, { pos: [-0.85, 0.14 + 0.375, 0.5] });
  p.box('matte', [0.58, 0.02, 0.68], FELT, { pos: [-0.85, 0.9, 0.5] });
  for (const s of [-1, 1]) {
    p.box('metal', [0.66, 0.08, 0.04], C.steelLight, { pos: [-0.85, 0.92, 0.5 + s * 0.37] });
    p.box('metal', [0.04, 0.08, 0.76], C.steelLight, { pos: [-0.85 + s * 0.33, 0.92, 0.5] });
  }
  p.box('glass', [0.64, 0.02, 0.72], 0xffffff, { pos: [-0.85, 0.99, 0.5] });
  p.decal('needleIcon', 0.5, 0.125, { pos: [-0.85, 0.6, 0.902], normal: [0, 0, 1] });
  // buffer gauge
  p.cyl('metal', 0.1, 0.1, 0.06, C.frame, { pos: [1.2, 0.17, 0.62] }, 10);
  p.cyl('metal', 0.1, 0.1, 0.06, C.frame, { pos: [1.2, 1.27, 0.62] }, 10);
  p.cyl('glass', 0.085, 0.085, 1.06, 0xffffff, { pos: [1.2, 0.72, 0.62] }, 10);
  t.lamp = lampMast(p, [0.55, MK1.roofY + 0.38, -0.5], 0.06, { beacon: true });

  const r = t.r;
  const bones: ScanBones = { scans: [scanBar(t, 0, MK1.scanY, -0.5)], needles: [], fill: 0 };
  for (let i = 0; i < 6; i++) {
    const b = t.bone(0, [-0.85, 0.915, 0.5 - 0.25 + i * 0.1]);
    needleParts(r, 0.4, b, [0, 0, 0], 0.08 * ((i % 3) - 1));
    bones.needles.push(b);
  }
  bones.fill = t.bone(0, [1.2, 0.2, 0.62]);
  r.cyl('glowAmber', 0.065, 0.065, 1.0, C.hay, { pos: [0, 0.5, 0], bone: bones.fill }, 8);
  BONES.set('scannerMk1', bones);
  tierKit(t, 3, 2, { postH: 1.0 });
  t.cullRadius = 2.6; t.cullCentre = [0, 1, 0];
  return t.build();
}

// =============================================================================================
// MK2
// =============================================================================================

const MK2 = { roofY: 1.9, scanY: 1.83 };

function mk2Template(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 4, 2, { h: 0.14, inset: 0.04, hazard: true });
  ports(p, 'scannerMk2', undefined, { accent: TEAL_DK });
  laneBed(p, -1.8, 1.8, -0.5);
  laneBed(p, -1.8, 1.8, 0.5);
  tunnelBits(p, -1.3, 1.3, -0.97, 0.97, MK2.roofY);
  p.bev('paint', [2.5, 0.06, 0.06], 0.01, TEAL_DK, { pos: [0, MK2.roofY - 0.06, 0] });
  p.round('paint', [2.4, 0.3, 1.7], 0.12, TEAL_DK, { pos: [0, MK2.roofY + 0.34, 0] });
  // chrome portal posts + cyan strips (MK2 look)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.bev('chrome', [0.14, MK2.roofY + 0.1, 0.1], 0.03, C.steelLight, { pos: [sx * 1.36, (MK2.roofY + 0.1) / 2 + 0.07, sz * 1.0] });
  }
  for (const sz of [-1, 1]) {
    p.box('glowCyan', [2.5, 0.04, 0.02], 0xffffff, { pos: [0, MK2.roofY + 0.12, sz * 1.061] });
    p.box('glowCyan', [2.4, 0.03, 0.03], 0xffffff, { pos: [0, MK2.roofY - 0.05, sz * 0.9] });
  }
  // screen (+Z wall) and plate (-Z wall)
  p.bev('paint', [1.2, 0.62, 0.05], 0.02, C.black, { pos: [-0.25, 1.2, 1.02] });
  p.decal('screenMk2', 1.1, 0.55, { pos: [-0.25, 1.2, 1.047], normal: [0, 0, 1] });
  namePlate(p, 'plateScanner2', [-0.2, 1.2, -1.02], [0, 0, -1], 1.0, 0.25);
  p.decal('jokeHay', 1.1, 0.14, { pos: [0.75, 0.7, -1.015], normal: [0, 0, -1] });
  // roof needle vault + ejector tube
  const vx = 0.55, vy = MK2.roofY + 0.49;
  p.bev('paint', [0.9, 0.2, 0.72], 0.03, TEAL, { pos: [vx, vy + 0.1, 0] });
  p.box('matte', [0.78, 0.02, 0.6], FELT, { pos: [vx, vy + 0.205, 0] });
  p.box('glass', [0.86, 0.14, 0.68], 0xffffff, { pos: [vx, vy + 0.28, 0] });
  for (const s of [-1, 1]) p.box('metal', [0.9, 0.03, 0.03], C.steelLight, { pos: [vx, vy + 0.36, s * 0.35] });
  p.tube('chrome', [[-0.2, MK2.roofY + 0.45, -0.3], [-0.1, vy + 0.5, -0.25], [vx - 0.4, vy + 0.32, -0.15]], 0.045, C.steelLight, 8);
  p.decal('needleIcon', 0.6, 0.15, { pos: [vx, vy + 0.1, 0.362], normal: [0, 0, 1] });
  // buffer gauge between the lanes (after the tunnel)
  p.cyl('glass', 0.07, 0.07, 1.1, 0xffffff, { pos: [1.55, BH + 0.6, 0] }, 10);
  p.cyl('metal', 0.09, 0.09, 0.06, C.frame, { pos: [1.55, BH + 1.18, 0] }, 10);
  t.lamp = lampMast(p, [-0.85, MK2.roofY + 0.49, 0.5], 0.12, { beacon: true });

  const r = t.r;
  const bones: ScanBones = { scans: [scanBar(t, 0, MK2.scanY, -0.5), scanBar(t, 0, MK2.scanY, 0.5)], needles: [], fill: 0 };
  for (let i = 0; i < 6; i++) {
    const b = t.bone(0, [vx, vy + 0.22, -0.25 + i * 0.1]);
    needleParts(r, 0.5, b, [0, 0, 0], 0.06 * ((i % 3) - 1));
    bones.needles.push(b);
  }
  bones.fill = t.bone(0, [1.55, BH + 0.06, 0]);
  r.cyl('glowAmber', 0.055, 0.055, 1.06, C.hay, { pos: [0, 0.53, 0], bone: bones.fill }, 8);
  // lane B lock: sign board + red/white barrier across the lane B intake
  const lock = t.bone(0);
  r.bev('paint', [0.04, 0.26, 0.92], 0.01, C.black, { pos: [-1.55, 1.32, 0.5], bone: lock });
  r.decal('laneB', 0.84, 0.21, { pos: [-1.572, 1.32, 0.5], normal: [-1, 0, 0], bone: lock });
  r.bev('paint', [0.06, 0.1, 0.9], 0.02, C.white, { pos: [-1.33, BH + 0.4, 0.5], bone: lock });
  r.hazard(0.86, 0.08, { pos: [-1.363, BH + 0.4, 0.5], normal: [-1, 0, 0], bone: lock }, 'hazardRed');
  bones.lock = lock;
  BONES.set('scannerMk2', bones);
  t.cullRadius = 3.2; t.cullCentre = [0, 1.2, 0];
  return t.build();
}

class ScannerModel extends RigModel {
  private readonly b: ScanBones;
  private readonly beams: THREE.Mesh[] = [];
  private needles = -1;
  private lanes = -1;

  constructor(readonly kind: 'scannerMk1' | 'scannerMk2') {
    super(cachedTemplate(kind, kind === 'scannerMk1' ? mk1Template : mk2Template), kind);
    this.b = BONES.get(kind)!;
    const h = (kind === 'scannerMk1' ? MK1.scanY : MK2.scanY) - BH - 0.02;
    for (const bi of this.b.scans) {
      const m = new THREE.Mesh(beamGeometry(), additiveMaterial(0x3ff5e6, 0.3));
      m.name = 'scanBeam';
      m.scale.y = h;
      m.castShadow = false;
      m.renderOrder = 2;
      this.rig.bones[bi].add(m);
      this.beams.push(m);
    }
    this.animate({}, 0, 0);
  }

  protected animate(anim: Record<string, number>, _dt: number, time: number): void {
    const bones = this.rig.bones;
    const active = af(anim, 'active', 0, 1) > 0.5;
    const lanes = this.kind === 'scannerMk2' ? (af(anim, 'lanes', 1, 2) >= 1.5 ? 2 : 1) : 1;
    const span = this.kind === 'scannerMk1' ? 0.75 : 1.15;
    const scan = af(anim, 'scan', 0, 1);
    for (let i = 0; i < this.b.scans.length; i++) {
      const on = active && i < lanes;
      const bone = bones[this.b.scans[i]];
      // lane B sweeps half a cycle behind lane A
      const s = i === 0 ? scan : (scan + 0.5) % 1;
      bone.position.x = -span + 2 * span * (0.5 - 0.5 * Math.cos(s * Math.PI * 2));
      bone.scale.setScalar(i < lanes ? 1 : HIDDEN);
      this.beams[i].visible = on;
      if (on) this.beams[i].material = additiveMaterial(0x3ff5e6, 0.22 + 0.1 * Math.sin(time * 23 + i));
    }
    if (lanes !== this.lanes) {
      this.lanes = lanes;
      if (this.b.lock !== undefined) this.rig.show(this.b.lock, lanes < 2);
    }
    const n = Math.round(af(anim, 'needles', 0, 6));
    if (n !== this.needles) {
      this.needles = n;
      this.b.needles.forEach((bi, i) => this.rig.show(bi, i < n));
    }
    bones[this.b.fill].scale.set(1, Math.max(HIDDEN, af(anim, 'fill', 0, 1)), 1);
    this.rig.lamp?.setAlarm(af(anim, 'alarm') > 0.5);
  }
}

export function createScannerMk1(): ModelInstance { return new ScannerModel('scannerMk1'); }
export function createScannerMk2(): ModelInstance { return new ScannerModel('scannerMk2'); }
