import { NEEDLE_COUNT } from '../config/needles';
import { ORDER_BY_ID } from '../config/orders';
import type { Sim } from '../sim/sim';

/**
 * Welcome Back: a read-only re-orientation card shown when a saved run is resumed after a real absence.
 * It never changes the run: no money, no hay, no needles, no simulation (the game stays in clickToPlay,
 * where the sim is paused, until the player clicks).
 */

/** Minimum time away (from the save's `savedAt`) before the card is shown. 20 min: longer than a reload or a
 * short break, shorter than "came back later / next day". Single place to tune. */
export const WELCOME_BACK_MIN_AWAY_S = 20 * 60;
/** Runs shorter than this (in-game seconds) are not worth re-orienting. */
export const WELCOME_BACK_MIN_RUN_S = 120;

export type RunStage = 'manual' | 'automation' | 'scanning' | 'processing' | 'late' | 'complete';

export interface WelcomeBackInfo {
  secondsAway: number;
  /** Share of the haystack removed, 0..100 (integer): the same measure as the `run_progress` event. */
  pilePercent: number;
  needlesFound: number;
  needlesTotal: number;
  stage: RunStage;
  /** "Find needle #3" / "All needles found". */
  objective: string;
  /** Delivered hay-equivalent per second over the last minute before leaving (0 = nothing automated). */
  hayPerSecond: number;
  money: number;
  playedSeconds: number;
  /** Titles of the orders on the board (real data; replaces a guessed "next goal"). */
  orders: string[];
}

/** Coarse stage of a run from what is built (used by Welcome Back and analytics). */
export function runStage(sim: Sim): RunStage {
  if (sim.completed) return 'complete';
  let auto = false, scan = false, proc = false, late = false;
  for (const b of sim.buildings.values()) {
    switch (b.type) {
      case 'vacuumCollector': case 'scannerMk2': late = true; break;
      case 'compressor': case 'wrapper': proc = true; break;
      case 'scannerMk1': scan = true; break;
      case 'pistonRake': case 'roboticArm': case 'hopper': auto = true; break;
      default: break;
    }
  }
  return late ? 'late' : proc ? 'processing' : scan ? 'scanning' : auto ? 'automation' : 'manual';
}

/** Card data, or null when it should not be shown (new run, short absence, very short run, bad clock). */
export function welcomeBackInfo(sim: Sim, savedAt: number, now: number): WelcomeBackInfo | null {
  if (!(savedAt > 0) || !Number.isFinite(now)) return null;
  const secondsAway = Math.floor((now - savedAt) / 1000);
  if (secondsAway < WELCOME_BACK_MIN_AWAY_S) return null;
  if (sim.time < WELCOME_BACK_MIN_RUN_S) return null;
  const found = sim.progress.needlesFound.length;
  return {
    secondsAway,
    pilePercent: Math.floor(sim.hay.progress() * 100),
    needlesFound: found,
    needlesTotal: NEEDLE_COUNT,
    stage: runStage(sim),
    objective: found >= NEEDLE_COUNT ? 'All needles found - keep growing the factory' : `Find needle #${found + 1} of ${NEEDLE_COUNT}`,
    hayPerSecond: Math.round(sim.progress.stableRate()),
    money: Math.floor(sim.progress.money),
    playedSeconds: Math.floor(sim.time),
    orders: sim.progress.activeOrders().map((o) => ORDER_BY_ID[o.id]?.title ?? o.id).slice(0, 3),
  };
}
