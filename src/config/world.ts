/**
 * World layout. All distances in metres. Build grid cells are 1 m; the hay heightfield uses 0.5 m cells.
 * Coordinate system: +X east, +Z south, +Y up. Grid cell (x, z) covers [x, x+1) × [z, z+1).
 */
export const WORLD = {
  /** Warehouse interior (main hall). */
  interior: { minX: -32, maxX: 32, minZ: -22, maxZ: 22 },
  /** North annex, closed by a temporary wall until "Warehouse Expansion I" is unlocked. */
  annex: { minX: -32, maxX: 32, minZ: 22, maxZ: 36 },
  wallHeight: 11,
  roofPeak: 16,

  /** Vertical distance between build levels (level 0 floor at y=0, level 1 deck at y=levelHeight). */
  levelHeight: 2.5,
  /** Height of belt surfaces / machine ports above their level floor. */
  beltHeight: 0.45,
  buildCell: 1,

  /** Hay heightfield resolution. Covers interior + annex. */
  hayCell: 0.5,

  /** The haystack. Shape is an organic mound; units are normalised to `totalUnits`. */
  pile: {
    cx: 5,
    cz: 0,
    rx: 13,
    rz: 11,
    height: 8.5,
    /** Surface noise amplitude (m) for an organic silhouette. */
    noise: 0.45,
    /** Total virtual hay units in the initial pile (GDD suggests ~150k). */
    totalUnits: 150_000,
    /** Max slope before hay slides (angle of repose), degrees. */
    reposeDeg: 40,
  },

  /** Player spawn: west side, facing the pile (+X). yaw in radians, 0 = facing +X. */
  spawn: { x: -19, z: 2, yaw: 0 },

  /** Fixed buildings placed at game start (cell = min corner, rot). */
  fixed: {
    sellStation: { x: -32, z: 5, rot: 0 as const },
  },

  /** Wall-mounted props (not grid buildings). */
  props: {
    orderBoard: { x: -31.8, y: 2.2, z: -3, facing: 0 },
    needleCase: { x: -31.8, y: 2.0, z: -9, facing: 0 },
  },
} as const;

/** Grid index helpers for the full buildable area (interior + annex). */
export const GRID = {
  minX: WORLD.interior.minX,
  maxX: WORLD.interior.maxX, // exclusive
  minZ: WORLD.interior.minZ,
  maxZ: WORLD.annex.maxZ, // exclusive
  get width() { return this.maxX - this.minX; },
  get depth() { return this.maxZ - this.minZ; },
};
