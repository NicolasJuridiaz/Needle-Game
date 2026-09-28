import { strawMound } from './strawHeap';
import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { C, lampMast, namePlate, ports, skid, tierKit } from './kit';
import { shade, type Parts } from './parts';
import { af, ease, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Power family (red + copper): Hay Generator (firebox with a flickering fire behind a grate, horizontal
 * boiler, chimney, flywheel dynamo, load gauge; industrial = second chimney + copper pipework) and the
 * Power Pole (wires are drawn by the render layer between the insulators at the top).
 */

const RED = C.power;
const RED_DK = shade(C.power, 0.55);
const COPPER = C.copper;

// =============================================================================================
// Hay Generator
// =============================================================================================

const GEN = { fbX: -0.8, fbTop: 1.64, doorZ: 0.72, boilerY: 1.3 };
const GEN_B = { fire: 1, fuel: 2, fly: 3, needle: 4, ind: 5 };

function chimney(p: Parts, x: number, z: number, y0: number, y1: number, bone?: number): void {
  p.cyl('paint', 0.16, 0.2, y1 - y0, C.steelDark, { pos: [x, (y0 + y1) / 2, z], bone }, 12);
  p.cyl('metal', 0.21, 0.21, 0.08, C.frame, { pos: [x, y0 + 0.5, z], bone }, 12);
  p.cyl('paint', 0.26, 0.18, 0.12, C.black, { pos: [x, y1 + 0.02, z], bone }, 12);
  for (let k = 0; k < 3; k++) p.cyl('paint', 0.172, 0.172, 0.07, k % 2 ? C.white : RED, { pos: [x, y1 - 0.18 - k * 0.07, z], bone }, 12);
}

function generatorTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 3, { h: 0.14, inset: 0.05, hazard: true });
  ports(p, 'hayGenerator', undefined, { accent: RED_DK });
  // firebox
  p.bev('paint', [1.0, GEN.fbTop - 0.14, 1.44], 0.05, RED_DK, { pos: [GEN.fbX, 0.14 + (GEN.fbTop - 0.14) / 2, 0] });
  p.bev('metal', [1.06, 0.08, 1.5], 0.02, C.frame, { pos: [GEN.fbX, GEN.fbTop, 0] });
  const dz = GEN.doorZ;
  p.box('matte', [0.56, 0.44, 0.01], 0x0c0806, { pos: [GEN.fbX, 0.62, dz + 0.005] });
  for (const y of [0.37, 0.87]) p.bev('metal', [0.68, 0.07, 0.07], 0.015, C.steelDark, { pos: [GEN.fbX, y, dz + 0.03] });
  for (const s of [-1, 1]) p.bev('metal', [0.07, 0.56, 0.07], 0.015, C.steelDark, { pos: [GEN.fbX + s * 0.31, 0.62, dz + 0.03] });
  for (let k = 0; k < 5; k++) p.rod('metal', [GEN.fbX - 0.22 + k * 0.11, 0.4, dz + 0.06], [GEN.fbX - 0.22 + k * 0.11, 0.84, dz + 0.06], 0.012, C.black, 5);
  // open door on its hinge
  p.bev('paint', [0.04, 0.48, 0.56], 0.012, RED_DK, { pos: [GEN.fbX - 0.36, 0.62, dz + 0.3] });
  p.decal('grill', 0.4, 0.2, { pos: [GEN.fbX - 0.338, 0.62, dz + 0.3], normal: [1, 0, 0] });
  p.cyl('metal', 0.02, 0.02, 0.5, C.frame, { pos: [GEN.fbX - 0.35, 0.62, dz + 0.03] }, 6);
  namePlate(p, 'plateGenerator', [GEN.fbX, 1.2, -0.735], [0, 0, -1], 0.9, 0.225);
  // boiler
  const by = GEN.boilerY;
  p.cyl('paint', 0.72, 0.72, 1.6, RED, { pos: [0.5, by, 0] }, 18, 'x');
  for (const x of [-0.3, 1.3]) p.cyl('metal', 0.74, 0.74, 0.06, C.frame, { pos: [x, by, 0] }, 18, 'x');
  for (const x of [0.1, 0.5, 0.9]) p.cyl('metal', 0.735, 0.735, 0.05, COPPER, { pos: [x, by, 0] }, 18, 'x');
  p.cyl('paint', 0.2, 0.22, 0.34, COPPER, { pos: [0.55, by + 0.8, 0] }, 12);
  p.sphere('paint', 0.2, COPPER, { pos: [0.55, by + 0.97, 0] }, 12, 6, Math.PI / 2);
  for (const x of [0.0, 1.0]) p.bev('metal', [0.2, 0.62, 1.1], 0.03, C.steelDark, { pos: [x, 0.14 + 0.31, 0] });
  p.bolts([1.33, by + 0.55, 0], [1.33, by - 0.55, 0], 5, [1, 0, 0], 0.022);
  p.decal('gauge', 0.36, 0.36, { pos: [1.335, by, 0], normal: [1, 0, 0] });
  chimney(p, GEN.fbX, -0.35, GEN.fbTop, 3.08);
  p.tube('metal', [[-0.3, by + 0.3, -0.3], [-0.2, by + 0.6, -0.3], [GEN.fbX + 0.2, GEN.fbTop + 0.05, -0.3]], 0.1, C.steelDark, 8);
  // dynamo on the +Z side, flywheel spun by the boiler
  p.cyl('paint', 0.28, 0.28, 0.6, COPPER, { pos: [0.8, 0.5, 1.05] }, 14, 'x');
  for (const x of [0.58, 0.8, 1.02]) p.cyl('metal', 0.29, 0.29, 0.04, C.frame, { pos: [x, 0.5, 1.05] }, 14, 'x');
  p.bev('metal', [0.8, 0.22, 0.6], 0.03, C.steelDark, { pos: [0.7, 0.25, 1.05] });
  p.decal('bolt', 0.22, 0.22, { pos: [1.105, 0.5, 1.05], normal: [1, 0, 0] }, C.factory);
  // output terminal mast
  p.cyl('metal', 0.05, 0.06, 2.4, C.frame, { pos: [1.2, 0.14 + 1.2, -1.15] }, 8);
  p.bev('paint', [0.4, 0.1, 0.1], 0.02, C.frame, { pos: [1.2, 2.5, -1.15] });
  for (const s of [-1, 1]) {
    p.cyl('paint', 0.05, 0.06, 0.16, 0x4e7a52, { pos: [1.2 + s * 0.15, 2.63, -1.15] }, 8);
    p.cyl('metal', 0.02, 0.02, 0.08, COPPER, { pos: [1.2 + s * 0.15, 2.75, -1.15] }, 6);
  }
  namePlate(p, 'plateVolt', [1.2, 1.4, -1.085], [0, 0, 1], 0.4, 0.1);
  t.lamp = lampMast(p, [GEN.fbX - 0.3, GEN.fbTop + 0.04, 0.5], 0.15);

  const r = t.r;
  const fire = t.bone(0, [GEN.fbX, 0.4, dz + 0.02]);
  r.box('glowAmber', [0.5, 0.08, 0.01], 0xffffff, { pos: [0, 0.04, 0], bone: fire });
  for (let k = 0; k < 5; k++) {
    const x = -0.2 + k * 0.1, h = 0.2 + ((k * 37) % 5) * 0.04;
    r.cyl('glowFire', 0.0, 0.07, h, 0xffffff, { pos: [x, 0.06 + h / 2, 0], scale: [1, 1, 0.12], bone: fire }, 6);
  }
  const fuel = t.bone(0, [GEN.fbX, 0.38, dz + 0.012]);
  r.add('matte', strawMound(0.5, 51), null, { scale: [0.5, 0.3, 0.02], rot: [0, 0, 0], bone: fuel });
  const fly = t.bone(0, [0.36, 0.5, 1.05]);
  r.cyl('metal', 0.34, 0.34, 0.07, C.frame, { bone: fly }, 18, 'x');
  r.cyl('paint', 0.28, 0.28, 0.075, RED, { bone: fly }, 18, 'x');
  for (let k = 0; k < 3; k++) r.box('metal', [0.08, 0.5, 0.06], C.steelLight, { rot: [(k * Math.PI) / 3, 0, 0], bone: fly });
  const needle = t.bone(0, [1.345, by, 0]);
  r.box('paint', [0.01, 0.14, 0.02], 0xd33a2c, { pos: [0, 0.06, 0], bone: needle });
  const ind = t.bone(0);
  chimney(r, GEN.fbX, 0.35, GEN.fbTop, 3.08, ind);
  r.tube('paint', [[0.1, by + 0.72, 0.2], [0.0, by + 1.1, 0.4], [GEN.fbX + 0.2, 2.2, 0.45], [GEN.fbX + 0.05, 2.5, 0.35]], 0.05, COPPER, 8, ind);
  r.tube('paint', [[1.0, by + 0.6, 0.45], [1.1, 1.3, 0.9], [0.9, 0.8, 1.05]], 0.045, COPPER, 8, ind);
  r.tube('paint', [[-0.3, by - 0.4, 0.5], [-0.35, 0.9, 0.9], [0.2, 0.75, 1.1]], 0.045, COPPER, 8, ind);
  r.cyl('paint', 0.16, 0.18, 0.3, COPPER, { pos: [1.0, by + 0.78, 0] }, 12, 'y');
  tierKit(t, 3, 3, { postH: 1.2 });
  t.cullRadius = 2.8; t.cullCentre = [0, 1.5, 0];
  return t.build();
}

class GeneratorModel extends RigModel {
  private flyA = 0;
  private needleA = 0;
  constructor() { super(cachedTemplate('hayGenerator', generatorTemplate), 'hayGenerator'); this.animate({}, 0, 0); }
  protected animate(anim: Record<string, number>, dt: number, time: number): void {
    const b = this.rig.bones;
    const fire = af(anim, 'fire', 0, 1);
    const fuel = af(anim, 'fuel', 0, 1);
    const load = af(anim, 'load', 0, 1.5);
    if (fire < 0.02) b[GEN_B.fire].scale.setScalar(HIDDEN);
    else {
      const flick = 0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 7.3 + 1);
      b[GEN_B.fire].scale.set(0.8 + fire * 0.2, (0.35 + fire * 0.9) * flick, 1);
    }
    b[GEN_B.fuel].scale.setScalar(fuel < 0.02 ? HIDDEN : 0.35 + fuel * 0.65);
    this.flyA = (this.flyA + dt * fire * (2 + load * 10)) % (Math.PI * 2);
    b[GEN_B.fly].rotation.x = this.flyA;
    this.needleA += ((1.1 - Math.min(1.2, load) * 1.8) - this.needleA) * ease(dt, 4);
    b[GEN_B.needle].rotation.x = this.needleA;
    this.rig.show(GEN_B.ind, af(anim, 'industrial') > 0.5);
  }
}

export function createGenerator(): ModelInstance { return new GeneratorModel(); }

// =============================================================================================
// Power Pole
// =============================================================================================

function poleTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  p.bev('paint', [0.56, 0.22, 0.56], 0.04, 0x8d8a83, { pos: [0, 0.11, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.bolt([sx * 0.17, 0.22, sz * 0.17], [0, 1, 0], 0.025);
  p.cyl('metal', 0.14, 0.16, 0.08, C.frame, { pos: [0, 0.26, 0] }, 10);
  p.cyl('paint', 0.1, 0.11, 1.8, RED, { pos: [0, 0.3 + 0.9, 0] }, 10);
  p.cyl('metal', 0.08, 0.1, 2.9, C.steel, { pos: [0, 2.1 + 1.45, 0] }, 10);
  for (let k = 0; k < 4; k++) p.cyl('paint', 0.113, 0.113, 0.08, k % 2 ? RED : C.white, { pos: [0, 0.9 + k * 0.08, 0] }, 10);
  namePlate(p, 'plateVolt', [0.12, 1.65, 0], [1, 0, 0], 0.4, 0.1, C.black);
  for (let k = 0; k < 6; k++) {
    const y = 2.2 + k * 0.35, s = k % 2 ? 1 : -1;
    p.rod('metal', [0, y, 0], [0, y, s * 0.2], 0.018, C.steelLight, 5);
  }
  // crossarm + insulators + finial coil
  p.bev('paint', [0.12, 0.12, 1.1], 0.02, C.steelDark, { pos: [0, 4.55, 0] });
  for (const s of [-1, 1]) p.rod('metal', [0, 4.2, 0], [0, 4.52, s * 0.4], 0.02, C.steelDark, 5);
  for (const z of [-0.45, 0.45]) {
    for (let k = 0; k < 3; k++) p.cyl('paint', 0.07 - k * 0.008, 0.075 - k * 0.008, 0.05, 0x4e7a52, { pos: [0, 4.65 + k * 0.06, z] }, 10);
    p.cyl('metal', 0.02, 0.02, 0.1, COPPER, { pos: [0, 4.85, z] }, 6);
  }
  p.cyl('paint', 0.05, 0.06, 0.3, 0x4e7a52, { pos: [0, 4.8, 0] }, 8);
  p.torus('paint', 0.06, 0.02, COPPER, { pos: [0, 5.0, 0], rot: [Math.PI / 2, 0, 0] }, 5, 10);
  p.cyl('metal', 0.02, 0.03, 0.14, COPPER, { pos: [0, 5.05, 0] }, 6);
  t.lamp = lampMast(p, [0.1, 4.61, 0], 0, { size: 0.05 });
  t.cullRadius = 3; t.cullCentre = [0, 2.5, 0];
  return t.build();
}

class PoleModel extends RigModel {
  constructor() { super(cachedTemplate('powerPole', poleTemplate), 'powerPole'); }
  protected animate(): void { /* static */ }
}

export function createPole(): ModelInstance { return new PoleModel(); }
