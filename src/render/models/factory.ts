import { strawMound } from './strawHeap';
import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { C, lampMast, LEVEL_H, ports, railing, skid } from './kit';
import { shade } from './parts';
import { af, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Factory construction (yellow): the Market Chute (sell station), elevated Platform tiles and Stairs.
 */

const YEL = C.factory;
const YEL_DK = shade(C.factory, 0.7);

// =============================================================================================
// Market Chute — big yellow intake block with a funnel on top and the MARKET sign; a gold coin pops out
// of the funnel on every sale (anim.pulse).
// =============================================================================================

const SELL = { top: 1.37, coinY: 2.25 };

function sellTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 4, { h: 0.12, inset: 0.04, hazard: true });
  p.bev('paint', [2.75, SELL.top - 0.12, 3.6], 0.06, YEL, { pos: [-0.075, 0.12 + (SELL.top - 0.12) / 2, 0] });
  p.bev('metal', [2.85, 0.08, 3.7], 0.02, C.frame, { pos: [-0.075, SELL.top, 0] });
  ports(p, 'sellStation', undefined, { accent: C.frame, depth: 0.02 });
  for (const s of [-1, 1]) p.decal('coin', 0.55, 0.55, { pos: [-1.0, 0.75, s * 1.802], normal: [0, 0, s] });
  p.decal('jokeHay', 2.2, 0.275, { pos: [-1.452, 0.75, 0], normal: [-1, 0, 0] });
  // funnel with a hay heap inside
  p.shell('paint', YEL_DK, 2.3, 3.2, 2.75, 3.75, 0.72, 0.06, { pos: [-0.05, SELL.top + 0.04, 0] }, 0x3a3226);
  p.add('matte', strawMound(0.3, 61), null, { pos: [-0.05, SELL.top + 0.12, 0], scale: [2.1, 1, 3.0] });
  for (const s of [-1, 1]) p.hazard(2.6, 0.16, { pos: [-0.05, SELL.top + 0.64, s * 1.873], normal: [0, 0.14, s] });
  // sign on two posts at the back
  for (const s of [-1, 1]) {
    p.bev('metal', [0.12, 1.95, 0.12], 0.02, C.frame, { pos: [-1.36, SELL.top + 0.95, s * 1.3] });
    p.bolt([-1.36, SELL.top + 0.3, s * 1.3], [1, 0, 0], 0.025);
  }
  p.bev('paint', [0.1, 0.98, 3.1], 0.04, C.frame, { pos: [-1.36, 2.83, 0] });
  p.decal('market', 2.9, 0.906, { pos: [-1.305, 2.83, 0], normal: [1, 0, 0] });
  p.decal('market', 2.9, 0.906, { pos: [-1.415, 2.83, 0], normal: [-1, 0, 0] });
  t.lamp = lampMast(p, [-1.36, 3.32, 1.35], 0, { size: 0.07 });

  const r = t.r;
  const coin = t.bone(0, [-0.05, SELL.coinY, 0]);
  r.cyl('paint', 0.3, 0.3, 0.06, C.gold, { rot: [Math.PI / 2, 0, 0], bone: coin }, 20);
  for (const s of [-1, 1]) r.decal('coin', 0.42, 0.42, { pos: [0, 0, s * 0.031], normal: [0, 0, s], bone: coin });
  const flash = t.bone(0, [-1.3, 2.3, 0]);
  r.box('glowAmber', [0.03, 0.07, 2.9], 0xffffff, { bone: flash });
  r.box('glowAmber', [0.03, 0.07, 2.9], 0xffffff, { pos: [0, 1.06, 0], bone: flash });
  t.cullRadius = 3.4; t.cullCentre = [0, 1.6, 0];
  return t.build();
}

class SellModel extends RigModel {
  private spin = 0;
  constructor() { super(cachedTemplate('sellStation', sellTemplate), 'sellStation'); this.animate({}, 0); }
  protected animate(anim: Record<string, number>, dt: number): void {
    const b = this.rig.bones;
    const pulse = af(anim, 'pulse', 0, 1);
    const coin = b[1];
    if (pulse < 0.03) coin.scale.setScalar(HIDDEN);
    else {
      this.spin = (this.spin + dt * 9) % (Math.PI * 2);
      const up = 1 - pulse;
      coin.position.y = SELL.coinY + Math.sin(Math.min(1, up * 1.4) * Math.PI) * 0.9;
      coin.rotation.y = this.spin;
      coin.scale.setScalar(0.5 + pulse * 0.6);
    }
    this.rig.show(2, pulse > 0.25);
  }
}

export function createSellStation(): ModelInstance { return new SellModel(); }

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
