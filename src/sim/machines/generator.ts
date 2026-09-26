import { BALANCE } from '../../config/balance';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import type { ItemPacket } from '../types';
import { playerAmount, takeFromPlayer } from './playerTransfer';
import { approach, EPS, fmtInt, fmtNum, fmtRate, HayBuffer, itemLabel, Machine, num, obj, slipNeedles } from './shared';

/** Flame intensity time constant (s). */
const FIRE_TAU = 0.4;

function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return '-';
  const t = Math.max(0, Math.round(s));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m} min ${t % 60 < 10 ? '0' : ''}${t % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Hay Generator: burns hay from its firebox (`generator.firebox`) to produce `generator.output` P.
 * The PowerNetwork decides the share of that output its network actually uses and writes it to
 * `load` (0..1) each tick; the firebox burns `generator.burnRate x load` hay/s. Manual E feeds the
 * whole carry (up to free space). With Auto Feed (`f_autofeed` port + `generator.autoFeed`) it also
 * takes hay by belt. Unscanned needles in burnt fuel slip through (tossed back on the pile).
 * anim: fire, fuel, load, industrial.
 */
export class HayGenerator extends Machine {
  private readonly firebox = new HayBuffer();
  /** Share of the output used by the network (set by PowerNetwork.tick). */
  load = 0;
  private readonly slipped: number[] = [];
  private readonly carried: number[] = [];

  constructor(init: BuildingInit) {
    super(init);
    this.anim.fire = 0;
    this.anim.fuel = 0;
    this.anim.load = 0;
    this.anim.industrial = 0;
  }

  get fuel(): number { return this.firebox.hay; }

  /** Is it able to produce power right now? */
  isFuelled(): boolean { return this.enabled && this.firebox.hay > EPS; }

  /** Power it can produce right now (P, before transmission loss). */
  outputPower(ctx: SimContext): number { return this.isFuelled() ? Math.max(0, ctx.stat('generator.output')) : 0; }

  private capacity(ctx: SimContext): number { return Math.max(0, ctx.stat('generator.firebox')); }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    if (item.type !== 'hay' || item.amount <= 0 || ctx.stat('generator.autoFeed') < 1 || !this.inPortAccepts(port, 'hay')) return false;
    return this.firebox.hay + item.amount <= this.capacity(ctx) + EPS;
  }

  override accept(item: ItemPacket, _port: number, _ctx: SimContext): void {
    this.firebox.add(item.amount, item.needleId);
    this.rateIn.add(item.amount);
  }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    const cap = this.capacity(ctx);
    if (this.powerGate(ctx)) {
      const load = Math.max(0, Math.min(1, this.load));
      if (this.firebox.hay > EPS) {
        this.slipped.length = 0;
        const burned = this.firebox.consume(this.burnRate(ctx) * dt, this.slipped);
        if (this.slipped.length) slipNeedles(ctx, this.slipped, this, this.centre);
        if (burned > 0) ctx.progress.stats.hayBurned += burned;
      }
      if (this.firebox.hay <= EPS) this.setStatus('noFuel', ctx);
      else if (load <= 0.001) this.setStatus('idle', ctx);
      else this.setStatus('running', ctx);
    } else {
      this.load = 0;
    }

    const lit = this.isFuelled();
    const a = this.anim;
    a.fire = approach(a.fire, lit ? 0.25 + 0.75 * Math.min(1, this.load) : 0, dt, FIRE_TAU);
    a.fuel = cap > 0 ? Math.min(1, this.firebox.hay / cap) : 0;
    a.load = lit ? Math.min(1, this.load) : 0;
    a.industrial = ctx.stat('generator.industrial') >= 1 ? 1 : 0;
  }

  /** Hay/s burnt right now: proportional to load, never below the pilot flame while fuelled. */
  private burnRate(ctx: SimContext): number {
    const load = Math.max(0, Math.min(1, this.load));
    return Math.max(0, ctx.stat('generator.burnRate')) * Math.max(load, BALANCE.generatorPilotBurn);
  }

  // ----- manual feeding ----------------------------------------------------------------------

  override interaction(ctx: SimContext): InteractionOption {
    const hay = playerAmount(ctx, 'hay');
    if (hay <= EPS) return { kind: 'feed', label: 'Feed hay', enabled: false, reason: 'Carrying no hay' };
    const room = this.capacity(ctx) - this.firebox.hay;
    if (room <= EPS) return { kind: 'feed', label: `Feed ${itemLabel('hay', Math.max(1, hay))}`, enabled: false, reason: 'Firebox is full' };
    return { kind: 'feed', label: `Feed ${itemLabel('hay', Math.max(1, Math.min(hay, room)))}`, enabled: true };
  }

  override interact(ctx: SimContext): boolean {
    this.prepare();
    const want = Math.min(playerAmount(ctx, 'hay'), this.capacity(ctx) - this.firebox.hay);
    if (want <= EPS) return false;
    this.carried.length = 0;
    const got = takeFromPlayer(ctx, 'hay', want, this.carried);
    if (got <= EPS) return false;
    this.firebox.addWithNeedles(got, this.carried);
    this.carried.length = 0;
    this.rateIn.add(got);
    const pos = this.posCopy();
    ctx.events.emit('generator:fed', { id: this.id, amount: got, pos });
    ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: got, pos: this.posCopy() });
    return true;
  }

  // ----- status / info -----------------------------------------------------------------------

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'noFuel':
        return ctx.stat('generator.autoFeed') >= 1 && this.inIdx.length
          ? 'Firebox empty - feed hay (E) or connect a fuel belt'
          : 'Firebox empty - feed hay (E)';
      case 'idle':
        return ctx.progress.buildingUnlocked('powerPole')
          ? 'Idle - no machine is connected: place machines or Power Poles nearby'
          : 'Idle - no machine is connected: build powered machines within 5 m';
      default: {
        const out = ctx.stat('generator.output');
        return `Making ${fmtInt(out * Math.min(1, this.load))} / ${fmtInt(out)} P (${Math.round(Math.min(1, this.load) * 100)}% load)`;
      }
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const out = ctx.stat('generator.output');
    const cap = this.capacity(ctx);
    const lit = this.isFuelled();
    const load = lit ? Math.min(1, this.load) : 0;
    lines.push({ label: 'Output', value: `${fmtNum(out * load)} / ${fmtNum(lit ? out : 0)} P`, tone: lit ? 'good' : 'bad' });
    lines.push({ label: 'Load', value: `${Math.round(load * 100)}%`, tone: load >= 0.999 ? 'warn' : undefined });
    lines.push({ label: 'Firebox', value: `${fmtInt(this.firebox.hay)} / ${fmtInt(cap)}`, tone: this.firebox.hay <= EPS ? 'bad' : this.firebox.hay < cap * 0.2 ? 'warn' : undefined });
    const burn = lit ? this.burnRate(ctx) : 0;
    lines.push({ label: 'Burning', value: fmtRate(burn) });
    if (burn > EPS && this.firebox.hay > EPS) lines.push({ label: 'Fuel left', value: fmtDuration(this.firebox.hay / burn) });
    const net = this.network >= 0 ? ctx.power.networks[this.network] : undefined;
    if (net) lines.push({ label: 'Network', value: `${net.consumers.length} machine${net.consumers.length === 1 ? '' : 's'}, ${fmtNum(net.demand)} P demand` });
  }

  override contents(): Inventory {
    const inv = new Inventory();
    this.firebox.addTo(inv);
    return inv;
  }

  override clearContents(): void { this.firebox.clear(); }

  override saveState(): unknown { return { firebox: this.firebox.toJSON(), load: this.load }; }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    this.firebox.load(o.firebox);
    this.load = Math.min(1, num(o.load, 0, 0));
  }
}
