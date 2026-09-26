import { BALANCE } from '../../config/balance';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import { ITEM_TYPES, type ItemPacket, type ItemType } from '../types';
import { giveToPlayer, playerAmount, playerEmpty, playerRoom, takeFromPlayer } from './playerTransfer';
import {
  approach, BLOCKED_GRACE, countsLabel, EPS, foundByPlayer, fmtInt, fmtRate, hayEq, itemLabel, loadInventory,
  Machine, num, obj, packetAmount, RateGate, takeHay,
} from './shared';

/** Seconds without input after which a store also sends partial hay packets (so nothing is left behind). */
const FLUSH_DELAY = 0.5;
/** Time constant (s) of the output activity animation. */
const OUT_TAU = 0.2;

const TYPE_CODE: Record<ItemType, number> = { hay: 0, bale: 1, wrapped: 2 };

/**
 * Mixed-item storage that keeps the arrival order of item types (run-length queue), so outputs are
 * FIFO by type ("roughly": hay packets may merge across runs). Hidden needles ride in the Inventory.
 */
export class FifoStore {
  readonly inv = new Inventory();
  private types: ItemType[] = [];
  private counts: number[] = [];
  private head = 0;

  weight(): number { return this.inv.weight(); }
  isEmpty(): boolean { return this.inv.isEmpty(); }

  private pushRun(type: ItemType, n: number): void {
    if (n <= 0) return;
    const last = this.types.length - 1;
    if (last >= this.head && this.types[last] === type) { this.counts[last] += n; return; }
    this.types.push(type);
    this.counts.push(n);
  }

  add(type: ItemType, n: number, needleIds?: readonly number[]): void {
    if (this.inv.isEmpty() && this.inv.needles.length === 0) { this.types.length = 0; this.counts.length = 0; this.head = 0; }
    this.inv[type] += n;
    if (needleIds) for (let i = 0; i < needleIds.length; i++) this.inv.needles.push(needleIds[i]);
    this.pushRun(type, n);
  }

  addPacket(p: ItemPacket): void {
    if (this.inv.isEmpty() && this.inv.needles.length === 0) { this.types.length = 0; this.counts.length = 0; this.head = 0; }
    this.inv.addPacket(p);
    this.pushRun(p.type, p.amount);
  }

  /** Type at the front of the queue (null when empty). */
  headType(): ItemType | null {
    while (this.head < this.types.length) {
      const t = this.types[this.head];
      if (this.counts[this.head] > EPS && this.inv[t] > EPS) return t;
      this.head++;
    }
    this.types.length = 0; this.counts.length = 0; this.head = 0;
    for (const t of ITEM_TYPES) if (this.inv[t] > EPS) { this.pushRun(t, this.inv[t]); return t; }
    return null;
  }

  /** More than one type run is queued (a partial hay packet may leave to let the next type through). */
  hasBacklog(): boolean {
    let runs = 0;
    for (let i = this.head; i < this.types.length; i++) if (this.counts[i] > EPS) runs++;
    return runs > 1;
  }

  /** Removes `n` of `type` from the earliest runs of that type. */
  private dropRuns(type: ItemType, n: number): void {
    let left = n;
    for (let i = this.head; i < this.types.length && left > EPS; i++) {
      if (this.types[i] !== type) continue;
      const d = Math.min(this.counts[i], left);
      this.counts[i] -= d;
      left -= d;
    }
    while (this.head < this.types.length && this.counts[this.head] <= EPS) this.head++;
    if (this.head >= this.types.length) { this.types.length = 0; this.counts.length = 0; this.head = 0; }
  }

  takePacket(type: ItemType, amount: number): ItemPacket | null {
    const p = this.inv.takePacket(type, amount);
    if (p) this.dropRuns(type, p.amount);
    return p;
  }

  /** Removes up to `n` of `type` (player take). Needles leaving with the last hay go to `needlesOut`. */
  remove(type: ItemType, n: number, needlesOut: number[]): number {
    const r = type === 'hay' ? takeHay(this.inv, n, needlesOut) : this.inv.remove(type, Math.floor(n + EPS));
    if (r > 0) this.dropRuns(type, r);
    return r;
  }

  clear(): void { this.inv.clear(); this.types.length = 0; this.counts.length = 0; this.head = 0; }

  toJSON(): { inv: ReturnType<Inventory['toJSON']>; runs: [number, number][] } {
    const runs: [number, number][] = [];
    for (let i = this.head; i < this.types.length; i++) if (this.counts[i] > EPS) runs.push([TYPE_CODE[this.types[i]], this.counts[i]]);
    return { inv: this.inv.toJSON(), runs };
  }

  load(raw: unknown): void {
    this.clear();
    const o = obj(raw);
    const inv = loadInventory(o.inv);
    inv.moveAllTo(this.inv);
    // Rebuild runs from the saved order, then reconcile with the stored counts.
    const want: Record<ItemType, number> = { hay: this.inv.hay, bale: this.inv.bale, wrapped: this.inv.wrapped };
    if (Array.isArray(o.runs)) {
      for (const r of o.runs) {
        if (!Array.isArray(r)) continue;
        const t = ITEM_TYPES[typeof r[0] === 'number' ? r[0] : -1];
        const n = num(r[1], 0, 0);
        if (!t || n <= 0) continue;
        const take = Math.min(n, want[t]);
        if (take > 0) { this.pushRun(t, take); want[t] -= take; }
      }
    }
    for (const t of ITEM_TYPES) if (want[t] > EPS) this.pushRun(t, want[t]);
  }
}

/**
 * Shared behaviour of the Hopper and the Silo: capacity in hay-equivalent weight, FIFO outputs on
 * every present out port (alternating which port is served first), manual deposit / take.
 */
abstract class StoreMachine extends Machine {
  protected readonly store = new FifoStore();
  protected readonly gates: RateGate[] = [];
  /** Seconds since the last item arrived. */
  protected inputAge = 1e9;
  /** Seconds since a packet last left. */
  protected outputAge = 1e9;
  private outTurn = 0;
  private readonly found: number[] = [];

  protected abstract capacity(ctx: SimContext): number;
  protected abstract outputRate(ctx: SimContext): number;
  /** Player may take items back right now (player's hands/barrow are empty). */
  protected abstract canPlayerTake(ctx: SimContext): boolean;

  protected fits(item: ItemPacket, ctx: SimContext): boolean {
    return this.store.weight() + item.amount * BALANCE.itemWeight[item.type] <= this.capacity(ctx) + EPS;
  }

  override accept(item: ItemPacket, _port: number, _ctx: SimContext): void {
    this.store.addPacket(item);
    this.rateIn.add(hayEq(item.type, item.amount));
    this.inputAge = 0;
  }

  /** Output step: every present out port with a link gets its own rate budget. Returns hay-eq pushed. */
  protected pushOutputs(ctx: SimContext, dt: number): number {
    const n = this.outIdx.length;
    while (this.gates.length < n) this.gates.push(new RateGate());
    const rate = this.outputRate(ctx);
    let pushed = 0;
    for (let k = 0; k < n; k++) {
      const slot = (this.outTurn + k) % n;
      const port = this.outIdx[slot];
      const gate = this.gates[slot];
      gate.blocked = false;
      if (!ctx.logistics.isLinked(this, port)) { gate.reset(); continue; }
      gate.refill(rate, dt);
      pushed += this.pushFromStore(ctx, port, gate);
      gate.settle(dt);
    }
    if (n > 1) this.outTurn = (this.outTurn + 1) % n;
    this.outputAge = pushed > 0 ? 0 : this.outputAge + dt;
    return pushed;
  }

  private pushFromStore(ctx: SimContext, port: number, gate: RateGate): number {
    const inv = this.store.inv;
    let pushed = 0;
    for (;;) {
      const type = this.store.headType();
      if (!type) break;
      const amt = packetAmount(inv, type);
      if (amt <= EPS) break;
      const flush = this.inputAge > FLUSH_DELAY || this.store.hasBacklog() || inv.needles.length > 1;
      if (type === 'hay' && amt < BALANCE.hayPacketSize - EPS && !flush) break;
      const cost = hayEq(type, amt);
      if (!gate.allows(cost)) break;
      this.probe.type = type; this.probe.amount = amt;
      if (!ctx.logistics.canPushOut(this, port, this.probe)) { gate.blocked = true; break; }
      const p = this.store.takePacket(type, amt);
      if (!p) break;
      if (!ctx.logistics.pushOut(this, port, p)) { this.store.addPacket(p); gate.blocked = true; break; }
      gate.credit -= cost;
      pushed += cost;
      this.rateOut.add(cost);
    }
    return pushed;
  }

  /** All linked outputs have been refusing packets for a while. */
  protected outputsStalled(ctx: SimContext): boolean {
    let linked = 0;
    for (let k = 0; k < this.outIdx.length; k++) {
      if (!ctx.logistics.isLinked(this, this.outIdx[k])) continue;
      linked++;
      const g = this.gates[k];
      if (!g || g.blockedFor < BLOCKED_GRACE) return false;
    }
    return linked > 0;
  }

  // ----- manual interaction ---------------------------------------------------------------

  /** What a deposit would move right now, per type (respecting capacity). */
  private depositPlan(ctx: SimContext, out: Record<ItemType, number>): number {
    let free = Math.max(0, this.capacity(ctx) - this.store.weight());
    let total = 0;
    const accepted = this.def.manualInput ?? ITEM_TYPES;
    for (const t of ITEM_TYPES) {
      out[t] = 0;
      if (!accepted.includes(t)) continue;
      const w = BALANCE.itemWeight[t];
      let n = Math.min(playerAmount(ctx, t), free / w);
      if (t !== 'hay') n = Math.floor(n + EPS);
      if (n <= EPS) continue;
      out[t] = n;
      free -= n * w;
      total += n;
    }
    return total;
  }

  private readonly plan: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };

  override interaction(ctx: SimContext): InteractionOption {
    if (playerEmpty(ctx)) {
      if (this.canPlayerTake(ctx)) {
        const type = this.store.headType();
        if (!type) return { kind: 'take', label: 'Take', enabled: false, reason: `${this.def.name} is empty` };
        const room = playerRoom(ctx, type);
        const n = Math.min(this.store.inv[type], room);
        const shown = type === 'hay' ? Math.max(1, Math.round(n)) : Math.floor(n + EPS);
        if (n <= EPS || (type !== 'hay' && shown < 1)) return { kind: 'take', label: `Take ${itemLabel(type, 1)}`, enabled: false, reason: 'No room to carry more' };
        return { kind: 'take', label: `Take ${itemLabel(type, shown)}`, enabled: true };
      }
      return { kind: 'deposit', label: 'Deposit', enabled: false, reason: 'Carrying nothing' };
    }
    const total = this.depositPlan(ctx, this.plan);
    if (total <= EPS) {
      const accepted = this.def.manualInput ?? ITEM_TYPES;
      const carriesAccepted = accepted.some((t) => playerAmount(ctx, t) > EPS);
      return { kind: 'deposit', label: 'Deposit', enabled: false, reason: carriesAccepted ? `${this.def.name} is full` : 'Cannot store what you carry' };
    }
    return { kind: 'deposit', label: `Deposit ${countsLabel(this.plan.hay, this.plan.bale, this.plan.wrapped)}`, enabled: true };
  }

  override interact(ctx: SimContext): boolean {
    this.prepare();
    if (playerEmpty(ctx)) {
      if (!this.canPlayerTake(ctx)) return false;
      const type = this.store.headType();
      if (!type) return false;
      const n = giveToPlayer(ctx, type, Math.min(this.store.inv[type], playerRoom(ctx, type)));
      if (n <= EPS) return false;
      this.found.length = 0;
      this.store.remove(type, n, this.found);
      // The player rummages through the hay: every hidden needle in it is noticed.
      if (type === 'hay') {
        for (let i = 0; i < this.store.inv.needles.length; i++) this.found.push(this.store.inv.needles[i]);
        this.store.inv.needles.length = 0;
      }
      if (this.found.length) foundByPlayer(ctx, this.found, this.centre);
      this.found.length = 0;
      ctx.events.emit('player:take', { sourceId: this.id, amount: n, pos: this.posCopy() });
      return true;
    }
    const total = this.depositPlan(ctx, this.plan);
    if (total <= EPS) return false;
    let moved = 0;
    for (const t of ITEM_TYPES) {
      const want = this.plan[t];
      if (want <= EPS) continue;
      this.found.length = 0;
      const n = takeFromPlayer(ctx, t, want, this.found);
      if (n <= EPS) continue;
      this.store.add(t, n, this.found.length ? this.found : undefined);
      moved += n;
    }
    this.found.length = 0;
    if (moved <= EPS) return false;
    this.inputAge = 0;
    ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: moved, pos: this.posCopy() });
    return true;
  }

  override contents(): Inventory { return this.store.inv; }
  override clearContents(): void { this.store.clear(); }

  protected storeLine(ctx: SimContext): InfoLine {
    const cap = this.capacity(ctx);
    const w = this.store.weight();
    return { label: 'Stored', value: `${fmtInt(w)} / ${fmtInt(cap)}`, tone: w >= cap - EPS ? 'warn' : undefined };
  }

  protected contentsLine(): InfoLine | null {
    const inv = this.store.inv;
    const s = countsLabel(inv.hay, inv.bale, inv.wrapped);
    return s ? { label: 'Contents', value: s } : null;
  }

  protected saveStore(): Record<string, unknown> {
    return { store: this.store.toJSON(), gates: this.gates.map((g) => g.credit), inputAge: Math.min(this.inputAge, 60), outTurn: this.outTurn };
  }

  protected loadStore(o: Record<string, unknown>): void {
    this.store.load(o.store);
    this.gates.length = 0;
    // Credits may be negative (paying back a bale).
    if (Array.isArray(o.gates)) for (const c of o.gates) { const g = new RateGate(); g.credit = num(c, 0); this.gates.push(g); }
    this.inputAge = num(o.inputAge, 1e9, 0);
    this.outTurn = Math.floor(num(o.outTurn, 0, 0));
  }
}

// =====================================================================================
// Hopper
// =====================================================================================

/**
 * Hay Hopper: dump hay in by hand (E, or quick dump from range) or by belt; it feeds its output
 * port(s) at `hopper.outputRate` hay-eq/s each. Without a linked output, E with empty hands takes
 * hay back. anim: fill (0..1), out (0..1 output activity).
 */
export class Hopper extends StoreMachine {
  constructor(init: BuildingInit) {
    super(init);
    this.anim.fill = 0;
    this.anim.out = 0;
  }

  protected capacity(ctx: SimContext): number { return ctx.stat('hopper.capacity'); }
  protected outputRate(ctx: SimContext): number { return ctx.stat('hopper.outputRate'); }
  protected canPlayerTake(ctx: SimContext): boolean { return !this.anyOutputLinked(ctx); }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    return item.amount > 0 && this.inPortAccepts(port, item.type) && this.fits(item, ctx);
  }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    this.inputAge += dt;
    const pushed = this.pushOutputs(ctx, dt);
    const cap = this.capacity(ctx);
    const w = this.store.weight();
    if (this.store.isEmpty()) this.setStatus('idle', ctx);
    else if (!this.anyOutputLinked(ctx) || this.outputsStalled(ctx)) this.setStatus('outputBlocked', ctx);
    else if (w >= cap - BALANCE.hayPacketSize) this.setStatus('full', ctx);
    else this.setStatus('running', ctx);
    this.anim.fill = cap > 0 ? Math.min(1, w / cap) : 0;
    this.anim.out = approach(this.anim.out, pushed > 0 || this.outputAge < 0.3 ? 1 : 0, dt, OUT_TAU);
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'idle': return 'Empty - deposit hay (E) or feed it by belt';
      case 'outputBlocked':
        return this.anyOutputLinked(ctx)
          ? 'Output blocked - the output belt is backed up'
          : 'Output blocked - connect a belt to the output, or take the hay back (E)';
      case 'full': return `Full - input is faster than the ${fmtRate(this.outputRate(ctx))} output`;
      default: return `Feeding ${fmtRate(this.rateOut.value)} to the belt`;
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    lines.push({ label: 'Output', value: `${fmtRate(this.rateOut.value)} (max ${fmtInt(this.outputRate(ctx))} per port)` });
    lines.push({ label: 'Input', value: fmtRate(this.rateIn.value) });
    lines.push(this.storeLine(ctx));
    const c = this.contentsLine();
    if (c && (this.store.inv.bale > 0 || this.store.inv.wrapped > 0)) lines.push(c);
    lines.push({ label: 'Outputs', value: `${this.outIdx.length} port${this.outIdx.length === 1 ? '' : 's'}` });
  }

  override saveState(): unknown { return this.saveStore(); }
  override loadState(s: unknown): void { this.loadStore(obj(s)); }
}

// =====================================================================================
// Silo
// =====================================================================================

/**
 * Silo: big mixed-item buffer. Accepts up to `silo.inputRate` hay-eq/s (per-tick budget) from its
 * inputs and unloads FIFO by type at `silo.outputRate` hay-eq/s per output (B with dual output).
 * Unpowered. Manual E: deposit carry, or take when empty-handed. anim: fill.
 */
export class Silo extends StoreMachine {
  /** Input budget (hay-eq) refilled each tick. */
  private inBudget = 0;

  constructor(init: BuildingInit) {
    super(init);
    this.anim.fill = 0;
  }

  protected capacity(ctx: SimContext): number { return ctx.stat('silo.capacity'); }
  protected outputRate(ctx: SimContext): number { return ctx.stat('silo.outputRate'); }
  protected canPlayerTake(_ctx: SimContext): boolean { return true; }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    return item.amount > 0 && this.inPortAccepts(port, item.type) && this.inBudget + EPS >= hayEq(item.type, item.amount) && this.fits(item, ctx);
  }

  override accept(item: ItemPacket, port: number, ctx: SimContext): void {
    this.inBudget = Math.max(0, this.inBudget - hayEq(item.type, item.amount));
    super.accept(item, port, ctx);
  }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    this.inputAge += dt;
    const rate = ctx.stat('silo.inputRate') * dt;
    const maxItem = Math.max(BALANCE.hayEquivalent.bale, BALANCE.hayEquivalent.wrapped, BALANCE.hayPacketSize * BALANCE.hayEquivalent.hay);
    this.inBudget = Math.min(this.inBudget + rate, maxItem + rate);
    this.pushOutputs(ctx, dt);
    const cap = this.capacity(ctx);
    const w = this.store.weight();
    if (w >= cap - EPS) this.setStatus('full', ctx);
    else if (this.outputAge < 0.5 || this.inputAge < 0.5) this.setStatus('running', ctx);
    else this.setStatus('idle', ctx);
    this.anim.fill = cap > 0 ? Math.min(1, w / cap) : 0;
  }

  protected override describeStatus(ctx: SimContext): string {
    const linked = this.anyOutputLinked(ctx);
    switch (this.status) {
      case 'full': return linked ? 'Full - the output line is slower than the input' : 'Full - connect a belt to the output to unload';
      case 'running':
        if (!linked) return 'Storing - connect a belt to the output to unload';
        return this.outputsStalled(ctx) ? 'Storing - the output belt is backed up' : `Unloading ${fmtRate(this.rateOut.value)}`;
      default:
        if (this.store.isEmpty()) return 'Empty - connect an input belt or deposit items (E)';
        return linked ? 'Holding - the output belt is backed up' : 'Holding - connect a belt to the output to unload';
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    lines.push(this.storeLine(ctx));
    const c = this.contentsLine();
    if (c) lines.push(c);
    lines.push({ label: 'Input', value: `${fmtRate(this.rateIn.value)} (max ${fmtInt(ctx.stat('silo.inputRate'))})` });
    lines.push({ label: 'Output', value: `${fmtRate(this.rateOut.value)} (max ${fmtInt(this.outputRate(ctx))} per port)` });
  }

  override saveState(): unknown { return { ...this.saveStore(), inBudget: this.inBudget }; }
  override loadState(s: unknown): void {
    const o = obj(s);
    this.loadStore(o);
    this.inBudget = num(o.inBudget, 0, 0);
  }
}
