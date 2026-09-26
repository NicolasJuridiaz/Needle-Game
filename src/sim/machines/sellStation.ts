import { ITEMS } from '../../config/items';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { ITEM_TYPES, type ItemPacket, type ItemType } from '../types';
import { heldBarrow, playerAmount, takeFromPlayer } from './playerTransfer';
import { countsLabel, EPS, fmtMoney, fmtNum, fmtRate, hayEq, itemLabel, Machine, num, obj, slipNeedles } from './shared';

/** Seconds for the sale pulse to decay to ~37%. */
const PULSE_TAU = 0.25;

/**
 * Market Chute: sells everything delivered to any input port instantly, and the player's whole carry
 * (plus a held wheelbarrow) with E. Unscanned hidden needles slip through and are tossed back.
 * anim: pulse (1 on each sale, decays).
 */
export class SellStation extends Machine {
  /** Money earned at this chute (belts + manual), for the tooltip. */
  private earned = 0;
  private readonly slipped: number[] = [];

  constructor(init: BuildingInit) {
    super(init);
    this.anim.pulse = 0;
  }

  override canAccept(item: ItemPacket, port: number, _ctx: SimContext): boolean {
    return item.amount > 0 && this.inPortAccepts(port, item.type);
  }

  override accept(item: ItemPacket, _port: number, ctx: SimContext): void {
    this.prepare();
    if (item.needleId !== undefined && !item.scanned) {
      this.slipped.push(item.needleId);
      slipNeedles(ctx, this.slipped, this, this.centre);
    }
    this.earned += ctx.progress.recordSale(item.type, item.amount, true, this.centre);
    this.rateIn.add(hayEq(item.type, item.amount));
    this.anim.pulse = 1;
  }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    this.anim.pulse = this.anim.pulse > 0.001 ? this.anim.pulse * Math.exp(-dt / PULSE_TAU) : 0;
    this.setStatus(this.rateIn.value > 0.05 ? 'running' : 'idle', ctx);
  }

  /** Money the player's current load would fetch. */
  private saleValue(ctx: SimContext): number {
    const mul = ctx.stat('econ.saleMul');
    let v = 0;
    for (const t of ITEM_TYPES) v += playerAmount(ctx, t) * ctx.stat(ITEMS[t].valueStat) * mul;
    return v;
  }

  override interaction(ctx: SimContext): InteractionOption {
    const hay = playerAmount(ctx, 'hay');
    const bale = playerAmount(ctx, 'bale');
    const wrapped = playerAmount(ctx, 'wrapped');
    const kinds = (hay > EPS ? 1 : 0) + (bale >= 1 ? 1 : 0) + (wrapped >= 1 ? 1 : 0);
    if (kinds === 0) return { kind: 'deposit', label: 'Sell', enabled: false, reason: 'Carrying nothing' };
    const value = fmtMoney(this.saleValue(ctx));
    if (kinds > 1) return { kind: 'deposit', label: `Sell everything (${value})`, enabled: true };
    const type: ItemType = hay > EPS ? 'hay' : bale >= 1 ? 'bale' : 'wrapped';
    const n = type === 'hay' ? Math.max(1, Math.round(hay)) : type === 'bale' ? bale : wrapped;
    return { kind: 'deposit', label: `Sell ${itemLabel(type, n)} (${value})`, enabled: true };
  }

  override interact(ctx: SimContext): boolean {
    this.prepare();
    let moved = 0;
    for (const t of ITEM_TYPES) {
      const n = takeFromPlayer(ctx, t, Infinity, this.slipped);
      if (n <= EPS) continue;
      moved += n;
      this.earned += ctx.progress.recordSale(t, n, false, this.centre);
    }
    if (this.slipped.length) slipNeedles(ctx, this.slipped, this, this.centre);
    if (moved <= EPS) return false;
    this.anim.pulse = 1;
    ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: moved, pos: this.posCopy() });
    return true;
  }

  protected override describeStatus(ctx: SimContext): string {
    if (this.status === 'running') return `Selling ${fmtRate(this.rateIn.value)} delivered by belt`;
    return heldBarrow(ctx) || !ctx.player.carry.isEmpty()
      ? 'Ready - press E to sell what you carry'
      : 'Waiting for deliveries - bring hay (E) or connect a belt';
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    lines.push({ label: 'Deliveries', value: fmtRate(this.rateIn.value) });
    const mul = ctx.stat('econ.saleMul');
    lines.push({ label: 'Raw hay', value: `$${fmtNum(ctx.stat(ITEMS.hay.valueStat) * mul)} each` });
    if (ctx.progress.buildingUnlocked('compressor')) lines.push({ label: 'Bale', value: `${fmtMoney(ctx.stat(ITEMS.bale.valueStat) * mul)} each` });
    if (ctx.progress.buildingUnlocked('wrapper')) lines.push({ label: 'Wrapped bale', value: `${fmtMoney(ctx.stat(ITEMS.wrapped.valueStat) * mul)} each` });
    lines.push({ label: 'Earned here', value: fmtMoney(this.earned), tone: 'good' });
    const carried = countsLabel(playerAmount(ctx, 'hay'), playerAmount(ctx, 'bale'), playerAmount(ctx, 'wrapped'));
    if (carried) lines.push({ label: 'You carry', value: carried });
  }

  override saveState(): unknown { return { earned: this.earned }; }
  override loadState(s: unknown): void { this.earned = num(obj(s).earned, 0, 0); }
}
