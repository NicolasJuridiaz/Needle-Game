import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import { playerTakesHay, takeHayOption } from './playerTransfer';
import {
  approach, EPS, FILL_EPS, fmtInt, fmtNum, fmtRate, loadInventory, localYaw, Machine, nearestAngle, needlesPickedUp, num, obj,
  RateGate, returnStrandedNeedles,
} from './shared';

/** Seconds between re-targeting the densest hay spot in radius. */
const RETARGET_INTERVAL = 0.25;
/** Radius (m) sucked around the nozzle's current spot. */
const NOZZLE_RADIUS = 0.9;
/** Nozzle follow / suction intensity time constants (s). */
const NOZZLE_TAU = 0.18;
const SUCK_TAU = 0.3;
/** Fan speed (rad/s) at full suction. */
const FAN_SPEED = 14;

/**
 * Vacuum Collector: every RETARGET_INTERVAL it picks the densest hay spot within `collector.radius`
 * (nozzle anim follows) and sucks `collector.rate` hay/s (x speed factor) from around it into its
 * buffer (`collector.buffer`), which unloads through its port at `collector.outputRate`.
 * Power 50 x `collector.powerMul`. Buffer full -> outputBlocked; nothing in radius -> noHay.
 * Manual E takes hay from the buffer. anim: spin, nozzleYaw, nozzleDist, suck, fill, industrial.
 */
export class VacuumCollector extends Machine {
  private readonly buffer = new Inventory();
  private readonly gate = new RateGate();
  private retarget = 0;
  private hasTarget = false;
  private tx = 0; private tz = 0;
  /** Target nozzle pose (local yaw, horizontal distance). */
  private tYaw = 0; private tDist = 0;
  private noHay = false;
  /** Seconds since the last suction that removed hay (drives flush of partial packets). */
  private idleFor = 0;

  constructor(init: BuildingInit) {
    super(init);
    const r = this.minRadius();
    this.tDist = r;
    this.anim.spin = 0;
    this.anim.nozzleYaw = 0;
    this.anim.nozzleDist = r;
    this.anim.suck = 0;
    this.anim.fill = 0;
    this.anim.industrial = 0;
  }

  /** The machine body covers the centre; the nozzle never targets inside the footprint. */
  private minRadius(): number { return Math.min(this.def.footprint[0], this.def.footprint[1]) * 0.5; }

  override powerDraw(ctx: SimContext): number { return super.powerDraw(ctx) * ctx.stat('collector.powerMul'); }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    const cap = ctx.stat('collector.buffer');
    this.anim.industrial = ctx.stat('collector.industrial') >= 1 ? 1 : 0;
    returnStrandedNeedles(ctx, this.buffer, this.cx, this.cz);
    let sucked = 0;
    let wanted = 0;

    if (this.powerGate(ctx)) {
      const sf = this.speedFactor(ctx);
      // Unload first so the buffer frees space for this tick's suction.
      this.gate.blocked = false;
      this.gate.refill(ctx.stat('collector.outputRate') * sf, dt);
      const flush = this.noHay || this.idleFor > RETARGET_INTERVAL;
      for (let i = 0; i < this.outIdx.length; i++) {
        const port = this.outIdx[i];
        if (ctx.logistics.isLinked(this, port)) this.pushPackets(ctx, port, this.buffer, 'hay', this.gate, flush);
      }
      this.gate.settle(dt);

      const free = cap - this.buffer.hay;
      this.retarget = Math.max(0, this.retarget - dt); // <= 0 means "look for a spot now"
      if (free > FILL_EPS && (this.retarget <= 0 || (!this.hasTarget && !this.noHay))) {
        this.retarget = RETARGET_INTERVAL;
        this.findSpot(ctx);
      }
      if (free > FILL_EPS && this.hasTarget) {
        wanted = Math.min(ctx.stat('collector.rate') * sf * dt, free);
        const ex = ctx.hay.extractRadius(this.tx, this.tz, NOZZLE_RADIUS, wanted);
        if (ex.needles.length) { this.buffer.add('hay', 0, ex.needles); needlesPickedUp(ctx, ex.needles, this); }
        if (ex.units > EPS) {
          sucked = ex.units;
          this.buffer.add('hay', ex.units);
          this.rateIn.add(ex.units);
          ctx.creditExtraction(ex.units, 'collector', ex.pos);
        } else {
          // Spot exhausted: look for another one next tick.
          this.hasTarget = false;
        }
      }
      this.idleFor = sucked > EPS ? 0 : this.idleFor + dt;

      if (cap - this.buffer.hay <= FILL_EPS) this.setStatus('outputBlocked', ctx);
      else if (this.noHay) this.setStatus('noHay', ctx);
      else this.setWorking(ctx);
    } else {
      this.gate.blocked = false;
      this.gate.settle(dt);
    }

    const a = this.anim;
    a.suck = approach(a.suck, wanted > EPS ? Math.min(1, sucked / wanted) : 0, dt, SUCK_TAU);
    a.spin += dt * FAN_SPEED * a.suck;
    a.nozzleYaw = approach(a.nozzleYaw, nearestAngle(a.nozzleYaw, this.tYaw), dt, NOZZLE_TAU);
    a.nozzleDist = approach(a.nozzleDist, this.tDist, dt, NOZZLE_TAU);
    a.fill = cap > 0 ? Math.min(1, this.buffer.hay / cap) : 0;
  }

  private findSpot(ctx: SimContext): void {
    const radius = ctx.stat('collector.radius');
    const minR = this.minRadius();
    const t = radius > minR ? ctx.hay.findTarget(this.cx, this.cz, radius, 'densest', minR) : null;
    if (!t) { this.hasTarget = false; this.noHay = true; return; }
    this.noHay = false;
    this.hasTarget = true;
    this.tx = t.x;
    this.tz = t.z;
    const dx = t.x - this.cx;
    const dz = t.z - this.cz;
    this.tYaw = localYaw(dx, dz, this.rot);
    this.tDist = Math.max(minR, Math.min(radius, Math.hypot(dx, dz)));
  }

  override interaction(ctx: SimContext): InteractionOption {
    return takeHayOption(ctx, this.buffer, 'Buffer is empty');
  }

  override interact(ctx: SimContext): boolean {
    this.prepare();
    return playerTakesHay(ctx, this.buffer, this, this.centre) > 0;
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'outputBlocked': return 'Output blocked - connect a belt or empty the buffer (E)';
      case 'noHay': return 'No hay in reach - move it closer to the stack';
      default:
        return this.anyOutputLinked(ctx)
          ? `Collecting ${fmtRate(this.rateIn.value)}`
          : 'Collecting into its buffer - connect a belt to the output';
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const cap = ctx.stat('collector.buffer');
    lines.push({ label: 'Suction', value: `${fmtRate(this.rateIn.value)} (max ${fmtInt(ctx.stat('collector.rate'))})` });
    lines.push({ label: 'Output', value: fmtRate(this.rateOut.value) });
    lines.push({ label: 'Buffer', value: `${fmtInt(this.buffer.hay)} / ${fmtInt(cap)}`, tone: this.buffer.hay >= cap - FILL_EPS ? 'warn' : undefined });
    lines.push({ label: 'Radius', value: `${fmtNum(ctx.stat('collector.radius'))} m` });
  }

  override contents(): Inventory { return this.buffer; }
  override clearContents(): void { this.buffer.clear(); }

  override saveState(): unknown {
    return {
      buffer: this.buffer.toJSON(), credit: this.gate.credit, retarget: this.retarget, hasTarget: this.hasTarget,
      target: [this.tx, this.tz, this.tYaw, this.tDist], noHay: this.noHay, idleFor: Math.min(this.idleFor, 60),
      pose: [this.anim.spin, this.anim.nozzleYaw, this.anim.nozzleDist],
    };
  }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    this.buffer.clear();
    loadInventory(o.buffer).moveAllTo(this.buffer);
    this.gate.reset();
    this.gate.credit = num(o.credit, 0, 0);
    this.retarget = num(o.retarget, 0, 0);
    this.hasTarget = o.hasTarget === true;
    const t = Array.isArray(o.target) ? o.target : [];
    this.tx = num(t[0], this.cx); this.tz = num(t[1], this.cz); this.tYaw = num(t[2], 0); this.tDist = num(t[3], this.minRadius(), 0);
    this.noHay = o.noHay === true;
    this.idleFor = num(o.idleFor, 0, 0);
    const p = Array.isArray(o.pose) ? o.pose : [];
    this.anim.spin = num(p[0], 0);
    this.anim.nozzleYaw = num(p[1], 0);
    this.anim.nozzleDist = num(p[2], this.minRadius(), 0);
  }
}
