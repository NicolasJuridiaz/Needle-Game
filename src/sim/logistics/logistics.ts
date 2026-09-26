import type { Building } from '../building';
import { cellKey, inGridBounds, neighbor, occupiedCells } from '../grid';
import type { BeltItemView, ILogistics, SimContext } from '../interfaces';
import { oppositeDir, type ItemPacket } from '../types';
import { LogisticsBuilding, type LogiHost } from './base';
import { carriesHiddenNeedle, hayEq, logiClock, releaseItem, toPacket } from './items';
import { REFUSED, type Lane } from './lane';

/**
 * Logistics module (ARCHITECTURE §4.2): port linking, belt/junction/lift simulation, item views.
 *
 * Tick model: every logistics building is stepped once per tick. When an item reaches the end of a lane and the
 * receiver is another logistics building that has not been stepped yet, the receiver is stepped FIRST
 * (downstream first), so a full belt line moves as one continuous stream without tick-boundary gaps.
 * Items carry their overshoot (`carry`) into the next lane, which keeps throughput exact
 * (base: 1.667 tiles/s / 0.333 tiles = 5 packets/s = 50 hay/s).
 */
export class Logistics implements ILogistics, LogiHost {
  /** Logistics buildings in id order (rebuilt by relink). */
  private list: LogisticsBuilding[] = [];
  tickNo = 0;
  v = 1;
  d = 0.333;
  private dt = 0;
  /** Reused view object handed to forEachItem callbacks (do not keep a reference to it). */
  private readonly view: BeltItemView = { uid: 0, type: 'hay', x: 0, y: 0, z: 0, yaw: 0, hidden: false };

  constructor(readonly ctx: SimContext, protected buildings: Map<number, Building>) {}

  // ===================================================================================
  // Linking
  // ===================================================================================

  relink(): void {
    const all = [...this.buildings.values()].sort((a, b) => a.id - b.id);
    const at = new Map<number, Building>();
    for (const b of all) {
      for (const c of occupiedCells(b.type, b.cell, b.rot, b.variant)) {
        if (inGridBounds(c.x, c.z)) at.set(cellKey(c.x, c.z, c.level), b);
      }
    }
    for (const b of all) {
      for (let i = 0; i < b.links.length; i++) b.links[i] = null;
      if (b instanceof LogisticsBuilding) b.resetLinks();
    }
    // Pass 1: tell logistics buildings which of their faces have an out-port pointing at them
    // (conveyors only accept side feeding when nothing feeds their back).
    for (const b of all) {
      for (const p of b.ports) {
        if (p.kind !== 'out') continue;
        const n = neighbor(p.cell, p.dir);
        if (!inGridBounds(n.x, n.z)) continue;
        const t = at.get(cellKey(n.x, n.z, n.level));
        if (t && t !== b && t instanceof LogisticsBuilding) t.noteFeeder(n, oppositeDir(p.dir));
      }
    }
    // Pass 2: links, one feeder per input port, in building-id order.
    const claimed = new Set<number>();
    for (const b of all) {
      const ports = [...b.ports].sort((x, y) => x.index - y.index);
      for (const p of ports) {
        if (p.kind !== 'out') continue;
        const n = neighbor(p.cell, p.dir);
        if (!inGridBounds(n.x, n.z)) continue;
        const t = at.get(cellKey(n.x, n.z, n.level));
        if (!t || t === b) continue;
        const outward = oppositeDir(p.dir);
        const idx = t.inputPortAt(n, outward);
        if (idx < 0) continue;
        const key = t.id * 64 + idx;
        if (claimed.has(key)) continue;
        claimed.add(key);
        b.links[p.index] = { target: t, port: idx };
        if (t instanceof LogisticsBuilding) t.onFeederLinked(idx, outward);
      }
    }
    this.list = all.filter((b): b is LogisticsBuilding => b instanceof LogisticsBuilding);
    for (const b of this.list) b.buildGeometry();
  }

  // ===================================================================================
  // Tick
  // ===================================================================================

  tick(dt: number): void {
    this.tickNo = ++logiClock.tick;
    this.dt = dt;
    this.v = this.ctx.stat('belt.speed');
    this.d = this.ctx.stat('belt.spacing');
    const list = this.list;
    for (let i = 0; i < list.length; i++) this.ensureStepped(list[i]);
  }

  /** Step `b` once this tick (no-op if already stepped or currently stepping — loops). */
  private ensureStepped(b: LogisticsBuilding): void {
    if (b.stepStamp === this.tickNo) return;
    b.stepStamp = this.tickNo;
    b.step(this.dt, this);
  }

  handOff(from: Building, port: number, lane: Lane, carry: number): number {
    const link = from.links[port];
    if (!link) return REFUSED;
    const t = link.target;
    const it = lane.items[0];
    const eq = hayEq(it);
    if (t instanceof LogisticsBuilding) {
      if (!this.buildings.has(t.id)) return REFUSED;
      this.ensureStepped(t);
      const dst = t.inLane(link.port);
      if (!dst) return REFUSED;
      const s = dst.insert(it, carry, this.d, this.tickNo);
      if (s === REFUSED) return REFUSED;
      lane.items.shift();
      from.rateOut.add(eq);
      t.rateIn.add(eq);
      return s;
    }
    if (!t.canAccept(it, link.port, this.ctx)) return REFUSED;
    lane.items.shift();
    const p = toPacket(it);
    releaseItem(it);
    t.accept(p, link.port, this.ctx);
    from.rateOut.add(eq);
    return 0;
  }

  // ===================================================================================
  // Port API (machines)
  // ===================================================================================

  pushOut(from: Building, port: number, item: ItemPacket): boolean {
    const link = from.links[port];
    if (!link) return false;
    const t = link.target;
    if (!t.canAccept(item, link.port, this.ctx)) return false;
    t.accept(item, link.port, this.ctx);
    return true;
  }

  canPushOut(from: Building, port: number, item: ItemPacket): boolean {
    const link = from.links[port];
    return !!link && link.target.canAccept(item, link.port, this.ctx);
  }

  isLinked(from: Building, port: number): boolean {
    return !!from.links[port];
  }

  // ===================================================================================
  // Views
  // ===================================================================================

  forEachItem(alpha: number, cb: (v: BeltItemView) => void): void {
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const v = this.view;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const lanes = list[i].lanes;
      for (let j = 0; j < lanes.length; j++) {
        const items = lanes[j].items;
        for (let k = 0; k < items.length; k++) {
          const it = items[k];
          v.uid = it.uid;
          v.type = it.type;
          v.x = it.px + (it.x - it.px) * a;
          v.y = it.py + (it.y - it.py) * a;
          v.z = it.pz + (it.z - it.pz) * a;
          let dy = it.yaw - it.pyaw;
          if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
          v.yaw = it.pyaw + dy * a;
          v.hidden = carriesHiddenNeedle(it);
          cb(v);
        }
      }
    }
  }

  itemCount(): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b instanceof LogisticsBuilding) n += b.itemCount();
    return n;
  }
}
