import { strawMound } from './strawHeap';
import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { needleParts } from './detection';
import { C, namePlate } from './kit';
import { shade } from './parts';
import { baleParts } from './processing';
import { af, ease, HIDDEN, RigModel, StaticModel, TemplateBuilder, type Template } from './rig';

/**
 * Props: wheelbarrow (world model; anim.fill, anim.held), a display needle, the order board and the needle
 * trophy case (anim.found = count, or anim.mask = bitmask of found slots) and the delivery truck.
 * Wall props (board, case) face +X with their bottom edge at y = 0 and their width along Z.
 */

// =============================================================================================
// Wheelbarrow: +X = wheel end, handles towards -X. Origin on the ground under the tub.
// =============================================================================================

const WB = { axleX: 0.55, axleY: 0.23, lift: -0.3 };
const TUB = 0x4f8f3f;

function wheelbarrowTemplate(): Template {
  const t = new TemplateBuilder();
  const r = t.r;
  const body = t.bone(0, [WB.axleX, WB.axleY, 0]);
  // tub (tilted slightly forward)
  r.shell('paint', TUB, 0.62, 0.46, 0.98, 0.72, 0.36, 0.035, { pos: [-0.5, 0.08, 0], rot: [0, 0, 0.1], bone: body }, shade(TUB, 0.7));
  r.bev('metal', [1.0, 0.03, 0.03], 0.01, C.steelDark, { pos: [-0.52, 0.47, 0.37], rot: [0, 0, 0.1], bone: body });
  r.bev('metal', [1.0, 0.03, 0.03], 0.01, C.steelDark, { pos: [-0.52, 0.47, -0.37], rot: [0, 0, 0.1], bone: body });
  // frame rails + handles + grips
  for (const s of [-1, 1]) {
    r.rod('metal', [0, 0, s * 0.1], [-0.95, 0.08, s * 0.24], 0.022, C.steelDark, 6, body);
    r.rod('metal', [-0.95, 0.08, s * 0.24], [-1.52, 0.2, s * 0.28], 0.022, C.steelDark, 6, body);
    r.cyl('matte', 0.03, 0.03, 0.22, C.black, { pos: [-1.44, 0.185, s * 0.28], rot: [0, 0, 0.2], bone: body }, 8, 'x');
    r.rod('metal', [-0.85, 0.06, s * 0.22], [-0.9, -WB.axleY + 0.02, s * 0.26], 0.02, C.steelDark, 6, body);
    r.box('matte', [0.08, 0.02, 0.06], C.black, { pos: [-0.9, -WB.axleY + 0.02, s * 0.26], bone: body });
    r.rod('metal', [-0.2, 0.06, s * 0.12], [-0.25, 0.15, s * 0.2], 0.015, C.steelDark, 5, body);
  }
  // wheel
  r.torus('matte', 0.16, 0.065, C.rubber, { bone: body }, 6, 16);
  r.cyl('metal', 0.1, 0.1, 0.1, C.steelLight, { bone: body }, 10, 'z');
  r.cyl('metal', 0.02, 0.02, 0.26, C.steelDark, { bone: body }, 6, 'z');
  // hay load
  const hay = t.bone(body, [-0.5, 0.12, 0]);
  r.add('matte', strawMound(0.35, 71), null, { bone: hay });
  t.cullRadius = 1.5; t.cullCentre = [-0.2, 0.4, 0];
  return t.build();
}

class WheelbarrowModel extends RigModel {
  private tilt = 0;
  constructor() { super(cachedTemplate('prop.wheelbarrow', wheelbarrowTemplate), 'wheelbarrow'); this.animate({}, 1); }
  protected animate(anim: Record<string, number>, dt: number): void {
    const b = this.rig.bones;
    const held = af(anim, 'held') > 0.5;
    this.tilt += ((held ? WB.lift : 0) - this.tilt) * ease(dt, 10);
    b[1].rotation.z = this.tilt;
    const fill = af(anim, 'fill', 0, 1);
    const h = b[2];
    if (fill < 0.02) h.scale.setScalar(HIDDEN);
    else { h.position.y = 0.1 + fill * 0.24; h.scale.set(0.58 + fill * 0.3, 0.3 + fill * 0.5, 0.42 + fill * 0.22); }
  }
}

// =============================================================================================
// Needle (display size, lying along X) with a red thread through the eye
// =============================================================================================

function needleTemplate(): Template {
  const t = new TemplateBuilder();
  needleParts(t.s, 0.5, 0, [0, 0.02, 0]);
  t.s.tube('matte', [[-0.22, 0.02, 0], [-0.26, 0.03, 0.06], [-0.34, 0.01, 0.05], [-0.4, 0.005, -0.03]], 0.004, 0xc8322c, 4);
  t.cullRadius = 0.4; t.cullCentre = [0, 0, 0];
  return t.build();
}

// =============================================================================================
// Order board (cork board with pinned cards)
// =============================================================================================

const TIMBER = 0x8a5a33;

function orderBoardTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  p.bev('paint', [0.08, 1.5, 2.4], 0.03, TIMBER, { pos: [0, 0.75, 0] });
  p.decal('cork', 2.2, 1.3, { pos: [0.041, 0.72, 0], normal: [1, 0, 0] });
  namePlate(p, 'plateOrders', [0.05, 1.62, 0], [1, 0, 0], 0.9, 0.225, 0x2b2014);
  const cards: [number, number, 'orderCardA' | 'orderCardB', number][] = [[0.95, -0.72, 'orderCardA', 0.05], [0.8, -0.2, 'orderCardB', -0.06], [0.95, 0.32, 'orderCardA', 0.03], [0.78, 0.8, 'orderCardB', -0.04]];
  for (const [y, z, name, tilt] of cards) {
    p.decal(name, 0.36, 0.48, { pos: [0.046, y, z], normal: [1, 0, 0], up: [0, Math.cos(tilt), Math.sin(tilt)] });
    p.sphere('paint', 0.018, 0xc8322c, { pos: [0.055, y + 0.2, z] }, 6, 4);
  }
  for (const s of [-1, 1]) p.bolt([0.04, 1.4, s * 1.1], [1, 0, 0], 0.02);
  t.cullRadius = 1.6; t.cullCentre = [0, 0.8, 0];
  return t.build();
}

// =============================================================================================
// Needle trophy case: 6 lit slots
// =============================================================================================

const CASE_B = { needle0: 1, lamp0: 7 };

function needleCaseTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  p.bev('paint', [0.3, 1.25, 2.4], 0.03, TIMBER, { pos: [0, 0.625, 0] });
  p.bev('paint', [0.34, 0.08, 2.44], 0.02, shade(TIMBER, 0.75), { pos: [0.02, 1.25, 0] });
  p.bev('paint', [0.34, 0.08, 2.44], 0.02, shade(TIMBER, 0.75), { pos: [0.02, 0.04, 0] });
  namePlate(p, 'plateNeedles', [0.16, 1.1, 0], [1, 0, 0], 1.0, 0.25, 0x2b2014);
  p.box('glass', [0.02, 0.86, 2.3], 0xffffff, { pos: [0.205, 0.57, 0] });
  const nums = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'] as const;
  for (let i = 0; i < 6; i++) {
    const z = 1.0 - i * 0.4; // slot 1 on the viewer's left
    p.box('matte', [0.02, 0.62, 0.34], 0x5a1418, { pos: [0.151, 0.6, z] });
    p.decal(nums[i], 0.1, 0.1, { pos: [0.162, 0.2, z], normal: [1, 0, 0] });
    p.cyl('metal', 0.035, 0.035, 0.02, C.frame, { pos: [0.12, 0.95, z] }, 8);
  }
  const r = t.r;
  for (let i = 0; i < 6; i++) {
    const b = t.bone(0, [0.172, 0.6, 1.0 - i * 0.4]);
    needleParts(r, 0.48, b, [0, 0, 0], 0); // authored along X; the instance stands it upright
    r.bev('paint', [0.5, 0.01, 0.09], 0.003, C.gold, { pos: [0, 0.014, 0], bone: b });
  }
  for (let i = 0; i < 6; i++) {
    const b = t.bone(0, [0.17, 0.93, 1.0 - i * 0.4]);
    r.box('glowWarm', [0.03, 0.03, 0.28], 0xffffff, { bone: b });
  }
  t.cullRadius = 1.6; t.cullCentre = [0, 0.6, 0];
  return t.build();
}

class NeedleCaseModel extends RigModel {
  private key = -1;
  constructor() {
    super(cachedTemplate('prop.needleCase', needleCaseTemplate), 'needleCase');
    for (let i = 0; i < 6; i++) this.rig.bones[CASE_B.needle0 + i].rotation.z = Math.PI / 2 - 0.1;
    this.animate({});
  }
  protected animate(anim: Record<string, number>): void {
    const mask = anim.mask !== undefined && anim.mask > 0 ? Math.round(anim.mask) : (1 << Math.round(af(anim, 'found', 0, 6))) - 1;
    if (mask === this.key) return;
    this.key = mask;
    for (let i = 0; i < 6; i++) {
      const on = ((mask >> i) & 1) === 1;
      this.rig.show(CASE_B.needle0 + i, on);
      this.rig.show(CASE_B.lamp0 + i, on);
    }
  }
}

// =============================================================================================
// Truck (7 × 3, cab at +X) with a load of bales
// =============================================================================================

function truckTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  const CAB = 0xc8453b;
  p.box('metal', [6.4, 0.3, 1.2], C.steelDark, { pos: [0, 0.75, 0] });
  for (const x of [2.55, -1.3, -2.45]) for (const s of [-1, 1]) {
    p.cyl('matte', 0.5, 0.5, 0.36, C.rubber, { pos: [x, 0.5, s * 1.12] }, 16, 'z');
    p.cyl('metal', 0.26, 0.26, 0.37, C.steelLight, { pos: [x, 0.5, s * 1.12] }, 10, 'z');
    p.cyl('metal', 0.08, 0.08, 0.39, C.frame, { pos: [x, 0.5, s * 1.12] }, 6, 'z');
  }
  // cab
  p.bev('paint', [1.5, 1.55, 2.4], 0.1, CAB, { pos: [2.65, 1.65, 0] });
  p.bev('paint', [0.8, 0.8, 2.4], 0.08, CAB, { pos: [3.05, 0.95, 0] });
  p.box('glass', [0.04, 0.62, 2.1], 0xffffff, { pos: [3.41, 2.0, 0], rot: [0, 0, -0.12] });
  for (const s of [-1, 1]) p.box('glass', [0.8, 0.55, 0.04], 0xffffff, { pos: [2.8, 2.0, s * 1.2] });
  p.box('matte', [0.04, 0.4, 1.6], 0x1a1a1a, { pos: [3.46, 0.95, 0] });
  for (let k = 0; k < 5; k++) p.box('metal', [0.05, 0.03, 1.5], C.steelLight, { pos: [3.48, 0.8 + k * 0.075, 0] });
  for (const s of [-1, 1]) {
    p.box('glowWarm', [0.04, 0.16, 0.3], 0xffffff, { pos: [3.46, 1.1, s * 0.95] });
    p.rod('metal', [3.1, 2.1, s * 1.2], [3.2, 2.1, s * 1.45], 0.02, C.black, 4);
    p.box('matte', [0.06, 0.3, 0.14], C.black, { pos: [3.22, 2.0, s * 1.48] });
  }
  p.bev('metal', [0.2, 0.2, 2.5], 0.04, C.steelLight, { pos: [3.5, 0.55, 0] });
  p.box('glowAmber', [0.2, 0.08, 1.2], 0xffffff, { pos: [2.65, 2.47, 0] });
  p.cyl('metal', 0.07, 0.07, 1.8, C.steelLight, { pos: [1.8, 1.9, 1.0] }, 8);
  // flatbed with side boards + logo
  p.bev('paint', [4.6, 0.15, 2.6], 0.03, TIMBER, { pos: [-0.45, 1.0, 0] });
  for (const s of [-1, 1]) {
    p.bev('paint', [4.5, 0.62, 0.06], 0.02, shade(TIMBER, 0.85), { pos: [-0.45, 1.38, s * 1.28] });
    p.decal('truckLogo', 2.4, 0.6, { pos: [-0.45, 1.38, s * 1.315], normal: [0, 0, s] });
  }
  p.bev('paint', [0.06, 0.62, 2.6], 0.02, shade(TIMBER, 0.85), { pos: [-2.72, 1.38, 0] });
  p.hazard(2.4, 0.12, { pos: [-2.76, 0.78, 0], normal: [-1, 0, 0] });
  for (const s of [-1, 1]) p.box('glowRed', [0.04, 0.12, 0.2], 0xffffff, { pos: [-2.76, 0.95, s * 1.0] });
  // load of bales
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    baleParts(p, 1.1, 0.55, 0.9, 0, -1.9 + i * 1.2, j ? 0.55 : -0.55, 1.075);
  }
  t.cullRadius = 4.4; t.cullCentre = [0, 1.2, 0];
  return t.build();
}

export function createProp(kind: 'wheelbarrow' | 'needle' | 'orderBoard' | 'needleCase' | 'truck'): ModelInstance {
  switch (kind) {
    case 'wheelbarrow': return new WheelbarrowModel();
    case 'needle': return new StaticModel(cachedTemplate('prop.needle', needleTemplate), 'needle');
    case 'orderBoard': return new StaticModel(cachedTemplate('prop.orderBoard', orderBoardTemplate), 'orderBoard');
    case 'needleCase': return new NeedleCaseModel();
    case 'truck': return new StaticModel(cachedTemplate('prop.truck', truckTemplate), 'truck');
  }
}
