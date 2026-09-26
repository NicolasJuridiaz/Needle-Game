import { Building, type BuildingInfo, type InfoLine } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import type { Cell, Dir, ItemPacket, MachineStatus } from '../types';
import { acquireItem, carriesHiddenNeedle, decodeItem, encodeItem, hayEq, logiClock, releaseItem, type SavedItem } from './items';
import { Lane, REFUSED, type LaneOwner } from './lane';

/** What logistics buildings need from the Logistics module during a tick. */
export interface LogiHost {
  readonly ctx: SimContext;
  /** Current logistics tick number (item stamps). */
  readonly tickNo: number;
  /** belt.speed (tiles/s) and belt.spacing (tiles) for this tick. */
  readonly v: number;
  readonly d: number;
  /** Hand the head of `lane` to whatever is linked at out-port `port` of `from`. */
  handOff(from: Building, port: number, lane: Lane, carry: number): number;
}

/** Seconds the head must wait before a belt reports 'outputBlocked' (avoids flicker on spacing waits). */
const BLOCKED_GRACE = 0.5;
/** Seconds a belt must stay empty before it reports 'idle'. */
const IDLE_GRACE = 0.5;

// -------------------------------------------------------------------------------------------------
// Small formatting helpers (player-facing text)
// -------------------------------------------------------------------------------------------------

export function fmtNum(n: number): string {
  if (Math.abs(n) < 9.95) return (Math.round(n * 10) / 10).toFixed(1);
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Base class of every logistics building (belts, ramps, lifts, splitters, mergers). Items live in {@link Lane}s.
 * The Logistics module drives `step()` once per tick (downstream first); `tick()` from the Sim is a no-op.
 */
export abstract class LogisticsBuilding extends Building implements LaneOwner {
  /** All lanes in a fixed order (save format uses the index). */
  lanes: Lane[] = [];
  /** Logistics tick in which this building was last stepped. */
  stepStamp = 0;
  protected blockedFor = 0;
  protected emptyFor = 0;
  /** Host set on every step (null before the first tick). */
  protected host: LogiHost | null = null;

  /** In-lane for input port definition index `port` (null = not an input). */
  abstract inLane(port: number): Lane | null;
  /** Rebuild lane geometry (world paths) — called by Logistics.relink() after links are known. */
  abstract buildGeometry(): void;
  /** Advance the lanes (called once per tick by Logistics, possibly recursively from upstream). */
  abstract step(dt: number, host: LogiHost): void;
  /** A head item reached the end of one of my lanes. */
  abstract exitLane(lane: Lane, carry: number): number;

  /** Relink hooks: forget link-derived state. */
  resetLinks(): void { /* override */ }
  /** Relink hook: an out-port of another building faces my cell `cell` from direction `outwardDir` (from me to it). */
  noteFeeder(_cell: Cell, _outwardDir: Dir): void { /* override */ }
  /** Relink hook: a feeder was linked into my input `port`, located in direction `outwardDir` from me. */
  onFeederLinked(_port: number, _outwardDir: Dir): void { /* override */ }

  itemCount(): number {
    let n = 0;
    for (let i = 0; i < this.lanes.length; i++) n += this.lanes[i].items.length;
    return n;
  }

  // ----- Port API used by machines (and pushOut) ---------------------------------------------------

  override canAccept(_item: ItemPacket, port: number, ctx: SimContext): boolean {
    const lane = this.inLane(port);
    return !!lane && lane.hasRoom(ctx.stat('belt.spacing'));
  }

  override accept(item: ItemPacket, port: number, ctx: SimContext): void {
    const lane = this.inLane(port);
    if (!lane) return;
    const it = acquireItem(item);
    if (lane.insert(it, 0, ctx.stat('belt.spacing'), logiClock.tick) === REFUSED) {
      // Caller skipped canAccept: force it in at the entry so the packet is never lost.
      it.s = Math.min(0, lane.items.length ? lane.items[lane.items.length - 1].s - lane.spacing(ctx.stat('belt.spacing')) : 0);
      it.stamp = logiClock.tick;
      lane.items.push(it);
      lane.posAt(it.s, it);
    }
    it.px = it.x; it.py = it.y; it.pz = it.z; it.pyaw = it.yaw;
    this.rateIn.add(hayEq(item));
  }

  // ----- Status ------------------------------------------------------------------------------------

  /** Shared status logic: idle when empty, outputBlocked when the head keeps waiting, else running. */
  protected updateStatus(dt: number, ctx: SimContext, anyBlocked: boolean): void {
    if (!this.enabled) { this.setStatus('disabled', ctx); return; }
    const n = this.itemCount();
    if (n === 0) {
      this.blockedFor = 0;
      this.emptyFor += dt;
      if (this.emptyFor >= IDLE_GRACE || this.status === 'disabled') this.setStatus('idle', ctx);
      return;
    }
    this.emptyFor = 0;
    this.blockedFor = anyBlocked ? this.blockedFor + dt : 0;
    this.setStatus(this.blockedFor >= BLOCKED_GRACE ? 'outputBlocked' : 'running', ctx);
  }

  /** Output port indices (for status texts). */
  protected outPortIndices(): number[] {
    const out: number[] = [];
    for (const p of this.ports) if (p.kind === 'out') out.push(p.index);
    return out;
  }

  protected statusText(ctx: SimContext): string {
    switch (this.status as MachineStatus) {
      case 'disabled': return 'Switched off';
      case 'idle': return 'Empty - waiting for items';
      case 'outputBlocked': {
        const unlinked = this.outPortIndices().some((p) => !ctx.logistics.isLinked(this, p));
        return unlinked ? 'Output not connected - extend the belt into a machine' : 'Output blocked - the next belt or machine is full';
      }
      default: return 'Moving items';
    }
  }

  /** Nominal capacity of one lane in hay/s (10-hay packets at belt speed / spacing). */
  protected laneCapacity(ctx: SimContext): number {
    const v = ctx.stat('belt.speed'), d = ctx.stat('belt.spacing');
    return (v / d) * 10;
  }

  protected baseLines(ctx: SimContext): InfoLine[] {
    const lines: InfoLine[] = [];
    lines.push({ label: 'Throughput', value: `${fmtNum(this.rateOut.value)} / ${fmtNum(this.laneCapacity(ctx))} hay/s` });
    lines.push({ label: 'Items', value: String(this.itemCount()) });
    const hidden = this.hiddenNeedles();
    if (hidden > 0) lines.push({ label: 'Signal', value: 'Something metallic is riding along...', tone: 'warn' });
    return lines;
  }

  override info(ctx: SimContext): BuildingInfo {
    return { title: this.def.name, status: this.status, statusText: this.statusText(ctx), lines: this.baseLines(ctx) };
  }

  private hiddenNeedles(): number {
    let n = 0;
    for (const l of this.lanes) for (const it of l.items) if (carriesHiddenNeedle(it)) n++;
    return n;
  }

  // ----- Contents / save ---------------------------------------------------------------------------

  override contents(): Inventory {
    const inv = new Inventory();
    for (const l of this.lanes) {
      for (const it of l.items) {
        inv.add(it.type, it.amount);
        if (carriesHiddenNeedle(it)) inv.needles.push(it.needleId!);
      }
    }
    return inv;
  }

  override clearContents(): void {
    for (const l of this.lanes) {
      for (const it of l.items) releaseItem(it);
      l.items.length = 0;
    }
  }

  protected saveItems(): SavedItem[] {
    const out: SavedItem[] = [];
    for (const l of this.lanes) for (const it of l.items) out.push(encodeItem(l.index, l.len, it));
    return out;
  }

  protected loadItems(raw: unknown): void {
    this.clearContents();
    if (!Array.isArray(raw)) return;
    for (const r of raw) {
      const dec = decodeItem(r);
      if (!dec) continue;
      const lane = this.lanes[dec.lane];
      if (!lane) { releaseItem(dec.item); continue; }
      dec.item.s = Math.max(-0.5, Math.min(1, dec.item.s)) * lane.len;
      lane.items.push(dec.item);
    }
    for (const l of this.lanes) {
      l.items.sort((a, b) => b.s - a.s);
      l.snapPoses();
    }
  }

  override saveState(): unknown { return { items: this.saveItems() }; }
  override loadState(s: unknown): void {
    const o = (s ?? {}) as { items?: unknown };
    this.loadItems(o.items);
  }
}
