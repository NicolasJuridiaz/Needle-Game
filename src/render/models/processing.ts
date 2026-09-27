import { COLORS } from '../palette';
import type { ModelInstance } from './api';
import { cachedTemplate } from './cache';
import { BH, C, hayMound, lampMast, namePlate, ports, skid, tierKit } from './kit';
import { shade, type Parts } from './parts';
import { af, HIDDEN, RigModel, TemplateBuilder, type Template } from './rig';

/**
 * Processing (green) + storage (galvanised): Compressor (bale press with 1–2 rams), Bale Wrapper (rotating
 * film ring around the lane; premium = gold film stripes) and Silo (tall tank with a level window).
 */

const GREEN = C.processing;
const GREEN_DK = shade(C.processing, 0.6);
const FILM = COLORS.wrapFilm;

/** Hay bale (twine bands) centred on its bone, base at y=0. Size along X = length. */
export function baleParts(p: Parts, l: number, h: number, d: number, bone: number, x = 0, z = 0, y = 0): void {
  p.bev('matte', [l, h, d], 0.035, C.hay, { pos: [x, y + h / 2, z], bone });
  p.bev('matte', [l * 0.96, h * 0.1, d * 0.96], 0.02, C.hayLight, { pos: [x, y + h - 0.01, z], bone });
  for (const s of [-1, 1]) {
    p.box('matte', [0.025, h + 0.01, d + 0.01], 0x6b4a22, { pos: [x + s * l * 0.26, y + h / 2, z], bone });
  }
}

/** Roller bed along X at belt height. */
function rollerBed(p: Parts, x0: number, x1: number, z: number, color: number): void {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  p.bev('paint', [len, BH - 0.24, 0.9], 0.02, color, { pos: [cx, 0.14 + (BH - 0.24) / 2, z] });
  for (const s of [-1, 1]) p.box('paint', [len, 0.14, 0.05], color, { pos: [cx, BH - 0.07, z + s * 0.43] });
  const n = Math.max(2, Math.round(len / 0.15));
  for (let i = 0; i < n; i++) {
    p.cyl('metal', 0.035, 0.035, 0.8, C.steelLight, { pos: [x0 + (len * (i + 0.5)) / n, BH - 0.035, z] }, 8, 'z');
  }
}

// =============================================================================================
// Compressor
// =============================================================================================

const CP = { floor: 0.52, ramTop: 1.76, ramLow: 0.9, x: 0.2 };
const CP_B = { hopperHay: 1, ram1: 2, hay1: 3, ch2: 4, ram2: 5, hay2: 6 };

function compressorTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 2, { h: 0.14, inset: 0.04, hazard: true });
  ports(p, 'compressor', undefined, { accent: GREEN_DK });
  // feed box + hopper
  p.bev('paint', [0.8, 0.8, 1.9], 0.04, GREEN, { pos: [-0.9, 0.54, 0] });
  p.shell('paint', GREEN, 0.7, 1.7, 0.84, 1.9, 0.5, 0.04, { pos: [-0.9, 0.94, 0] }, GREEN_DK);
  p.hazard(1.8, 0.1, { pos: [-0.9 - 0.421, 1.38, 0], normal: [-1, 0, 0] });
  p.decal('jokeHands', 1.3, 0.16, { pos: [-0.9, 0.62, -0.952], normal: [0, 0, -1] });
  // press frame
  p.bev('paint', [1.4, 0.38, 1.9], 0.04, GREEN_DK, { pos: [CP.x, 0.14 + 0.19, 0] });
  p.box('metal', [1.26, 0.02, 1.76], C.steelLight, { pos: [CP.x, CP.floor, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    p.bev('paint', [0.14, 2.2, 0.14], 0.03, GREEN, { pos: [CP.x + sx * 0.64, 0.5 + 1.1, sz * 0.88] });
  }
  p.bev('paint', [1.5, 0.28, 1.95], 0.05, GREEN, { pos: [CP.x, 2.5, 0] });
  namePlate(p, 'plateCompressor', [CP.x + 0.755, 2.5, 0], [1, 0, 0], 1.0, 0.25);
  // back wall of the chambers (reads as the press box) with warning plates
  p.bev('metal', [0.05, 1.3, 1.76], 0.015, C.frame, { pos: [CP.x - 0.6, 1.17, 0] });
  p.decal('warning', 0.3, 0.3, { pos: [CP.x - 0.572, 1.5, -0.5], normal: [1, 0, 0] });
  // chamber 1 cylinder (chamber 2 lives on a bone)
  p.cyl('paint', 0.2, 0.2, 0.5, C.steelDark, { pos: [CP.x, 2.1, -0.5] }, 12);
  p.cyl('metal', 0.16, 0.16, 0.14, C.frame, { pos: [CP.x, 2.71, -0.5] }, 12);
  // bale chute rollers to the output
  rollerBed(p, 0.9, 1.22, -0.5, GREEN_DK);
  // hydraulic pack
  p.bev('paint', [0.36, 0.5, 0.4], 0.04, C.frame, { pos: [1.2, 0.39, 0.62] });
  p.decal('gauge', 0.2, 0.2, { pos: [1.2, 0.5, 0.822], normal: [0, 0, 1] });
  p.tube('matte', [[1.2, 0.64, 0.6], [1.1, 1.8, 0.8], [CP.x + 0.2, 2.35, 0.6]], 0.03, C.black);
  t.lamp = lampMast(p, [CP.x - 0.55, 2.64, 0.8], 0.06);

  const r = t.r;
  const hh = t.bone(0, [-0.9, 1.0, 0]);
  r.add('decal', hayMound(1, 1, 0.3, 6, 41), 0xffffff, { bone: hh });
  const ram = (parent: number, z: number): [number, number] => {
    const rb = t.bone(parent, [CP.x, CP.ramTop, z]);
    r.cyl('chrome', 0.075, 0.075, 1.0, C.steelLight, { pos: [0, 0.5, 0], bone: rb }, 10);
    r.bev('paint', [1.0, 0.1, 0.78], 0.025, C.factory, { bone: rb });
    r.hazard(0.95, 0.08, { pos: [0.501, 0, 0], normal: [1, 0, 0], bone: rb });
    const hb = t.bone(parent, [CP.x, CP.floor + 0.01, z]);
    r.bev('matte', [0.94, 1, 0.72], 0.02, C.hay, { pos: [0, 0.5, 0], bone: hb });
    return [rb, hb];
  };
  ram(0, -0.5);
  const ch2 = t.bone(0);
  r.cyl('paint', 0.2, 0.2, 0.5, C.steelDark, { pos: [CP.x, 2.1, 0.5], bone: ch2 }, 12);
  r.cyl('metal', 0.16, 0.16, 0.14, C.frame, { pos: [CP.x, 2.71, 0.5], bone: ch2 }, 12);
  ram(ch2, 0.5);
  tierKit(t, 3, 2, { postH: 1.0 });
  t.cullRadius = 2.4; t.cullCentre = [0, 1.3, 0];
  return t.build();
}

class CompressorModel extends RigModel {
  constructor() { super(cachedTemplate('compressor', compressorTemplate), 'compressor'); this.animate({}); }
  protected animate(anim: Record<string, number>): void {
    const b = this.rig.bones;
    const press = af(anim, 'press', 0, 1);
    const fill = af(anim, 'fill', 0, 1);
    const two = af(anim, 'chambers', 1, 2) >= 1.5;
    this.rig.show(CP_B.ch2, two);
    const setRam = (ri: number, hi: number, p: number): void => {
      const y = CP.ramTop - (CP.ramTop - CP.ramLow) * p;
      b[ri].position.y = y;
      const hayH = y - 0.05 - CP.floor;
      if (fill < 0.02 && p < 0.1) b[hi].scale.setScalar(HIDDEN);
      else b[hi].scale.set(1, Math.max(0.05, Math.min(hayH, 0.35 + fill * 0.9)), 1);
    };
    setRam(CP_B.ram1, CP_B.hay1, press);
    if (two) setRam(CP_B.ram2, CP_B.hay2, 1 - press);
    const hh = b[CP_B.hopperHay];
    if (fill < 0.01) hh.scale.setScalar(HIDDEN);
    else { hh.position.y = 1.0 + fill * 0.36; hh.scale.set(0.66 + fill * 0.1, 0.4 + fill, 1.62 + fill * 0.14); }
  }
}

export function createCompressor(): ModelInstance { return new CompressorModel(); }

// =============================================================================================
// Bale Wrapper
// =============================================================================================

const WR = { cx: 0.05, cy: 0.7, cz: -0.5, ringR: 0.46, frameR: 0.56 };
const WR_B = { ring: 1, ringPrem: 2, bale: 3, film: 4, filmPrem: 5 };

function wrapperTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  skid(p, 3, 2, { h: 0.14, inset: 0.04, hazard: true });
  ports(p, 'wrapper', undefined, { accent: GREEN_DK });
  rollerBed(p, -1.3, WR.cx - 0.08, WR.cz, GREEN_DK);
  rollerBed(p, WR.cx + 0.08, 1.22, WR.cz, GREEN_DK);
  // static frame ring + feet + bracket to the cabinet
  p.torus('paint', WR.frameR, 0.05, GREEN, { pos: [WR.cx, WR.cy, WR.cz], rot: [0, Math.PI / 2, 0] }, 6, 28);
  for (const s of [-1, 1]) {
    const a = s * 2.35;
    const y = WR.cy + Math.cos(a) * WR.frameR, z = WR.cz + Math.sin(a) * WR.frameR;
    p.rod('paint', [WR.cx, y, z], [WR.cx, 0.14, z + s * 0.05], 0.045, GREEN, 6);
    p.box('matte', [0.2, 0.04, 0.16], C.black, { pos: [WR.cx, 0.16, z + s * 0.05] });
  }
  p.rod('paint', [WR.cx, WR.cy + WR.frameR * 0.7, WR.cz + WR.frameR * 0.7], [WR.cx, 1.25, 0.25], 0.045, GREEN, 6);
  // cabinet
  p.bev('paint', [2.4, 1.2, 0.7], 0.05, GREEN, { pos: [0, 0.74, 0.58] });
  namePlate(p, 'plateWrapper', [-0.3, 0.8, 0.937], [0, 0, 1], 0.9, 0.225);
  p.decal('jokeHug', 1.0, 0.125, { pos: [0.65, 1.2, 0.932], normal: [0, 0, 1] });
  p.decal('vent', 0.5, 0.25, { pos: [0.75, 0.6, 0.932], normal: [0, 0, 1] });
  p.hazard(2.3, 0.1, { pos: [0, 0.22, 0.932], normal: [0, 0, 1] });
  // control desk
  const n: [number, number, number] = [0, 0.7, 0.72];
  p.bev('paint', [0.6, 0.36, 0.06], 0.02, C.black, { pos: [0.6, 1.45, 0.62], normal: n });
  p.decal('gauge', 0.24, 0.24, { pos: [0.5, 1.45 + n[1] * 0.032, 0.62 + n[2] * 0.032], normal: n });
  // film spool tower
  p.cyl('metal', 0.04, 0.05, 1.3, C.frame, { pos: [-0.85, 1.34 + 0.65, 0.58] }, 8);
  p.cyl('paint', 0.22, 0.22, 0.5, FILM, { pos: [-0.85, 2.3, 0.58] }, 14);
  p.cyl('metal', 0.08, 0.08, 0.56, C.frame, { pos: [-0.85, 2.3, 0.58] }, 8);
  p.cyl('paint', 0.18, 0.18, 0.36, FILM, { pos: [-0.3, 1.52, 0.58] }, 12);
  t.lamp = lampMast(p, [1.0, 1.34, 0.8], 0.3);

  const r = t.r;
  const ring = t.bone(0, [WR.cx, WR.cy, WR.cz]);
  r.torus('metal', WR.ringR, 0.035, C.steelLight, { rot: [0, Math.PI / 2, 0], bone: ring }, 6, 24);
  r.bev('paint', [0.16, 0.1, 0.12], 0.02, C.factory, { pos: [0, WR.ringR, 0], bone: ring });
  r.cyl('paint', 0.075, 0.075, 0.34, FILM, { pos: [0, WR.ringR - 0.1, 0], bone: ring }, 12, 'x');
  r.cyl('metal', 0.03, 0.03, 0.4, C.frame, { pos: [0, WR.ringR - 0.1, 0], bone: ring }, 6, 'x');
  r.bev('metal', [0.14, 0.12, 0.12], 0.02, C.steelDark, { pos: [0, -WR.ringR, 0], bone: ring });
  const ringPrem = t.bone(ring);
  for (const x of [-0.1, 0, 0.1]) r.cyl('paint', 0.079, 0.079, 0.03, C.gold, { pos: [x, WR.ringR - 0.1, 0], bone: ringPrem }, 12, 'x');
  const bale = t.bone(0, [WR.cx, BH, WR.cz]);
  baleParts(r, 0.5, 0.35, 0.36, bale);
  const film = t.bone(bale, [-0.27, 0, 0]);
  r.bev('paint', [0.54, 0.38, 0.4], 0.05, FILM, { pos: [0.27, 0.19, 0], bone: film });
  const filmPrem = t.bone(film);
  for (const x of [0.13, 0.41]) r.box('paint', [0.07, 0.385, 0.405], C.gold, { pos: [x, 0.19, 0], bone: filmPrem });
  t.cullRadius = 2.2; t.cullCentre = [0, 1.2, 0];
  return t.build();
}

class WrapperModel extends RigModel {
  constructor() { super(cachedTemplate('wrapper', wrapperTemplate), 'wrapper'); this.animate({}); }
  protected animate(anim: Record<string, number>): void {
    const b = this.rig.bones;
    const premium = af(anim, 'premium') > 0.5;
    b[WR_B.ring].rotation.x = af(anim, 'spin');
    this.rig.show(WR_B.ringPrem, premium);
    const has = af(anim, 'hasBale') > 0.5;
    this.rig.show(WR_B.bale, has);
    const wrap = af(anim, 'wrap', 0, 1);
    b[WR_B.film].scale.set(wrap > 0.01 ? wrap : HIDDEN, 1, 1);
    this.rig.show(WR_B.filmPrem, premium);
  }
}

export function createWrapper(): ModelInstance { return new WrapperModel(); }

// =============================================================================================
// Silo
// =============================================================================================

const SI = { R: 1.4, base: 1.3, top: 6.2, peak: 6.95, winY0: 1.7, winY1: 5.8 };

function siloTemplate(): Template {
  const t = new TemplateBuilder();
  const p = t.s;
  const S = C.storage, SD = shade(C.storage, 0.72);
  skid(p, 3, 3, { h: 0.12, inset: 0.04 });
  p.bev('paint', [2.6, SI.base - 0.12, 2.6], 0.05, C.frame, { pos: [0, 0.12 + (SI.base - 0.12) / 2, 0] });
  ports(p, 'silo', undefined, { accent: C.steelDark });
  p.hazard(2.5, 0.12, { pos: [0, SI.base - 0.08, -1.302], normal: [0, 0, -1] });
  namePlate(p, 'plateSilo', [1.31, 0.8, 0.9], [1, 0, 0], 0.62, 0.232);
  // tank
  p.cyl('paint', SI.R * 0.9, SI.R, 0.3, SD, { pos: [0, SI.base + 0.15, 0] }, 20);
  p.cyl('metal', SI.R, SI.R, SI.top - SI.base - 0.3, S, { pos: [0, (SI.base + 0.3 + SI.top) / 2, 0] }, 20);
  for (let y = SI.base + 0.6; y < SI.top - 0.1; y += 0.55) p.cyl('metal', SI.R + 0.02, SI.R + 0.02, 0.05, SD, { pos: [0, y, 0] }, 20);
  p.cyl('metal', 0.25, SI.R + 0.05, SI.peak - SI.top, S, { pos: [0, (SI.top + SI.peak) / 2, 0] }, 20);
  p.cyl('metal', SI.R + 0.06, SI.R + 0.06, 0.08, SD, { pos: [0, SI.top, 0] }, 20);
  p.cyl('paint', 0.3, 0.3, 0.14, C.frame, { pos: [0, SI.peak + 0.02, 0] }, 12);
  // level window (+X face)
  const wh = SI.winY1 - SI.winY0;
  p.bev('paint', [0.12, wh + 0.2, 0.46], 0.03, C.black, { pos: [SI.R - 0.03, (SI.winY0 + SI.winY1) / 2, 0] });
  p.box('matte', [0.02, wh, 0.32], 0x141414, { pos: [SI.R + 0.035, (SI.winY0 + SI.winY1) / 2, 0] });
  p.box('glass', [0.02, wh, 0.34], 0xffffff, { pos: [SI.R + 0.075, (SI.winY0 + SI.winY1) / 2, 0] });
  p.decal('siloScale', 0.14, wh, { pos: [SI.R * 0.965 + 0.01, (SI.winY0 + SI.winY1) / 2, 0.38], normal: [0.96, 0, 0.27] });
  // ladder (-X side)
  for (const s of [-1, 1]) {
    p.rod('paint', [-SI.R - 0.2, SI.base, s * 0.2], [-SI.R - 0.2, SI.top + 0.3, s * 0.2], 0.022, C.factory, 6);
    for (const y of [SI.base + 0.5, (SI.base + SI.top) / 2, SI.top - 0.2]) p.rod('metal', [-SI.R + 0.02, y, s * 0.2], [-SI.R - 0.2, y, s * 0.2], 0.015, C.frame, 4);
  }
  for (let y = SI.base + 0.3; y < SI.top + 0.2; y += 0.3) p.rod('metal', [-SI.R - 0.2, y, -0.2], [-SI.R - 0.2, y, 0.2], 0.014, C.steelLight, 4);
  for (let y = SI.base + 2; y < SI.top + 0.3; y += 0.7) {
    p.torus('paint', 0.34, 0.015, C.factory, { pos: [-SI.R - 0.2, y, 0], rot: [Math.PI / 2, 0, 0] }, 4, 14, Math.PI);
  }
  // fill pipe up the side
  p.tube('metal', [[-1.05, SI.base, -1.05], [-1.2, SI.base + 0.5, -1.0], [-1.2, SI.top - 0.2, -1.0], [-0.9, SI.top + 0.5, -0.6], [-0.3, SI.peak - 0.1, -0.15]], 0.1, SD, 8);
  p.decal('jokeNeedles', 1.5, 0.19, { pos: [0, 2.3, -SI.R - 0.02], normal: [0, 0, -1] });
  t.lamp = lampMast(p, [0.9, SI.top + 0.04, 0.9], 0.2, { size: 0.1 });

  const r = t.r;
  const fill = t.bone(0, [SI.R + 0.05, SI.winY0, 0]);
  r.box('glowAmber', [0.012, wh, 0.3], C.hay, { pos: [0, wh / 2, 0], bone: fill });
  t.cullRadius = 4.4; t.cullCentre = [0, 3.4, 0];
  return t.build();
}

class SiloModel extends RigModel {
  constructor() { super(cachedTemplate('silo', siloTemplate), 'silo'); this.animate({}); }
  protected animate(anim: Record<string, number>): void {
    this.rig.bones[1].scale.set(1, Math.max(HIDDEN, af(anim, 'fill', 0, 1)), 1);
  }
}

export function createSilo(): ModelInstance { return new SiloModel(); }
