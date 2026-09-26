import { BALANCE } from '../../config/balance';
import { Building, type BuildingInfo, type InfoLine } from '../building';
import type { SimContext } from '../interfaces';
import { Inventory } from '../inventory';
import type { Sim } from '../sim';
import { DIR_DX, DIR_DZ, type ItemPacket, type ItemType, type Vec3, type WorldPort } from '../types';

/**
 * Shared machine infrastructure: the `Machine` base class (cached geometry, port index lists,
 * status texts, info tooltip assembly, rate-limited packet output) and small helpers used by
 * every machine family. Pure simulation code: no three.js, no DOM.
 */

export const EPS = 1e-6;
/**
 * A store filled from the hay field counts as full within this many hay units: extraction works on float32
 * heights, so a scoop sized to the free space can land ~1e-5 short of it (and a smaller scoop removes nothing).
 */
export const FILL_EPS = 1e-3;
const TWO_PI = Math.PI * 2;

/** Seconds a machine must fail to push before its status turns to 'outputBlocked' (avoids flicker on belt spacing waits). */
export const BLOCKED_GRACE = 0.5;

// =====================================================================================
// Math helpers
// =====================================================================================

export function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Ease-in-out on [0,1]. */
export function ease(t: number): number { return smoothstep(0, 1, t); }

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Exponential approach of `cur` towards `target` with time constant `tau` (frame-rate independent). */
export function approach(cur: number, target: number, dt: number, tau: number): number {
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Wraps an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  let r = a % TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  else if (r > Math.PI) r -= TWO_PI;
  return r;
}

/** Representation of angle `target` closest to the (unwrapped, continuous) angle `from`. */
export function nearestAngle(from: number, target: number): number {
  return from + wrapPi(target - from);
}

/**
 * Local yaw (animState convention) of the world direction (dx, dz) for a building with rotation `rot`.
 *
 * Conventions: anim yaw 0 = local forward (+X of the model); positive = counter-clockwise seen from
 * above, which is three.js' positive rotation about +Y (it turns +X towards -Z). The world yaw of a
 * direction is therefore atan2(-dz, dx). A building with rotation r has its local +X on world Dir r,
 * whose world yaw is -r*PI/2 (the model's `rotation.y`). Local yaw = world yaw - building yaw
 *   = atan2(-dz, dx) + r*PI/2, wrapped to (-PI, PI].
 */
export function localYaw(dx: number, dz: number, rot: number): number {
  return wrapPi(Math.atan2(-dz, dx) + rot * Math.PI * 0.5);
}

/** Hay-equivalent of `amount` items of `type` (throughput / rates). */
export function hayEq(type: ItemType, amount: number): number { return amount * BALANCE.hayEquivalent[type]; }

// =====================================================================================
// Formatting (player-facing text)
// =====================================================================================

/** Integer with thousands separators ("1,240"). */
export function fmtInt(n: number): string {
  const r = Math.round(n);
  const neg = r < 0;
  let s = String(Math.abs(r));
  for (let i = s.length - 3; i > 0; i -= 3) s = s.slice(0, i) + ',' + s.slice(i);
  return neg ? '-' + s : s;
}

/** Number for rates / small values: one decimal under 10, integer (with separators) above. */
export function fmtNum(n: number): string {
  if (Math.abs(n) < 9.95) return (Math.round(n * 10) / 10).toFixed(1);
  return fmtInt(n);
}

export function fmtMoney(v: number): string { return '$' + fmtInt(v); }

export function fmtRate(v: number, unit = 'hay/s'): string { return `${fmtNum(v)} ${unit}`; }

/** "35 hay", "1 bale", "3 bales", "2 wrapped bales". */
export function itemLabel(type: ItemType, n: number): string {
  if (type === 'hay') return `${fmtInt(n)} hay`;
  const c = Math.round(n);
  const noun = type === 'bale' ? 'bale' : 'wrapped bale';
  return `${fmtInt(c)} ${noun}${c === 1 ? '' : 's'}`;
}

/** Joins the non-zero parts of a counts triple: "35 hay, 2 bales". */
export function countsLabel(hay: number, bale: number, wrapped: number): string {
  let s = '';
  if (hay >= 0.5) s = itemLabel('hay', hay);
  if (bale >= 1) s += (s ? ', ' : '') + itemLabel('bale', bale);
  if (wrapped >= 1) s += (s ? ', ' : '') + itemLabel('wrapped', wrapped);
  return s;
}

// =====================================================================================
// Packet helpers
// =====================================================================================

/**
 * Amount for the next outgoing packet of `type` from `inv` (0 = nothing to send).
 * Hay packets are `BALANCE.hayPacketSize`; when several hidden needles are stored the packets
 * shrink so that every needle leaves inside its own hay packet (never stranded).
 */
export function packetAmount(inv: Inventory, type: ItemType): number {
  if (type !== 'hay') return inv[type] >= 1 ? 1 : 0;
  if (inv.hay <= EPS) return 0;
  let size: number = BALANCE.hayPacketSize;
  const n = inv.needles.length;
  if (n > 1) size = Math.min(size, inv.hay / n);
  return Math.min(inv.hay, size);
}

/** Removes up to `n` hay from `inv`. When the hay runs out, the hidden needles leave with it (appended to `needlesOut`). */
export function takeHay(inv: Inventory, n: number, needlesOut: number[]): number {
  const r = inv.remove('hay', n);
  if (inv.hay <= EPS && inv.needles.length) {
    for (let i = 0; i < inv.needles.length; i++) needlesOut.push(inv.needles[i]);
    inv.needles.length = 0;
  }
  return r;
}

/** Burst allowance of a {@link RateGate} (hay-eq): one full hay packet. */
const GATE_BURST = BALANCE.hayPacketSize * BALANCE.hayEquivalent.hay;

/**
 * Rate limiter for a machine output (hay-equivalent credits). A packet heavier than the burst allowance
 * (a bale is worth 40 hay-eq) may leave once the credit is full; the gate then runs into debt, so the
 * average rate still holds and such packets are never stuck.
 */
export class RateGate {
  /** Hay-eq credit; negative while paying back a heavy packet. */
  credit = 0;
  /** True when the last push attempt found a ready packet but the output refused it. */
  blocked = false;
  /** Seconds the output has been continuously blocked. */
  blockedFor = 0;

  /** Adds `rate*dt` hay-eq of credit, keeping at most one full hay packet of burst. */
  refill(rate: number, dt: number): void {
    const add = Math.max(0, rate * dt);
    const cap = GATE_BURST + add;
    this.credit = Math.min(this.credit + add, cap);
  }

  /** May a packet worth `cost` hay-eq leave now? (Then subtract `cost` from `credit`.) */
  allows(cost: number): boolean { return this.credit + EPS >= Math.min(cost, GATE_BURST); }

  /** Update the blocked timer after this tick's push attempts. */
  settle(dt: number): void { this.blockedFor = this.blocked ? this.blockedFor + dt : 0; }

  reset(): void { this.credit = 0; this.blocked = false; this.blockedFor = 0; }
}

/** Array-backed FIFO of packets with O(1) amortised shift and a running hay-unit total. */
export class PacketQueue {
  private items: (ItemPacket | undefined)[] = [];
  private head = 0;
  /** Sum of `amount` of queued packets. */
  total = 0;

  get length(): number { return this.items.length - this.head; }
  peek(): ItemPacket | undefined { return this.items[this.head]; }
  at(i: number): ItemPacket | undefined { return this.items[this.head + i]; }

  push(p: ItemPacket): void { this.items.push(p); this.total += p.amount; }

  shift(): ItemPacket | undefined {
    if (this.head >= this.items.length) return undefined;
    const p = this.items[this.head];
    this.items[this.head] = undefined;
    this.head++;
    if (this.head === this.items.length) { this.items.length = 0; this.head = 0; }
    else if (this.head > 16 && this.head * 2 > this.items.length) { this.items.splice(0, this.head); this.head = 0; }
    if (p) this.total -= p.amount;
    if (this.total < EPS) this.total = 0;
    return p;
  }

  clear(): void { this.items.length = 0; this.head = 0; this.total = 0; }

  /** Adds every queued packet to `inv` (contents / spill). */
  addTo(inv: Inventory): void {
    for (let i = this.head; i < this.items.length; i++) { const p = this.items[i]; if (p) inv.addPacket(p); }
  }

  toJSON(): ItemPacket[] {
    const out: ItemPacket[] = [];
    for (let i = this.head; i < this.items.length; i++) { const p = this.items[i]; if (p) out.push(copyPacket(p)); }
    return out;
  }

  load(list: unknown): void {
    this.clear();
    if (!Array.isArray(list)) return;
    for (const raw of list) { const p = parsePacket(raw); if (p) this.push(p); }
  }
}

export function copyPacket(p: ItemPacket): ItemPacket {
  const c: ItemPacket = { type: p.type, amount: p.amount };
  if (p.needleId !== undefined) c.needleId = p.needleId;
  if (p.scanned) c.scanned = true;
  return c;
}

const ITEM_SET: ReadonlySet<string> = new Set(['hay', 'bale', 'wrapped']);

export function parsePacket(raw: unknown): ItemPacket | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== 'string' || !ITEM_SET.has(o.type)) return null;
  const amount = typeof o.amount === 'number' && Number.isFinite(o.amount) && o.amount > 0 ? o.amount : 0;
  if (amount <= 0) return null;
  const p: ItemPacket = { type: o.type as ItemType, amount };
  if (typeof o.needleId === 'number' && Number.isInteger(o.needleId)) p.needleId = o.needleId;
  if (o.scanned === true) p.scanned = true;
  return p;
}

/**
 * Loose hay with hidden needles tracked by position in the stream (FIFO): each needle remembers how
 * much hay was ahead of it, so it is released exactly when the hay around it is consumed.
 * Used by consumers that burn/press hay (generator firebox, compressor hopper).
 */
export class HayBuffer {
  hay = 0;
  private ids: number[] = [];
  private ahead: number[] = [];

  get needleCount(): number { return this.ids.length; }
  needleIds(): readonly number[] { return this.ids; }

  add(amount: number, needleId?: number): void {
    if (needleId !== undefined) { this.ids.push(needleId); this.ahead.push(this.hay + Math.max(0, amount) * 0.5); }
    this.hay += Math.max(0, amount);
  }

  /** Adds hay together with several needles (spread through the added hay). */
  addWithNeedles(amount: number, needles: readonly number[]): void {
    const base = this.hay;
    const a = Math.max(0, amount);
    for (let i = 0; i < needles.length; i++) {
      this.ids.push(needles[i]);
      this.ahead.push(base + (a * (i + 1)) / (needles.length + 1));
    }
    this.hay += a;
  }

  /** Removes up to `amount` hay; needles whose hay was consumed are appended to `released`. Returns the hay removed. */
  consume(amount: number, released: number[]): number {
    const r = Math.min(this.hay, Math.max(0, amount));
    this.hay -= r;
    if (this.hay < EPS) this.hay = 0;
    if (this.ids.length) {
      let w = 0;
      for (let i = 0; i < this.ids.length; i++) {
        const left = this.ahead[i] - r;
        if (left < 0 || this.hay <= 0) { released.push(this.ids[i]); continue; }
        this.ids[w] = this.ids[i];
        this.ahead[w] = left;
        w++;
      }
      this.ids.length = w;
      this.ahead.length = w;
    }
    return r;
  }

  /** Moves everything (hay + needles) into an Inventory (contents / spill). */
  addTo(inv: Inventory): void { inv.add('hay', this.hay, this.ids.length ? this.ids : undefined); }

  clear(): void { this.hay = 0; this.ids.length = 0; this.ahead.length = 0; }

  toJSON(): { hay: number; needles: [number, number][] } {
    return { hay: this.hay, needles: this.ids.map((id, i) => [id, this.ahead[i]] as [number, number]) };
  }

  load(raw: unknown): void {
    this.clear();
    if (!raw || typeof raw !== 'object') return;
    const o = raw as Record<string, unknown>;
    this.hay = num(o.hay, 0, 0);
    if (Array.isArray(o.needles)) {
      for (const e of o.needles) {
        if (Array.isArray(e) && typeof e[0] === 'number' && Number.isInteger(e[0])) {
          this.ids.push(e[0]);
          this.ahead.push(typeof e[1] === 'number' && Number.isFinite(e[1]) ? Math.max(0, e[1]) : 0);
        }
      }
    }
  }
}

// =====================================================================================
// Save helpers
// =====================================================================================

export function obj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Finite number from saved data (with optional lower bound), or the default. */
export function num(v: unknown, def: number, min = -Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : def;
}

export function loadInventory(raw: unknown): Inventory {
  const o = obj(raw);
  const inv = Inventory.from({
    hay: num(o.hay, 0, 0), bale: num(o.bale, 0, 0), wrapped: num(o.wrapped, 0, 0),
    needles: Array.isArray(o.needles) ? o.needles.filter((n): n is number => typeof n === 'number' && Number.isInteger(n)) : [],
  });
  return inv;
}

// =====================================================================================
// Machine base class
// =====================================================================================

/**
 * Base class of every non-logistics building with behaviour. Provides:
 * - cached world geometry (`cx,cy,cz` centre, `fx,fz` local forward, `sx,sz` local +Z) updated
 *   when the building moves/rotates, without per-tick allocations;
 * - cached lists of present input/output port definition indices (refreshed when ports change);
 * - status texts that explain WHY (power problems handled here) and the info() tooltip layout;
 * - rate-limited packet output through linked ports.
 */
export abstract class Machine extends Building {
  protected cx = 0; protected cy = 0; protected cz = 0;
  protected fx = 1; protected fz = 0;
  protected sx = 0; protected sz = 1;
  /** Centre position object handed to APIs that copy it (sales, events that clone). */
  protected readonly centre: Vec3 = { x: 0, y: 0, z: 0 };
  /** Present input / output port definition indices (in port order). */
  protected readonly inIdx: number[] = [];
  protected readonly outIdx: number[] = [];
  /** Scratch probe packet for canPushOut checks (never handed to logistics). */
  protected readonly probe: ItemPacket = { type: 'hay', amount: 0 };

  private gx = NaN; private gz = NaN; private gl = NaN; private gr = NaN;
  private portsRef: WorldPort[] | null = null;

  /** Refresh cached geometry / port lists if the building moved or its ports changed. Cheap; call at the top of tick(). */
  protected prepare(): void {
    const c = this.cell;
    if (c.x !== this.gx || c.z !== this.gz || c.level !== this.gl || this.rot !== this.gr) {
      this.gx = c.x; this.gz = c.z; this.gl = c.level; this.gr = this.rot;
      const p = this.center;
      this.cx = p.x; this.cy = p.y; this.cz = p.z;
      this.centre.x = p.x; this.centre.y = p.y; this.centre.z = p.z;
      this.fx = DIR_DX[this.rot]; this.fz = DIR_DZ[this.rot];
      const s = (this.rot + 1) & 3;
      this.sx = DIR_DX[s]; this.sz = DIR_DZ[s];
      this.onGeometryChanged();
    }
    if (this.ports !== this.portsRef) {
      this.portsRef = this.ports;
      this.inIdx.length = 0; this.outIdx.length = 0;
      for (let i = 0; i < this.ports.length; i++) {
        const p = this.ports[i];
        (p.kind === 'in' ? this.inIdx : this.outIdx).push(p.index);
      }
      this.onPortsChanged();
    }
  }

  /** Hook: geometry changed (placement / move). */
  protected onGeometryChanged(): void { /* optional */ }
  /** Hook: port set changed (topology rebuild, tech unlock). */
  protected onPortsChanged(): void { /* optional */ }

  /** Fresh copy of the centre for event payloads. */
  protected posCopy(): Vec3 { this.prepare(); return { x: this.cx, y: this.cy, z: this.cz }; }

  /** True if input port definition `port` exists and accepts `type`. */
  protected inPortAccepts(port: number, type: ItemType): boolean {
    for (let i = 0; i < this.ports.length; i++) {
      const p = this.ports[i];
      if (p.index === port) return p.kind === 'in' && (!p.items || p.items.includes(type));
    }
    return false;
  }

  protected isLinked(ctx: SimContext, port: number): boolean { return ctx.logistics.isLinked(this, port); }

  /** True if any present output port is linked. */
  protected anyOutputLinked(ctx: SimContext): boolean {
    for (let i = 0; i < this.outIdx.length; i++) if (ctx.logistics.isLinked(this, this.outIdx[i])) return true;
    return false;
  }

  /** running, or lowPower when the network is overloaded. */
  protected setWorking(ctx: SimContext): void {
    this.setStatus(this.needsPower && this.powerSatisfaction < 0.995 ? 'lowPower' : 'running', ctx);
  }

  /**
   * Push packets of `type` from `inv` through `port`, limited by `gate` credits (hay-eq).
   * Partial hay packets (smaller than a full packet) only leave when `flush` is true, so a machine that
   * is still producing never floods belts with tiny packets. Returns hay-eq pushed.
   */
  protected pushPackets(ctx: SimContext, port: number, inv: Inventory, type: ItemType, gate: RateGate, flush: boolean): number {
    let pushed = 0;
    for (;;) {
      const amt = packetAmount(inv, type);
      if (amt <= EPS) break;
      if (type === 'hay' && amt < BALANCE.hayPacketSize - EPS && !flush && inv.needles.length <= 1) break;
      const cost = hayEq(type, amt);
      if (!gate.allows(cost)) break;
      this.probe.type = type; this.probe.amount = amt;
      if (!ctx.logistics.canPushOut(this, port, this.probe)) { gate.blocked = true; break; }
      const p = inv.takePacket(type, amt);
      if (!p) break;
      if (!ctx.logistics.pushOut(this, port, p)) { inv.addPacket(p); gate.blocked = true; break; }
      gate.credit -= cost;
      pushed += cost;
      this.rateOut.add(cost);
    }
    return pushed;
  }

  // ----- status / info -------------------------------------------------------------------

  /** Player-facing explanation of the current status (non-power statuses). */
  protected abstract describeStatus(ctx: SimContext): string;
  /** 3-6 tooltip lines (the power line is appended automatically for powered machines). */
  protected abstract infoLines(ctx: SimContext, lines: InfoLine[]): void;

  statusText(ctx: SimContext): string {
    return powerStatusText(this, ctx) ?? this.describeStatus(ctx);
  }

  override info(ctx: SimContext): BuildingInfo {
    this.prepare();
    const lines: InfoLine[] = [];
    this.infoLines(ctx, lines);
    if (this.needsPower) lines.push(powerLine(this, ctx));
    return { title: this.def.name, status: this.status, statusText: this.statusText(ctx), lines };
  }
}

/** Status text for disabled / power problems, or null when power is not the issue. */
export function powerStatusText(b: Building, ctx: SimContext): string | null {
  switch (b.status) {
    case 'disabled': return 'Switched off - switch it back on to resume';
    case 'noPower': {
      if (b.network < 0) {
        if (ctx.progress.buildingUnlocked('powerPole')) return `No power - place a Power Pole within ${fmtInt(ctx.stat('pole.range'))} m`;
        return `No power - build a Hay Generator within ${fmtInt(BALANCE.generatorDirectRadius)} m`;
      }
      const net = ctx.power.networks[b.network];
      if (net && net.generators.length === 0) return 'No power - connect this pole line to a Hay Generator';
      return 'No power - generators are out of fuel, feed them hay (E)';
    }
    case 'lowPower': return `Low power (${Math.round(b.powerSatisfaction * 100)}%) - add generators`;
    default: return null;
  }
}

/** "Power 15 P (82%)" tooltip line. */
export function powerLine(b: Building, ctx: SimContext): InfoLine {
  if (b.network < 0) return { label: 'Power', value: 'Not connected', tone: 'bad' };
  const draw = b.powerDraw(ctx) * ctx.stat('power.useMul');
  const pct = Math.round(b.powerSatisfaction * 100);
  return { label: 'Power', value: `${fmtNum(draw)} P (${pct}%)`, tone: pct >= 100 ? 'good' : pct > 0 ? 'warn' : 'bad' };
}

/** A needle hidden in hay handled by the player's hands: found ('manual'). */
export function foundByPlayer(ctx: SimContext, ids: readonly number[], pos: Vec3): void {
  const sim = ctx as unknown as Sim;
  for (let i = 0; i < ids.length; i++) sim.foundNeedle(ids[i], 'manual', { x: pos.x, y: pos.y, z: pos.z });
}

/** Unscanned needles reached a consumer: tossed back onto the pile (never lost). */
export function slipNeedles(ctx: SimContext, ids: number[], b: Building, pos: Vec3): void {
  for (let i = 0; i < ids.length; i++) ctx.needleSlipped(ids[i], b.type, pos);
  ids.length = 0;
}

/** Hidden needles picked up by an extractor (now riding inside its hay). */
export function needlesPickedUp(ctx: SimContext, ids: readonly number[], b: Building): void {
  for (let i = 0; i < ids.length; i++) ctx.events.emit('needle:inTransit', { id: ids[i], source: b.type });
}

/**
 * Needles left in an inventory without any hay to carry them (degenerate extraction) are put back
 * on the hay surface at (x,z) - exposed, never lost.
 */
export function returnStrandedNeedles(ctx: SimContext, inv: Inventory, x: number, z: number): void {
  if (inv.hay > EPS || inv.needles.length === 0) return;
  const ids = inv.needles.slice();
  inv.needles.length = 0;
  ctx.hay.deposit(x, z, 0, ids);
}
