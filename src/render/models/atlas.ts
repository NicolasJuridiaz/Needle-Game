import * as THREE from 'three';

/**
 * Decal atlas: every label, stripe, pictogram and machine screen used by the models lives in ONE pair of
 * procedurally drawn canvases (albedo + emissive) so all decals of a model merge into a single mesh that
 * shares one material across the whole factory. The layout is pure data (computed at import, usable in
 * Node tests); the pixels are drawn lazily the first time the textures are requested in a browser.
 */

export const ATLAS_W = 1024;
export const ATLAS_H = 2048;
/** Emissive layer resolution divisor (glows and screens do not need full resolution). */
const GLOW_SCALE = 2;
/** Padding between regions; region origins are aligned to it so the quarter-res ORM map lines up. */
const PAD = 8;
const ORM_SCALE = 4;
/** Default roughness / metalness (matches paletteMaterial()). */
const ORM_DEFAULT: readonly [number, number] = [0.72, 0.08];

type Ctx = CanvasRenderingContext2D;
interface RegionDef {
  name: RegionName;
  w: number;
  h: number;
  draw: (g: Ctx, w: number, h: number) => void;
  /** Optional emissive layer (drawn on black). */
  glow?: (g: Ctx, w: number, h: number) => void;
  /** Roughness / metalness of the region (default: painted plastic-ish steel). */
  orm?: readonly [number, number];
}

export type RegionName =
  | 'market' | 'truckLogo' | 'jokeNeedles' | 'jokeHug' | 'jokeHands' | 'jokeHay' | 'hazard' | 'hazardRed'
  | 'screenScan' | 'screenMk2' | 'screenPower' | 'cork' | 'tread'
  | 'plateHopper' | 'plateRake' | 'plateArm' | 'plateCollector' | 'plateScanner' | 'plateScanner2'
  | 'plateCompressor' | 'plateWrapper' | 'plateGenerator' | 'plateLift' | 'plateOrders' | 'plateNeedles' | 'plateSilo'
  | 'plateVolt' | 'siloScale' | 'orderCardA' | 'orderCardB' | 'coin' | 'gauge'
  | 'chevron' | 'arrow' | 'warning' | 'bolt' | 'vent' | 'grill'
  | 'in' | 'out' | 'up' | 'down' | 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'n6' | 'needleIcon' | 'laneB'
  | 'straw' | 'modeEven' | 'modeAlt' | 'modePrio' | 'modeOver' | 'modeSmart'
  | SolidName;

/**
 * Solid blocks: plain surfaces sample the centre of one of these so painted, metallic, chrome, matte and
 * glowing parts can all live in the same mesh as the decals (the ORM map gives each block its roughness /
 * metalness, the emissive layer lights the glow blocks).
 */
export type SolidName =
  | 'solidPaint' | 'solidMetal' | 'solidChrome' | 'solidMatte'
  | 'glowWarm' | 'glowCyan' | 'glowRed' | 'glowGreen' | 'glowFire' | 'glowWhite' | 'glowAmber';

export interface AtlasRegion {
  readonly name: RegionName;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number;
}

const FONT = '"Arial Black", "Helvetica Neue", Arial, system-ui, sans-serif';

function rr(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitText(g: Ctx, text: string, maxW: number, px: number, weight = 900): void {
  let size = px;
  g.font = `${weight} ${size}px ${FONT}`;
  while (g.measureText(text).width > maxW && size > 8) { size -= 1; g.font = `${weight} ${size}px ${FONT}`; }
}

function plate(text: string, bg: string, fg: string, edge: string, opts: { sub?: string; icon?: 'bolt' | 'needle' } = {}) {
  return (g: Ctx, w: number, h: number): void => {
    rr(g, 2, 2, w - 4, h - 4, h * 0.18);
    g.fillStyle = edge; g.fill();
    rr(g, 7, 7, w - 14, h - 14, h * 0.13);
    g.fillStyle = bg; g.fill();
    // rivets
    g.fillStyle = edge;
    for (const [rx, ry] of [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]]) { g.beginPath(); g.arc(rx, ry, 3.2, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tx = opts.icon ? w / 2 + h * 0.3 : w / 2;
    fitText(g, text, w - 44 - (opts.icon ? h * 0.6 : 0), opts.sub ? h * 0.42 : h * 0.56);
    g.fillText(text, tx, opts.sub ? h * 0.4 : h * 0.54);
    if (opts.sub) { fitText(g, opts.sub, w - 50, h * 0.2, 700); g.fillText(opts.sub, w / 2, h * 0.76); }
    if (opts.icon === 'bolt') { g.save(); g.translate(h * 0.55, h * 0.5); boltPath(g, h * 0.5); g.fill(); g.restore(); }
    if (opts.icon === 'needle') { g.save(); g.translate(h * 0.62, h * 0.5); g.rotate(-0.6); needlePath(g, h * 0.8); g.restore(); }
  };
}

function boltPath(g: Ctx, s: number): void {
  g.beginPath();
  g.moveTo(0.1 * s, -0.5 * s); g.lineTo(-0.28 * s, 0.06 * s); g.lineTo(-0.02 * s, 0.06 * s);
  g.lineTo(-0.12 * s, 0.5 * s); g.lineTo(0.28 * s, -0.08 * s); g.lineTo(0.02 * s, -0.08 * s); g.closePath();
}

function needlePath(g: Ctx, len: number): void {
  g.beginPath();
  g.moveTo(-len / 2, 0); g.lineTo(len / 2 - len * 0.12, -len * 0.035); g.lineTo(len / 2, 0);
  g.lineTo(len / 2 - len * 0.12, len * 0.035); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(len / 2 - len * 0.07, 0, len * 0.03, len * 0.012, 0, 0, Math.PI * 2);
  g.globalCompositeOperation = 'destination-out'; g.fill(); g.globalCompositeOperation = 'source-over';
}

function stripes(a: string, b: string) {
  return (g: Ctx, w: number, h: number): void => {
    g.fillStyle = a; g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    const p = h; // one period per region height -> 45° stripes when mapped at matching aspect
    for (let x = -h; x < w + h; x += p) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + p / 2, h); g.lineTo(x + p / 2 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  };
}

/** White pictogram on a dark steel plate (the vertex tint colours the glyph; the plate stays dark). */
function glyph(fn: (g: Ctx, w: number, h: number) => void) {
  return (g: Ctx, w: number, h: number): void => {
    g.fillStyle = '#23282c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; fn(g, w, h);
  };
}

function waveScreen(title: string, lanes: number, bg: string, line: string) {
  const body = (g: Ctx, w: number, h: number, glow: boolean): void => {
    g.fillStyle = glow ? '#000' : bg; g.fillRect(0, 0, w, h);
    if (!glow) { g.strokeStyle = '#123f3b'; g.lineWidth = 1; for (let x = 8; x < w; x += 16) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, h - 4); g.stroke(); } }
    g.strokeStyle = line; g.lineWidth = 3; g.fillStyle = line;
    const top = 26;
    const laneH = (h - top - 8) / lanes;
    for (let l = 0; l < lanes; l++) {
      const cy = top + laneH * (l + 0.5);
      g.beginPath();
      for (let x = 10; x < w - 10; x += 3) {
        const t = x / w;
        const spike = Math.abs(t - (0.62 - l * 0.25)) < 0.04 ? (l === 0 ? -1 : 1) * laneH * 0.36 : 0;
        const y = cy + Math.sin(t * 38 + l) * laneH * 0.09 + Math.sin(t * 91) * laneH * 0.05 + spike;
        if (x === 10) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      if (lanes > 1) { g.font = `700 12px ${FONT}`; g.textAlign = 'left'; g.fillText(l === 0 ? 'A' : 'B', 6, cy - laneH * 0.3); }
    }
    g.font = `900 17px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(title, 10, 14);
    g.textAlign = 'right'; g.fillText('● REC', w - 8, 14);
  };
  return {
    draw: (g: Ctx, w: number, h: number) => body(g, w, h, false),
    glow: (g: Ctx, w: number, h: number) => body(g, w, h, true),
  };
}

const scan = waveScreen('NEEDLE SCAN', 1, '#062422', '#3ff5e6');
const scan2 = waveScreen('SCAN MK II', 2, '#062422', '#3ff5e6');

function powerScreen(g: Ctx, w: number, h: number, glow: boolean): void {
  g.fillStyle = glow ? '#000' : '#1c0a08'; g.fillRect(0, 0, w, h);
  const cols = ['#ffcf3a', '#ffb02e', '#ff8a24', '#ff5a1f', '#ff3a2a'];
  for (let i = 0; i < 10; i++) {
    const bh = 10 + i * 5.5;
    g.fillStyle = cols[Math.min(4, Math.floor(i / 2))];
    g.fillRect(14 + i * 17, h - 12 - bh, 12, bh);
  }
  g.fillStyle = '#ffd35a'; g.font = `900 22px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'top';
  g.fillText('HAY→P', w - 10, 8);
}

function gauge(g: Ctx, w: number, h: number, glow: boolean): void {
  const cx = w / 2, cy = h / 2, r = w / 2 - 3;
  g.fillStyle = glow ? '#3a3326' : '#f4ecd6'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  if (glow) return;
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = '#d33'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, r - 8, -0.35, 0.7); g.stroke();
  g.strokeStyle = '#333'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * 0.75 + i * (Math.PI * 1.5 / 8);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); g.stroke();
  }
  g.strokeStyle = '#c21'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(-0.2) * (r - 10), cy + Math.sin(-0.2) * (r - 10)); g.stroke();
  g.fillStyle = '#222'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
}

function orderCard(accent: string, lines: number) {
  return (g: Ctx, w: number, h: number): void => {
    g.fillStyle = '#f3ecd9'; g.fillRect(2, 2, w - 4, h - 4);
    g.fillStyle = accent; g.fillRect(2, 2, w - 4, 20);
    g.fillStyle = '#fff'; g.font = `900 12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ORDER', w / 2, 12);
    g.fillStyle = '#6b6252';
    for (let i = 0; i < lines; i++) g.fillRect(10, 32 + i * 13, (w - 20) * (i % 3 === 2 ? 0.6 : 0.95), 4);
    g.strokeStyle = 'rgba(200,40,40,0.8)'; g.lineWidth = 3; g.beginPath(); g.arc(w - 26, h - 24, 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(200,40,40,0.8)'; g.font = `900 9px ${FONT}`; g.fillText('HAY', w - 26, h - 24);
  };
}

function numberPlaque(n: number) {
  return (g: Ctx, w: number, h: number): void => {
    rr(g, 1, 1, w - 2, h - 2, 5); g.fillStyle = '#8a6a2a'; g.fill();
    rr(g, 3, 3, w - 6, h - 6, 4); g.fillStyle = '#d9b45a'; g.fill();
    g.fillStyle = '#3a2a10'; g.font = `900 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), w / 2, h / 2 + 1);
  };
}

function smallPlate(text: string, bg: string, arrow: 'up' | 'down' | 'none') {
  return (g: Ctx, w: number, h: number): void => {
    rr(g, 1, 1, w - 2, h - 2, 6); g.fillStyle = bg; g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, text, arrow === 'none' ? w - 10 : w - 24, h * 0.62);
    g.fillText(text, arrow === 'none' ? w / 2 : w / 2 + 7, h / 2 + 1);
    if (arrow !== 'none') {
      g.beginPath();
      const s = arrow === 'up' ? -1 : 1;
      g.moveTo(8, h / 2 - s * 6); g.lineTo(20, h / 2 - s * 6); g.lineTo(14, h / 2 + s * 7); g.closePath(); g.fill();
    }
  };
}

const REGION_DEFS: RegionDef[] = [
  {
    name: 'market', w: 512, h: 160,
    draw: (g, w, h) => {
      rr(g, 2, 2, w - 4, h - 4, 20); g.fillStyle = '#1b2733'; g.fill();
      rr(g, 12, 12, w - 24, h - 24, 14); g.strokeStyle = '#f2c230'; g.lineWidth = 6; g.stroke();
      g.fillStyle = '#ffe07a'; g.strokeStyle = '#c8453b'; g.lineWidth = 10; g.lineJoin = 'round';
      g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'MARKET', w - 120, 96);
      g.strokeText('MARKET', w / 2, h / 2 + 4); g.fillText('MARKET', w / 2, h / 2 + 4);
      g.fillStyle = '#f2c230'; g.font = `900 40px ${FONT}`; g.fillText('$', 38, h / 2 + 2); g.fillText('$', w - 38, h / 2 + 2);
    },
    glow: (g, w, h) => {
      g.fillStyle = '#ffd24a'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'MARKET', w - 120, 96);
      g.fillText('MARKET', w / 2, h / 2 + 4);
      g.font = `900 40px ${FONT}`; g.fillText('$', 38, h / 2 + 2); g.fillText('$', w - 38, h / 2 + 2);
      rr(g, 12, 12, w - 24, h - 24, 14); g.strokeStyle = '#b8801a'; g.lineWidth = 4; g.stroke();
    },
  },
  {
    name: 'truckLogo', w: 512, h: 128,
    draw: (g, w, h) => {
      g.fillStyle = '#c8453b'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.beginPath(); g.arc(64, h / 2, 50, 0, Math.PI * 2); g.fillStyle = '#f2c230'; g.fill();
      g.fillStyle = '#e2b857'; g.beginPath(); g.moveTo(28, h / 2 + 30); g.quadraticCurveTo(64, h / 2 - 50, 100, h / 2 + 30); g.closePath(); g.fill();
      g.fillStyle = '#6b4a1a'; g.save(); g.translate(64, h / 2 + 6); g.rotate(-0.5); needlePath(g, 70); g.restore();
      g.fillStyle = '#1b1b1b'; fitText(g, 'HAYSTACK & SONS', w - 150, 50); g.fillText('HAYSTACK & SONS', 128, h / 2 - 14);
      g.fillStyle = '#c8453b'; fitText(g, 'NEEDLE RECOVERY SINCE TODAY', w - 150, 24, 800); g.fillText('NEEDLE RECOVERY SINCE TODAY', 130, h / 2 + 30);
    },
  },
  { name: 'jokeNeedles', w: 512, h: 64, draw: plate('CAUTION: MAY CONTAIN NEEDLES', '#f2c230', '#1b1b1b', '#1b1b1b') },
  { name: 'jokeHug', w: 512, h: 64, draw: plate('DO NOT HUG THE MACHINE', '#f1f1ee', '#c8453b', '#c8453b') },
  { name: 'jokeHands', w: 512, h: 64, draw: plate('KEEP HANDS OUT OF THE HAY', '#e8743b', '#1b1b1b', '#1b1b1b') },
  { name: 'jokeHay', w: 512, h: 64, draw: plate('WARNING: CONTENTS MAY BE HAY', '#2bb5a8', '#0b2b28', '#0b2b28') },
  { name: 'hazard', w: 512, h: 64, draw: stripes('#f2c230', '#222222') },
  { name: 'hazardRed', w: 512, h: 64, draw: stripes('#f1f1ee', '#c8453b') },
  { name: 'screenScan', w: 256, h: 128, draw: scan.draw, glow: scan.glow },
  { name: 'screenMk2', w: 256, h: 128, draw: scan2.draw, glow: scan2.glow },
  { name: 'screenPower', w: 256, h: 96, draw: (g, w, h) => powerScreen(g, w, h, false), glow: (g, w, h) => powerScreen(g, w, h, true) },
  {
    name: 'cork', w: 256, h: 160,
    draw: (g, w, h) => {
      g.fillStyle = '#b98a55'; g.fillRect(0, 0, w, h);
      let s = 1234567;
      for (let i = 0; i < 1400; i++) {
        s = (s * 16807) % 2147483647;
        const x = s % w; s = (s * 16807) % 2147483647; const y = s % h;
        g.fillStyle = i % 3 === 0 ? 'rgba(90,55,25,0.55)' : 'rgba(230,190,130,0.45)';
        g.fillRect(x, y, 2 + (i % 2), 2);
      }
    },
  },
  {
    name: 'tread', w: 128, h: 128,
    draw: (g, w, h) => {
      g.fillStyle = '#7d868b'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const o = (y / 16) % 2 === 0 ? 0 : 8;
        g.save(); g.translate(x + o + 4, y + 8); g.rotate(((x + y) / 16) % 2 === 0 ? 0.785 : -0.785);
        g.fillStyle = '#a3acb1'; g.fillRect(-5, -1.5, 10, 3); g.fillStyle = '#5b6368'; g.fillRect(-5, 1.5, 10, 1.2);
        g.restore();
      }
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
    },
  },
  { name: 'plateHopper', w: 256, h: 64, draw: plate('HAY HOPPER', '#1d1f22', '#f2c230', '#e8743b') },
  { name: 'plateRake', w: 256, h: 64, draw: plate('RAKE-O-MATIC', '#1d1f22', '#e8743b', '#e8743b', { sub: 'HYDRAULIC · 9000 PSI' }) },
  { name: 'plateArm', w: 256, h: 64, draw: plate('GRABBOT', '#1d1f22', '#f2c230', '#e8743b', { sub: 'GENTLE WITH HAY' }) },
  { name: 'plateCollector', w: 256, h: 64, draw: plate('VAC-3000', '#1d1f22', '#e8743b', '#e8743b', { sub: 'SUCKS (IN A GOOD WAY)' }) },
  { name: 'plateScanner', w: 256, h: 64, draw: plate('NEEDLE SCAN', '#0b2b28', '#3ff5e6', '#2bb5a8', { icon: 'needle' }) },
  { name: 'plateScanner2', w: 256, h: 64, draw: plate('SCAN MK II', '#0b2b28', '#3ff5e6', '#2bb5a8', { icon: 'needle' }) },
  { name: 'plateCompressor', w: 256, h: 64, draw: plate('BALE PRESS', '#16240f', '#bfe89e', '#6aa84f', { sub: '40 HAY = 1 BALE' }) },
  { name: 'plateWrapper', w: 256, h: 64, draw: plate('WRAP-O-MATIC', '#16240f', '#f1f1ee', '#6aa84f', { sub: 'NOW 20% SHINIER' }) },
  { name: 'plateGenerator', w: 256, h: 64, draw: plate('HAY POWER', '#2a0f0c', '#ffcf5a', '#c07a45', { icon: 'bolt' }) },
  { name: 'plateLift', w: 256, h: 64, draw: plate('BELT LIFT', '#101c28', '#f1f1ee', '#4f7fa8') },
  { name: 'plateOrders', w: 256, h: 64, draw: plate('ORDERS', '#2b2014', '#f2c230', '#8a5a33') },
  { name: 'plateNeedles', w: 256, h: 64, draw: plate('NEEDLES FOUND', '#2b2014', '#f2d27a', '#8a5a33', { icon: 'needle' }) },
  {
    name: 'plateSilo', w: 256, h: 96,
    draw: (g, w, h) => {
      g.fillStyle = '#2d3a44'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, 'SILO', w - 20, 86);
      g.fillText('SILO', w / 2, h / 2 + 4);
    },
  },
  { name: 'plateVolt', w: 256, h: 64, draw: plate('HIGH VOLTAGE', '#f2c230', '#1b1b1b', '#1b1b1b', { icon: 'bolt' }) },
  {
    name: 'siloScale', w: 64, h: 256,
    draw: (g, w, h) => {
      g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `800 11px ${FONT}`;
      for (let i = 0; i <= 20; i++) {
        const y = 6 + (h - 12) * (1 - i / 20);
        const major = i % 5 === 0;
        g.fillRect(0, y - 1.5, major ? 26 : 14, 3);
        if (major && i > 0) g.fillText(i === 20 ? 'FULL' : `${i * 5}`, 29, y);
      }
    },
  },
  { name: 'orderCardA', w: 96, h: 128, draw: orderCard('#c8453b', 6) },
  { name: 'orderCardB', w: 96, h: 128, draw: orderCard('#4f7fa8', 5) },
  {
    name: 'coin', w: 128, h: 128,
    draw: (g, w, h) => {
      g.fillStyle = '#b8860b'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2c230'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9a6a08'; g.font = `900 78px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', w / 2, h / 2 + 4);
    },
    glow: (g, w, h) => { g.fillStyle = '#5a4210'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill(); },
  },
  { name: 'gauge', w: 64, h: 64, draw: (g, w, h) => gauge(g, w, h, false), glow: (g, w, h) => gauge(g, w, h, true) },
  {
    name: 'chevron', w: 64, h: 64,
    draw: glyph((g, w, h) => {
      g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(12, h - 16); g.lineTo(w / 2, 14); g.lineTo(w - 12, h - 16); g.stroke();
    }),
  },
  {
    name: 'arrow', w: 64, h: 64,
    draw: glyph((g, w, h) => {
      g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w - 6, h * 0.48); g.lineTo(w * 0.64, h * 0.48); g.lineTo(w * 0.64, h - 4);
      g.lineTo(w * 0.36, h - 4); g.lineTo(w * 0.36, h * 0.48); g.lineTo(6, h * 0.48); g.closePath(); g.fill();
    }),
  },
  {
    name: 'warning', w: 64, h: 64,
    draw: (g, w, h) => {
      g.lineJoin = 'round';
      g.beginPath(); g.moveTo(w / 2, 5); g.lineTo(w - 4, h - 7); g.lineTo(4, h - 7); g.closePath();
      g.fillStyle = '#1b1b1b'; g.fill();
      g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w - 13, h - 12); g.lineTo(13, h - 12); g.closePath();
      g.fillStyle = '#f2c230'; g.fill();
      g.fillStyle = '#1b1b1b'; g.fillRect(w / 2 - 3.5, 24, 7, 18); g.fillRect(w / 2 - 3.5, 45, 7, 6);
    },
  },
  { name: 'bolt', w: 64, h: 64, draw: glyph((g, w, h) => { g.translate(w / 2, h / 2); boltPath(g, h * 0.95); g.fill(); }) },
  {
    name: 'vent', w: 128, h: 64,
    draw: (g, w, h) => {
      for (let i = 0; i < 6; i++) {
        rr(g, 8, 6 + i * 9.4, w - 16, 5.5, 2.5); g.fillStyle = '#0f1112'; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(10, 6 + i * 9.4 + 5.5, w - 20, 1.3);
      }
    },
  },
  {
    name: 'grill', w: 128, h: 64,
    draw: (g, w, h) => {
      rr(g, 1, 1, w - 2, h - 2, 8); g.fillStyle = '#d7dcdf'; g.fill();
      for (let i = 0; i < 7; i++) { g.fillStyle = '#1b1d1f'; g.fillRect(10 + i * 16, 8, 10, h - 16); }
    },
  },
  { name: 'in', w: 64, h: 32, draw: smallPlate('IN', '#2f5f8c', 'down') },
  { name: 'out', w: 64, h: 32, draw: smallPlate('OUT', '#3f8a3a', 'none') },
  { name: 'up', w: 64, h: 32, draw: smallPlate('UP', '#2f5f8c', 'up') },
  { name: 'down', w: 64, h: 32, draw: smallPlate('DOWN', '#2f5f8c', 'down') },
  { name: 'laneB', w: 128, h: 32, draw: smallPlate('LANE B LOCKED', '#8a3a2a', 'none') },
  { name: 'n1', w: 32, h: 32, draw: numberPlaque(1) },
  { name: 'n2', w: 32, h: 32, draw: numberPlaque(2) },
  { name: 'n3', w: 32, h: 32, draw: numberPlaque(3) },
  { name: 'n4', w: 32, h: 32, draw: numberPlaque(4) },
  { name: 'n5', w: 32, h: 32, draw: numberPlaque(5) },
  { name: 'n6', w: 32, h: 32, draw: numberPlaque(6) },
  { name: 'needleIcon', w: 128, h: 32, draw: glyph((g, w, h) => { g.translate(w / 2, h / 2); needlePath(g, w - 8); }) },
  { name: 'straw', w: 128, h: 128, draw: straw },
  { name: 'modeEven', w: 64, h: 64, draw: modeIcon('even'), glow: modeIcon('even') },
  { name: 'modeAlt', w: 64, h: 64, draw: modeIcon('alt'), glow: modeIcon('alt') },
  { name: 'modePrio', w: 64, h: 64, draw: modeIcon('prio'), glow: modeIcon('prio') },
  { name: 'modeOver', w: 64, h: 64, draw: modeIcon('over'), glow: modeIcon('over') },
  { name: 'modeSmart', w: 64, h: 64, draw: modeIcon('smart'), glow: modeIcon('smart') },
  solid('solidPaint', '#ffffff', ORM_DEFAULT),
  solid('solidMetal', '#ffffff', [0.36, 0.7]),
  solid('solidChrome', '#ffffff', [0.18, 0.92]),
  solid('solidMatte', '#ffffff', [0.93, 0]),
  glowSolid('glowWarm', '#ffd98a'),
  glowSolid('glowCyan', '#5ff5ff'),
  glowSolid('glowRed', '#ff3a2a'),
  glowSolid('glowGreen', '#5dff72'),
  glowSolid('glowFire', '#ff8a2a'),
  glowSolid('glowWhite', '#fff8ee'),
  glowSolid('glowAmber', '#ffb020'),
];

function solid(name: SolidName, color: string, orm: readonly [number, number]): RegionDef {
  return { name, w: 32, h: 32, orm, draw: (g, w, h) => { g.fillStyle = color; g.fillRect(-PAD, -PAD, w + PAD * 2, h + PAD * 2); } };
}

function glowSolid(name: SolidName, color: string): RegionDef {
  const fill = (g: Ctx, w: number, h: number): void => { g.fillStyle = color; g.fillRect(0, 0, w, h); };
  return { name, w: 32, h: 32, orm: [0.5, 0], draw: fill, glow: fill };
}

/** Warm straw: layered strands on a golden base (tinted per part by the vertex colour). */
function straw(g: Ctx, w: number, h: number): void {
  g.fillStyle = '#e2b857'; g.fillRect(0, 0, w, h);
  let s = 987654321;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const tones = ['#f6dc8a', '#c99a3e', '#eecb6a', '#a8792c', '#fbe7a4'];
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w, y = rnd() * h, a = (rnd() - 0.5) * 1.3 + (i % 2 ? 0.4 : -0.4), l = 10 + rnd() * 26;
    g.strokeStyle = tones[i % tones.length]; g.lineWidth = 1 + rnd() * 1.8;
    // wrap strands so the texture tiles across the region edges
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
    }
  }
}

/** Splitter mode pictograms (white on transparent-dark, lit through the emissive layer). */
function modeIcon(kind: 'even' | 'alt' | 'prio' | 'over' | 'smart') {
  return (g: Ctx, w: number, h: number): void => {
    g.fillStyle = '#10151a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
    const cx = w / 2, cy = h / 2;
    const arrow = (x0: number, y0: number, x1: number, y1: number): void => {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const a = Math.atan2(y1 - y0, x1 - x0);
      g.beginPath(); g.moveTo(x1 + Math.cos(a) * 3, y1 + Math.sin(a) * 3);
      g.lineTo(x1 - Math.cos(a - 0.6) * 12, y1 - Math.sin(a - 0.6) * 12);
      g.lineTo(x1 - Math.cos(a + 0.6) * 12, y1 - Math.sin(a + 0.6) * 12); g.closePath(); g.fill();
    };
    if (kind === 'even') { arrow(cx, h - 8, cx, 12); arrow(cx, cy + 6, 12, cy - 8); arrow(cx, cy + 6, w - 12, cy - 8); }
    else if (kind === 'alt') { arrow(12, cy + 10, w - 14, cy + 10); arrow(w - 12, cy - 10, 14, cy - 10); }
    else if (kind === 'prio') { g.lineWidth = 10; arrow(cx, h - 8, cx, 10); g.lineWidth = 4; arrow(cx, cy + 10, 14, cy); }
    else if (kind === 'over') {
      g.fillRect(10, cy - 4, w - 20, 8);
      g.lineWidth = 5; arrow(cx, cy - 6, cx, 10);
      g.globalAlpha = 0.55; g.fillRect(10, cy + 10, w - 20, 8); g.globalAlpha = 1;
    } else {
      g.beginPath(); g.arc(cx - 6, cy - 6, 14, 0, Math.PI * 2); g.lineWidth = 6; g.stroke();
      g.beginPath(); g.moveTo(cx + 4, cy + 4); g.lineTo(w - 10, h - 10); g.lineWidth = 8; g.stroke();
    }
  };
}

/** Shelf packing (tallest first), origins aligned to PAD. Pure and deterministic. */
function pack(defs: RegionDef[]): Map<RegionName, AtlasRegion> {
  const order = [...defs].sort((a, b) => b.h - a.h || b.w - a.w);
  const out = new Map<RegionName, AtlasRegion>();
  const align = (v: number): number => Math.ceil(v / PAD) * PAD;
  let x = PAD, y = PAD, rowH = 0;
  for (const d of order) {
    if (x + d.w + PAD > ATLAS_W) { x = PAD; y = align(y + rowH + PAD); rowH = 0; }
    if (y + d.h + PAD > ATLAS_H) throw new Error(`decal atlas overflow at ${d.name}`);
    // Half-texel inset keeps bilinear filtering inside the region.
    out.set(d.name, {
      name: d.name, x, y, w: d.w, h: d.h,
      u0: (x + 0.5) / ATLAS_W, u1: (x + d.w - 0.5) / ATLAS_W, v0: 1 - (y + d.h - 0.5) / ATLAS_H, v1: 1 - (y + 0.5) / ATLAS_H,
    });
    x = align(x + d.w + PAD);
    rowH = Math.max(rowH, d.h);
  }
  return out;
}

const LAYOUT = pack(REGION_DEFS);
const DEF_BY_NAME = new Map(REGION_DEFS.map((d) => [d.name, d] as const));

export function region(name: RegionName): AtlasRegion {
  const r = LAYOUT.get(name);
  if (!r) throw new Error(`unknown atlas region ${name}`);
  return r;
}

/** UV of the centre of a region (solid blocks: every vertex of a plain part samples this texel). */
export function regionCentre(name: RegionName): [number, number] {
  const r = region(name);
  return [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2];
}

export function regionNames(): RegionName[] { return REGION_DEFS.map((d) => d.name); }

/** Fraction of the atlas area in use (packing health check for tests). */
export function atlasUsage(): number {
  let a = 0;
  for (const r of LAYOUT.values()) a += r.w * r.h;
  return a / (ATLAS_W * ATLAS_H);
}

export interface AtlasTextures { map: THREE.Texture; emissive: THREE.Texture; orm: THREE.Texture }
let _textures: AtlasTextures | null = null;

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function ormStyle(orm: readonly [number, number]): string {
  return `rgb(255,${Math.round(orm[0] * 255)},${Math.round(orm[1] * 255)})`;
}

/**
 * Albedo + emissive + ORM (G = roughness, B = metalness) atlas textures, drawn once.
 * Headless (no DOM): empty textures with the same layout so geometry code runs in Node tests.
 */
export function atlasTextures(): AtlasTextures {
  if (_textures) return _textures;
  const albedo = makeCanvas(ATLAS_W, ATLAS_H);
  const glow = makeCanvas(ATLAS_W / GLOW_SCALE, ATLAS_H / GLOW_SCALE);
  const ormC = makeCanvas(ATLAS_W / ORM_SCALE, ATLAS_H / ORM_SCALE);
  if (!albedo || !glow || !ormC) {
    _textures = { map: new THREE.Texture(), emissive: new THREE.Texture(), orm: new THREE.Texture() };
    return _textures;
  }
  const ga = albedo.getContext('2d')!;
  const ge = glow.getContext('2d')!;
  const go = ormC.getContext('2d')!;
  ga.fillStyle = '#ffffff'; ga.fillRect(0, 0, ATLAS_W, ATLAS_H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, glow.width, glow.height);
  ge.scale(1 / GLOW_SCALE, 1 / GLOW_SCALE);
  go.fillStyle = ormStyle(ORM_DEFAULT); go.fillRect(0, 0, ormC.width, ormC.height);
  for (const d of REGION_DEFS) {
    const r = LAYOUT.get(d.name)!;
    ga.save(); ga.translate(r.x, r.y); ga.beginPath(); ga.rect(0, 0, r.w, r.h); ga.clip(); d.draw(ga, r.w, r.h); ga.restore();
    if (d.glow) { ge.save(); ge.translate(r.x, r.y); ge.beginPath(); ge.rect(0, 0, r.w, r.h); ge.clip(); d.glow(ge, r.w, r.h); ge.restore(); }
    const orm = DEF_BY_NAME.get(d.name)?.orm;
    if (orm) {
      go.fillStyle = ormStyle(orm);
      go.fillRect(r.x / ORM_SCALE, r.y / ORM_SCALE, r.w / ORM_SCALE, r.h / ORM_SCALE);
    }
  }
  const map = new THREE.CanvasTexture(albedo);
  const emissive = new THREE.CanvasTexture(glow);
  const orm = new THREE.CanvasTexture(ormC);
  for (const t of [map, emissive]) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  orm.colorSpace = THREE.NoColorSpace;
  _textures = { map, emissive, orm };
  return _textures;
}
