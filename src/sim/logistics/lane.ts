import { WORLD } from '../../config/world';
import type { Building } from '../building';
import type { BeltItem } from './items';

/** Returned by hand-off / insert functions when the receiver refused the item. */
export const REFUSED = -1e9;
/** Tolerance when checking the free space at a lane entry (absorbs float drift of tick-quantised motion). */
export const ENTRY_EPS = 1e-4;
const EXIT_EPS = 1e-9;

/**
 * Set by a refused hand-off: free space (tiles, <= 0) at the receiver's entry. The waiting head stops that far
 * before its lane end, so spacing is also kept across tile boundaries in a jam.
 */
export const refusal = { room: 0 };

/** Something that owns lanes and decides where an item goes when it reaches a lane's end. */
export interface LaneOwner {
  /**
   * The head item of `lane` reached the lane end with `carry` tiles of overshoot.
   * On success the owner REMOVES the head from `lane.items` and returns the item's position in its new lane
   * (0 when it left logistics). Returns {@link REFUSED} when it must wait.
   */
  exitLane(lane: Lane, carry: number): number;
}

/**
 * One path that items travel along inside a logistics building (a belt tile, a ramp, a splitter branch...).
 * Items are ordered head first (index 0 = furthest along). Positions `s` are in tiles along the lane, in
 * [0, len]; world positions follow a polyline whose physical length is mapped proportionally onto `len`.
 * All per-tick methods are allocation-free.
 */
export class Lane {
  readonly items: BeltItem[] = [];
  /** Logical length in tiles (governs travel time and capacity). */
  len: number;
  /**
   * When > 0, the lane holds at most this many items at full flow: spacing is stretched to len/capacity and the
   * speed scaled by the same factor, so throughput equals a normal belt (used by the belt lift carriage).
   */
  capacity = 0;
  /** The head item waited at the lane end during the last update. */
  blocked = false;

  // World-space polyline (rebuilt by setPath on relink).
  private pts: number[] = [];
  private cum: number[] = [];
  private yaws: number[] = [];
  private total = 0;

  /**
   * @param index position in the owner's lane list (save format)
   * @param port port definition index this lane is attached to (in-port for entry lanes, out-port for exit lanes), -1 = internal
   * @param kind 'in' lanes receive from ports, 'out' lanes deliver to ports, 'through' do both (belts, ramps, lifts)
   */
  constructor(readonly index: number, readonly port: number, readonly kind: 'in' | 'out' | 'through', len: number) {
    this.len = len;
  }

  spacing(d: number): number {
    return this.capacity > 0 ? Math.max(d, this.len / this.capacity) : d;
  }

  speed(v: number, d: number): number {
    return this.capacity > 0 ? v * (this.spacing(d) / d) : v;
  }

  /** Change the logical length, rescaling item positions (e.g. a belt turning into a curve). */
  setLength(len: number): void {
    if (Math.abs(len - this.len) < 1e-9) return;
    const k = len / this.len;
    for (let i = 0; i < this.items.length; i++) this.items[i].s *= k;
    this.len = len;
  }

  /**
   * Set the world path from LOCAL points of building `b` (rotation 0 frame: u along forward 0..w,
   * v across 0..d, h = height above the belt surface of the building's base level). Flat triples [u,v,h,...].
   */
  setPath(b: Building, local: readonly number[]): void {
    const [w, d] = b.def.footprint;
    const baseY = b.cell.level * WORLD.levelHeight + WORLD.beltHeight;
    const n = local.length / 3;
    const pts: number[] = new Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = local[i * 3], v = local[i * 3 + 1], h = local[i * 3 + 2];
      let ox: number, oz: number;
      switch (b.rot) {
        case 0: ox = u; oz = v; break;
        case 1: ox = d - v; oz = u; break;
        case 2: ox = w - u; oz = d - v; break;
        default: ox = v; oz = w - u; break;
      }
      pts[i * 3] = b.cell.x + ox;
      pts[i * 3 + 1] = baseY + h;
      pts[i * 3 + 2] = b.cell.z + oz;
    }
    const cum: number[] = [0];
    const yaws: number[] = [];
    let total = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i * 3 + 3] - pts[i * 3], dy = pts[i * 3 + 4] - pts[i * 3 + 1], dz = pts[i * 3 + 5] - pts[i * 3 + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
      cum.push(total);
      yaws.push(Math.hypot(dx, dz) > 1e-6 ? Math.atan2(-dz, dx) : NaN);
    }
    // Vertical segments inherit the yaw of a neighbouring horizontal one.
    for (let i = 0; i < yaws.length; i++) if (Number.isNaN(yaws[i])) yaws[i] = i > 0 ? yaws[i - 1] : NaN;
    for (let i = yaws.length - 1; i >= 0; i--) if (Number.isNaN(yaws[i])) yaws[i] = i < yaws.length - 1 ? yaws[i + 1] : 0;
    this.pts = pts;
    this.cum = cum;
    this.yaws = yaws;
    this.total = total;
  }

  /** World position/yaw of an item at `s` along this lane (written into the item's current pose). */
  posAt(s: number, it: BeltItem): void {
    const pts = this.pts;
    if (pts.length < 6) { it.x = pts[0] ?? 0; it.y = pts[1] ?? 0; it.z = pts[2] ?? 0; return; }
    let t = this.len > 0 ? (s / this.len) * this.total : 0;
    if (t < 0) t = 0; else if (t > this.total) t = this.total;
    const cum = this.cum;
    let i = 0;
    const last = cum.length - 2;
    while (i < last && cum[i + 1] < t) i++;
    const segLen = cum[i + 1] - cum[i];
    const f = segLen > 1e-9 ? (t - cum[i]) / segLen : 0;
    const k = i * 3;
    it.x = pts[k] + (pts[k + 3] - pts[k]) * f;
    it.y = pts[k + 1] + (pts[k + 4] - pts[k + 1]) * f;
    it.z = pts[k + 2] + (pts[k + 5] - pts[k + 2]) * f;
    it.yaw = this.yaws[i];
  }

  /** Is there room at the entry for one more item? */
  hasRoom(d: number): boolean {
    const n = this.items.length;
    return n === 0 || this.items[n - 1].s - this.spacing(d) >= -ENTRY_EPS;
  }

  /**
   * Append `it` at the entry, `carry` tiles in (clamped by the spacing to the last item).
   * Returns its position or {@link REFUSED}. Marks the item as moved in logistics tick `tick`.
   */
  insert(it: BeltItem, carry: number, d: number, tick: number): number {
    const n = this.items.length;
    let s = carry;
    if (n > 0) {
      const m = this.items[n - 1].s - this.spacing(d);
      if (m < -ENTRY_EPS) { refusal.room = m; return REFUSED; }
      if (s > m) s = m;
    }
    if (s > this.len) s = this.len;
    it.s = s;
    it.stamp = tick;
    this.posAt(s, it);
    this.items.push(it);
    return s;
  }

  /**
   * Advance all items by one tick. Items keep `spacing` between each other; the head asks the owner to hand it
   * on when it reaches the end (and waits there if refused). Items already moved in this tick are skipped.
   */
  advance(dt: number, v: number, d: number, tick: number, owner: LaneOwner): void {
    const items = this.items;
    const L = this.len;
    const sp = this.spacing(d);
    const vd = this.speed(v, d) * dt;
    this.blocked = false;
    let limit = Infinity;
    let i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.stamp === tick) { limit = it.s - sp; i++; continue; }
      it.px = it.x; it.py = it.y; it.pz = it.z; it.pyaw = it.yaw;
      it.stamp = tick;
      let ns = it.s + vd;
      if (ns > limit) ns = limit;
      if (ns < it.s) ns = it.s;
      if (i === 0 && ns >= L - EXIT_EPS) {
        refusal.room = 0;
        const placed = owner.exitLane(this, ns > L ? ns - L : 0);
        if (placed !== REFUSED) { limit = L + placed - sp; continue; } // head removed: items[0] is the next one
        let cap = L + (refusal.room < 0 ? refusal.room : 0);
        if (cap < it.s) cap = it.s;
        if (ns > cap) ns = cap;
        this.blocked = true;
      } else if (ns > L) ns = L;
      it.s = ns;
      this.posAt(ns, it);
      limit = ns - sp;
      i++;
    }
  }

  /** No movement this tick (disabled building): stop interpolation. */
  freeze(): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.px = it.x; it.py = it.y; it.pz = it.z; it.pyaw = it.yaw;
    }
    this.blocked = false;
  }

  /** Recompute world poses of all items (after a geometry change / load) without interpolation. */
  snapPoses(): void {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      this.posAt(it.s, it);
      it.px = it.x; it.py = it.y; it.pz = it.z; it.pyaw = it.yaw;
    }
  }
}
