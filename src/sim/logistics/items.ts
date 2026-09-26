import { BALANCE } from '../../config/balance';
import { ITEM_TYPES, type ItemPacket, type ItemType } from '../types';

/**
 * A packet travelling through logistics buildings. Records are pooled and handed from building to building
 * (belt -> belt keeps the same record, so `uid` is stable for render interpolation). When a packet leaves
 * logistics into a machine, the machine receives a plain {@link ItemPacket} copy and the record is recycled.
 */
export class BeltItem implements ItemPacket {
  type: ItemType = 'hay';
  amount = 0;
  needleId: number | undefined = undefined;
  scanned = false;
  /** Stable id while the packet stays inside logistics. */
  uid = 0;
  /** Travel distance along the lane that currently holds it (tiles). May be slightly < 0 while entering. */
  s = 0;
  /** Overshoot past the end of the previous lane, consumed by the receiving lane on hand-off. */
  carry = 0;
  /** Junctions: index of the in-lane the packet came through (positions it before the hub). */
  via = 0;
  /** Logistics tick in which the packet last moved (a packet never moves twice in one tick). */
  stamp = 0;
  /** World position/yaw after the last tick. */
  x = 0; y = 0; z = 0; yaw = 0;
  /** World position/yaw before the last tick (interpolation start). */
  px = 0; py = 0; pz = 0; pyaw = 0;
}

/** Global logistics clock: incremented once per Logistics.tick (any Sim). */
export const logiClock = { tick: 0 };

const POOL_MAX = 8192;
const pool: BeltItem[] = [];
let nextUid = 0;

/** Take a record from the pool initialised from `src` with a fresh uid. */
export function acquireItem(src: ItemPacket): BeltItem {
  const it = pool.pop() ?? new BeltItem();
  it.type = src.type;
  it.amount = src.amount;
  it.needleId = src.needleId;
  it.scanned = src.scanned === true;
  it.uid = ++nextUid;
  it.s = 0;
  it.carry = 0;
  it.via = 0;
  it.stamp = 0;
  return it;
}

/** Return a record to the pool. The caller must not keep any reference to it. */
export function releaseItem(it: BeltItem): void {
  it.needleId = undefined;
  it.uid = 0;
  if (pool.length < POOL_MAX) pool.push(it);
}

/** Plain packet copy for delivery to a machine (machines may keep the object). */
export function toPacket(it: BeltItem): ItemPacket {
  const p: ItemPacket = { type: it.type, amount: it.amount };
  if (it.needleId !== undefined) p.needleId = it.needleId;
  if (it.scanned) p.scanned = true;
  return p;
}

/** Hay-equivalent of a packet (throughput meters). */
export function hayEq(p: ItemPacket): number {
  return p.amount * BALANCE.hayEquivalent[p.type];
}

/** Hidden needle that a scanner has not seen yet. */
export function carriesHiddenNeedle(p: ItemPacket): boolean {
  return p.needleId !== undefined && !p.scanned;
}

// ---------------------------------------------------------------------------------------------
// Save format: one compact tuple per item.
// [laneIndex, fraction along the lane, item type index, amount, needleId (-1 = none), scanned 0/1, via]
// ---------------------------------------------------------------------------------------------

export type SavedItem = [number, number, number, number, number, number, number];

export function encodeItem(lane: number, laneLen: number, it: BeltItem): SavedItem {
  const frac = laneLen > 0 ? it.s / laneLen : 0;
  return [
    lane,
    Math.round(frac * 1e6) / 1e6,
    ITEM_TYPES.indexOf(it.type),
    it.amount,
    it.needleId ?? -1,
    it.scanned ? 1 : 0,
    it.via,
  ];
}

/** Decode a saved tuple into a fresh record. Returns null for malformed data. `s` holds the saved fraction. */
export function decodeItem(raw: unknown): { lane: number; item: BeltItem } | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const [lane, frac, typeIdx, amount, needle, scanned, via] = raw as number[];
  const type = ITEM_TYPES[typeIdx];
  if (!type || !Number.isFinite(lane) || !Number.isFinite(frac) || !Number.isFinite(amount) || amount <= 0) return null;
  const packet: ItemPacket = { type, amount };
  if (Number.isInteger(needle) && needle >= 0) packet.needleId = needle;
  if (scanned === 1) packet.scanned = true;
  const item = acquireItem(packet);
  item.s = frac;
  item.via = Number.isInteger(via) && via >= 0 ? via : 0;
  return { lane: lane | 0, item };
}
