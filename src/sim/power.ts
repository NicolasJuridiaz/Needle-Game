import type { Building } from './building';
import type { IPowerNetwork, PowerNetworkInfo, SimContext } from './interfaces';

/**
 * STUB — implemented by the Machines & Power agent. See docs/ARCHITECTURE.md §Power.
 */
export class PowerNetwork implements IPowerNetwork {
  networks: PowerNetworkInfo[] = [];
  totalSupply = 0;
  totalDemand = 0;
  wires: { a: number; b: number }[] = [];
  feeds: { from: number; to: number }[] = [];
  constructor(protected ctx: SimContext, protected buildings: Map<number, Building>) {}
  rebuild(): void { /* stub */ }
  tick(_dt: number): void { /* stub */ }
  networkAt(_x: number, _z: number): number { return -1; }
}
