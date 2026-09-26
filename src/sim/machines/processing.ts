import { BALANCE } from '../../config/balance';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import type { ItemPacket, ItemType } from '../types';
import { giveToPlayer, playerAmount, playerRoom, takeFromPlayer } from './playerTransfer';
import {
  BLOCKED_GRACE, EPS, fmtInt, fmtNum, fmtRate, HayBuffer, hayEq, itemLabel, Machine, num, obj, slipNeedles,
} from './shared';

/** Finished products kept inside a processing machine when its output cannot take them (player can take them, E). */
export const PRODUCT_QUEUE_MAX = 10;
/** Wrapper turntable speed (rad/s) while wrapping. */
const SPIN_SPEED = 6;

/**
 * Shared behaviour of the Compressor and the Wrapper: a queue of finished products (count) that
 * drains through every linked out port as fast as the port accepts, capped at PRODUCT_QUEUE_MAX;
 * a production step that stalls when the queue is full; manual deposit / take (E).
 */
abstract class ProcessingMachine extends Machine {
  /** Finished products waiting to leave. */
  protected out = 0;
  /** Seconds the production has been stalled by a full product queue. */
  protected stalledFor = 0;
  protected readonly product: ItemPacket;
  private outTurn = 0;

  constructor(init: BuildingInit, protected readonly productType: ItemType) {
    super(init);
    this.product = { type: productType, amount: 1 };
  }

  /** Product queue -> linked out ports (round-robin between ports). */
  protected drainProducts(ctx: SimContext): void {
    const n = this.outIdx.length;
    if (n === 0 || this.out < 1) return;
    let refused = 0;
    while (this.out >= 1 && refused < n) {
      const port = this.outIdx[this.outTurn % n];
      this.outTurn = (this.outTurn + 1) % n;
      this.probe.type = this.productType; this.probe.amount = 1;
      if (!ctx.logistics.canPushOut(this, port, this.probe)) { refused++; continue; }
      if (!ctx.logistics.pushOut(this, port, { type: this.productType, amount: 1 })) { refused++; continue; }
      this.out--;
      refused = 0;
    }
  }

  /** Try to move one finished product into the queue. False = queue full (stalled). */
  protected emitProduct(ctx: SimContext): boolean {
    if (this.out >= PRODUCT_QUEUE_MAX) return false;
    this.out++;
    this.rateOut.add(hayEq(this.productType, 1));
    ctx.events.emit('machine:cycle', { id: this.id, type: this.type, pos: this.posCopy() });
    return true;
  }

  protected updateStatus(ctx: SimContext, dt: number, stalled: boolean, working: boolean): void {
    this.stalledFor = stalled ? this.stalledFor + dt : 0;
    if (stalled && (this.stalledFor >= BLOCKED_GRACE || !this.anyOutputLinked(ctx))) this.setStatus('outputBlocked', ctx);
    else if (working) this.setWorking(ctx);
    else this.setStatus('noInput', ctx);
  }

  /** Room for manual input right now (in input units). */
  protected abstract inputRoom(ctx: SimContext): number;
  protected abstract inputType: ItemType;
  /** Stores `n` input items taken from the player (with hidden needles for hay). */
  protected abstract storeInput(n: number, needles: number[]): void;
  protected abstract fullReason: string;

  override interaction(ctx: SimContext): InteractionOption {
    const have = playerAmount(ctx, this.inputType);
    const room = this.inputRoom(ctx);
    const canDeposit = have > EPS && (this.inputType === 'hay' ? room > EPS : room >= 1 && have >= 1);
    if (canDeposit) {
      let n = Math.min(have, room);
      if (this.inputType !== 'hay') n = Math.floor(n + EPS);
      return { kind: 'deposit', label: `Deposit ${itemLabel(this.inputType, this.inputType === 'hay' ? Math.max(1, n) : n)}`, enabled: true };
    }
    if (this.out >= 1) {
      const n = Math.floor(Math.min(this.out, playerRoom(ctx, this.productType)) + EPS);
      if (n < 1) return { kind: 'take', label: `Take ${itemLabel(this.productType, this.out)}`, enabled: false, reason: 'No room to carry more' };
      return { kind: 'take', label: `Take ${itemLabel(this.productType, n)}`, enabled: true };
    }
    if (have > EPS) return { kind: 'deposit', label: `Deposit ${this.inputType === 'hay' ? 'hay' : 'bales'}`, enabled: false, reason: this.fullReason };
    return { kind: 'deposit', label: `Deposit ${this.inputType === 'hay' ? 'hay' : 'bales'}`, enabled: false, reason: this.inputType === 'hay' ? 'Carrying no hay' : 'Carrying no bales' };
  }

  private readonly carried: number[] = [];

  override interact(ctx: SimContext): boolean {
    this.prepare();
    const have = playerAmount(ctx, this.inputType);
    let room = this.inputRoom(ctx);
    if (this.inputType !== 'hay') room = Math.floor(room + EPS);
    if (have > EPS && room > EPS) {
      this.carried.length = 0;
      const got = takeFromPlayer(ctx, this.inputType, Math.min(have, room), this.carried);
      if (got > EPS) {
        this.storeInput(got, this.carried);
        this.carried.length = 0;
        this.rateIn.add(hayEq(this.inputType, got));
        ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: got, pos: this.posCopy() });
        return true;
      }
    }
    if (this.out >= 1) {
      const n = giveToPlayer(ctx, this.productType, Math.floor(this.out + EPS));
      if (n >= 1) {
        this.out -= n;
        ctx.events.emit('player:take', { sourceId: this.id, amount: n, pos: this.posCopy() });
        return true;
      }
    }
    return false;
  }
}

// =====================================================================================
// Compressor
// =====================================================================================

class Chamber {
  /** Hay pressed in this chamber (consumed from the input at cycle start). */
  hay = 0;
  /** Cycle progress 0..1 (valid while hay > 0). */
  t = 0;
}

/**
 * Compressor: raw hay input buffer (`compressor.buffer`); each of `compressor.chambers` chambers
 * presses `compressor.hayPerBale` hay per `compressor.cycle / speedFactor` s into one bale.
 * Bales leave through the out port (or accumulate, max 10, for the player to take with E).
 * Unscanned needles in the pressed hay slip through (tossed back on the pile). Power 25.
 * anim: press (0..1 ram), fill (input buffer), chambers (1 or 2).
 */
export class Compressor extends ProcessingMachine {
  private readonly buffer = new HayBuffer();
  private readonly chambers: Chamber[] = [new Chamber()];
  private readonly slipped: number[] = [];
  protected inputType: ItemType = 'hay';
  protected fullReason = 'Compressor input is full';

  constructor(init: BuildingInit) {
    super(init, 'bale');
    this.anim.press = 0;
    this.anim.fill = 0;
    this.anim.chambers = 1;
  }

  private chamberCount(ctx: SimContext): number {
    return Math.max(1, Math.floor(ctx.stat('compressor.chambers') + EPS));
  }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    if (item.type !== 'hay' || item.amount <= 0 || !this.inPortAccepts(port, 'hay')) return false;
    return this.buffer.hay <= EPS || this.buffer.hay + item.amount <= ctx.stat('compressor.buffer') + EPS;
  }

  override accept(item: ItemPacket, _port: number, _ctx: SimContext): void {
    this.buffer.add(item.amount, item.needleId);
    this.rateIn.add(item.amount);
  }

  protected inputRoom(ctx: SimContext): number { return Math.max(0, ctx.stat('compressor.buffer') - this.buffer.hay); }
  protected storeInput(n: number, needles: number[]): void { this.buffer.addWithNeedles(n, needles); }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    const nCh = this.chamberCount(ctx);
    while (this.chambers.length < nCh) this.chambers.push(new Chamber());
    if (this.enabled) this.drainProducts(ctx);

    let press = 0;
    if (this.powerGate(ctx)) {
      const sf = this.speedFactor(ctx);
      const per = Math.max(1, ctx.stat('compressor.hayPerBale'));
      const cyc = Math.max(0.01, ctx.stat('compressor.cycle'));
      let stalled = false;
      let working = false;
      for (let i = 0; i < this.chambers.length; i++) {
        const ch = this.chambers[i];
        // Chambers above the current count (never happens in normal play) just finish their bale.
        if (ch.hay <= EPS && i < nCh && this.buffer.hay >= per - EPS) {
          this.slipped.length = 0;
          ch.hay = this.buffer.consume(per, this.slipped);
          // ch.t keeps the leftover of the previous cycle (< one tick of progress): no rounding to ticks.
          if (this.slipped.length) slipNeedles(ctx, this.slipped, this, this.centre);
        }
        if (ch.hay <= EPS) continue;
        working = true;
        if (ch.t < 1) ch.t += (dt * sf) / cyc;
        if (ch.t >= 1) {
          if (this.emitProduct(ctx)) { ch.hay = 0; ch.t = Math.min(ch.t - 1, 0.999); }
          else { stalled = true; ch.t = 1; }
        }
        if (ch.hay > EPS) press = Math.max(press, Math.sin(Math.PI * ch.t));
      }
      this.updateStatus(ctx, dt, stalled, working);
    }

    this.anim.press = press;
    const cap = ctx.stat('compressor.buffer');
    this.anim.fill = cap > 0 ? Math.min(1, this.buffer.hay / cap) : 0;
    this.anim.chambers = nCh;
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'outputBlocked':
        return this.anyOutputLinked(ctx)
          ? 'Output blocked - the bale belt is backed up'
          : 'Output blocked - connect a belt to the bale output or take the bales (E)';
      case 'noInput': {
        const per = ctx.stat('compressor.hayPerBale');
        return this.buffer.hay > EPS
          ? `Waiting for hay - ${fmtInt(this.buffer.hay)} / ${fmtInt(per)} for the next bale`
          : 'Waiting for hay - feed it by belt or deposit hay (E)';
      }
      default:
        return this.anyOutputLinked(ctx) || this.out < 1
          ? `Pressing ${fmtRate(this.rateOut.value)} into bales`
          : 'Pressing bales - connect a belt to the output or take them (E)';
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const nCh = this.chamberCount(ctx);
    const per = ctx.stat('compressor.hayPerBale');
    const max = (per / Math.max(0.01, ctx.stat('compressor.cycle'))) * nCh * ctx.stat('global.machineSpeed');
    const cap = ctx.stat('compressor.buffer');
    lines.push({ label: 'Pressing', value: `${fmtNum(this.rateOut.value)} / ${fmtInt(max)} hay/s` });
    lines.push({ label: 'Input', value: `${fmtInt(this.buffer.hay)} / ${fmtInt(cap)}`, tone: this.buffer.hay >= cap - EPS ? 'warn' : undefined });
    lines.push({ label: 'Bales waiting', value: `${fmtInt(this.out)} / ${PRODUCT_QUEUE_MAX}`, tone: this.out >= PRODUCT_QUEUE_MAX ? 'warn' : undefined });
    lines.push({ label: 'Recipe', value: `${fmtInt(per)} hay -> 1 bale${nCh > 1 ? `, ${nCh} chambers` : ''}` });
  }

  override contents(): Inventory {
    const inv = new Inventory();
    this.buffer.addTo(inv);
    for (const ch of this.chambers) inv.add('hay', ch.hay);
    inv.add('bale', this.out);
    return inv;
  }

  override clearContents(): void {
    this.buffer.clear();
    for (const ch of this.chambers) { ch.hay = 0; ch.t = 0; }
    this.out = 0;
  }

  override saveState(): unknown {
    return { buffer: this.buffer.toJSON(), chambers: this.chambers.map((c) => [c.hay, c.t]), out: this.out };
  }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    this.buffer.load(o.buffer);
    const list = Array.isArray(o.chambers) ? o.chambers : [];
    this.chambers.length = 0;
    for (const c of list) {
      const ch = new Chamber();
      if (Array.isArray(c)) { ch.hay = num(c[0], 0, 0); ch.t = Math.min(1, num(c[1], 0, 0)); }
      this.chambers.push(ch);
    }
    if (this.chambers.length === 0) this.chambers.push(new Chamber());
    this.out = Math.min(PRODUCT_QUEUE_MAX, Math.floor(num(o.out, 0, 0)));
  }
}

// =====================================================================================
// Wrapper
// =====================================================================================

/**
 * Bale Wrapper: input bale buffer (`wrapper.buffer`); wraps one bale per `wrapper.cycle / speedFactor` s.
 * Wrapped bales leave through the out port (or accumulate, max 10, for the player to take with E).
 * Manual E deposits carried bales / takes wrapped ones. Power 30.
 * anim: spin (turntable angle), wrap (0..1 current bale), premium (0/1), hasBale (0/1).
 */
export class Wrapper extends ProcessingMachine {
  private inBales = 0;
  private hasBale = false;
  private t = 0;
  protected inputType: ItemType = 'bale';
  protected fullReason = 'Wrapper input is full';

  constructor(init: BuildingInit) {
    super(init, 'wrapped');
    this.anim.spin = 0;
    this.anim.wrap = 0;
    this.anim.premium = 0;
    this.anim.hasBale = 0;
  }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    if (item.type !== 'bale' || item.amount <= 0 || !this.inPortAccepts(port, 'bale')) return false;
    return this.inBales + item.amount <= ctx.stat('wrapper.buffer') + EPS;
  }

  override accept(item: ItemPacket, _port: number, _ctx: SimContext): void {
    this.inBales += item.amount;
    this.rateIn.add(hayEq('bale', item.amount));
  }

  protected inputRoom(ctx: SimContext): number { return Math.max(0, ctx.stat('wrapper.buffer') - this.inBales); }
  protected storeInput(n: number, _needles: number[]): void { this.inBales += n; }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    if (this.enabled) this.drainProducts(ctx);
    let spinning = false;
    if (this.powerGate(ctx)) {
      const sf = this.speedFactor(ctx);
      // this.t keeps the leftover of the previous cycle (< one tick of progress): no rounding to ticks.
      if (!this.hasBale && this.inBales >= 1 - EPS) { this.inBales = Math.max(0, this.inBales - 1); this.hasBale = true; }
      let stalled = false;
      if (this.hasBale) {
        if (this.t < 1) { this.t += (dt * sf) / Math.max(0.01, ctx.stat('wrapper.cycle')); spinning = true; }
        if (this.t >= 1) {
          if (this.emitProduct(ctx)) { this.hasBale = false; this.t = Math.min(this.t - 1, 0.999); }
          else { stalled = true; spinning = false; this.t = 1; }
        }
      }
      this.updateStatus(ctx, dt, stalled, this.hasBale || this.inBales >= 1);
      if (spinning) this.anim.spin += dt * SPIN_SPEED * sf;
    }
    this.anim.wrap = this.hasBale ? this.t : 0;
    this.anim.hasBale = this.hasBale ? 1 : 0;
    this.anim.premium = ctx.stat('wrapper.premium') >= 1 ? 1 : 0;
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'outputBlocked':
        return this.anyOutputLinked(ctx)
          ? 'Output blocked - the wrapped-bale belt is backed up'
          : 'Output blocked - connect a belt to the output or take the wrapped bales (E)';
      case 'noInput': return 'Waiting for bales - feed them by belt from a Compressor or deposit bales (E)';
      default:
        return this.anyOutputLinked(ctx) || this.out < 1
          ? `Wrapping ${fmtNum(this.rateOut.value / BALANCE.hayEquivalent.wrapped)} bales/s`
          : 'Wrapping - connect a belt to the output or take the wrapped bales (E)';
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const perSec = ctx.stat('global.machineSpeed') / Math.max(0.01, ctx.stat('wrapper.cycle'));
    const cap = ctx.stat('wrapper.buffer');
    lines.push({ label: 'Wrapping', value: `${fmtNum(this.rateOut.value / BALANCE.hayEquivalent.wrapped)} / ${fmtNum(perSec)} bales/s` });
    lines.push({ label: 'Input', value: `${fmtInt(this.inBales)} / ${fmtInt(cap)} bales`, tone: this.inBales >= cap - EPS ? 'warn' : undefined });
    lines.push({ label: 'Wrapped waiting', value: `${fmtInt(this.out)} / ${PRODUCT_QUEUE_MAX}`, tone: this.out >= PRODUCT_QUEUE_MAX ? 'warn' : undefined });
    if (ctx.stat('wrapper.premium') >= 1) lines.push({ label: 'Wrap', value: 'Premium', tone: 'good' });
  }

  override contents(): Inventory {
    const inv = new Inventory();
    inv.add('bale', this.inBales + (this.hasBale ? 1 : 0));
    inv.add('wrapped', this.out);
    return inv;
  }

  override clearContents(): void { this.inBales = 0; this.hasBale = false; this.t = 0; this.out = 0; }

  override saveState(): unknown {
    return { inBales: this.inBales, hasBale: this.hasBale, t: this.t, out: this.out, spin: this.anim.spin };
  }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    this.inBales = Math.floor(num(o.inBales, 0, 0) + EPS);
    this.hasBale = o.hasBale === true;
    // t carries the sub-tick leftover of the previous wrap even while idle.
    this.t = Math.min(1, num(o.t, 0, 0));
    this.out = Math.min(PRODUCT_QUEUE_MAX, Math.floor(num(o.out, 0, 0)));
    this.anim.spin = num(o.spin, 0);
  }
}
