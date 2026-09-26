/**
 * Pure (three.js-free) helpers for the hay heightfield view: display heights, normals, vertex tones and
 * the straw-tuft slot allocator. Kept separate from HayView so they can be unit-tested in Node.
 */

/** Hay thinner than this (m) is not drawn: its vertex is pushed under the floor. */
export const HAY_HIDE_EPS = 0.015;
/** Where hidden vertices go (m). Low enough that the slope into the floor looks like a soft edge. */
export const HAY_SUNK_Y = -0.12;
/** A cell needs at least this much hay (m) to grow straw tufts. */
export const TUFT_MIN_HEIGHT = 0.05;

export function displayHeight(h: number): number {
  return h > HAY_HIDE_EPS ? h : HAY_SUNK_Y;
}

/** Integer hash → [0, 1). Deterministic per key (cosmetic variation that survives rebuilds). */
export function hash01(key: number, salt = 0): number {
  let h = Math.imul(key ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(salt + 0x51ed27, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h + Math.imul(h ^ (h >>> 7), 0x297a2d39);
  return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
}

/**
 * Smooth low-frequency tone field (0..1) sampled per vertex once at construction (value noise over a
 * coarse lattice). Gives the pile large sun-bleached / darker patches instead of uniform colour.
 */
export function patchTone(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale, fz = z / scale;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const k = (a: number, b: number) => hash01(Math.imul(a, 73856093) ^ Math.imul(b, 19349663), seed);
  const a = k(x0, z0), b = k(x0 + 1, z0), c = k(x0, z0 + 1), d = k(x0 + 1, z0 + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * Writes the unit normal of vertex (c, r) of a row-major display-height grid into `out` at `o`.
 * Central differences inside, one-sided at the borders.
 */
export function gridNormal(y: Float32Array, stride: number, cols: number, rows: number, cellSize: number, c: number, r: number, out: Float32Array, o: number): void {
  const cl = c > 0 ? c - 1 : c, cr = c < cols - 1 ? c + 1 : c;
  const ru = r > 0 ? r - 1 : r, rd = r < rows - 1 ? r + 1 : r;
  const hl = y[(r * cols + cl) * stride + 1], hr = y[(r * cols + cr) * stride + 1];
  const hu = y[(ru * cols + c) * stride + 1], hd = y[(rd * cols + c) * stride + 1];
  const dx = (hr - hl) / (Math.max(1, cr - cl) * cellSize);
  const dz = (hd - hu) / (Math.max(1, rd - ru) * cellSize);
  let nx = -dx, ny = 1, nz = -dz;
  const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx *= inv; ny *= inv; nz *= inv;
  out[o] = nx; out[o + 1] = ny; out[o + 2] = nz;
}

/**
 * Vertex tone (RGB multipliers around 1) for the straw texture:
 *  - crevices (surface below the neighbour average) darker and warmer,
 *  - crests and the upper pile lighter (sun-bleached),
 *  - thin loose hay on the floor slightly dusty,
 *  - `patch` (0..1) adds large soft colour patches.
 */
export function hayTone(h: number, cavity: number, patch: number, pileHeight: number, out: Float32Array, o: number): void {
  const up = Math.min(1, Math.max(0, h / Math.max(0.1, pileHeight)));
  // cavity > 0: vertex sits below its neighbours (a crease); < 0: crest.
  const crease = Math.min(1, Math.max(0, cavity * 3.2));
  const crest = Math.min(1, Math.max(0, -cavity * 3.2));
  const thin = h < 0.3 ? 1 - Math.max(0, h) / 0.3 : 0;
  let l = 0.9 + 0.13 * up + 0.1 * crest - 0.3 * crease - 0.07 * thin;
  l *= 0.9 + 0.17 * patch;
  // Warm deep tone in creases, pale gold on crests.
  const r = l * (1.0 + 0.02 * crest);
  const g = l * (0.97 - 0.07 * crease + 0.02 * up);
  const b = l * (0.9 - 0.2 * crease + 0.06 * crest - 0.05 * thin + 0.04 * up);
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
}

/**
 * Fixed-capacity allocator mapping tuft "slots" (cell × slotsPerCell) to a compact range of instance
 * indices [0, count). Releasing swaps the last live instance into the freed index so the instanced
 * mesh can simply draw `count` instances. Allocation-free after construction.
 */
export class TuftSlots {
  readonly slotsPerCell: number;
  readonly capacity: number;
  /** slot → instance index (-1 = none). */
  readonly instOf: Int32Array;
  /** instance index → slot. */
  readonly slotOf: Int32Array;
  count = 0;

  constructor(cellCount: number, slotsPerCell: number, capacity: number) {
    this.slotsPerCell = slotsPerCell;
    this.capacity = capacity;
    this.instOf = new Int32Array(cellCount * slotsPerCell).fill(-1);
    this.slotOf = new Int32Array(capacity).fill(-1);
  }

  /** Instance index for `slot`, allocating one if needed. -1 when the pool is exhausted. */
  acquire(slot: number): number {
    const cur = this.instOf[slot];
    if (cur >= 0) return cur;
    if (this.count >= this.capacity) return -1;
    const idx = this.count++;
    this.instOf[slot] = idx;
    this.slotOf[idx] = slot;
    return idx;
  }

  /**
   * Frees the instance of `slot`. Returns the freed index, or -1 if the slot had none.
   * If the returned index differs from the new `count`, the instance previously stored at index `count`
   * now lives at the returned index: the caller must copy its per-instance data there.
   */
  release(slot: number): number {
    const idx = this.instOf[slot];
    if (idx < 0) return -1;
    this.instOf[slot] = -1;
    const last = --this.count;
    if (idx !== last) {
      const moved = this.slotOf[last];
      this.slotOf[idx] = moved;
      this.instOf[moved] = idx;
    }
    this.slotOf[last] = -1;
    return idx;
  }

  clear(): void {
    this.instOf.fill(-1);
    this.slotOf.fill(-1);
    this.count = 0;
  }
}
