import { BALANCE } from '../../config/balance';
import type { Building, BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import { DIR_DX, DIR_DZ } from '../types';
import { playerTakesHay, takeHayOption } from './playerTransfer';
import {
  EPS, ease, FILL_EPS, fmtInt, fmtNum, fmtRate, loadInventory, Machine, needlesPickedUp, num, obj, packetAmount, RateGate,
  returnStrandedNeedles,
} from './shared';

/** Cycle phases (fractions of `rake.cycleTime`): extend 0-0.4, rake back 0.4-0.8, dump 0.8-1. */
const EXTEND_END = 0.4;
const RAKE_END = 0.8;
/** Consecutive cycles without hay before the status turns to noHay. */
const EMPTY_CYCLES_FOR_NO_HAY = 2;

interface AdjacentInput { b: Building; port: number }

/**
 * Piston Rake: faces the stack (local +X). Each cycle the comb head extends into the hay, rakes back
 * and dumps into the tray: `hay.extractStrip` from the centre of the front edge of the footprint along
 * local +X (`rake.width` wide, up to `rake.reach` long, up to `rake.push` hay, never more than the
 * tray's free space). The tray unloads through the chute port at `rake.trayOutputRate`; with
 * `rake.autoOutput` it also feeds any adjacent input facing the rake. Manual E takes the tray.
 * anim: ext, reach, width, tray, phase, industrial.
 */
export class PistonRake extends Machine {
  private readonly tray = new Inventory();
  private readonly gate = new RateGate();
  /** Cycle phase 0..1 (valid while `cycling`). */
  private phase = 0;
  private cycling = false;
  private dumped = false;
  private emptyCycles = 0;
  /** Distance to the hay face measured by the last dump (m), NaN before the first one. */
  private lastReach = NaN;
  private readonly adjacent: AdjacentInput[] = [];
  private adjacentDirty = true;
  private adjTurn = 0;

  constructor(init: BuildingInit) {
    super(init);
    this.anim.ext = 0;
    this.anim.reach = 0;
    this.anim.width = 0;
    this.anim.tray = 0;
    this.anim.phase = 0;
    this.anim.industrial = 0;
  }

  protected override onGeometryChanged(): void { this.adjacentDirty = true; }
  protected override onPortsChanged(): void { this.adjacentDirty = true; }

  /** Centre of the front edge (local +X side) of the footprint. */
  private frontX(): number { return this.cx + this.fx * this.def.footprint[0] * 0.5; }
  private frontZ(): number { return this.cz + this.fz * this.def.footprint[0] * 0.5; }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    const cap = ctx.stat('rake.trayCapacity');
    const maxReach = ctx.stat('rake.reach');
    returnStrandedNeedles(ctx, this.tray, this.frontX(), this.frontZ());

    if (this.powerGate(ctx)) {
      const sf = this.speedFactor(ctx);
      this.unload(ctx, dt, sf);
      if (!this.cycling && cap - this.tray.hay > FILL_EPS) { this.cycling = true; this.phase = 0; this.dumped = false; }
      if (this.cycling) {
        this.phase += (dt * sf) / Math.max(0.05, ctx.stat('rake.cycleTime'));
        if (!this.dumped && this.phase >= RAKE_END) { this.dumped = true; this.dump(ctx, cap, maxReach); }
        if (this.phase >= 1) {
          this.phase -= 1;
          this.dumped = false;
          if (cap - this.tray.hay <= FILL_EPS) { this.cycling = false; this.phase = 0; }
        }
      }
      if (!this.cycling && cap - this.tray.hay <= FILL_EPS) this.setStatus('outputBlocked', ctx);
      else if (this.emptyCycles >= EMPTY_CYCLES_FOR_NO_HAY) this.setStatus('noHay', ctx);
      else this.setWorking(ctx);
    } else {
      this.gate.blocked = false;
      this.gate.settle(dt);
    }

    const p = this.cycling ? this.phase : 0;
    this.anim.phase = p;
    this.anim.ext = p < EXTEND_END ? ease(p / EXTEND_END) : p < RAKE_END ? 1 - ease((p - EXTEND_END) / (RAKE_END - EXTEND_END)) : 0;
    this.anim.reach = Number.isNaN(this.lastReach) ? maxReach : Math.min(this.lastReach, maxReach);
    this.anim.width = ctx.stat('rake.width');
    this.anim.tray = cap > 0 ? Math.min(1, this.tray.hay / cap) : 0;
    this.anim.industrial = ctx.stat('rake.industrial') >= 1 ? 1 : 0;
  }

  private dump(ctx: SimContext, cap: number, maxReach: number): void {
    const maxUnits = Math.min(ctx.stat('rake.push'), cap - this.tray.hay);
    if (maxUnits <= FILL_EPS) return;
    const ex = ctx.hay.extractStrip(this.frontX(), this.frontZ(), this.fx, this.fz, ctx.stat('rake.width'), maxReach, maxUnits);
    if (ex.needles.length) { this.tray.add('hay', 0, ex.needles); needlesPickedUp(ctx, ex.needles, this); }
    if (ex.units > EPS) {
      this.tray.add('hay', ex.units);
      this.rateIn.add(ex.units);
      this.emptyCycles = 0;
      this.lastReach = Math.max(0, Math.min(ex.reach, maxReach));
      ctx.creditExtraction(ex.units, 'rake', ex.pos);
      ctx.events.emit('machine:cycle', { id: this.id, type: this.type, pos: this.posCopy() });
    } else {
      this.emptyCycles++;
      this.lastReach = maxReach;
    }
  }

  /** Tray -> chute port (and, with Auto Output, any adjacent input facing the rake). */
  private unload(ctx: SimContext, dt: number, sf: number): void {
    const g = this.gate;
    g.blocked = false;
    g.refill(ctx.stat('rake.trayOutputRate') * sf, dt);
    const flush = this.emptyCycles > 0 || !this.cycling;
    let linked = false;
    for (let i = 0; i < this.outIdx.length; i++) {
      const port = this.outIdx[i];
      if (!ctx.logistics.isLinked(this, port)) continue;
      linked = true;
      this.pushPackets(ctx, port, this.tray, 'hay', g, flush);
    }
    if (ctx.stat('rake.autoOutput') >= 1 && this.tray.hay > EPS && (!linked || g.blocked)) {
      if (this.adjacentDirty) this.findAdjacent(ctx);
      if (this.adjacent.length) this.pushAdjacent(ctx, g, flush);
    }
    g.settle(dt);
  }

  /** Inputs of other buildings that face one of the rake's footprint cells (Auto Output). */
  private findAdjacent(ctx: SimContext): void {
    this.adjacentDirty = false;
    this.adjacent.length = 0;
    const [w, d] = this.size;
    const x0 = this.cell.x, z0 = this.cell.z, lvl = this.cell.level;
    for (const b of ctx.buildings.values()) {
      if (b === this) continue;
      for (let i = 0; i < b.ports.length; i++) {
        const p = b.ports[i];
        if (p.kind !== 'in' || p.cell.level !== lvl) continue;
        const nx = p.cell.x + DIR_DX[p.dir];
        const nz = p.cell.z + DIR_DZ[p.dir];
        if (nx >= x0 && nx < x0 + w && nz >= z0 && nz < z0 + d) this.adjacent.push({ b, port: p.index });
      }
    }
  }

  /** Round-robin over adjacent inputs; stops when every one of them refuses or credit runs out. */
  private pushAdjacent(ctx: SimContext, g: RateGate, flush: boolean): void {
    const n = this.adjacent.length;
    let refused = 0;
    while (refused < n) {
      const amt = packetAmount(this.tray, 'hay');
      if (amt <= EPS) return;
      if (!flush && amt < BALANCE.hayPacketSize - EPS && this.tray.needles.length <= 1) return;
      if (g.credit + EPS < amt) return;
      const t = this.adjacent[this.adjTurn % n];
      this.adjTurn = (this.adjTurn + 1) % n;
      this.probe.type = 'hay'; this.probe.amount = amt;
      if (!t.b.canAccept(this.probe, t.port, ctx)) { refused++; continue; }
      const pk = this.tray.takePacket('hay', amt);
      if (!pk) return;
      t.b.accept(pk, t.port, ctx);
      g.credit -= amt;
      refused = 0;
      this.rateOut.add(amt);
    }
  }

  override interaction(ctx: SimContext): InteractionOption {
    return takeHayOption(ctx, this.tray, 'Tray is empty');
  }

  override interact(ctx: SimContext): boolean {
    this.prepare();
    return playerTakesHay(ctx, this.tray, this, this.centre) > 0;
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'outputBlocked': return 'Output blocked - connect a belt or empty the tray (E)';
      case 'noHay': return 'No hay in reach - move it closer to the stack';
      default: {
        if (!this.anyOutputLinked(ctx) && !(ctx.stat('rake.autoOutput') >= 1 && this.adjacent.length)) {
          return 'Raking into the tray - connect a belt to the chute or empty it (E)';
        }
        return `Raking ${fmtRate(this.rateIn.value)}`;
      }
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const cap = ctx.stat('rake.trayCapacity');
    lines.push({ label: 'Raking', value: fmtRate(this.rateIn.value) });
    lines.push({ label: 'Output', value: fmtRate(this.rateOut.value) });
    lines.push({ label: 'Tray', value: `${fmtInt(this.tray.hay)} / ${fmtInt(cap)}`, tone: this.tray.hay >= cap - FILL_EPS ? 'warn' : undefined });
    lines.push({ label: 'Cycle', value: `${fmtNum(ctx.stat('rake.cycleTime'))} s, up to ${fmtInt(ctx.stat('rake.push'))} hay` });
  }

  override contents(): Inventory { return this.tray; }
  override clearContents(): void { this.tray.clear(); }

  override saveState(): unknown {
    return {
      tray: this.tray.toJSON(), phase: this.phase, cycling: this.cycling, dumped: this.dumped,
      emptyCycles: this.emptyCycles, lastReach: Number.isNaN(this.lastReach) ? null : this.lastReach, credit: this.gate.credit,
    };
  }

  override loadState(s: unknown): void {
    const o = obj(s);
    this.tray.clear();
    loadInventory(o.tray).moveAllTo(this.tray);
    this.phase = Math.min(1, num(o.phase, 0, 0)); // a saved phase is < 1; 1 just completes the cycle next tick
    this.cycling = o.cycling === true;
    this.dumped = o.dumped === true;
    this.emptyCycles = Math.floor(num(o.emptyCycles, 0, 0));
    this.lastReach = typeof o.lastReach === 'number' && Number.isFinite(o.lastReach) ? Math.max(0, o.lastReach) : NaN;
    this.gate.reset();
    this.gate.credit = num(o.credit, 0, 0);
  }
}
