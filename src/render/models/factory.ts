import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { C, LEVEL_H, railing } from './kit';
import { shade } from './parts';
import { RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Timber SELL HAY stand, elevated platform tiles and stairs.
 */

const YEL = C.factory;
const YEL_DK = shade(C.factory, 0.7);

import { SellerStall } from './sellerStall';
export function createSellStation(): ModelInstance { return new SellerStall(); }

// =============================================================================================
// Platform (level 1 only): deck top at y = 0 (the level-1 floor), centre column down to the floor below.
// =============================================================================================

function platformTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  p.bev('metal', [1.0, 0.16, 1.0], 0.02, C.steel, { pos: [0, -0.08, 0] });
  p.box('metal', [0.96, 0.012, 0.96], shade(C.steel, 1.25), { pos: [0, 0.001, 0] });
  // diamond-plate hint: raised studs
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    p.box('metal', [0.1, 0.008, 0.035], shade(C.steel, 1.45), { pos: [-0.36 + i * 0.24, 0.008, -0.36 + j * 0.24], rot: [0, (i + j) % 2 ? 0.7 : -0.7, 0] });
  }
  for (const s of [-1, 1]) {
    p.box('paint', [1.0, 0.1, 0.02], YEL, { pos: [0, -0.1, s * 0.501] });
    p.box('paint', [0.02, 0.1, 1.0], YEL, { pos: [s * 0.501, -0.1, 0] });
    p.box('metal', [1.0, 0.12, 0.06], C.frame, { pos: [0, -0.22, s * 0.44] });
  }
  p.box('metal', [0.06, 0.12, 0.88], C.frame, { pos: [0, -0.22, 0] });
  p.cyl('paint', 0.07, 0.08, LEVEL_H - 0.28, C.frame, { pos: [0, -LEVEL_H + (LEVEL_H - 0.28) / 2, 0] }, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    p.rod('metal', [0, -0.75, 0], [Math.cos(a) * 0.36, -0.26, Math.sin(a) * 0.36], 0.02, C.frame, 5);
  }
  p.bev('metal', [0.3, 0.04, 0.3], 0.01, C.black, { pos: [0, -LEVEL_H + 0.02, 0] });
  p.hazard(0.4, 0.14, { pos: [0, -LEVEL_H + 0.3, 0.078], normal: [0, 0, 1] });
  t.cullRadius = 1.8; t.cullCentre = [0, -1.2, 0];
  return t.build();
}

class PlatformModel extends RigModel {
  constructor() { super(cachedTemplate('platform', platformTemplate), 'platform'); }
  protected animate(): void { /* static */ }
}

export function createPlatform(): ModelInstance { return new PlatformModel(); }

// =============================================================================================
// Stairs: 10 steps from x = -1.5 (floor) up to the level-1 landing over the last cell.
// =============================================================================================

function stairsTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  const steps = 10, rise = LEVEL_H / steps, run = 0.2;
  for (let k = 1; k <= steps; k++) {
    const x = -1.5 + run * (k - 0.5);
    p.bev('metal', [run + 0.02, 0.05, 0.86], 0.01, C.steel, { pos: [x, rise * k - 0.025, 0] });
    p.box('paint', [0.03, 0.05, 0.86], YEL, { pos: [x + run / 2 - 0.01, rise * k - 0.02, 0] });
  }
  const ang = Math.atan2(LEVEL_H, steps * run);
  const len = Math.hypot(LEVEL_H, steps * run) + 0.1;
  for (const s of [-1, 1]) {
    p.bev('paint', [len, 0.22, 0.06], 0.02, YEL_DK, { pos: [-0.5, LEVEL_H / 2 - 0.12, s * 0.46], rot: [0, 0, ang] });
  }
  // landing
  p.bev('metal', [1.0, 0.18, 1.0], 0.02, C.steel, { pos: [1.0, LEVEL_H - 0.09, 0] });
  p.hazard(0.95, 0.12, { pos: [0.499, LEVEL_H - 0.09, 0], normal: [-1, 0, 0] });
  for (const sx of [0.55, 1.45]) for (const sz of [-0.44, 0.44]) {
    p.box('paint', [0.08, LEVEL_H - 0.18, 0.08], YEL_DK, { pos: [sx, (LEVEL_H - 0.18) / 2, sz] });
  }
  for (const sz of [-0.44, 0.44]) p.rod('metal', [0.55, 0.2, sz], [1.45, LEVEL_H - 0.3, sz], 0.02, C.frame, 5);
  p.box('matte', [0.3, 0.02, 0.9], C.black, { pos: [-1.45, 0.01, 0] });
  // railings
  for (const s of [-1, 1]) {
    const z = s * 0.47;
    railing(p, [[-1.42, 0.12, z], [-0.5, 0.12 + (0.92 / (steps * run)) * LEVEL_H, z], [0.5, LEVEL_H, z], [1.45, LEVEL_H, z]], 1.0, YEL);
  }
  t.cullRadius = 2.6; t.cullCentre = [0, 1.4, 0];
  return t.build();
}

class StairsModel extends RigModel {
  constructor() { super(cachedTemplate('stairs', stairsTemplate), 'stairs'); }
  protected animate(): void { /* static */ }
}

export function createStairs(): ModelInstance { return new StairsModel(); }
