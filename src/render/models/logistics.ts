import * as THREE from 'three';
import { BUILDABLES } from '../../config/buildables';
import { portDefsOf } from '../../sim/grid';
import type { BuildingType, PortDef } from '../../sim/types';
import type { ModelInstance } from './api';
import { cachedGeometry, cachedTemplate } from './cache';
import { buildConveyorGeometry, rampBeltY, type ConveyorGeometryKind } from './conveyor';
import { BH, C, LEVEL_H, namePlate, portFace } from './kit';
import { beltMaterial, modelMaterial } from './materials';
import { shade, type Parts, type V3 } from './parts';
import { af, ease, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Logistics family (steel blue + black belts): conveyor (ghost / gallery), ramps, splitters, mergers,
 * lane splitters / mergers and the belt lift. None of them are powered, so no status lamp (setStatus is a
 * no-op), except the splitter's mode display which lights up.
 */

const BLUE = C.logistics;
const BLUE_DK = shade(C.logistics, 0.62);
const BELT = 0x262626;

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------

function tileGeo(kind: ConveyorGeometryKind): { frame: THREE.BufferGeometry; belt: THREE.BufferGeometry } {
  return {
    frame: cachedGeometry(`conv.frame.${kind}`, () => buildConveyorGeometry(kind).frame),
    belt: cachedGeometry(`conv.belt.${kind}`, () => buildConveyorGeometry(kind).belt),
  };
}

/**
 * Short belt stub for a port of a compact logistics piece: bed, black belt and rails from the face inwards
 * by `len`, with a chevron showing the flow direction (blue = in, green = out).
 */
export function beltStub(p: Parts, w: number, d: number, pd: PortDef, len: number, bone = 0): void {
  const f = portFace(w, d, pd.cell, pd.dir);
  const y = (pd.levelOffset ?? 0) * LEVEL_H;
  const cx = f.x - f.nx * len / 2, cz = f.z - f.nz * len / 2;
  const along = f.nx !== 0;
  const sz = (a: number, b: number, h: number): V3 => (along ? [a, h, b] : [b, h, a]);
  p.box('matte', sz(len, 0.8, 0.03), BELT, { pos: [cx, y + BH - 0.015, cz], bone });
  p.box('matte', sz(len, 0.84, 0.12), 0x2b2f33, { pos: [cx, y + BH - 0.09, cz], bone });
  for (const s of [-1, 1]) {
    const ox = along ? 0 : s * 0.44, oz = along ? s * 0.44 : 0;
    p.box('paint', sz(len, 0.07, 0.25), BLUE, { pos: [cx + ox, y + BH - 0.07, cz + oz], bone });
  }
  if (y === 0) {
    // posts under the stub rails
    for (const s of [-1, 1]) {
      const ox = along ? 0 : s * 0.44, oz = along ? s * 0.44 : 0;
      p.box('metal', [0.05, BH - 0.2, 0.05], C.frame, { pos: [cx + ox, (BH - 0.2) / 2, cz + oz], bone });
    }
  }
  const flow: V3 = pd.kind === 'in' ? [-f.nx, 0, -f.nz] : [f.nx, 0, f.nz];
  p.decal('chevron', Math.min(0.3, len * 0.9), Math.min(0.3, len * 0.9), { pos: [cx, y + BH + 0.002, cz], normal: [0, 1, 0], up: flow, bone }, pd.kind === 'in' ? 0x8ac4ff : 0x9dff8a);
}

function stubs(p: Parts, type: BuildingType, variant: string | undefined, len: number): void {
  const def = BUILDABLES[type];
  const [w, d] = def.footprint;
  for (const pd of portDefsOf(def, variant)) beltStub(p, w, d, pd, len);
}

/** Compact hub housing: plinth, open sides at belt height, corner posts and a hood. */
function hub(p: Parts, sx: number, sz: number, top = 0.9): void {
  p.bev('paint', [sx, BH - 0.03, sz], 0.025, BLUE, { pos: [0, (BH - 0.03) / 2, 0] });
  p.hazard(sx - 0.1, 0.08, { pos: [0, 0.1, sz / 2 + 0.002], normal: [0, 0, 1] });
  p.box('matte', [sx - 0.04, 0.03, sz - 0.04], BELT, { pos: [0, BH - 0.015, 0] });
  const ph = top - 0.14 - BH;
  for (const ax of [-1, 1]) for (const az of [-1, 1]) {
    p.bev('paint', [0.08, ph, 0.08], 0.015, BLUE, { pos: [ax * (sx / 2 - 0.04), BH + ph / 2, az * (sz / 2 - 0.04)] });
  }
  p.bev('paint', [sx + 0.06, 0.14, sz + 0.06], 0.035, BLUE, { pos: [0, top - 0.07, 0] });
  p.box('matte', [sx - 0.08, 0.02, sz - 0.08], 0x151617, { pos: [0, top - 0.15, 0] });
  for (const ax of [-1, 1]) for (const az of [-1, 1]) p.bolt([ax * (sx / 2 - 0.03), top, az * (sz / 2 - 0.03)], [0, 1, 0], 0.018);
  for (const s of [-1, 1]) p.hazard(sx - 0.1, 0.06, { pos: [0, top - 0.07, s * (sz / 2 + 0.031)], normal: [0, 0, s] });
}

/** Flash light (bone scaled by anim.flash) on a small housing. Returns the bone index. */
function flashLight(t: TemplateBuilder, pos: V3): number {
  t.s.cyl('paint', 0.05, 0.06, 0.03, C.black, { pos: [pos[0], pos[1] + 0.015, pos[2]] }, 10);
  const b = t.bone(0, [pos[0], pos[1] + 0.03, pos[2]]);
  t.r.sphere('glowGreen', 0.045, 0xffffff, { bone: b }, 10, 5, Math.PI / 2);
  return b;
}

// ---------------------------------------------------------------------------------------------
// Conveyor (ghost / gallery; BeltView draws the real ones instanced)
// ---------------------------------------------------------------------------------------------

class ConveyorModel implements ModelInstance {
  readonly root = new THREE.Group();
  private readonly frame: THREE.Mesh;
  private readonly belt: THREE.Mesh;
  private curve = 0;

  constructor() {
    this.root.name = 'conveyor';
    const g = tileGeo('straight');
    this.frame = new THREE.Mesh(g.frame, modelMaterial());
    this.belt = new THREE.Mesh(g.belt, beltMaterial());
    this.frame.castShadow = this.frame.receiveShadow = true;
    this.belt.receiveShadow = true;
    this.root.add(this.frame, this.belt);
  }

  update(anim: Record<string, number>): void {
    const c = Math.round(af(anim, 'curve', -1, 1));
    if (c === this.curve) return;
    this.curve = c;
    const g = tileGeo(c < 0 ? 'curveL' : c > 0 ? 'curveR' : 'straight');
    this.frame.geometry = g.frame;
    this.belt.geometry = g.belt;
  }

  setStatus(): void { /* unpowered */ }
  dispose(): void { this.root.removeFromParent(); }
}

export function createConveyor(): ModelInstance { return new ConveyorModel(); }

// ---------------------------------------------------------------------------------------------
// Conveyor ramp (up / down)
// ---------------------------------------------------------------------------------------------

function rampTemplate(down: boolean): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  // UP / DOWN plates on the rails (aligned with the slope) and hazard bands at the elevated end
  const slopeAt = (x: number): number => Math.atan2(rampBeltY(x + 0.05, down) - rampBeltY(x - 0.05, down), 0.1);
  for (const s of [-1, 1]) {
    for (const x of [-0.45, 0.45]) {
      const a = slopeAt(x);
      p.decal(down ? 'down' : 'up', 0.32, 0.16, { pos: [x, rampBeltY(x, down) - 0.08, s * 0.477], normal: [0, 0, s], up: [-Math.sin(a), Math.cos(a), 0] });
    }
    p.hazard(0.3, 0.1, { pos: [down ? -1.33 : 1.33, LEVEL_H + BH - 0.08, s * 0.477], normal: [0, 0, s] });
  }
  t.cullRadius = 2.6; t.cullCentre = [0, 1.4, 0];
  return t.build();
}

class RampModel extends RigModel {
  private readonly belt: THREE.Mesh;
  private readonly frame: THREE.Mesh;
  constructor(down: boolean) {
    super(cachedTemplate(`ramp.${down ? 'down' : 'up'}`, () => rampTemplate(down)), 'conveyorRamp');
    const g = tileGeo(down ? 'rampDown' : 'ramp');
    this.frame = new THREE.Mesh(g.frame, modelMaterial());
    this.frame.castShadow = this.frame.receiveShadow = true;
    this.belt = new THREE.Mesh(g.belt, beltMaterial());
    this.belt.receiveShadow = true;
    this.root.add(this.frame, this.belt);
  }
  protected animate(): void { /* static */ }
}

export function createRamp(variant?: string): ModelInstance { return new RampModel(variant === 'down'); }

// ---------------------------------------------------------------------------------------------
// Splitter / Merger (1×1)
// ---------------------------------------------------------------------------------------------

const MODE_REGIONS = ['modeEven', 'modeAlt', 'modePrio', 'modeOver', 'modeSmart'] as const;
const FILTER_COLORS = [C.hay, C.hayDark, C.white];

interface HubBones { vane?: number; flash: number; modes: number[]; filters: number[] }
const HUB_BONES = new Map<string, HubBones>();

function splitterTemplate(kind: 'splitter' | 'merger'): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  hub(p, 0.66, 0.66);
  stubs(p, kind, undefined, 0.17);
  const bones: HubBones = { flash: 0, modes: [], filters: [] };
  const r = t.r;
  if (kind === 'splitter') {
    // mode display window on the hood
    p.box('matte', [0.4, 0.012, 0.4], 0x0e1112, { pos: [0, 0.905, 0] });
    for (let m = 0; m < MODE_REGIONS.length; m++) {
      const b = t.bone(0, [0, 0.913, 0]);
      r.decal(MODE_REGIONS[m], 0.34, 0.34, { normal: [0, 1, 0], up: [1, 0, 0], bone: b });
      bones.modes.push(b);
    }
    for (let k = 0; k < 3; k++) {
      const b = t.bone(0, [0.24, 0.905, 0.24]);
      r.bev('paint', [0.09, 0.07, 0.09], 0.015, FILTER_COLORS[k], { pos: [0, 0.035, 0], bone: b });
      bones.filters.push(b);
    }
    // diverter vane (pivot at the back)
    const v = t.bone(0, [-0.27, BH, 0]);
    r.bev('paint', [0.42, 0.24, 0.035], 0.01, C.factory, { pos: [0.21, 0.13, 0], bone: v });
    r.cyl('metal', 0.03, 0.03, 0.3, C.steelLight, { pos: [0, 0.15, 0], bone: v }, 8);
    bones.vane = v;
    bones.flash = flashLight(t, [-0.25, 0.9, -0.25]);
  } else {
    p.decal('arrow', 0.34, 0.34, { pos: [0, 0.902, 0], normal: [0, 1, 0], up: [1, 0, 0] }, 0x9dff8a);
    bones.flash = flashLight(t, [-0.25, 0.9, -0.25]);
    // merge paddle wheel under the hood (spins while items pass)
    const v = t.bone(0, [0.05, BH + 0.2, 0]);
    for (let k = 0; k < 3; k++) r.bev('paint', [0.05, 0.3, 0.02], 0.008, C.factory, { rot: [0, (k * Math.PI) / 3, 0], bone: v });
    bones.vane = v;
  }
  HUB_BONES.set(kind, bones);
  t.cullRadius = 1; t.cullCentre = [0, 0.45, 0];
  return t.build();
}

class SplitterModel extends RigModel {
  private readonly b: HubBones;
  private mode = -1;
  private filter = -1;
  private side = 1;
  private lastFlash = 0;
  private vaneA = 0;
  private spinA = 0;

  constructor(readonly kind: 'splitter' | 'merger') {
    super(cachedTemplate(kind, () => splitterTemplate(kind)), kind);
    this.b = HUB_BONES.get(kind)!;
    if (kind === 'splitter') this.setMode(0, 0);
  }

  private setMode(mode: number, filter: number): void {
    if (mode === this.mode && filter === this.filter) return;
    this.mode = mode; this.filter = filter;
    this.b.modes.forEach((bi, i) => this.rig.show(bi, i === mode));
    this.b.filters.forEach((bi, i) => this.rig.show(bi, mode === 4 && i === filter));
  }

  protected animate(anim: Record<string, number>, dt: number): void {
    const flash = af(anim, 'flash', 0, 1);
    const bones = this.rig.bones;
    const fl = bones[this.b.flash];
    fl.scale.setScalar(flash > 0.05 ? 0.4 + flash * 0.9 : HIDDEN);
    if (flash > this.lastFlash + 0.3) this.side = -this.side;
    this.lastFlash = flash;
    if (this.kind === 'splitter') {
      this.setMode(Math.round(af(anim, 'mode', 0, 4)), Math.round(af(anim, 'filter', 0, 2)));
      this.vaneA += (this.side * 0.55 * flash - this.vaneA) * ease(dt, 12);
      bones[this.b.vane!].rotation.y = this.vaneA;
    } else {
      this.spinA = (this.spinA + dt * flash * 9) % (Math.PI * 2);
      bones[this.b.vane!].rotation.y = this.spinA;
    }
  }
}

export function createSplitter(): ModelInstance { return new SplitterModel('splitter'); }
export function createMerger(): ModelInstance { return new SplitterModel('merger'); }

// ---------------------------------------------------------------------------------------------
// Lane splitter / merger (1×2)
// ---------------------------------------------------------------------------------------------

function laneTemplate(kind: 'uSplitter' | 'uMerger'): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  hub(p, 0.66, 1.66);
  stubs(p, kind, undefined, 0.17);
  // lane dividers / guide under the hood
  p.bev('metal', [0.5, 0.16, 0.04], 0.01, C.steelLight, { pos: [0, BH + 0.08, 0], rot: [0, kind === 'uSplitter' ? -0.5 : 0.5, 0] });
  p.decal(kind === 'uSplitter' ? 'arrow' : 'arrow', 0.3, 0.3, { pos: [0, 0.902, -0.45], normal: [0, 1, 0], up: [1, 0, 0] }, 0x9dff8a);
  p.decal('arrow', 0.3, 0.3, { pos: [0, 0.902, 0.45], normal: [0, 1, 0], up: [1, 0, 0] }, kind === 'uSplitter' ? 0x9dff8a : 0x8ac4ff);
  const flash = flashLight(t, [-0.25, 0.9, 0]);
  const v = t.bone(0, [kind === 'uSplitter' ? -0.27 : 0.27, BH, -0.5]);
  t.r.bev('paint', [0.4, 0.22, 0.035], 0.01, C.factory, { pos: [kind === 'uSplitter' ? 0.2 : -0.2, 0.12, 0], bone: v });
  t.r.cyl('metal', 0.03, 0.03, 0.28, C.steelLight, { pos: [0, 0.14, 0], bone: v }, 8);
  HUB_BONES.set(kind, { flash, vane: v, modes: [], filters: [] });
  t.cullRadius = 1.3; t.cullCentre = [0, 0.45, 0];
  return t.build();
}

class LaneModel extends RigModel {
  private readonly b: HubBones;
  private vaneA = 0;
  private side = 1;
  private lastFlash = 0;
  constructor(kind: 'uSplitter' | 'uMerger') {
    super(cachedTemplate(kind, () => laneTemplate(kind)), kind);
    this.b = HUB_BONES.get(kind)!;
  }
  protected animate(anim: Record<string, number>, dt: number): void {
    const flash = af(anim, 'flash', 0, 1);
    const bones = this.rig.bones;
    bones[this.b.flash].scale.setScalar(flash > 0.05 ? 0.4 + flash * 0.9 : HIDDEN);
    if (flash > this.lastFlash + 0.3) this.side = -this.side;
    this.lastFlash = flash;
    this.vaneA += ((this.side > 0 ? 0.5 : 0) * flash - this.vaneA) * ease(dt, 12);
    bones[this.b.vane!].rotation.y = this.vaneA;
  }
}

export function createUSplitter(): ModelInstance { return new LaneModel('uSplitter'); }
export function createUMerger(): ModelInstance { return new LaneModel('uMerger'); }

// ---------------------------------------------------------------------------------------------
// Belt lift (1×1, both levels)
// ---------------------------------------------------------------------------------------------

const LIFT_TOP = 3.4;
const LIFT_BONES = { carriage: 1, weight: 2, pulley: 3 };

function liftTemplate(variant: 'up' | 'down'): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  // base plate + pit
  p.bev('metal', [0.96, 0.08, 0.96], 0.02, C.frame, { pos: [0, 0.04, 0] });
  p.box('matte', [0.66, 0.02, 0.66], 0x121314, { pos: [0, 0.085, 0] });
  // four corner rails
  for (const ax of [-1, 1]) for (const az of [-1, 1]) {
    p.bev('paint', [0.08, LIFT_TOP - 0.2, 0.08], 0.015, BLUE, { pos: [ax * 0.44, (LIFT_TOP - 0.2) / 2 + 0.08, az * 0.44] });
  }
  // side guide rails (z sides), with hazard bands at the level-1 deck height
  for (const az of [-1, 1]) {
    p.box('metal', [0.04, LIFT_TOP - 0.3, 0.03], C.steelLight, { pos: [0, LIFT_TOP / 2, az * 0.46] });
    p.hazard(0.8, 0.08, { pos: [0, LEVEL_H, az * 0.485], normal: [0, 0, az] });
    p.box('paint', [0.96, 0.06, 0.04], BLUE_DK, { pos: [0, LEVEL_H, az * 0.46] });
  }
  // head frame with the pulley housing
  p.bev('paint', [1.0, 0.14, 1.0], 0.03, BLUE, { pos: [0, LIFT_TOP - 0.13, 0] });
  p.bev('paint', [0.3, 0.34, 0.22], 0.03, BLUE_DK, { pos: [0, LIFT_TOP - 0.2, 0.42] });
  namePlate(p, 'plateLift', [0, 1.5, 0.5], [0, 0, 1], 0.6, 0.15);
  p.decal(variant, 0.3, 0.15, { pos: [0, 1.28, 0.48], normal: [0, 0, 1] });
  p.decal(variant, 0.3, 0.15, { pos: [0, 1.28, -0.48], normal: [0, 0, -1] });
  stubs(p, 'beltLift', variant, 0.14);
  const r = t.r;
  // carriage: platform with rollers and side cheeks
  const car = t.bone(0, [0, BH, 0]);
  r.bev('paint', [0.72, 0.08, 0.84], 0.02, C.factory, { pos: [0, -0.06, 0], bone: car });
  for (let k = 0; k < 4; k++) r.cyl('metal', 0.035, 0.035, 0.76, C.steelLight, { pos: [-0.27 + k * 0.18, 0, 0], bone: car }, 8, 'z');
  for (const az of [-1, 1]) r.bev('paint', [0.72, 0.18, 0.04], 0.01, C.factory, { pos: [0, 0.05, az * 0.42], bone: car });
  r.hazard(0.7, 0.06, { pos: [0, -0.06, 0.422], normal: [0, 0, 1], bone: car });
  // counterweight (moves opposite) on the +Z side
  const cw = t.bone(0, [0, 0, 0.46]);
  r.bev('metal', [0.22, 0.4, 0.06], 0.015, C.steelDark, { pos: [0, 0, 0], bone: cw });
  r.hazard(0.2, 0.06, { pos: [0, 0.12, 0.031], normal: [0, 0, 1], bone: cw });
  // pulley
  const pul = t.bone(0, [0, LIFT_TOP - 0.2, 0.3]);
  r.cyl('metal', 0.14, 0.14, 0.05, C.steelLight, { rot: [Math.PI / 2, 0, 0], bone: pul }, 10);
  r.box('paint', [0.24, 0.03, 0.055], C.factory, { bone: pul });
  t.cullRadius = 2.1; t.cullCentre = [0, 1.7, 0];
  return t.build();
}

class LiftModel extends RigModel {
  constructor(variant: 'up' | 'down') { super(cachedTemplate(`lift.${variant}`, () => liftTemplate(variant)), 'beltLift'); }
  protected animate(anim: Record<string, number>): void {
    const ph = af(anim, 'phase', 0, 1);
    const b = this.rig.bones;
    b[LIFT_BONES.carriage].position.y = BH + ph * LEVEL_H;
    b[LIFT_BONES.weight].position.y = LIFT_TOP - 0.6 - ph * (LIFT_TOP - 1.1);
    b[LIFT_BONES.pulley].rotation.z = ph * 14;
  }
}

export function createLift(variant?: string): ModelInstance { return new LiftModel(variant === 'down' ? 'down' : 'up'); }
