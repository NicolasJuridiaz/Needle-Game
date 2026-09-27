import { ITEMS } from '../../config/items';
import { WORLD } from '../../config/world';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { ITEM_TYPES, type ItemPacket, type ItemType } from '../types';
import { heldBarrow, playerAmount, takeFromPlayer } from './playerTransfer';
import { countsLabel, EPS, fmtMoney, fmtNum, fmtRate, hayEq, itemLabel, Machine, num, obj, slipNeedles } from './shared';

/** Seconds for the sale pulse to decay to ~37%. */
const PULSE_TAU = 0.25;

/** One manual load riding the Market intake belt (amounts per item type, seconds travelled). */
export interface IntakeLoad { hay: number; bale: number; wrapped: number; t: number }

/**
 * Market Chute: sells everything delivered to any input port instantly. What the PLAYER carries (carry + held
 * wheelbarrow) is no longer sold by pressing E on the chute: it is dropped on the fixed Market intake belt
 * (`depositIntake`, WORLD.intake), rides it for `transitSeconds` and is then sold here with exactly the same sale call
 * as the old direct sale (manual, not "via belt": belt-only Orders are unaffected). Unscanned hidden needles in the
 * dropped hay slip through at the moment of the drop and are tossed back, as before.
 * anim: pulse (1 on each sale, decays).
 */
export class SellStation extends Machine {
  /** Money earned at this chute (belts + manual), for the tooltip. */
  private earned = 0;
  private readonly slipped: number[] = [];
  /** Manual loads on the intake belt, oldest first. */
  private readonly intake: IntakeLoad[] = [];

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
    this.advanceIntake(dt, ctx);
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
    if (hay <= EPS && bale < 1 && wrapped < 1) return { kind: 'deposit', label: 'Market Chute', enabled: false, reason: 'Drop hay on the intake belt to sell it' };
    // Never a "Sell" label here: selling happens only at the belt (worth ${fmtMoney(this.saleValue(ctx))} right now).
    return { kind: 'deposit', label: 'Market Chute', enabled: false, reason: `Drop it on the SELL HAY intake belt (${fmtMoney(this.saleValue(ctx))})` };
  }

  /** E on the chute itself no longer sells: carried items go on the intake belt (depositIntake). */
  override interact(_ctx: SimContext): boolean { return false; }

  /**
   * Drops everything the player carries (carry + held wheelbarrow) on the intake belt. Needles hidden in the hay
   * slip through now (tossed back to the pile), exactly as the old direct sale did. Returns the amount dropped.
   */
  depositIntake(ctx: SimContext): number {
    this.prepare();
    const load: IntakeLoad = { hay: 0, bale: 0, wrapped: 0, t: 0 };
    let moved = 0;
    for (const t of ITEM_TYPES) {
      const n = takeFromPlayer(ctx, t, Infinity, this.slipped);
      if (n <= EPS) continue;
      load[t] += n;
      moved += n;
    }
    if (this.slipped.length) slipNeedles(ctx, this.slipped, this, this.centre);
    if (moved <= EPS) return 0;
    this.intake.push(load);
    const i = WORLD.intake;
    ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: moved, pos: { x: i.x + 0.5, y: i.beltY, z: i.z0 + 1 } });
    return moved;
  }

  /** Loads on the intake belt with their progress 0..1 (render). */
  intakeLoads(): readonly IntakeLoad[] { return this.intake; }

  /** Moves the intake loads; a load that reaches the chute is sold with the regular manual sale. */
  private advanceIntake(dt: number, ctx: SimContext): void {
    if (!this.intake.length) return;
    const T = WORLD.intake.transitSeconds;
    for (const l of this.intake) l.t += dt;
    while (this.intake.length && this.intake[0].t >= T) {
      const l = this.intake.shift()!;
      for (const t of ITEM_TYPES) {
        if (l[t] <= EPS) continue;
        this.earned += ctx.progress.recordSale(t, l[t], false, this.centre);
      }
      this.anim.pulse = 1;
    }
  }

  protected override describeStatus(ctx: SimContext): string {
    if (this.status === 'running') return `Selling ${fmtRate(this.rateIn.value)} delivered by belt`;
    return heldBarrow(ctx) || !ctx.player.carry.isEmpty()
      ? 'Drop what you carry on the intake belt (E) to sell it'
      : 'Waiting for deliveries - drop hay on the intake belt or connect a belt';
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

  override saveState(): unknown {
    return this.intake.length ? { earned: this.earned, intake: this.intake.map((l) => ({ ...l })) } : { earned: this.earned };
  }

  override loadState(s: unknown): void {
    const o = obj(s);
    this.earned = num(o.earned, 0, 0);
    this.intake.length = 0;
    if (Array.isArray(o.intake)) {
      for (const e of o.intake) {
        const l = obj(e);
        this.intake.push({ hay: num(l.hay, 0, 0), bale: num(l.bale, 0, 0), wrapped: num(l.wrapped, 0, 0), t: num(l.t, 0, 0) });
      }
    }
  }
}
