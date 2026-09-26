/**
 * Global balance constants that are NOT upgradable stats (those live in stats.ts).
 */
export const BALANCE = {
  /** Fixed simulation tick (s). Sim runs at 20 Hz; rendering interpolates. */
  tickDt: 0.05,

  /** Hay units per raw-hay packet on belts / through machine ports. */
  hayPacketSize: 10,

  /** Hay-equivalent weight of items (player carry, silo capacity). */
  itemWeight: { hay: 1, bale: 20, wrapped: 20 } as Record<'hay' | 'bale' | 'wrapped', number>,

  /** Starting resources. */
  startMoney: 0,
  startWP: 0,

  /** Refund fraction when demolishing. Logistics are fully refunded to encourage experimenting. */
  refund: { default: 0.9, logistics: 1.0 },

  /** Delay (s) for a demolished machine's contents to be returned as loose hay on the floor. */
  spillOnDemolish: true,

  /** Needle rewards. Buffs are assigned in DISCOVERY order (k-th needle found -> buff k). */
  needleWP: 4,

  /** Power: idle machines draw this fraction of their nominal power. */
  idlePowerFraction: 0.15,
  /** A fuelled generator's fire never goes fully out: it burns at least this fraction of its full-load rate. */
  generatorPilotBurn: 0.25,
  /** Radius (m) around a generator that powers machines directly without poles. */
  generatorDirectRadius: 5,

  /** Autosave interval (s). */
  autosaveInterval: 30,

  /** "Stable production" orders measure delivered hay-equivalent per second over this window (s). */
  stableWindow: 60,

  /** Hay-equivalent value of processed items for throughput stats. */
  hayEquivalent: { hay: 1, bale: 40, wrapped: 40 } as Record<'hay' | 'bale' | 'wrapped', number>,
} as const;
