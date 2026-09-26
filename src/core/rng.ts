/** Small deterministic PRNG (mulberry32). Seeded per run so needle placement is reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 0x9e3779b9; }
  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(a: number, bInclusive: number): number { return Math.floor(this.range(a, bInclusive + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}

/** 2D value noise for organic shapes (deterministic, seedable). */
export function valueNoise2D(seed: number) {
  const hash = (x: number, z: number) => {
    let h = (x * 374761393 + z * 668265263 + seed * 144269504) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number): number => {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = smooth(x - xi), zf = smooth(z - zi);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * zf;
  };
}
