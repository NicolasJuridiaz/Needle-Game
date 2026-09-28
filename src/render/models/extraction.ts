import { strawMound } from './strawHeap';
import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { C, hoseGeometry, HoseLayout, lampMast, namePlate, ports, skid, tierKit } from './kit';
import { shade, wedge, type V3 } from './parts';
import { af, ease, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Extraction family (safety orange): Hay Hopper, Piston Rake, Robotic Arm, Vacuum Collector.
 */

const ORANGE = C.extraction;
const ORANGE_DK = shade(C.extraction, 0.72);

// =============================================================================================
// Hay Hopper — funnel bin on a port block; hay level rises with anim.fill, agitator turns with anim.out.
// =============================================================================================

const HOP = { baseTop: 1.07, top: 2.2, wBot: 1.5, wTop: 1.96, wall: 0.06 };

function hopperTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 2, 2, { h: 0.12, inset: 0.05 });
  // port block
  p.bev('paint', [1.76, HOP.baseTop - 0.12, 1.76], 0.05, ORANGE, { pos: [0, 0.12 + (HOP.baseTop - 0.12) / 2, 0] });
  p.bev('metal', [1.8, 0.08, 1.8], 0.02, C.frame, { pos: [0, HOP.baseTop - 0.02, 0] });
  ports(p, 'hopper', undefined, { accent: C.frame, depth: 0.02 });
  // funnel bin
  const fh = HOP.top - HOP.baseTop;
  p.shell('paint', ORANGE, HOP.wBot, HOP.wBot, HOP.wTop, HOP.wTop, fh, HOP.wall, { pos: [0, HOP.baseTop, 0] }, ORANGE_DK);
  // steel rim cap + ribs
  const slope = Math.atan2((HOP.wTop - HOP.wBot) / 2, fh);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const nx = Math.cos(a), nz = -Math.sin(a);
    const n: V3 = [nx * Math.cos(slope), -Math.sin(slope), nz * Math.cos(slope)];
    const up: V3 = [nx * Math.sin(slope), Math.cos(slope), nz * Math.sin(slope)];
    const at = (y: number, lat: number): V3 => {
      const r = HOP.wBot / 2 + ((HOP.wTop - HOP.wBot) / 2) * ((y - HOP.baseTop) / fh) + 0.004;
      return [nx * r + nz * lat, y, nz * r - nx * lat];
    };
    p.hazard(HOP.wTop - 0.16, 0.16, { pos: at(HOP.top - 0.13, 0), normal: n, up });
    for (const lat of [-0.45, 0.45]) {
      const a0 = at(HOP.baseTop + 0.05, lat), a1 = at(HOP.top - 0.22, lat);
      p.rod('metal', [a0[0] + n[0] * 0.02, a0[1], a0[2] + n[2] * 0.02], [a1[0] + n[0] * 0.02, a1[1], a1[2] + n[2] * 0.02], 0.03, ORANGE_DK, 6);
    }
    if (k === 0) namePlate(p, 'plateHopper', at(HOP.baseTop + 0.5, 0), n, 0.9, 0.225);
    if (k === 2) namePlate(p, 'jokeNeedles', at(HOP.baseTop + 0.5, 0), n, 1.2, 0.15);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.rod('metal', [sx * 0.86, HOP.baseTop, sz * 0.86], [sx * (HOP.wTop / 2 - 0.02), HOP.top - 0.02, sz * (HOP.wTop / 2 - 0.02)], 0.035, C.frame, 6);
    p.bolt([sx * (HOP.wTop / 2 - 0.05), HOP.top, sz * (HOP.wTop / 2 - 0.05)], [0, 1, 0], 0.025);
  }
  t.lamp = lampMast(p, [HOP.wTop / 2 - 0.08, HOP.top, -(HOP.wTop / 2 - 0.08)], 0);

  // moving: agitator (1) and hay surface (2)
  const r = t.r;
  const agit = t.bone(0, [0, HOP.baseTop + HOP.wall, 0]);
  r.cyl('metal', 0.045, 0.06, 0.55, C.steelLight, { pos: [0, 0.275, 0], bone: agit }, 8);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    r.bev('paint', [0.55, 0.05, 0.1], 0.015, C.factory, { pos: [Math.cos(a) * 0.3, 0.12 + k * 0.12, -Math.sin(a) * 0.3], rot: [0, a, 0.25], bone: agit });
  }
  const hay = t.bone(0, [0, HOP.baseTop + 0.1, 0]);
  r.add('matte', strawMound(0.3, 11), null, { bone: hay });
  t.cullRadius = 2; t.cullCentre = [0, 1.1, 0];
  return t.build();
}

class HopperModel extends RigModel {
  private agitAngle = 0;
  constructor() { super(cachedTemplate('hopper', hopperTemplate), 'hopper'); }

  protected animate(anim: Record<string, number>, dt: number, time: number): void {
    const fill = af(anim, 'fill', 0, 1);
    const out = af(anim, 'out', 0, 1);
    const b = this.rig.bones;
    this.agitAngle = (this.agitAngle + dt * out * 5) % (Math.PI * 2);
    b[1].rotation.y = this.agitAngle;
    const hay = b[2];
    if (fill <= 0.001) { hay.scale.setScalar(HIDDEN); return; }
    const y0 = HOP.baseTop + HOP.wall, y1 = HOP.top - 0.08;
    const y = y0 + (y1 - y0) * fill;
    const t = (y - HOP.baseTop) / (HOP.top - HOP.baseTop);
    const w = (HOP.wBot + (HOP.wTop - HOP.wBot) * t) - HOP.wall * 2 - 0.01;
    const jig = out > 0 ? Math.sin(time * 40) * 0.006 * out : 0;
    hay.position.set(0, y + jig, 0);
    hay.scale.set(w, 0.6 + fill * 0.8, w);
  }
}

export function createHopper(): ModelInstance { return new HopperModel(); }

// =============================================================================================
// Piston Rake — chassis with a hay tray, a front scoop ramp and a hydraulic cylinder pushing a wide comb
// head `ext × reach` metres forward. Industrial: double outer cylinders + dark armour + side arms.
// =============================================================================================

const RK = { barrelY: 1.92, barrelEnd: 0.95, drop: 1.74, combW: 1.5 };
const RAKE_B = { tray: 1, rod: 2, head: 3, comb: 4, ind: 5, rodL: 6, rodR: 7, headInd: 8 };

function rakeTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 2, 3, { h: 0.12, inset: 0.04, hazard: true });
  ports(p, 'pistonRake', undefined, { accent: ORANGE_DK });
  // hay tray (open bin) behind the scoop ramp
  p.shell('paint', ORANGE, 0.9, 2.5, 1.0, 2.7, 0.8, 0.05, { pos: [-0.15, 0.12, 0] }, ORANGE_DK);
  p.hazard(2.5, 0.12, { pos: [0.352, 0.84, 0], normal: [1, 0, 0] });
  // front scoop ramp
  p.add('metal', wedge(0.65, 0.62, 2.6), C.steelLight, { pos: [0.675, 0.02, 0] });
  p.bolts([0.95, 0.07, -1.2], [0.95, 0.07, 1.2], 6, [0, 1, 0], 0.02);
  // side towers + crossbeam carrying the cylinder
  for (const s of [-1, 1]) {
    p.bev('paint', [0.3, 1.7, 0.18], 0.03, ORANGE, { pos: [0.18, 0.12 + 0.85, s * 1.38] });
    p.bolts([0.08, 0.3, s * 1.472], [0.08, 1.6, s * 1.472], 4, [0, 0, s], 0.02);
  }
  p.bev('metal', [0.34, 0.2, 2.94], 0.04, C.frame, { pos: [0.18, 1.74, 0] });
  // main cylinder barrel along +X, supported at the back by an A-frame on the tray
  p.cyl('paint', 0.14, 0.14, 1.6, ORANGE_DK, { pos: [0.15, RK.barrelY, 0] }, 12, 'x');
  p.cyl('metal', 0.17, 0.17, 0.12, C.frame, { pos: [RK.barrelEnd - 0.06, RK.barrelY, 0] }, 12, 'x');
  p.cyl('metal', 0.17, 0.17, 0.12, C.frame, { pos: [-0.62, RK.barrelY, 0] }, 12, 'x');
  for (const s of [-1, 1]) p.rod('metal', [-0.62, 0.92, s * 1.25], [-0.62, RK.barrelY - 0.1, 0], 0.035, C.frame, 6);
  p.box('metal', [0.2, 0.16, 0.34], C.frame, { pos: [0.18, RK.barrelY - 0.14, 0] });
  // pump unit + hoses
  p.bev('paint', [0.34, 0.5, 0.55], 0.04, C.frame, { pos: [-0.8, 0.37, 1.05] });
  p.decal('vent', 0.4, 0.2, { pos: [-0.8, 0.45, 1.33], normal: [0, 0, 1] });
  p.tube('matte', [[-0.8, 0.62, 1.0], [-0.75, 1.3, 0.8], [-0.4, RK.barrelY + 0.15, 0.1]], 0.03, C.black);
  p.tube('matte', [[-0.72, 0.62, 1.15], [-0.3, 1.5, 1.2], [0.7, RK.barrelY + 0.12, 0.08]], 0.03, C.black);
  namePlate(p, 'plateRake', [-0.15, 0.55, 1.335], [0, 0, 1], 0.8, 0.2);
  p.decal('jokeHands', 1.1, 0.14, { pos: [-0.15, 0.55, -1.337], normal: [0, 0, -1] });
  t.lamp = lampMast(p, [0.18, 1.84, 1.38], 0.22);

  const r = t.r;
  const tray = t.bone(0, [-0.15, 0.2, 0]);
  r.add('matte', strawMound(0.35, 21), null, { bone: tray });
  // rod: unit length along +X, scaled by the extension
  const rod = t.bone(0, [RK.barrelEnd, RK.barrelY, 0]);
  r.cyl('chrome', 0.065, 0.065, 1, C.steelLight, { pos: [0.5, 0, 0], bone: rod }, 10, 'x');
  // head: clevis + drop arm; comb (scaled in Z by the rake width)
  const head = t.bone(0, [RK.barrelEnd + 0.1, RK.barrelY, 0]);
  r.bev('metal', [0.22, 0.22, 0.26], 0.03, C.frame, { bone: head });
  r.bev('paint', [0.14, RK.drop, 0.18], 0.03, ORANGE, { pos: [0.08, -RK.drop / 2, 0], bone: head });
  r.rod('metal', [0.0, -0.1, 0], [0.08, -RK.drop + 0.2, 0.0], 0.02, C.frame, 5, head);
  const comb = t.bone(head, [0.1, -RK.drop, 0]);
  r.bev('paint', [0.2, 0.16, RK.combW], 0.03, ORANGE, { bone: comb });
  r.hazard(RK.combW - 0.1, 0.1, { pos: [0.101, 0, 0], normal: [1, 0, 0], bone: comb });
  for (let k = 0; k < 11; k++) {
    const z = -RK.combW / 2 + 0.07 + (k * (RK.combW - 0.14)) / 10;
    r.box('metal', [0.05, 0.26, 0.035], C.steelLight, { pos: [0.02, -0.17, z], rot: [0, 0, -0.25], bone: comb });
  }
  // industrial kit: outer cylinders + armour + head side arms
  const ind = t.bone(0);
  for (const s of [-1, 1]) {
    r.cyl('paint', 0.11, 0.11, 1.4, C.steelDark, { pos: [0.25, RK.barrelY, s * 0.62], bone: ind }, 10, 'x');
    r.cyl('metal', 0.14, 0.14, 0.1, C.black, { pos: [RK.barrelEnd - 0.05, RK.barrelY, s * 0.62], bone: ind }, 10, 'x');
    r.bev('metal', [0.36, 1.2, 0.05], 0.02, C.steelDark, { pos: [0.18, 0.9, s * 1.49], bone: ind });
    r.hazard(0.3, 0.1, { pos: [0.18, 1.4, s * 1.516], normal: [0, 0, s], bone: ind });
    r.bev('metal', [0.9, 0.5, 0.04], 0.015, C.steelDark, { pos: [-0.15, 0.55, s * 1.39], rot: [s * 0.06, 0, 0], bone: ind });
  }
  const rodL = t.bone(ind, [RK.barrelEnd, RK.barrelY, -0.62]);
  const rodR = t.bone(ind, [RK.barrelEnd, RK.barrelY, 0.62]);
  for (const b of [rodL, rodR]) r.cyl('chrome', 0.05, 0.05, 1, C.steelLight, { pos: [0.5, 0, 0], bone: b }, 8, 'x');
  const headInd = t.bone(head);
  for (const s of [-1, 1]) {
    r.bev('metal', [0.16, 0.16, 0.2], 0.03, C.black, { pos: [0, 0, s * 0.62], bone: headInd });
    r.bev('paint', [0.1, RK.drop - 0.1, 0.12], 0.02, C.steelDark, { pos: [0.06, -RK.drop / 2 - 0.02, s * 0.62], bone: headInd });
    r.box('metal', [0.1, 0.1, 0.62], C.steelDark, { pos: [0, 0, s * 0.31], bone: headInd });
  }
  tierKit(t, 2, 3, { postH: 1.1 });
  t.cullRadius = 6.5; t.cullCentre = [2.5, 1.2, 0];
  return t.build();
}

class RakeModel extends RigModel {
  private ext = 0;
  constructor() { super(cachedTemplate('pistonRake', rakeTemplate), 'pistonRake'); this.animate({}, 0); }

  protected animate(anim: Record<string, number>, dt: number): void {
    const b = this.rig.bones;
    const industrial = af(anim, 'industrial') > 0.5;
    const reach = af(anim, 'reach', 0, 12);
    const target = af(anim, 'ext', 0, 1) * reach;
    this.ext += (target - this.ext) * ease(dt, 25);
    const e = Math.max(HIDDEN, this.ext);
    b[RAKE_B.rod].scale.set(e, 1, 1);
    b[RAKE_B.head].position.x = RK.barrelEnd + 0.1 + this.ext;
    const width = (anim.width ?? 0) > 0.1 ? af(anim, 'width', 0.5, 6) : RK.combW;
    b[RAKE_B.comb].scale.set(industrial ? 1.3 : 1, industrial ? 1.25 : 1, width / RK.combW);
    this.rig.show(RAKE_B.ind, industrial);
    this.rig.show(RAKE_B.headInd, industrial);
    if (industrial) { b[RAKE_B.rodL].scale.set(e, 1, 1); b[RAKE_B.rodR].scale.set(e, 1, 1); }
    const tray = af(anim, 'tray', 0, 1);
    const tb = b[RAKE_B.tray];
    if (tray < 0.01) tb.scale.setScalar(HIDDEN);
    else { tb.position.y = 0.17 + tray * 0.62; tb.scale.set(0.86 + tray * 0.08, 0.5 + tray, 2.45 + tray * 0.12); }
  }
}

export function createRake(): ModelInstance { return new RakeModel(); }

// =============================================================================================
// Robotic Arm — pedestal + turntable + 2-link IK arm + wrist that keeps the claw vertical.
// MK2 swaps the painted segments for chrome ones with orange accents.
// =============================================================================================

const ARM = { base: 0.95, shoulder: 0.32, L1: 1.95, L2: 1.95, claw: 0.62 };
const ARM_B = { turn: 1, shoulder: 2, upStd: 3, upMk2: 4, elbow: 5, foreStd: 6, foreMk2: 7, wrist: 8, fingerA: 9, fingerB: 10, hay: 11, turnMk2: 12, turnStd: 13 };

function armTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 1, 1, { h: 0.1, inset: 0.03, hazard: true });
  ports(p, 'roboticArm', undefined, { accent: ORANGE_DK });
  p.cyl('paint', 0.3, 0.38, ARM.base - 0.1, ORANGE, { pos: [0, 0.1 + (ARM.base - 0.1) / 2, 0] }, 14);
  p.cyl('metal', 0.33, 0.33, 0.06, C.frame, { pos: [0, ARM.base - 0.03, 0] }, 14);
  p.decal('warning', 0.2, 0.2, { pos: [-0.33, 0.55, 0], normal: [-1, 0, 0] });
  namePlate(p, 'plateArm', [-0.05, 0.35, 0.34], [0.2, 0, 1], 0.44, 0.11);
  t.lamp = lampMast(p, [-0.38, 0.1, -0.38], 0.55, { size: 0.07 });

  const r = t.r;
  const turn = t.bone(0, [0, ARM.base, 0]);
  const shoulder = t.bone(turn, [0, ARM.shoulder, 0]);
  const upStd = t.bone(shoulder);
  const upMk2 = t.bone(shoulder);
  const elbow = t.bone(shoulder, [ARM.L1, 0, 0]);
  const foreStd = t.bone(elbow);
  const foreMk2 = t.bone(elbow);
  const wrist = t.bone(elbow, [ARM.L2, 0, 0]);
  const fA = t.bone(wrist, [0.1, -0.3, 0]);
  const fB = t.bone(wrist, [-0.1, -0.3, 0]);
  const hay = t.bone(wrist, [0, -0.46, 0]);
  const turnMk2 = t.bone(turn);
  const turnStd = t.bone(turn);
  // turntable (shared) + yoke
  r.cyl('metal', 0.36, 0.36, 0.1, C.frame, { pos: [0, 0.05, 0], bone: turn }, 14);
  for (const s of [-1, 1]) r.bev('paint', [0.3, 0.46, 0.07], 0.02, ORANGE, { pos: [0, 0.3, s * 0.2], bone: turnStd });
  for (const s of [-1, 1]) r.bev('chrome', [0.28, 0.44, 0.06], 0.025, C.steelLight, { pos: [0, 0.3, s * 0.19], bone: turnMk2 });
  r.bev('paint', [0.3, 0.3, 0.34], 0.04, C.frame, { pos: [-0.3, 0.22, 0], bone: turn });
  r.decal('vent', 0.26, 0.13, { pos: [-0.451, 0.24, 0], normal: [-1, 0, 0], bone: turn });
  r.cyl('metal', 0.1, 0.1, 0.5, C.steelLight, { pos: [0, ARM.shoulder, 0], bone: turn }, 10, 'z');
  // upper arm (standard): chunky box beam + hydraulic line
  r.bev('paint', [ARM.L1 + 0.1, 0.22, 0.24], 0.05, ORANGE, { pos: [ARM.L1 / 2, 0, 0], bone: upStd });
  r.hazard(0.5, 0.08, { pos: [ARM.L1 * 0.5, 0, 0.121], normal: [0, 0, 1], bone: upStd });
  r.rod('metal', [0.25, 0.14, 0.06], [ARM.L1 - 0.3, 0.14, 0.06], 0.025, C.black, 6, upStd);
  r.bolts([0.2, 0.111, -0.08], [ARM.L1 - 0.2, 0.111, -0.08], 5, [0, 1, 0], 0.018, C.bolt, upStd);
  // upper arm (MK2): slim chrome tube + orange spine
  r.cyl('chrome', 0.09, 0.11, ARM.L1, C.steelLight, { pos: [ARM.L1 / 2, 0, 0], bone: upMk2 }, 12, 'x');
  r.bev('paint', [ARM.L1 * 0.8, 0.05, 0.06], 0.015, ORANGE, { pos: [ARM.L1 / 2, 0.1, 0], bone: upMk2 });
  // elbow joint
  r.cyl('metal', 0.14, 0.14, 0.3, C.frame, { bone: elbow }, 12, 'z');
  // forearm
  r.bev('paint', [ARM.L2 + 0.05, 0.17, 0.19], 0.04, ORANGE, { pos: [ARM.L2 / 2, 0, 0], bone: foreStd });
  r.rod('metal', [0.2, 0.11, -0.05], [ARM.L2 - 0.25, 0.11, -0.05], 0.02, C.black, 6, foreStd);
  r.cyl('chrome', 0.07, 0.085, ARM.L2, C.steelLight, { pos: [ARM.L2 / 2, 0, 0], bone: foreMk2 }, 12, 'x');
  r.bev('paint', [ARM.L2 * 0.7, 0.04, 0.05], 0.012, ORANGE, { pos: [ARM.L2 / 2, 0.08, 0], bone: foreMk2 });
  // wrist + claw housing (points down)
  r.cyl('metal', 0.11, 0.11, 0.24, C.frame, { bone: wrist }, 10, 'z');
  r.bev('paint', [0.3, 0.22, 0.26], 0.04, C.factory, { pos: [0, -0.18, 0], bone: wrist });
  r.hazard(0.26, 0.07, { pos: [0, -0.18, 0.131], normal: [0, 0, 1], bone: wrist });
  // fingers (clamshell jaws)
  for (const [b, s] of [[fA, 1], [fB, -1]] as const) {
    r.bev('metal', [0.05, 0.3, 0.24], 0.015, C.steelLight, { pos: [s * 0.01, -0.14, 0], bone: b });
    r.bev('metal', [0.1, 0.05, 0.24], 0.015, C.steelLight, { pos: [-s * 0.04, -0.29, 0], rot: [0, 0, s * 0.35], bone: b });
  }
  r.add('matte', strawMound(0.8, 33), null, { pos: [0, -0.12, 0], scale: [0.22, 0.3, 0.22], bone: hay });
  r.sphere('matte', 0.1, C.hay, { bone: hay }, 7, 5);
  tierKit(t, 1, 1, { plateY: 0.3, postH: 0.6 });
  t.cullRadius = 5; t.cullCentre = [0, 1.5, 0];
  return t.build();
}

function wrapAngle(a: number): number {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

class ArmModel extends RigModel {
  private yaw = 0;
  private dist = 2;
  private height = 0.8;
  private grip = 0;
  private mk2 = -1;
  constructor() { super(cachedTemplate('roboticArm', armTemplate), 'roboticArm'); this.animate({ dist: 1.6, height: 0.6 }, 1); }

  protected animate(anim: Record<string, number>, dt: number): void {
    const b = this.rig.bones;
    const k = ease(dt, 14);
    this.yaw += wrapAngle(af(anim, 'yaw') - this.yaw) * k;
    this.dist += (af(anim, 'dist', 0.3, 6) - this.dist) * k;
    this.height += (af(anim, 'height', 0, 4) - this.height) * k;
    this.grip += (af(anim, 'grip', 0, 1) - this.grip) * ease(dt, 20);
    const mk2 = af(anim, 'mk2') > 0.5 ? 1 : 0;
    if (mk2 !== this.mk2) {
      this.mk2 = mk2;
      for (const [s, m] of [[ARM_B.upStd, ARM_B.upMk2], [ARM_B.foreStd, ARM_B.foreMk2], [ARM_B.turnStd, ARM_B.turnMk2]]) {
        this.rig.show(s, !mk2); this.rig.show(m, !!mk2);
      }
    }
    b[ARM_B.turn].rotation.y = this.yaw;
    // IK in the turntable plane: wrist target = claw tip + claw length
    const { L1, L2 } = ARM;
    let dx = this.dist, dy = this.height + ARM.claw - (ARM.base + ARM.shoulder);
    let rr = Math.hypot(dx, dy);
    const maxR = L1 + L2 - 0.02, minR = 0.35;
    if (rr > maxR) { dx *= maxR / rr; dy *= maxR / rr; rr = maxR; }
    if (rr < minR) { const s = minR / Math.max(1e-4, rr); dx *= s; dy *= s; rr = minR; }
    const cosA = Math.max(-1, Math.min(1, (L1 * L1 + rr * rr - L2 * L2) / (2 * L1 * rr)));
    const cosE = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - rr * rr) / (2 * L1 * L2)));
    const a1 = Math.atan2(dy, dx) + Math.acos(cosA);
    const a2 = a1 - (Math.PI - Math.acos(cosE));
    b[ARM_B.shoulder].rotation.z = a1;
    b[ARM_B.elbow].rotation.z = a2 - a1;
    b[ARM_B.wrist].rotation.z = -a2;
    const open = (1 - this.grip) * 0.55;
    b[ARM_B.fingerA].rotation.z = open;
    b[ARM_B.fingerB].rotation.z = -open;
    const load = af(anim, 'load', 0, 1);
    b[ARM_B.hay].scale.setScalar(load > 0.02 ? 0.4 + load * 0.7 : HIDDEN);
  }
}

export function createArm(): ModelInstance { return new ArmModel(); }

// =============================================================================================
// Vacuum Collector — cyclone tank with a turbine on top, swivel boom and a skinned corrugated hose down
// to a floor nozzle at (nozzleYaw, nozzleDist). Industrial: second turbine pod.
// =============================================================================================

const VAC = { tankX: -0.2, tankR: 1.05, tankTop: 2.5, swivel: [1.05, 2.12, 0] as V3, rings: 16, nozzleH: 0.78 };
const VAC_B = { fan: 1, swivel: 2, fill: 3, nozzle: 4, ind: 5, fan2: 6, hose0: 7 };

function collectorTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 3, { h: 0.14, inset: 0.05, hazard: true });
  ports(p, 'vacuumCollector', undefined, { accent: ORANGE_DK, depth: 0.02 });
  const tx = VAC.tankX, R = VAC.tankR;
  p.cyl('paint', R, R * 0.72, 0.5, ORANGE_DK, { pos: [tx, 0.14 + 0.25, 0] }, 18);
  p.cyl('paint', R, R, VAC.tankTop - 0.64, ORANGE, { pos: [tx, 0.64 + (VAC.tankTop - 0.64) / 2, 0] }, 18);
  for (const y of [0.66, 1.4, 2.2]) p.cyl('metal', R + 0.03, R + 0.03, 0.08, C.frame, { pos: [tx, y, 0] }, 18);
  p.cyl('metal', R + 0.06, R + 0.06, 0.1, C.frame, { pos: [tx, VAC.tankTop + 0.05, 0] }, 18);
  // turbine housing + fan cage
  p.cyl('paint', 0.78, 0.82, 0.6, C.steelDark, { pos: [tx, VAC.tankTop + 0.4, 0] }, 16);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    p.decal('vent', 0.44, 0.22, { pos: [tx + Math.cos(a) * 0.805, VAC.tankTop + 0.4, -Math.sin(a) * 0.805], normal: [Math.cos(a), 0, -Math.sin(a)] });
  }
  p.torus('metal', 0.76, 0.03, C.black, { pos: [tx, VAC.tankTop + 1.0, 0], rot: [Math.PI / 2, 0, 0] }, 5, 20);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 4;
    p.rod('metal', [tx + Math.cos(a) * 0.76, VAC.tankTop + 1.0, Math.sin(a) * 0.76], [tx - Math.cos(a) * 0.76, VAC.tankTop + 1.0, -Math.sin(a) * 0.76], 0.014, C.black, 4);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    p.rod('metal', [tx + Math.cos(a) * 0.78, VAC.tankTop + 0.7, Math.sin(a) * 0.78], [tx + Math.cos(a) * 0.76, VAC.tankTop + 1.0, Math.sin(a) * 0.76], 0.016, C.black, 4);
  }
  // swivel bracket at the front
  p.bev('metal', [0.5, 0.16, 0.34], 0.03, C.frame, { pos: [0.83, VAC.swivel[1] - 0.14, 0] });
  p.cyl('metal', 0.14, 0.16, 0.12, C.frame, { pos: [VAC.swivel[0], VAC.swivel[1] - 0.06, 0] }, 12);
  // level window (+Z side)
  p.bev('paint', [0.36, 1.62, 0.08], 0.02, C.black, { pos: [tx, 1.42, R - 0.01] });
  p.box('matte', [0.24, 1.48, 0.02], 0x151515, { pos: [tx, 1.42, R + 0.03] });
  p.box('glass', [0.26, 1.5, 0.02], 0xffffff, { pos: [tx, 1.42, R + 0.07] });
  p.decal('siloScale', 0.1, 1.4, { pos: [tx + 0.24, 1.42, R - 0.02], normal: [0.2, 0, 1] });
  namePlate(p, 'plateCollector', [tx + R + 0.005, 1.1, 0], [1, 0, 0], 0.9, 0.225);
  p.decal('jokeHug', 1.3, 0.16, { pos: [tx - R - 0.005, 1.75, 0], normal: [-1, 0, 0] });
  // control box
  p.bev('paint', [0.5, 0.8, 0.4], 0.04, C.frame, { pos: [1.05, 0.54, 1.05] });
  p.decal('gauge', 0.24, 0.24, { pos: [1.05, 0.7, 1.253], normal: [0, 0, 1] });
  t.lamp = lampMast(p, [1.05, 0.94, 1.05], 0.12);

  const r = t.r;
  const fan = t.bone(0, [tx, VAC.tankTop + 0.78, 0]);
  r.cyl('metal', 0.12, 0.12, 0.12, C.frame, { bone: fan }, 10);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    r.bev('paint', [0.62, 0.03, 0.16], 0.01, C.factory, { pos: [Math.cos(a) * 0.38, 0, -Math.sin(a) * 0.38], rot: [0.35, a, 0], bone: fan });
  }
  const sw = t.bone(0, VAC.swivel);
  r.cyl('paint', 0.13, 0.13, 0.16, ORANGE, { pos: [0, 0.06, 0], bone: sw }, 12);
  r.cyl('metal', 0.14, 0.14, 0.3, C.frame, { pos: [0.18, 0.06, 0], bone: sw }, 10, 'x');
  const fill = t.bone(0, [tx, 0.68, R + 0.045]);
  r.box('glowAmber', [0.22, 1.46, 0.015], C.hay, { pos: [0, 0.73, 0], bone: fill });
  const nozzle = t.bone(0, [3, VAC.nozzleH, 0]);
  r.cyl('paint', 0.13, 0.13, 0.3, ORANGE, { pos: [0, -0.15, 0], bone: nozzle }, 12);
  r.cyl('metal', 0.14, 0.34, 0.36, C.frame, { pos: [0, -0.48, 0], bone: nozzle }, 14, 'y', true);
  r.torus('metal', 0.34, 0.03, C.black, { pos: [0, -0.66, 0], rot: [Math.PI / 2, 0, 0], bone: nozzle }, 5, 16);
  r.hazard(0.36, 0.08, { pos: [0, -0.1, 0.132], normal: [0, 0, 1], bone: nozzle });
  r.bev('paint', [0.3, 0.06, 0.05], 0.01, C.factory, { pos: [0, -0.02, 0.14], bone: nozzle });
  // industrial second turbine pod
  const ind = t.bone(0);
  r.cyl('paint', 0.42, 0.45, 2.2, ORANGE_DK, { pos: [0.95, 0.14 + 1.1, -0.95], bone: ind }, 14);
  r.cyl('paint', 0.5, 0.5, 0.35, C.steelDark, { pos: [0.95, 2.5, -0.95], bone: ind }, 14);
  r.torus('metal', 0.48, 0.025, C.black, { pos: [0.95, 2.75, -0.95], rot: [Math.PI / 2, 0, 0], bone: ind }, 5, 16);
  r.tube('metal', [[0.95, 2.1, -0.52], [0.6, 2.3, -0.3], [tx + 0.6, VAC.tankTop - 0.2, -0.4]], 0.09, C.frame, 8, ind);
  r.hazard(0.8, 0.1, { pos: [0.95, 1.2, -0.52], normal: [0, 0, 1], bone: ind });
  const fan2 = t.bone(ind, [0.95, 2.72, -0.95]);
  r.cyl('metal', 0.08, 0.08, 0.1, C.frame, { bone: fan2 }, 8);
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    r.bev('paint', [0.38, 0.025, 0.12], 0.008, C.factory, { pos: [Math.cos(a) * 0.23, 0, -Math.sin(a) * 0.23], rot: [0.35, a, 0], bone: fan2 });
  }
  // hose rings
  const start = t.bones.length;
  for (let i = 0; i < VAC.rings; i++) t.bone(0);
  r.add('matte', hoseGeometry(VAC.rings, 0.12, start, 10), 0x2e2e2e);
  tierKit(t, 3, 3, { postH: 1.2 });
  t.cullRadius = 7.5; t.cullCentre = [1.5, 1.2, 0];
  return t.build();
}

class CollectorModel extends RigModel {
  private readonly hose = new HoseLayout();
  private yaw = 0;
  private dist = 3;
  constructor() { super(cachedTemplate('vacuumCollector', collectorTemplate), 'vacuumCollector'); this.animate({ nozzleDist: 3 }, 1, 0); }

  protected animate(anim: Record<string, number>, dt: number, time: number): void {
    const b = this.rig.bones;
    const industrial = af(anim, 'industrial') > 0.5;
    const spin = af(anim, 'spin');
    const suck = af(anim, 'suck', 0, 1);
    b[VAC_B.fan].rotation.y = spin;
    this.rig.show(VAC_B.ind, industrial);
    if (industrial) b[VAC_B.fan2].rotation.y = -spin * 1.3;
    const fill = af(anim, 'fill', 0, 1);
    b[VAC_B.fill].scale.set(1, Math.max(HIDDEN, fill), 1);
    const k = ease(dt, 10);
    this.yaw += wrapAngle(af(anim, 'nozzleYaw') - this.yaw) * k;
    this.dist += (af(anim, 'nozzleDist', 1.9, 9) - this.dist) * k;
    const cy = Math.cos(this.yaw), sy = -Math.sin(this.yaw);
    b[VAC_B.swivel].rotation.y = this.yaw;
    const jig = suck > 0 ? Math.sin(time * 47) * 0.012 * suck : 0;
    const nz = b[VAC_B.nozzle];
    nz.position.set(cy * this.dist + jig, VAC.nozzleH + Math.abs(jig), sy * this.dist - jig);
    nz.rotation.y = this.yaw;
    const [sx, sY] = VAC.swivel;
    const h = this.hose;
    h.p0.set(sx + cy * 0.34, sY + 0.06, sy * 0.34);
    h.p1.set(sx + cy * 1.2, sY + 0.55, sy * 1.2);
    h.p2.set(nz.position.x - cy * 0.25, VAC.nozzleH + 1.3, nz.position.z - sy * 0.25);
    h.p3.set(nz.position.x, VAC.nozzleH + 0.02, nz.position.z);
    h.apply(b, VAC_B.hose0, VAC.rings, 0.02 * suck, time);
  }
}

export function createCollector(): ModelInstance { return new CollectorModel(); }
