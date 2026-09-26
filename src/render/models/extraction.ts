import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { BH, C, hayMound, lampMast, namePlate, ports, skid } from './kit';
import { shade, type V3 } from './parts';
import { af, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

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
  r.add('decal', hayMound(1, 1, 0.3, 6, 11), 0xffffff, { bone: hay });
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
