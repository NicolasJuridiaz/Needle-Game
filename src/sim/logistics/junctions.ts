import type { BuildingInfo, BuildingInit, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import type { ItemType, SplitterMode } from '../types';
import { LogisticsBuilding, type LogiHost } from './base';
import type { BeltItem } from './items';
import { Lane, REFUSED } from './lane';

interface LaneSpec { port: number; len: number; path: readonly number[] }

const IN_BACK = [0, 0.5, 0, 0.5, 0.5, 0];
const IN_LEFT = [0.5, 0, 0, 0.5, 0.5, 0];
const IN_RIGHT = [0.5, 1, 0, 0.5, 0.5, 0];
const OUT_FRONT = [0.5, 0.5, 0, 1, 0.5, 0];
const OUT_LEFT = [0.5, 0.5, 0, 0.5, 0, 0];
const OUT_RIGHT = [0.5, 0.5, 0, 0.5, 1, 0];
const OUT_LANE_B = [0.5, 0.5, 0, 0.6, 1.2, 0, 0.8, 1.5, 0, 1, 1.5, 0];
const IN_LANE_B = [0, 1.5, 0, 0.2, 1.5, 0, 0.4, 1.2, 0, 0.5, 0.5, 0];

/**
 * Hub-style logistics building: items travel along in-lanes to the centre, where `route()` picks an out-lane.
 * Out-lanes deliver to their port's link. Processing order per tick: out-lanes first (they free space), then
 * in-lanes starting at `turn` (fair arbitration for mergers).
 */
abstract class Junction extends LogisticsBuilding {
  readonly ins: Lane[];
  readonly outs: Lane[];
  private readonly specs: LaneSpec[];
  /** Index of the in-lane served first next time (merger fairness). */
  turn = 0;
  /** Items dispatched per out-lane since placement (info). */
  counts: number[];

  constructor(init: BuildingInit, ins: LaneSpec[], outs: LaneSpec[]) {
    super(init);
    let idx = 0;
    this.ins = ins.map((s) => new Lane(idx++, s.port, 'in', s.len));
    this.outs = outs.map((s) => new Lane(idx++, s.port, 'out', s.len));
    this.lanes = [...this.ins, ...this.outs];
    this.specs = [...ins, ...outs];
    this.counts = outs.map(() => 0);
  }

  inLane(port: number): Lane | null {
    for (let i = 0; i < this.ins.length; i++) if (this.ins[i].port === port) return this.ins[i];
    return null;
  }

  buildGeometry(): void {
    for (let i = 0; i < this.lanes.length; i++) {
      this.lanes[i].setPath(this, this.specs[i].path);
      this.lanes[i].snapPoses();
    }
  }

  /** Out-lane index for the item waiting at the centre coming from `from`, or -1 to wait. */
  protected abstract route(from: Lane, it: BeltItem, d: number): number;

  protected linked(j: number): boolean { return !!this.links[this.outs[j].port]; }
  protected room(j: number, d: number): boolean { return this.outs[j].hasRoom(d); }
  protected ok(j: number, d: number): boolean { return this.linked(j) && this.room(j, d); }

  step(dt: number, host: LogiHost): void {
    this.host = host;
    let blocked = false;
    if (!this.enabled) {
      for (const l of this.lanes) l.freeze();
    } else {
      const { v, d, tickNo } = host;
      for (let j = 0; j < this.outs.length; j++) {
        this.outs[j].advance(dt, v, d, tickNo, this);
        if (this.outs[j].blocked) blocked = true;
      }
      const n = this.ins.length;
      const start = this.turn % n;
      for (let k = 0; k < n; k++) {
        const lane = this.ins[(start + k) % n];
        lane.advance(dt, v, d, tickNo, this);
        if (lane.blocked) blocked = true;
      }
    }
    this.updateStatus(dt, host.ctx, blocked);
    this.anim.flash = Math.max(0, (this.anim.flash ?? 0) - dt * 4);
  }

  exitLane(lane: Lane, carry: number): number {
    const host = this.host!;
    if (lane.kind === 'out') return host.handOff(this, lane.port, lane, carry);
    const it = lane.items[0];
    const j = this.route(lane, it, host.d);
    if (j < 0) return REFUSED;
    const s = this.outs[j].insert(it, carry, host.d, host.tickNo);
    if (s === REFUSED) return REFUSED;
    lane.items.shift();
    this.counts[j]++;
    this.turn = (this.ins.indexOf(lane) + 1) % this.ins.length;
    this.anim.flash = 1;
    return s;
  }

  protected saveExtra(): Record<string, unknown> { return {}; }
  protected loadExtra(_o: Record<string, unknown>): void { /* override */ }

  override saveState(): unknown {
    return { items: this.saveItems(), turn: this.turn, counts: [...this.counts], ...this.saveExtra() };
  }

  override loadState(s: unknown): void {
    const o = (s ?? {}) as Record<string, unknown>;
    this.loadItems(o.items);
    if (typeof o.turn === 'number' && Number.isFinite(o.turn)) this.turn = Math.max(0, o.turn | 0);
    if (Array.isArray(o.counts)) for (let i = 0; i < this.counts.length; i++) this.counts[i] = Number(o.counts[i]) || 0;
    this.loadExtra(o);
  }

  protected outLabel(j: number): string {
    const p = this.ports.find((q) => q.index === this.outs[j].port);
    return p?.label ?? `Output ${j + 1}`;
  }

  protected countLines(ctx: SimContext): BuildingInfo['lines'] {
    const lines = this.baseLines(ctx);
    const parts: string[] = [];
    for (let j = 0; j < this.outs.length; j++) {
      if (!this.linked(j)) continue;
      parts.push(`${this.outLabel(j)} ${this.counts[j].toLocaleString('en-US')}`);
    }
    lines.push({ label: 'Delivered', value: parts.length ? parts.join(' · ') : 'No output connected', tone: parts.length ? undefined : 'warn' });
    return lines;
  }

  override info(ctx: SimContext): BuildingInfo {
    return { title: this.def.name, status: this.status, statusText: this.statusText(ctx), lines: this.countLines(ctx) };
  }
}

// =====================================================================================================
// Splitter
// =====================================================================================================

export const SPLITTER_MODES: readonly SplitterMode[] = ['even', 'alternating', 'priority', 'overflow', 'smart'];
const MODE_NODE: Record<SplitterMode, string | null> = {
  even: null, alternating: 'l_alternating', priority: 'l_priority', overflow: 'l_overflow', smart: 'l_smart',
};
const MODE_NAME: Record<SplitterMode, string> = {
  even: 'Even', alternating: 'Alternating', priority: 'Priority (2:1)', overflow: 'Overflow', smart: 'Smart filter',
};
export const FILTER_TYPES: readonly ItemType[] = ['hay', 'bale', 'wrapped'];
const FILTER_NAME = ['Raw hay', 'Bales', 'Wrapped bales'];

/**
 * Splitter: 1 input (back), outputs primary (front, lane 0), left (lane 1), right (lane 2).
 * Modes: see ARCHITECTURE §4.2. Interact (E) cycles unlocked modes (smart also cycles its filter).
 */
export class Splitter extends Junction {
  mode: SplitterMode = 'even';
  /** Smart filter: 0 hay, 1 bale, 2 wrapped. */
  filter = 0;
  /** Last out-lane served (round robin). */
  rr = 2;
  /** Last side served (1 or 2). */
  sideRr = 2;
  /** Priority pattern counter. */
  pk = 0;

  constructor(init: BuildingInit) {
    super(init, [{ port: 0, len: 0.5, path: IN_BACK }], [
      { port: 1, len: 0.5, path: OUT_FRONT },
      { port: 2, len: 0.5, path: OUT_LEFT },
      { port: 3, len: 0.5, path: OUT_RIGHT },
    ]);
    this.anim.mode = 0;
    this.anim.filter = 0;
  }

  setMode(mode: SplitterMode, filter?: number): void {
    if (SPLITTER_MODES.includes(mode)) this.mode = mode;
    if (filter !== undefined && Number.isFinite(filter)) this.filter = Math.max(0, Math.min(2, filter | 0));
    this.syncAnim();
  }

  private syncAnim(): void {
    this.anim.mode = SPLITTER_MODES.indexOf(this.mode);
    this.anim.filter = this.filter;
  }

  availableModes(ctx: SimContext): SplitterMode[] {
    return SPLITTER_MODES.filter((m) => { const n = MODE_NODE[m]; return !n || ctx.progress.isUnlocked(n); });
  }

  /** Next side lane (1/2) after `sideRr` that is linked and has room; -1 if none. */
  private nextSide(d: number): number {
    for (let k = 1; k <= 2; k++) {
      const j = ((this.sideRr - 1 + k) % 2) + 1;
      if (this.ok(j, d)) { this.sideRr = j; return j; }
    }
    return -1;
  }

  private anySideLinked(): boolean { return this.linked(1) || this.linked(2); }

  protected route(_from: Lane, it: BeltItem, d: number): number {
    switch (this.mode) {
      case 'alternating': {
        for (let k = 1; k <= 3; k++) {
          const j = (this.rr + k) % 3;
          if (!this.linked(j)) continue;
          if (!this.room(j, d)) return -1; // strict: wait for this output
          this.rr = j;
          return j;
        }
        return -1;
      }
      case 'priority': {
        const wantPrimary = (this.pk % 3 < 2 && this.linked(0)) || !this.anySideLinked();
        let j = -1;
        if (wantPrimary) {
          if (this.ok(0, d)) j = 0; else j = this.nextSide(d);
        } else {
          j = this.nextSide(d);
          if (j < 0 && this.ok(0, d)) j = 0;
        }
        if (j >= 0) this.pk = (this.pk + 1) % 3;
        return j;
      }
      case 'overflow': {
        if (this.ok(0, d)) return 0;
        return this.nextSide(d);
      }
      case 'smart': {
        if (it.type === FILTER_TYPES[this.filter]) return this.ok(0, d) ? 0 : -1;
        return this.nextSide(d);
      }
      default: { // even
        for (let k = 1; k <= 3; k++) {
          const j = (this.rr + k) % 3;
          if (this.ok(j, d)) { this.rr = j; return j; }
        }
        return -1;
      }
    }
  }

  override interaction(ctx: SimContext): InteractionOption | null {
    const modes = this.availableModes(ctx);
    const cur = this.mode === 'smart' ? `${MODE_NAME.smart}: ${FILTER_NAME[this.filter]}` : MODE_NAME[this.mode];
    if (modes.length <= 1) return { kind: 'cycleMode', label: `Mode: ${cur}`, enabled: false, reason: 'Unlock more splitter modes in the Work Tree' };
    return { kind: 'cycleMode', label: `Mode: ${cur} - change`, enabled: true };
  }

  override interact(ctx: SimContext): boolean {
    const modes = this.availableModes(ctx);
    if (modes.length <= 1 && this.mode === 'even') return false;
    if (this.mode === 'smart' && this.filter < FILTER_TYPES.length - 1) {
      this.filter++;
    } else {
      const i = modes.indexOf(this.mode);
      this.mode = modes[(i + 1) % modes.length];
      if (this.mode === 'smart') this.filter = 0;
    }
    this.syncAnim();
    return true;
  }

  override info(ctx: SimContext): BuildingInfo {
    const inf = super.info(ctx);
    inf.lines.unshift({ label: 'Mode', value: MODE_NAME[this.mode] });
    if (this.mode === 'smart') inf.lines.splice(1, 0, { label: 'Filter', value: `${FILTER_NAME[this.filter]} -> Primary, rest -> sides` });
    return inf;
  }

  protected override saveExtra(): Record<string, unknown> {
    return { mode: this.mode, filter: this.filter, rr: this.rr, sideRr: this.sideRr, pk: this.pk };
  }

  protected override loadExtra(o: Record<string, unknown>): void {
    if (typeof o.mode === 'string' && SPLITTER_MODES.includes(o.mode as SplitterMode)) this.mode = o.mode as SplitterMode;
    if (typeof o.filter === 'number') this.filter = Math.max(0, Math.min(2, o.filter | 0));
    if (typeof o.rr === 'number') this.rr = ((o.rr | 0) % 3 + 3) % 3;
    if (typeof o.sideRr === 'number') this.sideRr = o.sideRr === 1 ? 1 : 2;
    if (typeof o.pk === 'number') this.pk = ((o.pk | 0) % 3 + 3) % 3;
    this.syncAnim();
  }
}

// =====================================================================================================
// Merger family (fair round robin at the centre)
// =====================================================================================================

abstract class FairMerger extends Junction {
  protected route(_from: Lane, _it: BeltItem, d: number): number {
    return this.ok(0, d) ? 0 : -1;
  }

  override info(ctx: SimContext): BuildingInfo {
    const inf = super.info(ctx);
    const out = this.links[this.outs[0].port];
    inf.lines.push({ label: 'Output', value: out ? 'Connected' : 'Not connected', tone: out ? 'good' : 'warn' });
    return inf;
  }
}

/** Merger: inputs back/left/right -> front, served fairly (round robin). */
export class Merger extends FairMerger {
  constructor(init: BuildingInit) {
    super(init, [
      { port: 0, len: 0.5, path: IN_BACK },
      { port: 1, len: 0.5, path: IN_LEFT },
      { port: 2, len: 0.5, path: IN_RIGHT },
    ], [{ port: 3, len: 0.5, path: OUT_FRONT }]);
  }
}

/** U-Merger: two parallel lanes (A = row 0, B = row 1) -> lane A output. */
export class UMerger extends FairMerger {
  constructor(init: BuildingInit) {
    super(init, [
      { port: 0, len: 0.5, path: IN_BACK },
      { port: 1, len: 1, path: IN_LANE_B },
    ], [{ port: 2, len: 0.5, path: OUT_FRONT }]);
  }
}

/** U-Splitter: one lane -> two parallel lanes, even alternation (never waits if one can take it). */
export class USplitter extends Junction {
  rr = 1;

  constructor(init: BuildingInit) {
    super(init, [{ port: 0, len: 0.5, path: IN_BACK }], [
      { port: 1, len: 0.5, path: OUT_FRONT },
      { port: 2, len: 1, path: OUT_LANE_B },
    ]);
  }

  protected route(_from: Lane, _it: BeltItem, d: number): number {
    for (let k = 1; k <= 2; k++) {
      const j = (this.rr + k) % 2;
      if (this.ok(j, d)) { this.rr = j; return j; }
    }
    return -1;
  }

  protected override saveExtra(): Record<string, unknown> { return { rr: this.rr }; }
  protected override loadExtra(o: Record<string, unknown>): void { if (typeof o.rr === 'number') this.rr = (o.rr | 0) === 0 ? 0 : 1; }
}

