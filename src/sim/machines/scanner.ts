import { BALANCE } from '../../config/balance';
import type { BuildingInit, InfoLine, InteractionOption } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import type { ItemPacket } from '../types';
import { playerAmount, takeFromPlayer } from './playerTransfer';
import { approach, BLOCKED_GRACE, EPS, fmtInt, fmtRate, itemLabel, Machine, num, obj, PacketQueue } from './shared';

/** Activity light time constant (s). */
const ACTIVE_TAU = 0.3;
/** Scanning pauses while a lane's output queue holds more than this many batches. */
const OUTPUT_BATCHES = 2;

/** One scanning lane: input queue -> scan cycle -> output queue (packets keep their identity). */
class ScanLane {
  readonly input = new PacketQueue();
  readonly output = new PacketQueue();
  /** Progress of the current scan cycle (0..1). */
  timer = 0;
  /** Alternates each cycle so the beam sweeps back and forth (continuous anim). */
  parity = 0;
  /** Seconds the output has been unable to drain while scanning is paused. */
  blockedFor = 0;
  working = false;

  clear(): void { this.input.clear(); this.output.clear(); this.timer = 0; this.blockedFor = 0; this.working = false; }
}

/**
 * Needle scanners. Packets from the input buffer are scanned in batches (`batch` hay per `cycle`),
 * marked `scanned`, and queued to the output, which drains to the out port as fast as it accepts.
 * A hidden needle is detected deterministically (`ctx.needleDetected`). Without auto-eject the
 * scanner raises an alarm and stops for `scanner.alarmTime` s. Lane i uses ports 2i (in) and 2i+1 (out).
 */
abstract class Scanner extends Machine {
  protected readonly lanes: ScanLane[];
  /** Seconds of needle alarm left. */
  protected alarm = 0;
  /** Needles detected by this scanner (tray, purely visual). */
  protected needles = 0;

  constructor(init: BuildingInit, laneSlots: number) {
    super(init);
    this.lanes = [];
    for (let i = 0; i < laneSlots; i++) this.lanes.push(new ScanLane());
    this.anim.scan = 0;
    this.anim.active = 0;
    this.anim.alarm = 0;
    this.anim.needles = 0;
    this.anim.fill = 0;
  }

  protected abstract batch(ctx: SimContext): number;
  protected abstract cycle(ctx: SimContext): number;
  protected abstract bufferCap(ctx: SimContext): number;
  protected abstract autoEject(ctx: SimContext): boolean;

  /** Lane i exists when both of its ports are present (lane B of the MK2 needs Dual Lane Scan). */
  protected laneActive(i: number): boolean {
    return i < this.lanes.length && this.inIdx.includes(i * 2) && this.outIdx.includes(i * 2 + 1);
  }

  protected activeLanes(): number {
    let n = 0;
    for (let i = 0; i < this.lanes.length; i++) if (this.laneActive(i)) n++;
    return n;
  }

  override canAccept(item: ItemPacket, port: number, ctx: SimContext): boolean {
    if (item.type !== 'hay' || item.amount <= 0 || !this.inPortAccepts(port, 'hay')) return false;
    this.prepare();
    const li = port >> 1;
    const lane = this.lanes[li];
    if (!lane || !this.laneActive(li)) return false;
    return lane.input.length === 0 || lane.input.total + item.amount <= this.bufferCap(ctx) + EPS;
  }

  override accept(item: ItemPacket, port: number, _ctx: SimContext): void {
    this.lanes[port >> 1].input.push(item);
    this.rateIn.add(item.amount);
  }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    if (this.alarm > 0) this.alarm = Math.max(0, this.alarm - dt);
    const powered = this.powerGate(ctx);
    const running = powered && this.alarm <= 0;
    let anyBlocked = false;
    let anyWork = false;

    if (running) {
      const sf = this.speedFactor(ctx);
      const batch = this.batch(ctx);
      const cyc = Math.max(0.01, this.cycle(ctx));
      for (let i = 0; i < this.lanes.length; i++) {
        const lane = this.lanes[i];
        lane.working = false;
        if (!this.laneActive(i)) continue;
        const pushed = this.drain(ctx, lane, i * 2 + 1);
        const paused = lane.output.total > OUTPUT_BATCHES * batch;
        if (!paused && lane.input.length > 0) {
          lane.working = true;
          lane.timer += (dt * sf) / cyc;
          if (lane.timer >= 1) {
            lane.timer = Math.min(lane.timer - 1, 0.999);
            lane.parity ^= 1;
            this.scanBatch(ctx, lane, batch);
            if (this.alarm > 0) break;
          }
        }
        lane.blockedFor = paused && !pushed ? lane.blockedFor + dt : 0;
        const linked = ctx.logistics.isLinked(this, i * 2 + 1);
        if (paused && (!linked || lane.blockedFor >= BLOCKED_GRACE)) anyBlocked = true;
        if (lane.working || lane.output.length > 0 || lane.input.length > 0) anyWork = true;
      }
    } else {
      for (let i = 0; i < this.lanes.length; i++) this.lanes[i].working = false;
    }

    if (powered) {
      if (this.alarm > 0) this.setStatus('needleAlarm', ctx);
      else if (anyBlocked) this.setStatus('outputBlocked', ctx);
      else if (!anyWork) this.setStatus('noInput', ctx);
      else this.setWorking(ctx);
    }
    this.writeAnim(ctx, dt);
  }

  /** Output queue -> out port, as fast as the port accepts. Returns true if anything left. */
  private drain(ctx: SimContext, lane: ScanLane, port: number): boolean {
    let any = false;
    while (lane.output.length > 0) {
      const p = lane.output.peek();
      if (!p || !ctx.logistics.canPushOut(this, port, p)) break;
      lane.output.shift();
      if (!ctx.logistics.pushOut(this, port, p)) { lane.output.push(p); break; }
      this.rateOut.add(p.amount);
      any = true;
    }
    return any;
  }

  private scanBatch(ctx: SimContext, lane: ScanLane, batch: number): void {
    let moved = 0;
    while (lane.input.length > 0) {
      const p = lane.input.peek();
      if (!p || (moved > 0 && moved + p.amount > batch + EPS)) break;
      lane.input.shift();
      moved += p.amount;
      if (p.needleId !== undefined) {
        const id = p.needleId;
        delete p.needleId;
        this.needles++;
        ctx.needleDetected(id, this.id, this.posCopy());
        if (!this.autoEject(ctx)) {
          this.alarm = ctx.stat('scanner.alarmTime');
          this.setStatus('needleAlarm', ctx);
          ctx.events.emit('scanner:alarm', { id: this.id, pos: this.posCopy(), needleId: id });
        }
      }
      p.scanned = true;
      lane.output.push(p);
    }
    if (moved <= 0) return;
    ctx.progress.stats.hayScanned += moved;
    ctx.events.emit('machine:cycle', { id: this.id, type: this.type, pos: this.posCopy() });
  }

  protected writeAnim(ctx: SimContext, dt: number): void {
    const a = this.anim;
    let lane: ScanLane | null = null;
    let working = false;
    let fill = 0;
    let lanes = 0;
    const cap = this.bufferCap(ctx);
    for (let i = 0; i < this.lanes.length; i++) {
      if (!this.laneActive(i)) continue;
      const l = this.lanes[i];
      lanes++;
      fill += cap > 0 ? Math.min(1, l.input.total / cap) : 0;
      if (!lane || (!lane.working && l.working)) lane = l;
      if (l.working) working = true;
    }
    if (lane) a.scan = lane.parity ? 1 - lane.timer : lane.timer;
    a.active = approach(a.active, working ? 1 : 0, dt, ACTIVE_TAU);
    a.alarm = this.alarm > 0 ? 1 : 0;
    a.needles = this.needles;
    a.fill = lanes > 0 ? fill / lanes : 0;
  }

  // ----- manual deposit -------------------------------------------------------------------

  /** Free input buffer over all active lanes (hay). */
  private freeSpace(ctx: SimContext): number {
    const cap = this.bufferCap(ctx);
    let free = 0;
    for (let i = 0; i < this.lanes.length; i++) if (this.laneActive(i)) free += Math.max(0, cap - this.lanes[i].input.total);
    return free;
  }

  override interaction(ctx: SimContext): InteractionOption {
    this.prepare();
    const hay = playerAmount(ctx, 'hay');
    if (hay <= EPS) return { kind: 'deposit', label: 'Deposit hay', enabled: false, reason: 'Carrying no hay' };
    const n = Math.min(hay, this.freeSpace(ctx));
    if (n <= EPS) return { kind: 'deposit', label: `Deposit ${itemLabel('hay', Math.max(1, hay))}`, enabled: false, reason: 'Scanner buffer is full' };
    return { kind: 'deposit', label: `Deposit ${itemLabel('hay', Math.max(1, n))}`, enabled: true };
  }

  private readonly carried: number[] = [];

  override interact(ctx: SimContext): boolean {
    this.prepare();
    const want = Math.min(playerAmount(ctx, 'hay'), this.freeSpace(ctx));
    if (want <= EPS) return false;
    this.carried.length = 0;
    const got = takeFromPlayer(ctx, 'hay', want, this.carried);
    if (got <= EPS) return false;
    const cap = this.bufferCap(ctx);
    let left = got;
    for (let i = 0; i < this.lanes.length && left > EPS; i++) {
      if (!this.laneActive(i)) continue;
      const lane = this.lanes[i];
      let room = Math.max(0, cap - lane.input.total);
      while (room > EPS && left > EPS) {
        const amount = Math.min(BALANCE.hayPacketSize, room, left);
        const p: ItemPacket = { type: 'hay', amount };
        const id = this.carried.pop();
        if (id !== undefined) p.needleId = id;
        lane.input.push(p);
        room -= amount;
        left -= amount;
      }
    }
    // Rounding leftovers (never more than EPS) and any needle without a packet ride in the last lane.
    if (this.carried.length || left > EPS) {
      const lane = this.lanes[0];
      for (const id of this.carried) lane.input.push({ type: 'hay', amount: Math.max(left, EPS), needleId: id });
      this.carried.length = 0;
    }
    this.rateIn.add(got);
    ctx.events.emit('player:deposit', { targetId: this.id, type: this.type, amount: got, pos: this.posCopy() });
    return true;
  }

  // ----- status / info ---------------------------------------------------------------------

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'needleAlarm':
        return this.autoEject(ctx)
          ? 'Needle found!'
          : `Needle found! Line stopped for ${Math.ceil(this.alarm)} s - Auto Needle Eject keeps it running`;
      case 'outputBlocked': return 'Output blocked - connect a belt to the output';
      case 'noInput': return 'Waiting for hay - feed it by belt or deposit hay (E)';
      default: return `Scanning ${fmtRate(this.rateOut.value)} - never misses a needle`;
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    const lanes = Math.max(1, this.activeLanes());
    const max = (this.batch(ctx) / Math.max(0.01, this.cycle(ctx))) * lanes * ctx.stat('global.machineSpeed');
    const cap = this.bufferCap(ctx);
    let stored = 0;
    for (let i = 0; i < this.lanes.length; i++) if (this.laneActive(i)) stored += this.lanes[i].input.total;
    lines.push({ label: 'Scanning', value: `${fmtRate(this.rateOut.value)} (max ${fmtInt(max)})` });
    lines.push({ label: 'Buffer', value: `${fmtInt(stored)} / ${fmtInt(cap * lanes)}` });
    lines.push({ label: 'Needles found', value: fmtInt(this.needles), tone: this.needles > 0 ? 'good' : undefined });
    this.extraLines(ctx, lines);
  }

  protected abstract extraLines(ctx: SimContext, lines: InfoLine[]): void;

  override contents(): Inventory {
    const inv = new Inventory();
    for (const l of this.lanes) { l.input.addTo(inv); l.output.addTo(inv); }
    return inv;
  }

  override clearContents(): void { for (const l of this.lanes) l.clear(); }

  override saveState(): unknown {
    return {
      lanes: this.lanes.map((l) => ({ input: l.input.toJSON(), output: l.output.toJSON(), timer: l.timer, parity: l.parity })),
      alarm: this.alarm, needles: this.needles,
    };
  }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    const lanes = Array.isArray(o.lanes) ? o.lanes : [];
    for (let i = 0; i < this.lanes.length; i++) {
      const l = this.lanes[i];
      const s = obj(lanes[i]);
      l.clear();
      l.input.load(s.input);
      l.output.load(s.output);
      l.timer = Math.min(1, num(s.timer, 0, 0)); // a saved timer is < 1; 1 just scans on the next tick
      l.parity = s.parity === 1 ? 1 : 0;
    }
    this.alarm = num(o.alarm, 0, 0);
    this.needles = Math.floor(num(o.needles, 0, 0));
    this.anim.needles = this.needles;
  }
}

/** Needle Scanner MK1: one lane, stops on detection unless Auto Needle Eject is unlocked. */
export class ScannerMk1 extends Scanner {
  constructor(init: BuildingInit) { super(init, 1); }
  protected batch(ctx: SimContext): number { return ctx.stat('scanner.batch'); }
  protected cycle(ctx: SimContext): number { return ctx.stat('scanner.cycle'); }
  protected bufferCap(ctx: SimContext): number { return ctx.stat('scanner.buffer'); }
  protected autoEject(ctx: SimContext): boolean { return ctx.stat('scanner.autoEject') >= 1; }
  protected extraLines(ctx: SimContext, lines: InfoLine[]): void {
    lines.push({ label: 'Auto eject', value: this.autoEject(ctx) ? 'On' : 'Off - stops on each needle', tone: this.autoEject(ctx) ? 'good' : undefined });
  }
}

/** Needle Scanner MK2: faster, always auto-ejects; a second lane with Dual Lane Scan. anim.lanes. */
export class ScannerMk2 extends Scanner {
  constructor(init: BuildingInit) {
    super(init, 2);
    this.anim.lanes = 1;
  }
  protected batch(ctx: SimContext): number { return ctx.stat('scanner2.batch'); }
  protected cycle(ctx: SimContext): number { return ctx.stat('scanner2.cycle') / Math.max(0.01, ctx.stat('scanner2.speedMul')); }
  protected bufferCap(ctx: SimContext): number { return ctx.stat('scanner2.buffer'); }
  protected autoEject(_ctx: SimContext): boolean { return true; }
  protected override writeAnim(ctx: SimContext, dt: number): void {
    super.writeAnim(ctx, dt);
    this.anim.lanes = Math.max(1, this.activeLanes());
  }
  protected extraLines(_ctx: SimContext, lines: InfoLine[]): void {
    lines.push({ label: 'Lanes', value: this.activeLanes() >= 2 ? '2 (dual lane)' : '1' });
  }
}
