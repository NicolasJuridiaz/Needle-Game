import * as THREE from 'three';
import { Rng } from '../core/rng';
import { WORLD } from '../config/world';
import { canvasTexture, context2d, createCanvas } from './textures';

/**
 * Environment-specific procedural canvases: the large non-tiling warehouse floor, the static signage
 * atlas and the (dynamic) order board. Owned (and disposed) by `Environment`.
 */

const FONT = '"Arial Black", "Helvetica Neue", Arial, system-ui, sans-serif';

/** World rectangle covered by the floor texture (interior + annex). */
export const FLOOR_RECT = {
  minX: WORLD.interior.minX, maxX: WORLD.interior.maxX,
  minZ: WORLD.interior.minZ, maxZ: WORLD.annex.maxZ,
} as const;

/** Door opening in the west wall (world z range, height). The Market Chute sits inside it. */
export const DOOR = { z0: 1, z1: 13, height: 8 } as const;

/** Big floor canvas: slab tones, saw-cut joints, stains, tyre marks, hay dust and painted markings. */
export function createFloorTexture(width: number, anisotropy: number): THREE.CanvasTexture {
  const R = FLOOR_RECT;
  const W = width;
  const ppm = W / (R.maxX - R.minX);
  const H = Math.round((R.maxZ - R.minZ) * ppm);
  const cv = createCanvas(W, H);
  const c = context2d(cv);
  const rng = new Rng(0xf1007);
  const X = (x: number) => (x - R.minX) * ppm;
  const Z = (z: number) => (z - R.minZ) * ppm;
  const I = WORLD.interior, A = WORLD.annex;

  c.fillStyle = '#8e8a82';
  c.fillRect(0, 0, W, H);

  // Slabs (8 m along x; 11 m in the hall, 7 m in the annex) with individual tone and a soft gradient.
  const zJoints = [I.minZ, -11, 0, 11, I.maxZ, 29, A.maxZ];
  for (let zi = 0; zi < zJoints.length - 1; zi++) {
    const annex = zJoints[zi] >= I.maxZ;
    for (let x = I.minX; x < I.maxX; x += 8) {
      const l = (annex ? 60 : 55) + rng.range(-2.5, 2.5);
      const g = c.createLinearGradient(X(x), Z(zJoints[zi]), X(x + 8), Z(zJoints[zi + 1]));
      g.addColorStop(0, `hsl(38, ${annex ? 5 : 6}%, ${l + rng.range(-1.5, 1.5)}%)`);
      g.addColorStop(1, `hsl(36, ${annex ? 5 : 6}%, ${l + rng.range(-1.5, 1.5)}%)`);
      c.fillStyle = g;
      c.fillRect(X(x), Z(zJoints[zi]), 8 * ppm + 1, (zJoints[zi + 1] - zJoints[zi]) * ppm + 1);
    }
  }

  // Large soft blotches (curing marks, damp patches).
  for (let i = 0; i < 420; i++) {
    const x = rng.next() * W, y = rng.next() * H, r = rng.range(0.6, 4.5) * ppm;
    const dark = rng.next() < 0.6;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? `rgba(60,55,48,${rng.range(0.03, 0.08)})` : `rgba(235,230,220,${rng.range(0.03, 0.07)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Power-trowel swirls.
  c.lineWidth = Math.max(1, ppm * 0.03);
  for (let i = 0; i < 260; i++) {
    const x = rng.next() * W, y = rng.next() * H, r = rng.range(0.4, 1.4) * ppm;
    c.strokeStyle = `rgba(${rng.next() < 0.5 ? '255,255,250' : '40,38,34'},${rng.range(0.03, 0.06)})`;
    c.beginPath();
    c.arc(x, y, r, rng.next() * 6, rng.next() * 6 + rng.range(0.8, 2.2));
    c.stroke();
  }

  // Hay dust ring around the pile base and scattered straw specks.
  const P = WORLD.pile;
  const dust = c.createRadialGradient(X(P.cx), Z(P.cz), P.rx * 0.6 * ppm, X(P.cx), Z(P.cz), P.rx * 1.45 * ppm);
  dust.addColorStop(0, 'rgba(176,138,62,0.34)');
  dust.addColorStop(0.55, 'rgba(176,138,62,0.14)');
  dust.addColorStop(1, 'rgba(176,138,62,0)');
  c.save();
  c.translate(X(P.cx), Z(P.cz));
  c.scale(1, P.rz / P.rx);
  c.translate(-X(P.cx), -Z(P.cz));
  c.fillStyle = dust;
  c.fillRect(X(P.cx) - P.rx * 1.5 * ppm, Z(P.cz) - P.rx * 1.5 * ppm, P.rx * 3 * ppm, P.rx * 3 * ppm);
  c.restore();
  c.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 1.6 + 0.2;
    const x = X(P.cx + Math.cos(a) * P.rx * d), y = Z(P.cz + Math.sin(a) * P.rz * d);
    const len = rng.range(0.05, 0.22) * ppm, ang = rng.next() * Math.PI;
    c.strokeStyle = `hsla(${rng.range(36, 48)},${rng.range(40, 65)}%,${rng.range(45, 70)}%,${rng.range(0.35, 0.8) * (d > 1.2 ? 0.5 : 1)})`;
    c.lineWidth = Math.max(1, ppm * rng.range(0.012, 0.025));
    c.beginPath();
    c.moveTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len);
    c.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    c.stroke();
  }

  // Tyre marks sweeping in from the loading door.
  for (const off of [-0.9, 0.9]) {
    c.strokeStyle = 'rgba(38,34,30,0.12)';
    c.lineWidth = ppm * 0.28;
    c.beginPath();
    c.moveTo(X(I.minX), Z(7 + off));
    c.bezierCurveTo(X(-22), Z(7 + off), X(-18), Z(-4 + off * 0.8), X(-8), Z(-14 + off));
    c.stroke();
    c.strokeStyle = 'rgba(38,34,30,0.08)';
    c.beginPath();
    c.moveTo(X(I.minX), Z(7.4 + off));
    c.bezierCurveTo(X(-20), Z(8 + off), X(-12), Z(17 + off), X(4), Z(18.5 + off));
    c.stroke();
  }

  // Oil and rust stains.
  for (let i = 0; i < 38; i++) {
    const nearDoor = i < 14;
    const x = nearDoor ? X(rng.range(I.minX + 1, I.minX + 10)) : rng.next() * W;
    const y = nearDoor ? Z(rng.range(DOOR.z0, DOOR.z1)) : rng.next() * H;
    const rust = !nearDoor && rng.next() < 0.35;
    const blobs = rng.int(3, 7);
    for (let b = 0; b < blobs; b++) {
      const bx = x + rng.range(-0.35, 0.35) * ppm, by = y + rng.range(-0.35, 0.35) * ppm;
      const r = rng.range(0.12, 0.5) * ppm;
      const g = c.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, rust ? 'rgba(120,62,30,0.2)' : 'rgba(28,24,20,0.22)');
      g.addColorStop(0.7, rust ? 'rgba(120,62,30,0.1)' : 'rgba(28,24,20,0.1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  }

  // Saw-cut expansion joints.
  const joint = (x0: number, y0: number, x1: number, y1: number) => {
    c.strokeStyle = 'rgba(40,38,35,0.75)';
    c.lineWidth = Math.max(1.5, ppm * 0.05);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    c.strokeStyle = 'rgba(215,210,200,0.35)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0 + 1.5, y0 + 1.5); c.lineTo(x1 + 1.5, y1 + 1.5); c.stroke();
  };
  for (let x = I.minX + 8; x < I.maxX; x += 8) joint(X(x), 0, X(x), H);
  for (const z of zJoints.slice(1, -1)) joint(0, Z(z), W, Z(z));

  // Painted walkway line along the hall walls (worn) and the loading-bay box around the Market Chute.
  const paint = (x0: number, z0: number, x1: number, z1: number, color: string, wid: number) => {
    c.strokeStyle = color;
    c.lineWidth = wid * ppm;
    c.setLineDash([]);
    c.beginPath(); c.moveTo(X(x0), Z(z0)); c.lineTo(X(x1), Z(z1)); c.stroke();
  };
  const yellow = 'rgba(226,182,40,0.82)';
  const inset = 1.2;
  paint(I.minX + inset, I.minZ + inset, I.maxX - inset, I.minZ + inset, yellow, 0.12);
  paint(I.maxX - inset, I.minZ + inset, I.maxX - inset, I.maxZ - inset, yellow, 0.12);
  paint(I.maxX - inset, I.maxZ - inset, I.minX + inset, I.maxZ - inset, yellow, 0.12);
  paint(I.minX + inset, I.maxZ - inset, I.minX + inset, DOOR.z1 + 0.5, yellow, 0.12);
  paint(I.minX + inset, DOOR.z0 - 0.5, I.minX + inset, I.minZ + inset, yellow, 0.12);
  // Loading bay: hatched band in front of the chute's intake side.
  const bx0 = X(I.minX + 3.2), bx1 = X(I.minX + 4.6), bz0 = Z(DOOR.z0 + 0.5), bz1 = Z(DOOR.z1 - 0.5);
  c.save();
  c.beginPath(); c.rect(bx0, bz0, bx1 - bx0, bz1 - bz0); c.clip();
  c.fillStyle = 'rgba(34,32,30,0.55)'; c.fillRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
  c.strokeStyle = 'rgba(232,186,38,0.85)';
  c.lineWidth = ppm * 0.22;
  for (let y = bz0 - (bx1 - bx0); y < bz1 + (bx1 - bx0); y += ppm * 0.6) {
    c.beginPath(); c.moveTo(bx0, y); c.lineTo(bx1, y + (bx1 - bx0)); c.stroke();
  }
  c.restore();
  // Stencil lettering.
  c.save();
  c.translate(X(I.minX + 6.2), Z((DOOR.z0 + DOOR.z1) / 2));
  c.rotate(Math.PI / 2);
  c.font = `900 ${Math.round(ppm * 0.9)}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(232,190,50,0.7)';
  c.fillText('LOADING BAY', 0, 0);
  c.restore();
  // Hazard band where the annex meets the hall.
  c.save();
  c.beginPath(); c.rect(0, Z(I.maxZ) - ppm * 0.25, W, ppm * 0.5); c.clip();
  c.fillStyle = 'rgba(30,28,26,0.8)'; c.fillRect(0, Z(I.maxZ) - ppm * 0.25, W, ppm * 0.5);
  c.fillStyle = 'rgba(235,190,40,0.85)';
  for (let x = -ppm; x < W + ppm; x += ppm * 0.8) {
    c.beginPath();
    c.moveTo(x, Z(I.maxZ) + ppm * 0.25); c.lineTo(x + ppm * 0.4, Z(I.maxZ) + ppm * 0.25);
    c.lineTo(x + ppm * 0.9, Z(I.maxZ) - ppm * 0.25); c.lineTo(x + ppm * 0.5, Z(I.maxZ) - ppm * 0.25);
    c.closePath(); c.fill();
  }
  c.restore();

  // Wear: scuffs and speckles over everything (including the paint).
  for (let i = 0; i < 5200; i++) {
    const x = rng.next() * W, y = rng.next() * H;
    const v = rng.next() < 0.5;
    c.fillStyle = v ? `rgba(245,240,230,${rng.range(0.05, 0.16)})` : `rgba(30,28,25,${rng.range(0.05, 0.18)})`;
    const s = rng.range(0.6, 2.2);
    c.fillRect(x, y, s, s);
  }
  c.lineWidth = 1;
  for (let i = 0; i < 700; i++) {
    const x = rng.next() * W, y = rng.next() * H, len = rng.range(0.1, 0.7) * ppm, a = rng.next() * Math.PI;
    c.strokeStyle = `rgba(${rng.next() < 0.5 ? '240,236,226' : '35,33,30'},${rng.range(0.04, 0.1)})`;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); c.stroke();
  }

  const t = canvasTexture(cv, { anisotropy });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------------------------------------
// Signage atlas
// ------------------------------------------------------------------------------------------------

export type SignName =
  | 'banner' | 'needles' | 'expansion' | 'keepOut' | 'loading' | 'noSmoking' | 'hayHat' | 'daysWithout'
  | 'exit' | 'soon' | 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'n6';

export interface SignRegion { x: number; y: number; w: number; h: number }

const SIGN_ATLAS = 1024;
const SIGN_REGIONS: Record<SignName, SignRegion> = {
  banner: { x: 0, y: 0, w: 1024, h: 150 },
  expansion: { x: 0, y: 150, w: 1024, h: 300 },
  needles: { x: 0, y: 450, w: 512, h: 96 },
  loading: { x: 512, y: 450, w: 512, h: 128 },
  keepOut: { x: 0, y: 546, w: 256, h: 256 },
  noSmoking: { x: 256, y: 578, w: 240, h: 300 },
  hayHat: { x: 496, y: 578, w: 240, h: 300 },
  daysWithout: { x: 736, y: 578, w: 288, h: 200 },
  exit: { x: 736, y: 778, w: 288, h: 100 },
  soon: { x: 0, y: 878, w: 512, h: 146 },
  n1: { x: 512, y: 880, w: 64, h: 64 }, n2: { x: 576, y: 880, w: 64, h: 64 }, n3: { x: 640, y: 880, w: 64, h: 64 },
  n4: { x: 704, y: 880, w: 64, h: 64 }, n5: { x: 768, y: 880, w: 64, h: 64 }, n6: { x: 832, y: 880, w: 64, h: 64 },
};

/** UV rectangle [u0, v0, u1, v1] of a sign region (canvas textures are uploaded with flipY). */
export function signUV(name: SignName): [number, number, number, number] {
  const r = SIGN_REGIONS[name];
  return [r.x / SIGN_ATLAS, 1 - (r.y + r.h) / SIGN_ATLAS, (r.x + r.w) / SIGN_ATLAS, 1 - r.y / SIGN_ATLAS];
}

/** Aspect ratio (w / h) of a sign region. */
export function signAspect(name: SignName): number {
  const r = SIGN_REGIONS[name];
  return r.w / r.h;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function fitFont(c: CanvasRenderingContext2D, text: string, maxW: number, px: number): void {
  let s = px;
  c.font = `900 ${s}px ${FONT}`;
  while (c.measureText(text).width > maxW && s > 8) { s -= 1; c.font = `900 ${s}px ${FONT}`; }
}

function hazardBorder(c: CanvasRenderingContext2D, r: SignRegion, band: number): void {
  c.save();
  c.beginPath();
  c.rect(r.x, r.y, r.w, r.h);
  c.rect(r.x + band, r.y + band, r.w - band * 2, r.h - band * 2);
  c.clip('evenodd');
  c.fillStyle = '#1f1f1f';
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = '#f2c230';
  for (let k = -r.h; k < r.w + r.h; k += band * 2) {
    c.beginPath();
    c.moveTo(r.x + k, r.y + r.h); c.lineTo(r.x + k + band, r.y + r.h);
    c.lineTo(r.x + k + band + r.h, r.y); c.lineTo(r.x + k + r.h, r.y);
    c.closePath(); c.fill();
  }
  c.restore();
}

function grime(c: CanvasRenderingContext2D, r: SignRegion, rng: Rng, amount: number): void {
  c.save();
  c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
  for (let i = 0; i < amount; i++) {
    const x = r.x + rng.next() * r.w, y = r.y + rng.next() * r.h, rad = rng.range(4, 26);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(70,58,40,${rng.range(0.04, 0.12)})`);
    g.addColorStop(1, 'rgba(70,58,40,0)');
    c.fillStyle = g;
    c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  c.restore();
}

/** Static signage (banners, safety signs, EXPANSION hoarding, slot numbers). */
export function createSignAtlas(): THREE.CanvasTexture {
  const cv = createCanvas(SIGN_ATLAS, SIGN_ATLAS);
  const c = context2d(cv);
  const rng = new Rng(0x5167);
  c.clearRect(0, 0, SIGN_ATLAS, SIGN_ATLAS);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const R = SIGN_REGIONS;

  // Company banner.
  {
    const r = R.banner;
    c.fillStyle = '#2b3a46'; c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#f2c230'; c.fillRect(r.x, r.y + 10, r.w, 8); c.fillRect(r.x, r.y + r.h - 18, r.w, 8);
    c.fillStyle = '#f4efe2';
    fitFont(c, 'PROJECT NEEDLE  ·  HAY & SONS INDUSTRIES', r.w - 80, 64);
    c.fillText('PROJECT NEEDLE  ·  HAY & SONS INDUSTRIES', r.x + r.w / 2, r.y + r.h / 2 + 2);
    grime(c, r, rng, 30);
  }
  // Warehouse expansion hoarding sign.
  {
    const r = R.expansion;
    hazardBorder(c, r, 26);
    c.fillStyle = '#f5f0e2';
    c.fillRect(r.x + 26, r.y + 26, r.w - 52, r.h - 52);
    c.fillStyle = '#c8453b';
    fitFont(c, 'WAREHOUSE EXPANSION', r.w - 140, 96);
    c.fillText('WAREHOUSE EXPANSION', r.x + r.w / 2, r.y + 108);
    c.fillStyle = '#26221d';
    fitFont(c, 'MORE FLOOR · MORE HAY · MORE NEEDLE-FREE SPACE', r.w - 160, 40);
    c.fillText('MORE FLOOR · MORE HAY · MORE NEEDLE-FREE SPACE', r.x + r.w / 2, r.y + 180);
    c.fillStyle = '#5b554b';
    fitFont(c, 'UNLOCK IN THE WORK TREE', r.w - 300, 34);
    c.fillText('UNLOCK IN THE WORK TREE', r.x + r.w / 2, r.y + 232);
    grime(c, r, rng, 40);
  }
  // Trophy-case header.
  {
    const r = R.needles;
    roundRect(c, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 16);
    c.fillStyle = '#6b4a2b'; c.fill();
    roundRect(c, r.x + 12, r.y + 12, r.w - 24, r.h - 24, 10);
    c.fillStyle = '#d8b25a'; c.fill();
    c.fillStyle = '#3a2814';
    fitFont(c, 'NEEDLES FOUND', r.w - 70, 50);
    c.fillText('NEEDLES FOUND', r.x + r.w / 2, r.y + r.h / 2 + 2);
  }
  // Loading bay sign above the door.
  {
    const r = R.loading;
    c.fillStyle = '#1f5d8c'; roundRect(c, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 14); c.fill();
    c.strokeStyle = '#f4efe2'; c.lineWidth = 5; roundRect(c, r.x + 14, r.y + 14, r.w - 28, r.h - 28, 10); c.stroke();
    c.fillStyle = '#f4efe2';
    fitFont(c, 'SELL HAY  ▸  TRUCK', r.w - 70, 52);
    c.fillText('SELL HAY  ▸  TRUCK', r.x + r.w / 2, r.y + r.h / 2 + 2);
    grime(c, r, rng, 12);
  }
  // Keep out (construction) sign.
  {
    const r = R.keepOut;
    c.fillStyle = '#f2c230'; c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#1f1f1f';
    c.beginPath(); c.moveTo(r.x + r.w / 2, r.y + 26); c.lineTo(r.x + r.w - 26, r.y + r.h - 70); c.lineTo(r.x + 26, r.y + r.h - 70); c.closePath(); c.fill();
    c.fillStyle = '#f2c230'; c.font = `900 96px ${FONT}`; c.fillText('!', r.x + r.w / 2, r.y + 128);
    c.fillStyle = '#1f1f1f'; fitFont(c, 'KEEP OUT', r.w - 30, 42); c.fillText('KEEP OUT', r.x + r.w / 2, r.y + r.h - 38);
    grime(c, r, rng, 16);
  }
  // No smoking near the hay.
  {
    const r = R.noSmoking;
    c.fillStyle = '#f7f4ec'; c.fillRect(r.x, r.y, r.w, r.h);
    const cx = r.x + r.w / 2, cy = r.y + 110;
    c.fillStyle = '#26221d'; c.fillRect(cx - 62, cy - 8, 110, 20); c.fillStyle = '#e8743b'; c.fillRect(cx + 48, cy - 8, 16, 20);
    c.strokeStyle = '#c8453b'; c.lineWidth = 16;
    c.beginPath(); c.arc(cx, cy, 76, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx - 54, cy - 54); c.lineTo(cx + 54, cy + 54); c.stroke();
    c.fillStyle = '#26221d';
    fitFont(c, 'NO SMOKING', r.w - 24, 34); c.fillText('NO SMOKING', cx, r.y + 222);
    fitFont(c, 'THIS IS A HAY BARN', r.w - 30, 22); c.fillText('THIS IS A HAY BARN', cx, r.y + 262);
    grime(c, r, rng, 14);
  }
  // Hay hat area (safety sign, blue).
  {
    const r = R.hayHat;
    c.fillStyle = '#f7f4ec'; c.fillRect(r.x, r.y, r.w, r.h);
    const cx = r.x + r.w / 2, cy = r.y + 110;
    c.fillStyle = '#1f5d8c'; c.beginPath(); c.arc(cx, cy, 82, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f4efe2';
    c.beginPath(); c.ellipse(cx, cy + 22, 62, 14, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(cx, cy + 4, 36, 34, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#f2c230'; c.fillRect(cx - 36, cy + 2, 72, 9);
    c.fillStyle = '#26221d';
    fitFont(c, 'HAY HAT AREA', r.w - 24, 32); c.fillText('HAY HAT AREA', cx, r.y + 222);
    fitFont(c, 'STRAW OPTIONAL', r.w - 40, 22); c.fillText('STRAW OPTIONAL', cx, r.y + 262);
    grime(c, r, rng, 14);
  }
  // Days without losing a needle.
  {
    const r = R.daysWithout;
    c.fillStyle = '#2f5a35'; c.fillRect(r.x, r.y, r.w, r.h);
    c.strokeStyle = '#d9d2bd'; c.lineWidth = 6; c.strokeRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
    c.fillStyle = '#f4efe2';
    fitFont(c, 'DAYS WITHOUT', r.w - 40, 30); c.fillText('DAYS WITHOUT', r.x + r.w / 2, r.y + 40);
    fitFont(c, 'LOSING A NEEDLE', r.w - 40, 30); c.fillText('LOSING A NEEDLE', r.x + r.w / 2, r.y + 74);
    c.fillStyle = '#f4efe2'; c.fillRect(r.x + r.w / 2 - 50, r.y + 96, 100, 84);
    c.fillStyle = '#c8453b'; c.font = `900 72px ${FONT}`; c.fillText('0', r.x + r.w / 2, r.y + 142);
  }
  // Exit sign.
  {
    const r = R.exit;
    c.fillStyle = '#1d9a4a'; c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = '#f4ffef'; fitFont(c, 'EXIT  ▸', r.w - 40, 64); c.fillText('EXIT  ▸', r.x + r.w / 2, r.y + r.h / 2 + 3);
  }
  // Spray-painted "SOON" on plywood (transparent background).
  {
    const r = R.soon;
    c.save();
    c.translate(r.x + r.w / 2, r.y + r.h / 2);
    c.rotate(-0.06);
    c.font = `900 104px ${FONT}`;
    c.fillStyle = 'rgba(200,69,59,0.9)';
    c.fillText('SOON!', 0, 6);
    c.strokeStyle = 'rgba(200,69,59,0.35)'; c.lineWidth = 6; c.strokeText('SOON!', 0, 6);
    c.restore();
    for (let i = 0; i < 26; i++) {
      c.fillStyle = `rgba(200,69,59,${rng.range(0.2, 0.6)})`;
      c.beginPath(); c.arc(r.x + rng.range(40, r.w - 40), r.y + r.h - rng.range(4, 26), rng.range(1, 3.5), 0, Math.PI * 2); c.fill();
    }
  }
  // Slot number plaques.
  (['n1', 'n2', 'n3', 'n4', 'n5', 'n6'] as const).forEach((n, i) => {
    const r = R[n];
    roundRect(c, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 10);
    c.fillStyle = '#d8b25a'; c.fill();
    c.fillStyle = '#3a2814'; c.font = `900 40px ${FONT}`; c.fillText(String(i + 1), r.x + r.w / 2, r.y + r.h / 2 + 2);
  });

  return canvasTexture(cv, { anisotropy: 4 });
}

// ------------------------------------------------------------------------------------------------
// Order board
// ------------------------------------------------------------------------------------------------

export const ORDER_BOARD_PX = { w: 1024, h: 640 } as const;

/** Cork board with a header strip and up to 3 pinned order cards. */
export function drawOrderBoard(cv: HTMLCanvasElement, lines: readonly string[]): void {
  const c = context2d(cv);
  const W = cv.width, H = cv.height;
  const rng = new Rng(0x0bd);
  // Cork.
  c.fillStyle = '#b98a55';
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 5200; i++) {
    c.fillStyle = rng.next() < 0.5 ? `rgba(120,80,40,${rng.range(0.15, 0.4)})` : `rgba(230,190,140,${rng.range(0.12, 0.3)})`;
    const s = rng.range(1.5, 4.5);
    c.fillRect(rng.next() * W, rng.next() * H, s, s);
  }
  // Header tape.
  c.save();
  c.translate(W / 2, 64);
  c.rotate(-0.012);
  c.fillStyle = '#f2c230';
  c.fillRect(-W * 0.36, -40, W * 0.72, 80);
  c.fillStyle = '#1e1b16';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `900 58px ${FONT}`;
  c.fillText('TODAY\'S ORDERS', 0, 3);
  c.restore();

  const shown = lines.length ? lines.slice(0, 3) : ['No open orders - keep digging!'];
  const cardH = 138, gap = 22, top = 130;
  shown.forEach((text, i) => {
    const y = top + i * (cardH + gap);
    const tilt = (rng.next() - 0.5) * 0.03;
    c.save();
    c.translate(W / 2, y + cardH / 2);
    c.rotate(tilt);
    c.fillStyle = 'rgba(40,25,10,0.35)';
    c.fillRect(-W * 0.43 + 8, -cardH / 2 + 10, W * 0.86, cardH);
    c.fillStyle = i === 0 ? '#fbf6e8' : '#f3eedf';
    c.fillRect(-W * 0.43, -cardH / 2, W * 0.86, cardH);
    c.fillStyle = 'rgba(80,140,200,0.35)';
    for (let k = 1; k < 4; k++) c.fillRect(-W * 0.43, -cardH / 2 + k * 34, W * 0.86, 2);
    c.fillStyle = 'rgba(200,69,59,0.5)';
    c.fillRect(-W * 0.43 + 96, -cardH / 2, 3, cardH);
    // Checkbox.
    c.strokeStyle = '#3b352c'; c.lineWidth = 5;
    c.strokeRect(-W * 0.43 + 26, -26, 48, 48);
    // Text (wrapped to 2 lines).
    c.fillStyle = '#231f1a';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    const maxW = W * 0.86 - 140;
    const words = text.split(/\s+/);
    const rows: string[] = [];
    let cur = '';
    c.font = `800 44px ${FONT}`;
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (c.measureText(t).width > maxW && cur) { rows.push(cur); cur = w; } else cur = t;
    }
    if (cur) rows.push(cur);
    if (rows.length > 2) { rows.length = 2; rows[1] = `${rows[1].replace(/\s+\S*$/, '')}…`; }
    const size = rows.length > 1 ? 38 : 46;
    c.font = `800 ${size}px ${FONT}`;
    rows.forEach((row, k) => {
      const yy = rows.length > 1 ? (k === 0 ? -24 : 24) : 0;
      c.fillText(row, -W * 0.43 + 120, yy + 2, maxW);
    });
    // Pin.
    const pinColors = ['#c8453b', '#2b7fc2', '#3f9b4f'];
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.arc(W * 0.4 + 5, -cardH / 2 + 22, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = pinColors[i % pinColors.length];
    c.beginPath(); c.arc(W * 0.4, -cardH / 2 + 16, 14, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.beginPath(); c.arc(W * 0.4 - 4, -cardH / 2 + 11, 4, 0, Math.PI * 2); c.fill();
    c.restore();
  });
}
