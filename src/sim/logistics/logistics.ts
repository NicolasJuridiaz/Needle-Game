import type { Building } from '../building';
import type { BeltItemView, ILogistics, SimContext } from '../interfaces';
import type { ItemPacket } from '../types';

/**
 * STUB — implemented by the Logistics agent. See docs/ARCHITECTURE.md §Logistics.
 */
export class Logistics implements ILogistics {
  constructor(protected ctx: SimContext, protected buildings: Map<number, Building>) {}
  relink(): void { /* stub */ }
  tick(_dt: number): void { /* stub */ }
  pushOut(_from: Building, _port: number, _item: ItemPacket): boolean { return false; }
  canPushOut(_from: Building, _port: number, _item: ItemPacket): boolean { return false; }
  isLinked(_from: Building, _port: number): boolean { return false; }
  forEachItem(_alpha: number, _cb: (v: BeltItemView) => void): void { /* stub */ }
  itemCount(): number { return 0; }
}
