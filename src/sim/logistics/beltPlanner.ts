import type { BeltPlan } from '../interfaces';
import type { Sim } from '../sim';
import type { Cell } from '../types';

export interface BeltPlanOptions {
  /** 'auto' = A* around obstacles (needs Auto Route / Snap+), 'xFirst'/'zFirst' = L-shaped route. */
  mode: 'auto' | 'xFirst' | 'zFirst';
  /** Allow ramps/lifts to change level (needs the Belt Lift node). */
  allowLevelChange: boolean;
}

/**
 * STUB — implemented by the Logistics agent. Plans a belt path from `start` to `end` (inclusive cells).
 * Must snap to adjacent machine ports: if `start` is next to an output port the first belt faces away from it,
 * if `end` is next to an input port the last belt points into it.
 */
export function planBeltPath(_sim: Sim, _start: Cell, _end: Cell, _opts: BeltPlanOptions): BeltPlan {
  return { ok: false, reason: 'not implemented', steps: [], cost: 0, connectsStart: false, connectsEnd: false };
}
