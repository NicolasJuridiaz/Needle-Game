import { BALANCE } from '../config/balance';
import type { ItemCounts, ItemPacket, ItemType } from './types';

/**
 * Aggregate item storage with hidden-needle tracking.
 * Hidden needles travel with raw hay: when hay leaves as a packet, a hidden needle may ride along.
 */
export class Inventory {
  hay = 0;
  bale = 0;
  wrapped = 0;
  /** Needle ids hidden inside the stored raw hay (unscanned). */
  needles: number[] = [];

  count(type: ItemType): number { return this[type]; }

  /** Hay-equivalent weight (player carry / silo capacity). */
  weight(): number {
    const w = BALANCE.itemWeight;
    return this.hay * w.hay + this.bale * w.bale + this.wrapped * w.wrapped;
  }

  isEmpty(): boolean { return this.hay <= 1e-6 && this.bale <= 0 && this.wrapped <= 0; }

  add(type: ItemType, n: number, needleIds?: number[]): void {
    this[type] += n;
    if (needleIds?.length) this.needles.push(...needleIds);
  }

  addPacket(p: ItemPacket): void {
    this.add(p.type, p.amount, p.needleId !== undefined ? [p.needleId] : undefined);
  }

  /** Removes up to n of a type; returns amount removed. Hidden needles leave with the last hay. */
  remove(type: ItemType, n: number): number {
    const r = Math.min(this[type], n);
    this[type] -= r;
    if (this[type] < 1e-6) this[type] = 0;
    return r;
  }

  /**
   * Takes a packet of `type`. For hay, up to `size` units (at least 1e-6). Returns null if empty.
   * A hidden needle is attached to the packet if any is stored (FIFO).
   */
  takePacket(type: ItemType, size: number): ItemPacket | null {
    if (this[type] <= 1e-6) return null;
    const amount = type === 'hay' ? Math.min(this.hay, size) : 1;
    if (type !== 'hay' && this[type] < 1) return null;
    this.remove(type, amount);
    const p: ItemPacket = { type, amount };
    if (type === 'hay' && this.needles.length) p.needleId = this.needles.shift();
    return p;
  }

  /** Moves everything into `other`. */
  moveAllTo(other: Inventory): void {
    other.hay += this.hay; other.bale += this.bale; other.wrapped += this.wrapped;
    other.needles.push(...this.needles);
    this.clear();
  }

  clear(): void { this.hay = 0; this.bale = 0; this.wrapped = 0; this.needles = []; }

  counts(): ItemCounts { return { hay: this.hay, bale: this.bale, wrapped: this.wrapped }; }

  toJSON() { return { hay: this.hay, bale: this.bale, wrapped: this.wrapped, needles: [...this.needles] }; }

  static from(o: { hay?: number; bale?: number; wrapped?: number; needles?: number[] } | undefined): Inventory {
    const inv = new Inventory();
    if (o) { inv.hay = o.hay ?? 0; inv.bale = o.bale ?? 0; inv.wrapped = o.wrapped ?? 0; inv.needles = [...(o.needles ?? [])]; }
    return inv;
  }
}
