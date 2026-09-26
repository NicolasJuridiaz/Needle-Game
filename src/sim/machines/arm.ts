import type { BuildingInit, InfoLine } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import {
  approach, BLOCKED_GRACE, EPS, ease, fmtInt, fmtNum, fmtRate, lerp, loadInventory, localYaw, Machine,
  nearestAngle, needlesPickedUp, num, obj, packetAmount, returnStrandedNeedles, smoothstep,
} from './shared';

/** Arm states. GRAB is instantaneous at the end of REACH. */
const S_IDLE = 0;
const S_ROT_TARGET = 1;
const S_REACH = 2;
const S_LIFT = 3;
const S_ROT_DROP = 4;
const S_RELEASE = 5;

/** Base durations (s) of the vertical moves (divided by `arm.speed` and by the power speed factor). */
const REACH_TIME = 0.35;
const LIFT_TIME = 0.3;
/** Radius (m) of the grab around the target cell. */
const GRAB_RADIUS = 0.45;
/**
 * When the claw comes back less than this full (thin hay at the edge of the pile), it scoops the
 * remainder from a wider disc (GRAB_WIDE_RADIUS) around the same spot, so a grab is ~`arm.grab`.
 */
const GRAB_FILL = 0.75;
const GRAB_WIDE_RADIUS = 0.9;
/** Closest target (m) from the pedestal axis. */
const MIN_TARGET_RADIUS = 0.8;
/**
 * With nothing linked at the drop point the hay is dumped on the floor in front; targets closer than
 * this (drop point + spread of the dumped heap) are ignored so the arm never re-grabs its own heap.
 */
const UNLINKED_MIN_RADIUS = 2.3;
/** Claw heights (m above the arm's floor) while travelling / when dropping / at most. */
const TRAVEL_HEIGHT = 2.2;
const DROP_HEIGHT = 1.3;
const MAX_CLAW_HEIGHT = 4;
/** Seconds between target searches while nothing is in reach. */
const RETRY_INTERVAL = 0.5;
/** Grip opening time constant (s) while idle. */
const GRIP_TAU = 0.15;
const DEG = Math.PI / 180;

/**
 * Robotic Arm: 1x1 pedestal that grabs hay within `arm.reach` and drops it on its front cell.
 * IDLE -> pick target (hay.findTarget, nearest or densest with `arm.smart`) -> ROTATE (shortest way at
 * `arm.rotSpeed` deg/s) -> REACH/LOWER -> GRAB (hay.extractRadius, `arm.grab x arm.throughputMul`) ->
 * LIFT -> ROTATE back to the drop yaw (local 0) -> RELEASE: packets through port 0 when linked
 * (waits while blocked - hay is never lost), otherwise `hay.deposit` on the floor at the drop point.
 * Timings are divided by the speed factor (power satisfaction x global machine speed).
 *
 * Yaw conversion (anim.yaw is LOCAL): world yaw of a direction (dx,dz) is atan2(-dz, dx) (three.js:
 * positive rotation about +Y turns +X towards -Z); a building with rot r faces world yaw -r*PI/2,
 * so local yaw = atan2(-dz, dx) + r*PI/2 (see `localYaw`). anim.yaw is kept continuous (never
 * wrapped) so interpolation between samples never spins the long way round.
 * anim: yaw, dist, height, grip, load, mk2.
 */
export class RoboticArm extends Machine {
  /** Hay in the claw (with any hidden needles it grabbed). */
  private readonly load = new Inventory();
  private state = S_IDLE;
  /** Progress 0..1 of the current state. */
  private prog = 0;
  /** Duration (s at speed factor 1) of the current state; 0 = instant. */
  private dur = 0;
  // Pose at the start / end of the current move.
  private sYaw = 0; private sDist = 0; private sH = 0; private sGrip = 0;
  private eYaw = 0; private eDist = 0; private eH = 0; private eGrip = 0;
  // Current target.
  private tx = 0; private tz = 0; private grabH = 0;
  /** Claw capacity at the time of the grab (for anim.load). */
  private loadCap = 1;
  private retry = 0;
  private noHay = false;
  private blockedFor = 0;

  constructor(init: BuildingInit) {
    super(init);
    this.anim.yaw = 0;
    this.anim.dist = this.dropDist();
    this.anim.height = TRAVEL_HEIGHT;
    this.anim.grip = 0;
    this.anim.load = 0;
    this.anim.mk2 = 0;
  }

  /** Horizontal distance of the drop point (centre of the front cell) from the pedestal axis. */
  private dropDist(): number { return this.def.footprint[0] * 0.5 + 0.5; }
  private dropX(): number { return this.cx + this.fx * this.dropDist(); }
  private dropZ(): number { return this.cz + this.fz * this.dropDist(); }

  override tick(dt: number, ctx: SimContext): void {
    this.prepare();
    this.anim.mk2 = ctx.stat('arm.mk2') >= 1 ? 1 : 0;
    returnStrandedNeedles(ctx, this.load, this.dropX(), this.dropZ());
    if (!this.powerGate(ctx)) return;

    let t = dt * this.speedFactor(ctx);
    let blocked = false;
    for (let guard = 0; guard < 8 && t > 0; guard++) {
      if (this.state === S_IDLE) {
        this.anim.grip = approach(this.anim.grip, 0, dt, GRIP_TAU);
        if (this.retry > 0) { this.retry -= dt; break; }
        if (!this.pickTarget(ctx)) { this.noHay = true; this.retry = RETRY_INTERVAL; break; }
        this.noHay = false;
        continue;
      }
      if (this.state === S_RELEASE) {
        if (this.release(ctx)) { this.state = S_IDLE; this.prog = 0; continue; }
        blocked = true;
        break;
      }
      const need = (1 - this.prog) * this.dur;
      if (this.dur <= 0 || t >= need) {
        t -= Math.max(0, need);
        this.prog = 1;
        this.writePose();
        this.finishState(ctx);
      } else {
        this.prog += t / this.dur;
        t = 0;
        this.writePose();
      }
    }

    this.blockedFor = blocked ? this.blockedFor + dt : 0;
    if (this.blockedFor >= BLOCKED_GRACE) this.setStatus('outputBlocked', ctx);
    else if (this.noHay && this.state === S_IDLE) this.setStatus('noHay', ctx);
    else this.setWorking(ctx);
  }

  /** Choose the next hay target and start rotating towards it. */
  private pickTarget(ctx: SimContext): boolean {
    const reach = ctx.stat('arm.reach');
    const minR = ctx.logistics.isLinked(this, 0) ? MIN_TARGET_RADIUS : UNLINKED_MIN_RADIUS;
    if (reach < minR) return false;
    const target = ctx.hay.findTarget(this.cx, this.cz, reach, ctx.stat('arm.smart') >= 1 ? 'densest' : 'nearest', minR);
    if (!target) return false;
    const dx = target.x - this.cx;
    const dz = target.z - this.cz;
    const dist = Math.min(reach, Math.max(MIN_TARGET_RADIUS, Math.hypot(dx, dz)));
    this.tx = target.x;
    this.tz = target.z;
    this.grabH = Math.min(MAX_CLAW_HEIGHT, Math.max(0, target.height - this.cy));
    const yaw = nearestAngle(this.anim.yaw, localYaw(dx, dz, this.rot));
    this.begin(S_ROT_TARGET, this.rotationTime(ctx, yaw), yaw, dist, Math.max(TRAVEL_HEIGHT, this.grabH), 0);
    return true;
  }

  private rotationTime(ctx: SimContext, toYaw: number): number {
    const speed = Math.max(1, ctx.stat('arm.rotSpeed')) * DEG;
    return Math.abs(toYaw - this.anim.yaw) / speed;
  }

  private begin(state: number, dur: number, yaw: number, dist: number, h: number, grip: number): void {
    this.state = state;
    this.prog = 0;
    this.dur = dur;
    this.sYaw = this.anim.yaw; this.sDist = this.anim.dist; this.sH = this.anim.height; this.sGrip = this.anim.grip;
    this.eYaw = yaw; this.eDist = dist; this.eH = h; this.eGrip = grip;
  }

  /** Writes the interpolated pose for the current state/progress. */
  private writePose(): void {
    const p = this.prog;
    const e = ease(p);
    const a = this.anim;
    a.yaw = lerp(this.sYaw, this.eYaw, e);
    a.dist = lerp(this.sDist, this.eDist, e);
    a.height = lerp(this.sH, this.eH, e);
    // The claw closes in the last part of the descent, and opens while swinging away after a drop.
    a.grip = this.state === S_REACH ? lerp(this.sGrip, this.eGrip, smoothstep(0.6, 1, p)) : lerp(this.sGrip, this.eGrip, e);
    a.load = this.load.hay > EPS ? Math.min(1, this.load.hay / this.loadCap) : 0;
  }

  private finishState(ctx: SimContext): void {
    const speed = Math.max(0.01, ctx.stat('arm.speed'));
    switch (this.state) {
      case S_ROT_TARGET:
        this.begin(S_REACH, REACH_TIME / speed, this.eYaw, this.eDist, this.grabH, 1);
        break;
      case S_REACH: {
        this.grab(ctx);
        this.begin(S_LIFT, LIFT_TIME / speed, this.eYaw, this.eDist, Math.max(TRAVEL_HEIGHT, this.grabH), this.load.hay > EPS ? 1 : 0);
        break;
      }
      case S_LIFT:
        if (this.load.hay > EPS || this.load.needles.length) {
          const yaw = nearestAngle(this.anim.yaw, 0);
          this.begin(S_ROT_DROP, this.rotationTime(ctx, yaw), yaw, this.dropDist(), DROP_HEIGHT, 1);
        } else {
          this.state = S_IDLE;
          this.prog = 0;
        }
        break;
      case S_ROT_DROP:
        this.state = S_RELEASE;
        this.prog = 0;
        break;
      default:
        this.state = S_IDLE;
        this.prog = 0;
    }
  }

  private grab(ctx: SimContext): void {
    const cap = Math.max(0, ctx.stat('arm.grab') * ctx.stat('arm.throughputMul'));
    this.loadCap = Math.max(1, cap);
    if (cap <= EPS) return;
    this.scoop(ctx, GRAB_RADIUS, cap);
    if (this.load.hay < cap * GRAB_FILL) this.scoop(ctx, GRAB_WIDE_RADIUS, cap - this.load.hay);
  }

  private scoop(ctx: SimContext, radius: number, max: number): void {
    if (max <= EPS) return;
    const ex = ctx.hay.extractRadius(this.tx, this.tz, radius, max);
    if (ex.needles.length) { this.load.add('hay', 0, ex.needles); needlesPickedUp(ctx, ex.needles, this); }
    if (ex.units > EPS) {
      this.load.add('hay', ex.units);
      this.rateIn.add(ex.units);
      ctx.creditExtraction(ex.units, 'arm', ex.pos);
    }
  }

  /** Drop the claw's load. Returns true when the claw is empty. */
  private release(ctx: SimContext): boolean {
    const had = this.load.hay;
    if (ctx.logistics.isLinked(this, 0)) {
      while (this.load.hay > EPS) {
        const amt = packetAmount(this.load, 'hay');
        this.probe.type = 'hay'; this.probe.amount = amt;
        if (!ctx.logistics.canPushOut(this, 0, this.probe)) break;
        const p = this.load.takePacket('hay', amt);
        if (!p) break;
        if (!ctx.logistics.pushOut(this, 0, p)) { this.load.addPacket(p); break; }
        this.rateOut.add(p.amount);
      }
    } else if (had > EPS || this.load.needles.length) {
      const x = this.dropX(), z = this.dropZ();
      ctx.hay.deposit(x, z, had, this.load.needles.length ? this.load.needles.slice() : undefined);
      this.rateOut.add(had);
      this.load.clear();
      ctx.events.emit('hay:deposited', { amount: had, pos: { x, y: this.cy, z } });
    }
    this.anim.load = this.load.hay > EPS ? Math.min(1, this.load.hay / this.loadCap) : 0;
    if (this.load.hay > EPS) return false;
    this.load.clear();
    if (had > EPS) ctx.events.emit('machine:cycle', { id: this.id, type: this.type, pos: this.posCopy() });
    return true;
  }

  protected override describeStatus(ctx: SimContext): string {
    switch (this.status) {
      case 'outputBlocked': return 'Output blocked - the belt or hopper at the drop point is full';
      case 'noHay': return 'No hay in reach - move it closer to the stack';
      default:
        return ctx.logistics.isLinked(this, 0)
          ? `Moving ${fmtRate(this.rateOut.value)}`
          : 'Dropping hay on the floor - place a belt or hopper at the drop point';
    }
  }

  protected override infoLines(ctx: SimContext, lines: InfoLine[]): void {
    lines.push({ label: 'Output', value: fmtRate(this.rateOut.value) });
    lines.push({ label: 'Grab', value: `${fmtInt(ctx.stat('arm.grab') * ctx.stat('arm.throughputMul'))} hay per swing` });
    lines.push({ label: 'Reach', value: `${fmtNum(ctx.stat('arm.reach'))} m` });
    lines.push({ label: 'Targeting', value: ctx.stat('arm.smart') >= 1 ? 'Densest hay (smart)' : 'Nearest hay' });
    lines.push({ label: 'Drop point', value: ctx.logistics.isLinked(this, 0) ? 'Connected' : 'Floor (not connected)', tone: ctx.logistics.isLinked(this, 0) ? 'good' : 'warn' });
  }

  override contents(): Inventory { return this.load; }
  override clearContents(): void { this.load.clear(); this.anim.load = 0; }

  override saveState(): unknown {
    const a = this.anim;
    return {
      state: this.state, prog: this.prog, dur: this.dur,
      s: [this.sYaw, this.sDist, this.sH, this.sGrip], e: [this.eYaw, this.eDist, this.eH, this.eGrip],
      target: [this.tx, this.tz, this.grabH], loadCap: this.loadCap, load: this.load.toJSON(),
      retry: this.retry, noHay: this.noHay, blockedFor: this.blockedFor,
      pose: [a.yaw, a.dist, a.height, a.grip],
    };
  }

  override loadState(raw: unknown): void {
    const o = obj(raw);
    const st = Math.floor(num(o.state, S_IDLE, 0));
    this.state = st >= S_IDLE && st <= S_RELEASE ? st : S_IDLE;
    this.prog = Math.min(1, num(o.prog, 0, 0));
    this.dur = num(o.dur, 0, 0);
    const v = (a: unknown, i: number, d: number): number => (Array.isArray(a) ? num(a[i], d) : d);
    this.sYaw = v(o.s, 0, 0); this.sDist = v(o.s, 1, this.dropDist()); this.sH = v(o.s, 2, TRAVEL_HEIGHT); this.sGrip = v(o.s, 3, 0);
    this.eYaw = v(o.e, 0, 0); this.eDist = v(o.e, 1, this.dropDist()); this.eH = v(o.e, 2, TRAVEL_HEIGHT); this.eGrip = v(o.e, 3, 0);
    this.tx = v(o.target, 0, 0); this.tz = v(o.target, 1, 0); this.grabH = v(o.target, 2, 0);
    this.loadCap = Math.max(1, num(o.loadCap, 1));
    this.load.clear();
    loadInventory(o.load).moveAllTo(this.load);
    this.retry = num(o.retry, 0, 0);
    this.noHay = o.noHay === true;
    this.blockedFor = num(o.blockedFor, 0, 0);
    this.anim.yaw = v(o.pose, 0, 0);
    this.anim.dist = v(o.pose, 1, this.dropDist());
    this.anim.height = v(o.pose, 2, TRAVEL_HEIGHT);
    this.anim.grip = v(o.pose, 3, 0);
    this.anim.load = this.load.hay > EPS ? Math.min(1, this.load.hay / this.loadCap) : 0;
  }
}
