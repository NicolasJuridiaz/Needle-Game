import * as THREE from 'three';
import { Rng } from '../core/rng';

/**
 * Procedural textures, generated once on canvases (no image files ship with the game).
 * Colour textures are sRGB; normal maps and masks are linear. Shared textures are cached per key —
 * callers must not dispose them (use `disposeSharedTextures()` on teardown).
 */

const cache = new Map<string, THREE.Texture | { map: THREE.Texture; normalMap: THREE.Texture }>();

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

export interface TextureOptions {
  srgb?: boolean;
  repeat?: boolean;
  anisotropy?: number;
  mipmaps?: boolean;
}

export function canvasTexture(c: HTMLCanvasElement, o: TextureOptions = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = o.anisotropy ?? 4;
  if (o.mipmaps === false) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.needsUpdate = true;
  return t;
}

/**
 * Tangent-space normal map from a height field (0..1, canvas row order: row 0 = top of the canvas).
 * The result lines up with a CanvasTexture of the same canvas (which is uploaded with flipY).
 */
export function normalMapFromHeight(height: Float32Array, w: number, h: number, strength: number, wrap = true): THREE.DataTexture {
  const data = new Uint8Array(w * h * 4);
  const at = (x: number, y: number): number => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y)); }
    return height[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    const outRow = h - 1 - y; // DataTexture rows start at v = 0 (bottom)
    for (let x = 0; x < w; x++) {
      const du = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dv = (at(x, y - 1) - at(x, y + 1)) * strength; // canvas y grows downwards, v upwards
      let nx = -du, ny = -dv, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (outRow * w + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Reads the red channel of a canvas as 0..1 heights. */
function canvasHeights(c: HTMLCanvasElement): Float32Array {
  const ctx = context2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = img[i * 4] / 255;
  return out;
}

/** Calls `fn(ox, oy)` for every wrap offset needed so a shape near an edge tiles seamlessly. */
function wrapOffsets(w: number, h: number, x: number, y: number, reach: number, fn: (ox: number, oy: number) => void): void {
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const ox = i * w, oy = j * h;
      if (x + ox + reach < 0 || x + ox - reach > w || y + oy + reach < 0 || y + oy - reach > h) continue;
      fn(ox, oy);
    }
  }
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;
}

function grey(v: number): string {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c},${c},${c})`;
}

// ------------------------------------------------------------------------------------------------
// Building materials
// ------------------------------------------------------------------------------------------------

/** World metres covered by one repeat of the corrugated sheet texture (both axes). */
export const CORRUGATED_METRES = 2;

/** Neutral light corrugated sheet (tinted by vertex colours): vertical ribs, panel seam with rivets. */
export function corrugatedTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const key = 'corrugated';
  const hit = cache.get(key);
  if (hit && !(hit instanceof THREE.Texture)) return hit;
  const W = 256, H = 256, ribs = 12;
  const col = createCanvas(W, H);
  const c = context2d(col);
  const heights = new Float32Array(W * H);
  const rng = new Rng(0xc0f);
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (x / W) * ribs;
      const f = p - Math.floor(p);
      // Trapezoid rib profile: flat crest, slanted flanks, flat valley.
      const prof = f < 0.18 ? 1 : f < 0.42 ? 1 - (f - 0.18) / 0.24 : f < 0.76 ? 0 : (f - 0.76) / 0.24;
      let hv = prof;
      const seam = Math.abs(y - 6);
      if (seam < 4) hv += 0.35 * (1 - seam / 4);
      heights[y * W + x] = hv * 0.8;
      const streak = 0.94 + 0.06 * Math.sin(x * 0.37 + Math.sin(y * 0.02) * 2) * Math.sin(x * 0.051);
      const shade = (0.86 + 0.12 * prof) * streak;
      const o = (y * W + x) * 4;
      const v = Math.round(Math.min(1, shade) * 236);
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = Math.round(v * 1.01); img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // Overlap seam shadow + rivets.
  c.fillStyle = 'rgba(40,44,46,0.35)'; c.fillRect(0, 9, W, 2);
  for (let r = 0; r < ribs; r++) {
    const x = (r + 0.09) / ribs * W;
    c.fillStyle = 'rgba(70,72,74,0.9)'; c.beginPath(); c.arc(x, 6, 2.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.arc(x - 0.6, 5.3, 0.9, 0, Math.PI * 2); c.fill();
  }
  // Weathering smudges.
  for (let i = 0; i < 60; i++) {
    const x = rng.next() * W, y = rng.next() * H, r = rng.range(6, 30);
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(90,84,70,${rng.range(0.03, 0.09)})`);
    gr.addColorStop(1, 'rgba(90,84,70,0)');
    c.fillStyle = gr;
    wrapOffsets(W, H, x, y, r, (ox, oy) => c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2));
  }
  const map = canvasTexture(col, { repeat: true, anisotropy: 8 });
  const normalMap = normalMapFromHeight(heights, W, H, 3.2);
  normalMap.anisotropy = 8;
  const out = { map, normalMap };
  cache.set(key, out);
  return out;
}

/** World metres covered by one repeat of the concrete detail texture. */
export const CONCRETE_DETAIL_METRES = 2.5;

/** Grey-scale concrete grain centred on 0.5 (multiplied ×2 in the floor shader). Tileable. */
export function concreteDetailTexture(): THREE.Texture {
  return cached('concreteDetail', () => {
    const S = 256;
    const data = new Uint8Array(S * S * 4);
    const rng = new Rng(0xc0c);
    const octaves = [
      { f: 4, a: 0.05 }, { f: 16, a: 0.045 }, { f: 64, a: 0.035 },
    ];
    const grids = octaves.map((o) => {
      const g = new Float32Array(o.f * o.f);
      for (let i = 0; i < g.length; i++) g[i] = rng.next() * 2 - 1;
      return g;
    });
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let v = 0.5;
        octaves.forEach((o, k) => {
          const g = grids[k];
          const fx = (x / S) * o.f, fy = (y / S) * o.f;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          const tx = smooth(fx - x0), ty = smooth(fy - y0);
          const x1 = (x0 + 1) % o.f, y1 = (y0 + 1) % o.f;
          const a = g[y0 * o.f + x0], b = g[y0 * o.f + x1], cc = g[y1 * o.f + x0], d = g[y1 * o.f + x1];
          v += (a + (b - a) * tx + (cc + (d - cc) * tx - (a + (b - a) * tx)) * ty) * o.a;
        });
        const r = rng.next();
        if (r < 0.012) v -= rng.range(0.05, 0.14);
        else if (r < 0.02) v += rng.range(0.04, 0.09);
        v += (rng.next() - 0.5) * 0.03;
        const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
        const o4 = (y * S + x) * 4;
        data[o4] = b; data[o4 + 1] = b; data[o4 + 2] = b; data[o4 + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  });
}

/** One plywood sheet (portrait, 1.22 × 2.44 m): wood grain, knots, nail rows, stencil marks. */
export function plywoodTexture(): THREE.Texture {
  return cached('plywood', () => {
    const W = 256, H = 512;
    const cv = createCanvas(W, H);
    const c = context2d(cv);
    const rng = new Rng(0x9e1);
    c.fillStyle = '#c9a26b'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const x = rng.next() * W;
      const amp = rng.range(2, 9), freq = rng.range(0.004, 0.014), ph = rng.next() * 6;
      c.strokeStyle = rng.next() < 0.5 ? `rgba(150,105,55,${rng.range(0.15, 0.4)})` : `rgba(230,196,140,${rng.range(0.15, 0.35)})`;
      c.lineWidth = rng.range(0.8, 3.2);
      c.beginPath();
      for (let y = 0; y <= H; y += 8) {
        const xx = x + Math.sin(y * freq + ph) * amp;
        if (y === 0) c.moveTo(xx, y); else c.lineTo(xx, y);
      }
      c.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = rng.range(20, W - 20), y = rng.range(20, H - 20), rx = rng.range(5, 10), ry = rng.range(10, 22);
      c.fillStyle = 'rgba(110,70,35,0.55)'; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(90,55,25,0.4)'; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y, rx + 4, ry + 7, 0, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = 'rgba(60,50,40,0.85)';
    for (const x of [8, W / 2, W - 8]) for (let y = 14; y < H; y += 38) { c.beginPath(); c.arc(x, y, 2, 0, Math.PI * 2); c.fill(); }
    c.strokeStyle = 'rgba(70,50,30,0.6)'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, W - 3, H - 3);
    c.fillStyle = 'rgba(40,40,60,0.35)';
    c.font = 'bold 22px system-ui, sans-serif';
    c.save(); c.translate(W * 0.28, H * 0.72); c.rotate(-Math.PI / 2); c.fillText('GRADE C · 18 MM', 0, 0); c.restore();
    return canvasTexture(cv, { repeat: false, anisotropy: 8 });
  });
}

/** Rubber belt with transverse cleats. V runs along the belt (4 cleats per repeat). */
export function beltTexture(): THREE.Texture {
  return cached('belt', () => {
    const W = 128, H = 128;
    const cv = createCanvas(W, H);
    const c = context2d(cv);
    const rng = new Rng(0xbe1);
    c.fillStyle = '#2c2d2f'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(${rng.next() < 0.5 ? '255,255,255' : '0,0,0'},${rng.range(0.03, 0.09)})`;
      c.fillRect(rng.next() * W, rng.next() * H, 1.5, 1.5);
    }
    for (let k = 0; k < 4; k++) {
      const y = k * (H / 4) + 6;
      c.fillStyle = '#1b1c1d'; c.fillRect(0, y + 7, W, 4);
      c.fillStyle = '#4a4c4f'; c.fillRect(0, y, W, 8);
      c.fillStyle = '#6a6d70'; c.fillRect(0, y, W, 2);
    }
    c.fillStyle = '#1e1f20'; c.fillRect(0, 0, 6, H); c.fillRect(W - 6, 0, 6, H);
    return canvasTexture(cv, { repeat: true, anisotropy: 4 });
  });
}

// ------------------------------------------------------------------------------------------------
// FX
// ------------------------------------------------------------------------------------------------

/** Cells of the particle atlas (4 × 2 grid). */
export const PARTICLE_SHAPES = { straw: 0, puff: 1, spark: 2, star: 3, coin: 4, confetti: 5, ring: 6, chunk: 7 } as const;
export type ParticleShape = keyof typeof PARTICLE_SHAPES;
export const PARTICLE_ATLAS_COLS = 4;
export const PARTICLE_ATLAS_ROWS = 2;

/** White / grey particle shapes (tinted per particle). Premultiplied-friendly soft edges. */
export function particleAtlas(): THREE.Texture {
  return cached('particles', () => {
    const C = 128;
    const cv = createCanvas(C * PARTICLE_ATLAS_COLS, C * PARTICLE_ATLAS_ROWS);
    const c = context2d(cv);
    c.clearRect(0, 0, cv.width, cv.height);
    const cell = (i: number, draw: (cx: number, cy: number) => void) => {
      const cx = (i % PARTICLE_ATLAS_COLS) * C + C / 2, cy = Math.floor(i / PARTICLE_ATLAS_COLS) * C + C / 2;
      c.save(); c.beginPath(); c.rect(cx - C / 2, cy - C / 2, C, C); c.clip(); draw(cx, cy); c.restore();
    };
    const rng = new Rng(0x9a7);
    // straw: a thin slightly bent stick
    cell(PARTICLE_SHAPES.straw, (cx, cy) => {
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(120,95,50,0.9)'; c.lineWidth = 11;
      c.beginPath(); c.moveTo(cx - 52, cy + 10); c.quadraticCurveTo(cx, cy - 8, cx + 52, cy + 4); c.stroke();
      c.strokeStyle = '#ffffff'; c.lineWidth = 7;
      c.beginPath(); c.moveTo(cx - 52, cy + 10); c.quadraticCurveTo(cx, cy - 8, cx + 52, cy + 4); c.stroke();
    });
    // puff: soft blob built from overlapping radial gradients
    cell(PARTICLE_SHAPES.puff, (cx, cy) => {
      for (let i = 0; i < 7; i++) {
        const x = cx + rng.range(-16, 16), y = cy + rng.range(-16, 16), r = rng.range(30, 48);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.42)'); g.addColorStop(0.6, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.fillRect(cx - C / 2, cy - C / 2, C, C);
      }
    });
    // spark: hot core + glow
    cell(PARTICLE_SHAPES.spark, (cx, cy) => {
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, 60);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(cx - C / 2, cy - C / 2, C, C);
    });
    // star: 4-point glint
    cell(PARTICLE_SHAPES.star, (cx, cy) => drawStar(c, cx, cy, 60));
    // coin: disc with rim and embossed mark
    cell(PARTICLE_SHAPES.coin, (cx, cy) => {
      c.fillStyle = '#b9b9b9'; c.beginPath(); c.arc(cx, cy, 50, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, 42, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#c8c8c8'; c.font = 'bold 60px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('$', cx, cy + 3);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(cx - 16, cy - 20, 12, 6, -0.6, 0, Math.PI * 2); c.fill();
    });
    // confetti: rectangle
    cell(PARTICLE_SHAPES.confetti, (cx, cy) => { c.fillStyle = '#ffffff'; c.fillRect(cx - 34, cy - 18, 68, 36); });
    // ring: soft shock ring
    cell(PARTICLE_SHAPES.ring, (cx, cy) => {
      const g = c.createRadialGradient(cx, cy, 30, cx, cy, 60);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(cx - C / 2, cy - C / 2, C, C);
    });
    // chunk: a clump of crossed straws
    cell(PARTICLE_SHAPES.chunk, (cx, cy) => {
      c.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        const a = rng.next() * Math.PI, l = rng.range(28, 54);
        const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
        const ox = rng.range(-12, 12), oy = rng.range(-12, 12);
        c.strokeStyle = 'rgba(110,85,40,0.9)'; c.lineWidth = 9;
        c.beginPath(); c.moveTo(cx + ox - dx, cy + oy - dy); c.lineTo(cx + ox + dx, cy + oy + dy); c.stroke();
        c.strokeStyle = rng.next() < 0.5 ? '#ffffff' : '#e0e0e0'; c.lineWidth = 5.5;
        c.beginPath(); c.moveTo(cx + ox - dx, cy + oy - dy); c.lineTo(cx + ox + dx, cy + oy + dy); c.stroke();
      }
    });
    return canvasTexture(cv, { mipmaps: true, anisotropy: 1 });
  });
}

function drawStar(c: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
  c.fillStyle = 'rgba(255,255,255,0.95)';
  for (const [sx, sy, len] of [[1, 0, 1], [0, 1, 1], [0.7, 0.7, 0.45], [0.7, -0.7, 0.45]] as const) {
    const w = len > 0.9 ? 5 : 3;
    c.beginPath();
    c.moveTo(cx - sx * r * len, cy - sy * r * len);
    c.lineTo(cx - sy * w, cy + sx * w);
    c.lineTo(cx + sx * r * len, cy + sy * r * len);
    c.lineTo(cx + sy * w, cy - sx * w);
    c.closePath(); c.fill();
  }
}

/** Standalone star glint for needle sprites. */
export function glintTexture(): THREE.Texture {
  return cached('glint', () => {
    const S = 128;
    const cv = createCanvas(S, S);
    const c = context2d(cv);
    c.clearRect(0, 0, S, S);
    drawStar(c, S / 2, S / 2, S / 2 - 2);
    return canvasTexture(cv, { anisotropy: 1 });
  });
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  const hit = cache.get(key);
  if (hit instanceof THREE.Texture) return hit;
  const t = make();
  cache.set(key, t);
  return t;
}

/** Frees every shared procedural texture (renderer teardown). */
export function disposeSharedTextures(): void {
  for (const v of cache.values()) {
    if (v instanceof THREE.Texture) v.dispose();
    else { v.map.dispose(); v.normalMap.dispose(); }
  }
  cache.clear();
}
