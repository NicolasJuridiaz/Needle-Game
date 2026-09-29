/**
 * World layout. All distances in metres. Build grid cells are 1 m; the hay heightfield uses 0.5 m cells.
 * Coordinate system: +X east, +Z south, +Y up. Grid cell (x, z) covers [x, x+1) × [z, z+1).
 */
export const WORLD = {
  /**
   * Warehouse interior (main hall). Compact layout (was maxX 32): the east wall stands at x = 24, the pile sits 6 m
   * further west (pile.cx) so the Market is ~6 m closer; the factory keeps the full z depth and a 13 m east strip.
   */
  interior: { minX: -32, maxX: 24, minZ: -22, maxZ: 22 },
  /** North annex, closed by a temporary wall until "Warehouse Expansion I" is unlocked. */
  annex: { minX: -32, maxX: 24, minZ: 22, maxZ: 36 },
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
    /**
     * Centre (m). Compact layout: -1 (was 5), so the pile's west foot is ~14 m from the SELL HAY drop point (was ~21).
     * -1 is the most the reference factory layout allows: trunk (rake, hopper, scanner, 2 splitters) between the
     * pile foot and the chute, processing on a row north of it (tools/balance/bot.ts).
     */
    cx: -1,
    cz: 0,
    rx: 13,
    rz: 11,
    height: 8.5,
    /** Surface noise amplitude (m) for an organic silhouette. */
    noise: 0.45,
    /**
     * Total LOGICAL hay units in the initial pile (the geometry above is unchanged; only units per metre).
     * RC2: 750k, chosen over 500k / 650k with 50 bot seeds each (docs/DESIGN_DECISIONS.md D15):
     * median completion 64.7 min, P90 68.8, Vacuum Collector and Scanner MK2 used in 100 % of runs.
     */
    totalUnits: 750_000,
    /** Max slope before hay slides (angle of repose), degrees. */
    reposeDeg: 40,
  },

  /** Player spawn: between the Market and the pile, facing the pile (+X). yaw in radians, 0 = facing +X. */
  spawn: { x: -21, z: 2, yaw: 0 },

  /** Fixed buildings placed at game start (cell = min corner, rot). */
  fixed: {
    sellStation: { x: -32, z: 5, rot: 0 as const },
  },

  /**
   * Market intake (manual sell loop): a short FIXED belt along the west wall that runs south (+Z) into the north end
   * of the Market Chute. The player drops carried hay on it; the chute sells it when it arrives (`transitSeconds`),
   * through the same sale call as before. Not a grid building: its cells are reserved (no building can go there).
   * Column x = -32 is the only strip that stays free in real late-game factories (RC1 fixture, bot saves).
   * `dropPadX1`: east edge of the painted drop pad in front of the belt; aiming at the belt OR the pad drops the load,
   * so the sell point is as far from the pile as the old E-on-the-chute point was (walking time unchanged).
   */
  intake: { x: -32, z0: 1, z1: 5, beltY: 0.45, transitSeconds: 1.8, dropPadX1: -29.6 },
  /** Store kiosk (opens the Shop with E; the B key still works everywhere). Cells reserved like the intake. */
  store: { x: -32, z0: -3, z1: 1 },

  /** Wall-mounted props (not grid buildings). */
  props: {
    orderBoard: { x: -31.8, y: 2.2, z: -5, facing: 0 },
    needleCase: { x: -31.8, y: 2.0, z: -9, facing: 0 },
  },
} as const;

/** Cells nothing can be built on (both levels): the Market intake belt and the Store kiosk. */
export function isReservedCell(x: number, z: number): boolean {
  const i = WORLD.intake, st = WORLD.store;
  if (x === i.x && z >= i.z0 && z < i.z1) return true;
  return x === st.x && z >= st.z0 && z < st.z1;
}

/** Grid index helpers for the full buildable area (interior + annex). */
export const GRID = {
  minX: WORLD.interior.minX,
  maxX: WORLD.interior.maxX, // exclusive
  minZ: WORLD.interior.minZ,
  maxZ: WORLD.annex.maxZ, // exclusive
  get width() { return this.maxX - this.minX; },
  get depth() { return this.maxZ - this.minZ; },
};
