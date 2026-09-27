/**
 * VISUAL MAPPING of the hay pile (three.js-free, unit-tested in Node).
 *
 *   simulation heightfield (hay.heights, authoritative: units, extraction, needles, depth bands, save)
 *     -> HaySurface.visual (this file: local 3×3 smoothing + height remap + low-frequency masses, bounded)
 *     -> HayView mesh, hay aiming, walking on the pile, needle / barrow placement on the surface.
 *
 * The logical pile is a peaked dome; seen from the floor it reads as a cone. The remap g(t) = 1 - (1 - t)^P
 * (t = height / pile height) raises the flanks and flattens the crown, so the same hay reads as a big rounded heap
 * with shoulders. Rules that keep gameplay honest:
 *  - a cell with no logical hay (h <= HAY_HIDE_EPS) has no visual hay, and a cell with hay always shows some:
 *    what you see is what you can dig, and nothing invisible can be dug;
 *  - visual - logical stays within [-VISUAL_MAX_LOWER, +VISUAL_MAX_RAISE]: the surface stays glued to the simulation
 *    (the larger allowance is only used to take the point off the crown);
 *  - the mapping is monotonic in the local height: removing hay always lowers the visual surface.
 * Nothing here is ever written back to the simulation.
 */
import { WORLD } from '../config/world';
import { HAY_HIDE_EPS, patchTone } from './hayGrid';

/** Exponent of the flank-raising remap (1 = identity). */
export const SHAPE_EXPONENT = 2.4;
/** Visual crown height as a fraction of the logical pile height. */
export const SHAPE_CROWN = 0.82;
/** Max visual-above-logical (flanks raised) and visual-below-logical (crown lowered) differences (m). */
export const VISUAL_MAX_RAISE = 1.6;
export const VISUAL_MAX_LOWER = 2.4;
/** Amplitude (fraction of height) and scale (m) of the low-frequency noise on top of the lobes. */
const MASS_NOISE = 0.05;
const MASS_SCALE = 6.5;
/**
 * Secondary masses: a few broad lobes (u, w in pile radii from the pile centre, r radius in pile radii, a = height
 * gain) so the heap reads as several overlapping mounds with a slightly saddled crown, not one smooth dome.
 * Gains multiply the local height, so a lobe shrinks with the hay under it and vanishes when that hay is gone.
 */
const LOBES: readonly (readonly [number, number, number, number])[] = [
  // flank shoulders (they carry the outline seen from the spawn / the sides)
  [-0.15, -0.68, 0.3, 0.34], [0.3, 0.7, 0.3, 0.3], [-0.1, 0.62, 0.24, 0.18], [0.4, -0.62, 0.26, 0.2],
  // toe masses front / back
  [-0.68, 0.12, 0.24, 0.18], [0.7, -0.2, 0.26, 0.16],
  // crown: flattened, with two low off-centre humps (slightly irregular top)
  [0.08, -0.02, 0.4, -0.2], [0.32, -0.32, 0.2, 0.08], [-0.22, 0.3, 0.2, 0.06],
];

/** Minimal read-only view of the sim heightfield (IHayField satisfies it). */
export interface HeightGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heights: Float32Array;
  heightAt(x: number, z: number): number;
}

/**
 * Visual height of one cell from its logical height `h`, the 3×3 neighbourhood mean `mean` and the secondary-mass
 * gain `mass` at the cell (0 = none).
 */
export function visualHeight(h: number, mean: number, mass: number, pileHeight: number): number {
  if (h <= HAY_HIDE_EPS) return h;
  const H = Math.max(0.1, pileHeight);
  const hs = 0.5 * h + 0.5 * mean;
  const t = hs / H;
  const g = t >= 1 ? 1 + (t - 1) * 0.5 : 1 - Math.pow(1 - t, SHAPE_EXPONENT);
  // secondary masses fade in with height (none on thin floor hay, full on the body of the pile)
  const fade = Math.min(1, Math.max(0, (t - 0.1) / 0.3));
  let v = H * SHAPE_CROWN * g * (1 + mass * fade);
  v = Math.min(h + VISUAL_MAX_RAISE, Math.max(h - VISUAL_MAX_LOWER, v));
  return Math.max(v, HAY_HIDE_EPS * 2); // a cell with hay always shows hay
}

export class HaySurface {
  cols = 0;
  rows = 0;
  cellSize = 0.5;
  originX = 0;
  originZ = 0;
  /** Visual heights, same layout as the sim grid. */
  visual = new Float32Array(0);
  /** Static secondary-mass gain per cell (lobes + low-frequency noise). */
  private mass = new Float32Array(0);
  private readonly pileHeight: number;

  constructor(private readonly hay: HeightGrid, pileHeight = WORLD.pile.height) {
    this.pileHeight = pileHeight;
    this.rebuild();
  }

  /** True when the sim grid layout changed (rebuild needed). */
  stale(): boolean {
    const h = this.hay;
    return h.cols !== this.cols || h.rows !== this.rows || h.cellSize !== this.cellSize;
  }

  rebuild(): void {
    const h = this.hay;
    this.cols = h.cols; this.rows = h.rows; this.cellSize = h.cellSize;
    this.originX = h.originX; this.originZ = h.originZ;
    const n = this.cols * this.rows;
    this.visual = new Float32Array(n);
    this.mass = new Float32Array(n);
    const P = WORLD.pile;
    for (let r = 0; r < this.rows; r++) {
      const z = this.originZ + (r + 0.5) * this.cellSize;
      for (let c = 0; c < this.cols; c++) {
        const x = this.originX + (c + 0.5) * this.cellSize;
        const u = (x - P.cx) / P.rx, w = (z - P.cz) / P.rz;
        let m = MASS_NOISE * (patchTone(x, z, MASS_SCALE, 71) * 2 - 1);
        for (const [lu, lw, lr, la] of LOBES) m += la * Math.exp(-((u - lu) ** 2 + (w - lw) ** 2) / (lr * lr));
        this.mass[r * this.cols + c] = m;
      }
    }
    if (n > 0) this.update(0, 0, this.cols - 1, this.rows - 1);
  }

  /**
   * Recompute the visual heights for the inclusive cell rect (grown by 1 for the smoothing).
   * Returns the inclusive rect that may have changed, or null when empty.
   */
  update(c0: number, r0: number, c1: number, r1: number): { c0: number; r0: number; c1: number; r1: number } | null {
    const cols = this.cols, rows = this.rows;
    c0 = Math.max(0, c0 - 1); r0 = Math.max(0, r0 - 1);
    c1 = Math.min(cols - 1, c1 + 1); r1 = Math.min(rows - 1, r1 + 1);
    if (c1 < c0 || r1 < r0) return null;
    const h = this.hay.heights, v = this.visual, m = this.mass, H = this.pileHeight;
    for (let r = r0; r <= r1; r++) {
      const ra = r > 0 ? r - 1 : r, rb = r < rows - 1 ? r + 1 : r;
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const ca = c > 0 ? c - 1 : c, cb = c < cols - 1 ? c + 1 : c;
        let sum = 0, n = 0;
        for (let rr = ra; rr <= rb; rr++) for (let cc = ca; cc <= cb; cc++) { sum += h[rr * cols + cc]; n++; }
        v[i] = visualHeight(h[i], sum / n, m[i], H);
      }
    }
    return { c0, r0, c1, r1 };
  }

  /** Bilinear visual height at world (x, z); same sampling as the sim's heightAt. */
  heightAt(x: number, z: number): number {
    const fx = (x - this.originX) / this.cellSize - 0.5;
    const fz = (z - this.originZ) / this.cellSize - 0.5;
    let c0 = Math.floor(fx), r0 = Math.floor(fz);
    const tx = fx - c0, tz = fz - r0;
    const C = this.cols - 1, R = this.rows - 1;
    if (C < 1 || R < 1 || c0 < -1 || r0 < -1 || c0 > C || r0 > R) return 0;
    const c1 = Math.min(C, c0 + 1), r1 = Math.min(R, r0 + 1);
    c0 = Math.max(0, c0); r0 = Math.max(0, r0);
    const v = this.visual, W = this.cols;
    const a = v[r0 * W + c0], b = v[r0 * W + c1], c = v[r1 * W + c0], d = v[r1 * W + c1];
    // hidden cells hold ~0: clamp tiny negative interpolation noise
    return Math.max(0, (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz);
  }

  /** Visual minus logical surface height at (x, z): moves things lying on the logical surface onto the visual one. */
  offsetAt(x: number, z: number): number {
    return this.heightAt(x, z) - this.hay.heightAt(x, z);
  }
}
