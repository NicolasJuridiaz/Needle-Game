import { NEEDLE_BANDS } from '../config/needles';
import { WORLD } from '../config/world';
import { Rng, valueNoise2D } from '../core/rng';
import type { DetectorReading, DirtyRect, HayExtraction, HaySave, IHayField } from './interfaces';
import type { NeedleState, Vec3 } from './types';

/** Fraction of the excess slope moved per relaxation step (smooth slumping instead of instant snaps). */
const RELAX_RATE = 0.55;
/** Ignore slope excess below this (m) to avoid endless micro-moves. */
const RELAX_EPS = 0.004;
/** Max cell relaxations per tick (budget; leftovers carry over). */
const RELAX_BUDGET = 4000;
/** Rake removes at most this much height (m) from one cell per cycle, so it keeps pulling at the face. */
const RAKE_CELL_CAP = 0.8;
/** Hay deposited on top of a tossed-back needle (units) so it lands shallowly buried. */
const TOSS_COVER_UNITS = 20;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * The hay heightfield: covers the whole warehouse floor (interior + annex) at 0.5 m resolution.
 * The haystack is its initial state; loose hay dropped anywhere lives in the same field.
 * Units are virtual: `unitsPerMeter` converts metres of height in one cell to hay units.
 */
export class HayField implements IHayField {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize = WORLD.hayCell;
  readonly originX = WORLD.interior.minX;
  readonly originZ = WORLD.interior.minZ;
  heights: Float32Array;
  blocked: Uint8Array;
  unitsPerMeter = 1;
  initialUnits = 0;
  needles: NeedleState[] = [];
  onExposed?: (id: number) => void;

  /** Running sum of heights (double precision, updated from stored float32 values). */
  private sumH = 0;
  private readonly maxDiff: number;
  private readonly queue: Int32Array;
  private readonly inQueue: Uint8Array;
  private qHead = 0;
  private qLen = 0;
  private dirty: DirtyRect | null = null;
  private rng = new Rng(1);
  // scratch buffers for extraction (no per-call allocation for typical sizes)
  private scratchIdx = new Int32Array(4096);
  private scratchVal = new Float64Array(4096);

  constructor() {
    this.cols = Math.round((WORLD.interior.maxX - WORLD.interior.minX) / this.cellSize);
    this.rows = Math.round((WORLD.annex.maxZ - WORLD.interior.minZ) / this.cellSize);
    const n = this.cols * this.rows;
    this.heights = new Float32Array(n);
    this.blocked = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.inQueue = new Uint8Array(n);
    this.maxDiff = Math.tan((WORLD.pile.reposeDeg * Math.PI) / 180) * this.cellSize;
  }

  // =====================================================================================
  // Helpers
  // =====================================================================================

  private cx(col: number): number { return this.originX + (col + 0.5) * this.cellSize; }
  private cz(row: number): number { return this.originZ + (row + 0.5) * this.cellSize; }
  private colOf(x: number): number { return Math.floor((x - this.originX) / this.cellSize); }
  private rowOf(z: number): number { return Math.floor((z - this.originZ) / this.cellSize); }
  private inBounds(c: number, r: number): boolean { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }

  private setH(i: number, v: number): void {
    const old = this.heights[i];
    this.heights[i] = v < 0 ? 0 : v;
    this.sumH += this.heights[i] - old;
    const c = i % this.cols, r = (i / this.cols) | 0;
    const d = this.dirty;
    if (!d) this.dirty = { c0: c, r0: r, c1: c, r1: r };
    else {
      if (c < d.c0) d.c0 = c; if (c > d.c1) d.c1 = c;
      if (r < d.r0) d.r0 = r; if (r > d.r1) d.r1 = r;
    }
  }

  private push(i: number): void {
    if (this.inQueue[i] || this.blocked[i]) return;
    this.inQueue[i] = 1;
    this.queue[(this.qHead + this.qLen) % this.queue.length] = i;
    this.qLen++;
  }

  private activateAround(i: number): void {
    const c = i % this.cols, r = (i / this.cols) | 0;
    this.push(i);
    if (c > 0) this.push(i - 1);
    if (c < this.cols - 1) this.push(i + 1);
    if (r > 0) this.push(i - this.cols);
    if (r < this.rows - 1) this.push(i + this.cols);
  }

  private ensureScratch(n: number): void {
    if (this.scratchIdx.length < n) { this.scratchIdx = new Int32Array(n * 2); this.scratchVal = new Float64Array(n * 2); }
  }

  private needleCell(n: NeedleState): number {
    const c = this.colOf(n.pos.x), r = this.rowOf(n.pos.z);
    return this.inBounds(c, r) ? r * this.cols + c : -1;
  }

  private liveNeedle(n: NeedleState): boolean { return n.status === 'buried' || n.status === 'exposed'; }

  /** After cells changed height, take needles whose column was cut below them. */
  private collectCutNeedles(touched: Int32Array, count: number, out: number[]): void {
    for (const n of this.needles) {
      if (!this.liveNeedle(n)) continue;
      const ci = this.needleCell(n);
      for (let k = 0; k < count; k++) {
        if (touched[k] !== ci) continue;
        if (this.heights[ci] < n.pos.y + 0.02) { n.status = 'inTransit'; out.push(n.id); }
        break;
      }
    }
  }

  // =====================================================================================
  // Generation
  // =====================================================================================

  generate(seed: number, totalUnits: number = WORLD.pile.totalUnits): void {
    const P = WORLD.pile;
    const units = Number.isFinite(totalUnits) && totalUnits > 0 ? totalUnits : P.totalUnits;
    const rng = new Rng(seed ^ 0x6a09e667);
    this.rng = new Rng(seed ^ 0x3c6ef372);
    const nOutline = valueNoise2D(seed ^ 0x1234);
    const nSurface = valueNoise2D(seed ^ 0x9876);
    const nFine = valueNoise2D(seed ^ 0x5555);
    this.heights.fill(0);
    this.blocked.fill(0);
    this.sumH = 0;
    this.qHead = 0; this.qLen = 0; this.inQueue.fill(0);

    // Lumps / shoulders on the flanks.
    const lumps: { x: number; z: number; r: number; a: number }[] = [];
    const lumpCount = 4 + rng.int(0, 2);
    for (let i = 0; i < lumpCount; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const rr = rng.range(0.35, 0.75);
      lumps.push({ x: P.cx + Math.cos(ang) * P.rx * rr, z: P.cz + Math.sin(ang) * P.rz * rr, r: rng.range(2.2, 4.2), a: rng.range(0.6, 1.5) });
    }

    const H = P.height;
    for (let r = 0; r < this.rows; r++) {
      const z = this.cz(r);
      for (let c = 0; c < this.cols; c++) {
        const x = this.cx(c);
        const dx = (x - P.cx) / P.rx, dz = (z - P.cz) / P.rz;
        const ang = Math.atan2(dz, dx);
        const warp = 1 + 0.13 * (nOutline(Math.cos(ang) * 1.6 + 3.1, Math.sin(ang) * 1.6 + 7.3) * 2 - 1);
        const rn = Math.sqrt(dx * dx + dz * dz) / warp;
        let h = 0;
        if (rn < 1) {
          const s = rn * rn * (3 - 2 * rn);
          h = H * Math.pow(1 - s, 0.85);
          // soften the crown slightly
          h = Math.min(h, H * 0.96 + (h - H * 0.96) * 0.35);
        }
        for (const L of lumps) {
          const d2 = ((x - L.x) ** 2 + (z - L.z) ** 2) / (L.r * L.r);
          if (d2 < 4) h += L.a * Math.exp(-d2 * 1.6) * (h > 0.2 ? 1 : 0.4);
        }
        if (h > 0.05) {
          const k = Math.min(1, h / 1.6);
          h += P.noise * (nSurface(x * 0.28, z * 0.28) * 2 - 1) * k;
          h += P.noise * 0.35 * (nFine(x * 0.9, z * 0.9) * 2 - 1) * k;
        }
        this.heights[r * this.cols + c] = h > 0.03 ? h : 0;
      }
    }

    // Clamp slopes below the angle of repose (a stable initial state), shaping natural flanks.
    const lim = this.maxDiff * 0.86;
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        let h = this.heights[i];
        if (h <= 0) continue;
        const m = Math.min(
          c > 0 ? this.heights[i - 1] : 0, c < this.cols - 1 ? this.heights[i + 1] : 0,
          r > 0 ? this.heights[i - this.cols] : 0, r < this.rows - 1 ? this.heights[i + this.cols] : 0,
        ) + lim;
        if (h > m) { h = m; changed = true; this.heights[i] = h > 0.03 ? h : 0; }
      }
      if (!changed) break;
    }

    let sum = 0;
    for (let i = 0; i < this.heights.length; i++) sum += this.heights[i];
    this.sumH = sum;
    this.unitsPerMeter = units / sum;
    this.initialUnits = units;
    this.dirty = { c0: 0, r0: 0, c1: this.cols - 1, r1: this.rows - 1 };
    this.placeNeedles(rng);
  }

  private placeNeedles(rng: Rng): void {
    const H0 = this.heights;
    const V0 = this.sumH;
    const V = (d: number) => { let s = 0; for (let i = 0; i < H0.length; i++) { const v = H0[i] - d; if (v > 0) s += v; } return s; };
    let maxH = 0;
    for (let i = 0; i < H0.length; i++) if (H0[i] > maxH) maxH = H0[i];
    this.needles = [];
    const placed: { x: number; z: number }[] = [];
    NEEDLE_BANDS.forEach((band, id) => {
      const t = rng.range(band[0] + 0.01, band[1] - 0.01);
      let lo = 0, hi = maxH;
      for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (V(mid) > (1 - t) * V0) lo = mid; else hi = mid; }
      const d = (lo + hi) / 2;
      const cands: number[] = [];
      const minSpacing = 2;
      for (let i = 0; i < H0.length; i++) {
        if (H0[i] < d + 0.25) continue;
        const x = this.cx(i % this.cols), z = this.cz((i / this.cols) | 0);
        if (z >= WORLD.interior.maxZ - 0.5) continue;
        if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minSpacing * minSpacing)) continue;
        if (id >= 1) {
          // keep away from the rim so the band holds
          const c = i % this.cols, r = (i / this.cols) | 0;
          let rim = false;
          for (let dr = -2; dr <= 2 && !rim; dr++) for (let dc = -2; dc <= 2; dc++) {
            const cc = c + dc, rr = r + dr;
            if (!this.inBounds(cc, rr) || H0[rr * this.cols + cc] <= 0.05) { rim = true; break; }
          }
          if (rim) continue;
        }
        cands.push(i);
      }
      let cell: number;
      if (cands.length) cell = cands[Math.floor(rng.next() * cands.length)];
      else { // fallback: tallest cell
        cell = 0;
        for (let i = 1; i < H0.length; i++) if (H0[i] > H0[cell]) cell = i;
      }
      const x = this.cx(cell % this.cols), z = this.cz((cell / this.cols) | 0);
      const y = Math.max(0.1, Math.min(H0[cell] - 0.05, H0[cell] - d));
      placed.push({ x, z });
      this.needles.push({ id, band: [band[0], band[1]], pos: { x, y, z }, status: 'buried', returns: 0 });
    });
  }

  // =====================================================================================
  // Queries
  // =====================================================================================

  heightAt(x: number, z: number): number {
    const fx = (x - this.originX) / this.cellSize - 0.5;
    const fz = (z - this.originZ) / this.cellSize - 0.5;
    let c0 = Math.floor(fx), r0 = Math.floor(fz);
    const tx = fx - c0, tz = fz - r0;
    const C = this.cols - 1, R = this.rows - 1;
    if (c0 < -1 || r0 < -1 || c0 > C || r0 > R) return 0;
    const c1 = Math.min(C, c0 + 1), r1 = Math.min(R, r0 + 1);
    c0 = Math.max(0, c0); r0 = Math.max(0, r0);
    const h = this.heights, W = this.cols;
    const a = h[r0 * W + c0], b = h[r0 * W + c1], c = h[r1 * W + c0], d = h[r1 * W + c1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  totalUnits(): number { return this.sumH * this.unitsPerMeter; }

  progress(): number {
    if (this.initialUnits <= 0) return 0;
    const p = 1 - this.totalUnits() / this.initialUnits;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  unitsInRadius(x: number, z: number, radius: number): number {
    let s = 0;
    const r2 = radius * radius;
    const c0 = Math.max(0, this.colOf(x - radius)), c1 = Math.min(this.cols - 1, this.colOf(x + radius));
    const r0 = Math.max(0, this.rowOf(z - radius)), r1 = Math.min(this.rows - 1, this.rowOf(z + radius));
    for (let r = r0; r <= r1; r++) {
      const dz = this.cz(r) - z;
      for (let c = c0; c <= c1; c++) {
        const dx = this.cx(c) - x;
        if (dx * dx + dz * dz <= r2) s += this.heights[r * this.cols + c];
      }
    }
    return s * this.unitsPerMeter;
  }

  maxHeightInRect(x0: number, z0: number, x1: number, z1: number): number {
    let m = 0;
    const c0 = Math.max(0, Math.ceil((x0 - this.originX) / this.cellSize - 0.5)), c1 = Math.min(this.cols - 1, Math.floor((x1 - this.originX) / this.cellSize - 0.5 - 1e-6));
    const r0 = Math.max(0, Math.ceil((z0 - this.originZ) / this.cellSize - 0.5)), r1 = Math.min(this.rows - 1, Math.floor((z1 - this.originZ) / this.cellSize - 0.5 - 1e-6));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const h = this.heights[r * this.cols + c]; if (h > m) m = h; }
    return m;
  }

  findTarget(x: number, z: number, radius: number, mode: 'nearest' | 'densest', minRadius = 0, behind?: { fx: number; fz: number; margin: number }): { x: number; z: number; height: number; units: number } | null {
    const r2 = radius * radius, m2 = minRadius * minRadius;
    const bx = behind?.fx ?? 0, bz = behind?.fz ?? 0, bMax = behind ? -behind.margin : Infinity;
    const c0 = Math.max(0, this.colOf(x - radius)), c1 = Math.min(this.cols - 1, this.colOf(x + radius));
    const r0 = Math.max(0, this.rowOf(z - radius)), r1 = Math.min(this.rows - 1, this.rowOf(z + radius));
    let best = -1, bestScore = Infinity, fallback = -1, fallbackD = Infinity;
    for (let r = r0; r <= r1; r++) {
      const dz = this.cz(r) - z;
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const h = this.heights[i];
        if (h <= 0.03 || this.blocked[i]) continue;
        const dx = this.cx(c) - x;
        const d2 = dx * dx + dz * dz;
        if (d2 > r2 || d2 < m2 || dx * bx + dz * bz > bMax) continue;
        if (mode === 'densest') {
          const score = -h + d2 * 1e-4; // tallest, ties -> nearer
          if (score < bestScore) { bestScore = score; best = i; }
        } else if (h > 0.15) {
          if (d2 < bestScore) { bestScore = d2; best = i; }
        } else if (d2 < fallbackD) { fallbackD = d2; fallback = i; }
      }
    }
    const i = best >= 0 ? best : fallback;
    if (i < 0) return null;
    const h = this.heights[i];
    return { x: this.cx(i % this.cols), z: this.cz((i / this.cols) | 0), height: h, units: h * this.unitsPerMeter };
  }

  // =====================================================================================
  // Extraction / deposit
  // =====================================================================================

  extractRadius(x: number, z: number, radius: number, maxUnits: number): HayExtraction {
    const out: HayExtraction = { units: 0, needles: [], pos: { x, y: 0, z } };
    if (!(maxUnits > 0) || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    radius = Math.max(0, radius);
    const r2 = radius * radius;
    const c0 = Math.max(0, this.colOf(x - radius)), c1 = Math.min(this.cols - 1, this.colOf(x + radius));
    const r0 = Math.max(0, this.rowOf(z - radius)), r1 = Math.min(this.rows - 1, this.rowOf(z + radius));
    this.ensureScratch((c1 - c0 + 2) * (r1 - r0 + 2) + 1);
    const idx = this.scratchIdx;
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      const dz = this.cz(r) - z;
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.blocked[i] || this.heights[i] <= 0) continue;
        const dx = this.cx(c) - x;
        if (dx * dx + dz * dz <= r2) idx[n++] = i;
      }
    }
    if (n === 0) {
      // at least the nearest cell with hay (within one cell of the radius)
      const t = this.findTarget(x, z, radius + this.cellSize * 1.5, 'nearest');
      if (!t) return out;
      idx[n++] = this.rowOf(t.z) * this.cols + this.colOf(t.x);
    }
    // water level L: sum(max(h - L, 0)) = want
    const want = maxUnits / this.unitsPerMeter;
    let total = 0, hmax = 0;
    for (let k = 0; k < n; k++) { const h = this.heights[idx[k]]; total += h; if (h > hmax) hmax = h; }
    let L = 0;
    if (total > want) {
      let lo = 0, hi = hmax;
      for (let it = 0; it < 32; it++) {
        const mid = (lo + hi) / 2;
        let s = 0;
        for (let k = 0; k < n; k++) { const v = this.heights[idx[k]] - mid; if (v > 0) s += v; }
        if (s > want) lo = mid; else hi = mid;
      }
      L = hi;
    }
    let removed = 0, sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const h = this.heights[i];
      if (h <= L) continue;
      const take = h - L;
      const before = this.heights[i];
      this.setH(i, L);
      const actual = before - this.heights[i];
      removed += actual;
      sx += this.cx(i % this.cols) * actual; sz += this.cz((i / this.cols) | 0) * actual; sy += (L + take / 2) * actual;
      this.activateAround(i);
    }
    if (removed <= 0) return out;
    out.units = removed * this.unitsPerMeter;
    out.pos = { x: sx / removed, y: sy / removed, z: sz / removed };
    this.collectCutNeedles(idx, n, out.needles);
    return out;
  }

  extractStrip(x: number, z: number, dirX: number, dirZ: number, width: number, maxLength: number, maxUnits: number): HayExtraction & { reach: number } {
    const out = { units: 0, needles: [] as number[], pos: { x, y: 0, z }, reach: 0 };
    const dl = Math.hypot(dirX, dirZ);
    if (!(maxUnits > 0) || dl < 1e-6 || !(maxLength > 0)) return out;
    dirX /= dl; dirZ /= dl;
    const hw = Math.max(this.cellSize * 0.5, width / 2);
    const ex = x + dirX * maxLength, ez = z + dirZ * maxLength;
    const minx = Math.min(x, ex) - hw, maxx = Math.max(x, ex) + hw, minz = Math.min(z, ez) - hw, maxz = Math.max(z, ez) + hw;
    const c0 = Math.max(0, this.colOf(minx)), c1 = Math.min(this.cols - 1, this.colOf(maxx));
    const r0 = Math.max(0, this.rowOf(minz)), r1 = Math.min(this.rows - 1, this.rowOf(maxz));
    this.ensureScratch((c1 - c0 + 2) * (r1 - r0 + 2) + 1);
    const idx = this.scratchIdx, along = this.scratchVal;
    let n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * this.cols + c;
      if (this.blocked[i] || this.heights[i] <= 0.01) continue;
      const px = this.cx(c) - x, pz = this.cz(r) - z;
      const a = px * dirX + pz * dirZ;
      const b = -px * dirZ + pz * dirX;
      if (a < 0 || a > maxLength || Math.abs(b) > hw) continue;
      idx[n] = i; along[n] = a; n++;
    }
    if (n === 0) return out;
    // sort by distance along the strip (insertion sort: n is small)
    for (let k = 1; k < n; k++) {
      const ai = idx[k], aa = along[k];
      let j = k - 1;
      while (j >= 0 && along[j] > aa) { idx[j + 1] = idx[j]; along[j + 1] = along[j]; j--; }
      idx[j + 1] = ai; along[j + 1] = aa;
    }
    let want = maxUnits / this.unitsPerMeter;
    let removed = 0, sx = 0, sy = 0, sz = 0, reach = 0, touched = 0;
    for (let k = 0; k < n && want > 1e-9; k++) {
      const i = idx[k];
      const h = this.heights[i];
      const take = Math.min(h, RAKE_CELL_CAP, want);
      if (take <= 0) continue;
      this.setH(i, h - take);
      const actual = h - this.heights[i];
      want -= actual;
      removed += actual;
      sx += this.cx(i % this.cols) * actual; sz += this.cz((i / this.cols) | 0) * actual; sy += (h - actual / 2) * actual;
      reach = Math.max(reach, along[k]);
      this.activateAround(i);
      touched = k + 1;
    }
    if (removed <= 0) return out;
    out.units = removed * this.unitsPerMeter;
    out.pos = { x: sx / removed, y: sy / removed, z: sz / removed };
    out.reach = reach;
    this.collectCutNeedles(idx, touched, out.needles);
    return out;
  }

  deposit(x: number, z: number, units: number, needles?: number[]): void {
    if (!(units > 0) && !needles?.length) return;
    units = Math.max(0, units || 0);
    const vol = units / this.unitsPerMeter;
    // spread radius grows with the amount (a small cone)
    let radius = Math.min(2.2, Math.max(0.5, Math.sqrt(vol / Math.PI) * 1.2 + 0.35));
    let n = 0, wsum = 0;
    let idx = this.scratchIdx, w = this.scratchVal;
    for (let attempt = 0; attempt < 6 && n === 0; attempt++) {
      const c0 = Math.max(0, this.colOf(x - radius)), c1 = Math.min(this.cols - 1, this.colOf(x + radius));
      const r0 = Math.max(0, this.rowOf(z - radius)), r1 = Math.min(this.rows - 1, this.rowOf(z + radius));
      this.ensureScratch((c1 - c0 + 2) * (r1 - r0 + 2) + 1);
      idx = this.scratchIdx; w = this.scratchVal;
      wsum = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (this.blocked[i]) continue;
        const d = Math.hypot(this.cx(c) - x, this.cz(r) - z);
        if (d > radius) continue;
        const wt = 1 - d / (radius + 1e-6) + 0.05;
        idx[n] = i; w[n] = wt; wsum += wt; n++;
      }
      if (n === 0) radius *= 2; // everything around is blocked (inside a machine): search wider
    }
    if (n === 0) return; // no free floor anywhere near (should not happen)
    let centre = idx[0], bestW = -1;
    for (let k = 0; k < n; k++) {
      const add = (vol * w[k]) / wsum;
      if (add > 0) this.setH(idx[k], this.heights[idx[k]] + add);
      this.activateAround(idx[k]);
      if (w[k] > bestW) { bestW = w[k]; centre = idx[k]; }
    }
    // Keep the conservation exact despite float32 rounding.
    if (needles?.length) {
      for (const id of needles) {
        const nd = this.needles.find((q) => q.id === id);
        if (!nd || nd.status === 'found') continue;
        nd.pos = { x: this.cx(centre % this.cols), y: this.heights[centre], z: this.cz((centre / this.cols) | 0) };
        nd.status = 'exposed';
        this.onExposed?.(id);
      }
    }
  }

  setBlocked(x0: number, z0: number, x1: number, z1: number, blocked: boolean): void {
    const c0 = Math.max(0, Math.ceil((x0 - this.originX) / this.cellSize - 0.5)), c1 = Math.min(this.cols - 1, Math.floor((x1 - this.originX) / this.cellSize - 0.5 - 1e-6));
    const r0 = Math.max(0, Math.ceil((z0 - this.originZ) / this.cellSize - 0.5)), r1 = Math.min(this.rows - 1, Math.floor((z1 - this.originZ) / this.cellSize - 0.5 - 1e-6));
    if (c1 < c0 || r1 < r0) return;
    if (!blocked) {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.blocked[r * this.cols + c] = 0;
      // neighbours may now slump into the freed area
      for (let r = r0 - 1; r <= r1 + 1; r++) for (let c = c0 - 1; c <= c1 + 1; c++) if (this.inBounds(c, r)) this.push(r * this.cols + c);
      return;
    }
    // Collect hay (and needles) sitting in the rect, then block it and push the hay outside.
    let vol = 0;
    const movedNeedles: number[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * this.cols + c;
      if (this.heights[i] > 0) { vol += this.heights[i]; this.setH(i, 0); }
      this.blocked[i] = 1;
      this.inQueue[i] = 0;
    }
    for (const nd of this.needles) {
      if (!this.liveNeedle(nd)) continue;
      const c = this.colOf(nd.pos.x), r = this.rowOf(nd.pos.z);
      if (c >= c0 && c <= c1 && r >= r0 && r <= r1) movedNeedles.push(nd.id);
    }
    if (vol <= 0 && !movedNeedles.length) return;
    // Distribute along the ring just outside the rect.
    const ring: number[] = [];
    for (let grow = 1; grow <= 12 && ring.length === 0; grow++) {
      for (let r = r0 - grow; r <= r1 + grow; r++) for (let c = c0 - grow; c <= c1 + grow; c++) {
        if (!this.inBounds(c, r)) continue;
        const onRing = r === r0 - grow || r === r1 + grow || c === c0 - grow || c === c1 + grow;
        if (!onRing) continue;
        const i = r * this.cols + c;
        if (!this.blocked[i]) ring.push(i);
      }
    }
    if (!ring.length) return;
    const each = vol / ring.length;
    for (const i of ring) { this.setH(i, this.heights[i] + each); this.activateAround(i); }
    for (const id of movedNeedles) {
      const nd = this.needles.find((q) => q.id === id)!;
      const i = ring[Math.floor(ring.length / 2)];
      const surf = this.heights[i];
      nd.pos = { x: this.cx(i % this.cols), y: Math.max(0.05, surf - 0.1), z: this.cz((i / this.cols) | 0) };
      nd.status = surf > nd.pos.y + 0.05 ? 'buried' : 'exposed';
      if (nd.status === 'exposed') this.onExposed?.(id);
    }
  }

  // =====================================================================================
  // Relaxation
  // =====================================================================================

  tick(_dt: number): void {
    let budget = RELAX_BUDGET;
    const h = this.heights, W = this.cols, R = this.rows, md = this.maxDiff;
    while (this.qLen > 0 && budget-- > 0) {
      const i = this.queue[this.qHead];
      this.qHead = (this.qHead + 1) % this.queue.length;
      this.qLen--;
      this.inQueue[i] = 0;
      if (this.blocked[i]) continue;
      const hi = h[i];
      if (hi <= 0) continue;
      const c = i % W, r = (i / W) | 0;
      let moved = false;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (c === 0) continue; j = i - 1; }
        else if (k === 1) { if (c === W - 1) continue; j = i + 1; }
        else if (k === 2) { if (r === 0) continue; j = i - W; }
        else { if (r === R - 1) continue; j = i + W; }
        if (this.blocked[j]) continue;
        const excess = h[i] - h[j] - md;
        if (excess <= RELAX_EPS) continue;
        const m = Math.min(h[i], excess * 0.5 * RELAX_RATE);
        this.setH(i, h[i] - m);
        this.setH(j, h[j] + m);
        this.push(j);
        moved = true;
      }
      if (moved) this.activateAround(i);
    }
    // Needle exposure / burial.
    for (const n of this.needles) {
      if (!this.liveNeedle(n)) continue;
      const ci = this.needleCell(n);
      if (ci < 0) continue;
      const surf = h[ci];
      if (n.status === 'buried' && surf <= n.pos.y + 0.02) {
        n.status = 'exposed';
        n.pos.y = surf;
        this.onExposed?.(n.id);
      } else if (n.status === 'exposed') {
        if (surf < n.pos.y) n.pos.y = surf; // rests on the (sinking) surface
        else if (surf > n.pos.y + 0.1) n.status = 'buried';
      }
    }
  }

  consumeDirtyRect(): DirtyRect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  // =====================================================================================
  // Needles
  // =====================================================================================

  detectorReading(x: number, z: number, range: number, depth: number, noise: number): DetectorReading {
    const res: DetectorReading = { strength: 0, distance: 0, dirX: 0, dirZ: 0, tooDeep: false, needleId: -1 };
    let tooDeep = false;
    for (const n of this.needles) {
      if (!this.liveNeedle(n)) continue;
      const dx = n.pos.x - x, dz = n.pos.z - z;
      const dh = Math.hypot(dx, dz);
      if (dh > range) continue;
      const dd = Math.max(0, this.heightAt(n.pos.x, n.pos.z) - n.pos.y);
      if (dd > depth) { tooDeep = true; continue; }
      const s = Math.pow(1 - dh / range, 1.5) * (1 - (0.5 * dd) / Math.max(depth, 1e-3));
      if (s > res.strength) {
        res.strength = s; res.distance = dh; res.needleId = n.id;
        res.dirX = dh > 1e-6 ? dx / dh : 0; res.dirZ = dh > 1e-6 ? dz / dh : 0;
      }
    }
    if (res.needleId >= 0 && noise > 0) {
      // Deterministic jitter per 0.5 m position cell: stable while standing still.
      const qx = Math.floor(x * 2), qz = Math.floor(z * 2);
      let hsh = (qx * 73856093) ^ (qz * 19349663) ^ (res.needleId * 83492791);
      hsh = Math.imul(hsh ^ (hsh >>> 13), 0x5bd1e995);
      const u = ((hsh >>> 0) % 10000) / 10000, v = (((hsh >>> 7) >>> 0) % 10000) / 10000;
      res.strength = Math.max(0, Math.min(1, res.strength * (1 + (u * 2 - 1) * 0.25 * noise)));
      const a = (v * 2 - 1) * ((40 * Math.PI) / 180) * noise;
      const cs = Math.cos(a), sn = Math.sin(a);
      const nx = res.dirX * cs - res.dirZ * sn, nz = res.dirX * sn + res.dirZ * cs;
      res.dirX = nx; res.dirZ = nz;
    }
    res.tooDeep = res.needleId < 0 && tooDeep;
    return res;
  }

  markFound(id: number): void {
    const n = this.needles.find((q) => q.id === id);
    if (n) n.status = 'found';
  }

  tossBack(id: number): Vec3 {
    const n = this.needles.find((q) => q.id === id);
    if (!n) return { x: 0, y: 0, z: 0 };
    let maxH = 0;
    for (let i = 0; i < this.heights.length; i++) if (this.heights[i] > maxH && !this.blocked[i]) maxH = this.heights[i];
    const cands: number[] = [];
    if (maxH > 0.3) {
      const thr = maxH * 0.6;
      for (let i = 0; i < this.heights.length; i++) if (!this.blocked[i] && this.heights[i] >= thr) cands.push(i);
    }
    if (!cands.length) for (let i = 0; i < this.heights.length; i++) if (!this.blocked[i] && this.heights[i] > 0.05) cands.push(i);
    let cell: number;
    if (cands.length) cell = cands[Math.floor(this.rng.next() * cands.length)];
    else {
      const c = this.colOf(WORLD.pile.cx), r = this.rowOf(WORLD.pile.cz);
      cell = r * this.cols + c;
      if (this.blocked[cell]) { for (let i = 0; i < this.heights.length; i++) if (!this.blocked[i] && i < this.cols * this.rowOf(WORLD.interior.maxZ - 1)) { cell = i; break; } }
    }
    const x = this.cx(cell % this.cols), z = this.cz((cell / this.cols) | 0);
    n.pos = { x, y: this.heights[cell], z };
    n.status = 'buried';
    n.returns++;
    // cover it with a little hay right on top of it
    const add = TOSS_COVER_UNITS / this.unitsPerMeter;
    this.setH(cell, this.heights[cell] + add);
    this.activateAround(cell);
    return { ...n.pos };
  }

  exposedNeedleNear(x: number, y: number, z: number, radius: number): number {
    let best = -1, bd = radius * radius;
    for (const n of this.needles) {
      if (n.status !== 'exposed') continue;
      const d = (n.pos.x - x) ** 2 + (n.pos.y - y) ** 2 + (n.pos.z - z) ** 2;
      if (d <= bd) { bd = d; best = n.id; }
    }
    return best;
  }

  // =====================================================================================
  // Save / load
  // =====================================================================================

  serialize(): HaySave {
    const q = new Uint16Array(this.heights.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.min(65535, Math.round(this.heights[i] * 1000));
    return {
      heights: toBase64(new Uint8Array(q.buffer)),
      blocked: toBase64(this.blocked),
      initialUnits: this.initialUnits,
      unitsPerMeter: this.unitsPerMeter,
      rng: this.rng.state,
      needles: this.needles.map((n) => ({ ...n, band: [n.band[0], n.band[1]], pos: { ...n.pos } })),
    };
  }

  deserialize(s: HaySave): void {
    const hb = fromBase64(s.heights);
    const q = new Uint16Array(hb.buffer, hb.byteOffset, Math.floor(hb.byteLength / 2));
    const n = Math.min(q.length, this.heights.length);
    this.heights.fill(0);
    for (let i = 0; i < n; i++) this.heights[i] = q[i] / 1000;
    const bb = fromBase64(s.blocked);
    this.blocked.fill(0);
    this.blocked.set(bb.subarray(0, this.blocked.length));
    this.initialUnits = s.initialUnits;
    let sum = 0;
    for (let i = 0; i < this.heights.length; i++) sum += this.heights[i];
    this.sumH = sum;
    this.unitsPerMeter = s.unitsPerMeter ?? (sum > 0 ? s.initialUnits / sum : 1);
    if (s.rng !== undefined) this.rng.state = s.rng;
    this.needles = s.needles.map((nd) => ({ ...nd, band: [nd.band[0], nd.band[1]], pos: { ...nd.pos } }));
    // Re-activate every cell with hay once: stable cells settle immediately.
    this.qHead = 0; this.qLen = 0; this.inQueue.fill(0);
    for (let i = 0; i < this.heights.length; i++) if (this.heights[i] > 0) this.push(i);
    this.dirty = { c0: 0, r0: 0, c1: this.cols - 1, r1: this.rows - 1 };
  }
}
