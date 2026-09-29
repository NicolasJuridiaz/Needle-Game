import { WORLD } from '../config/world';
import type { Sim } from './sim';

export interface SupplyBounds { readonly x: number; readonly z0: number; readonly z1: number }

const LEGACY_BOUNDS: SupplyBounds = { x: WORLD.store.x, z0: -1, z1: 1 };

/** Preserve factories saved before the wider shop existed. Render, aim and collision share these bounds. */
export function getSupplyBounds(sim: Pick<Sim, 'grid'>): SupplyBounds {
  const full = WORLD.store;
  for (let z = full.z0; z < LEGACY_BOUNDS.z0; z++) {
    if (sim.grid.get(full.x, z, 0) > 0 || sim.grid.get(full.x, z, 1) > 0) return LEGACY_BOUNDS;
  }
  return full;
}
