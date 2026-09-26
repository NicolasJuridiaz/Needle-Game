import { WORLD } from '../../config/world';
import type { BuildingInfo, BuildingInit } from '../building';
import type { SimContext } from '../interfaces';
import { oppositeDir, rotateDir, type Cell, type Dir } from '../types';
import { fmtNum, LogisticsBuilding, type LogiHost } from './base';
import { Lane } from './lane';

/** Path length (tiles) of a curved belt tile (quarter circle of radius 0.5). */
export const CURVE_LENGTH = Math.PI / 4;
const ARC_SEGMENTS = 6;

function arcPath(side: -1 | 1): number[] {
  // Enters at the middle of the local left (v=0) or right (v=1) edge, exits at the middle of the front edge.
  const cv = side < 0 ? 0 : 1;
  const out: number[] = [];
  for (let k = 0; k <= ARC_SEGMENTS; k++) {
    const t = (k / ARC_SEGMENTS) * (Math.PI / 2);
    const th = side < 0 ? Math.PI - t : Math.PI + t;
    out.push(1 + 0.5 * Math.cos(th), cv + 0.5 * Math.sin(th), 0);
  }
  return out;
}
const ARC_LEFT = arcPath(-1);
const ARC_RIGHT = arcPath(1);
const STRAIGHT = [0, 0.5, 0, 1, 0.5, 0];

/** Single-lane logistics building whose only out-port is definition index 1 (belt, ramp, lift). */
abstract class ThroughBuilding extends LogisticsBuilding {
  readonly lane: Lane;

  constructor(init: BuildingInit, len: number) {
    super(init);
    this.lane = new Lane(0, 0, 'through', len);
    this.lanes = [this.lane];
  }

  inLane(port: number): Lane | null { return port === 0 ? this.lane : null; }

  exitLane(lane: Lane, carry: number): number {
    return this.host!.handOff(this, 1, lane, carry);
  }

  step(dt: number, host: LogiHost): void {
    this.host = host;
    if (!this.enabled) this.lane.freeze();
    else this.lane.advance(dt, host.v, host.d, host.tickNo, this);
    this.updateStatus(dt, host.ctx, this.lane.blocked);
    this.afterStep(dt, host);
  }

  protected afterStep(_dt: number, _host: LogiHost): void { /* override */ }

  override info(ctx: SimContext): BuildingInfo {
    const lines = this.baseLines(ctx);
    const linked = ctx.logistics.isLinked(this, 1);
    lines.push({ label: 'Output', value: linked ? 'Connected' : 'Not connected', tone: linked ? 'good' : 'warn' });
    return { title: this.def.name, status: this.status, statusText: this.statusText(ctx), lines };
  }
}

/**
 * Conveyor tile. rot = flow direction. Fed from its back, or (only when nothing feeds its back) from one side:
 * the tile then becomes a curve (anim.curve -1 = fed from local left/-Z, +1 = from local right/+Z).
 */
export class Conveyor extends ThroughBuilding {
  /** Something's out-port faces this belt's back (set during relink). */
  backFed = false;
  /** Outward direction (from this tile) of the linked feeder, -1 = none. */
  feedDir: Dir | -1 = -1;
  curve: -1 | 0 | 1 = 0;

  constructor(init: BuildingInit) { super(init, 1); }

  get flowDir(): Dir { return this.rot as Dir; }
  get backDir(): Dir { return oppositeDir(this.rot as Dir); }

  override inputPortAt(cell: Cell, outwardDir: Dir): number {
    if (cell.x !== this.cell.x || cell.z !== this.cell.z || cell.level !== this.cell.level) return -1;
    if (!this.ports.some((p) => p.kind === 'in' && p.index === 0)) return -1;
    if (outwardDir === this.backDir) return 0;
    if (outwardDir === this.flowDir) return -1; // head-on: never
    return this.backFed ? -1 : 0;
  }

  override resetLinks(): void { this.backFed = false; this.feedDir = -1; }

  override noteFeeder(cell: Cell, outwardDir: Dir): void {
    if (outwardDir === this.backDir && cell.x === this.cell.x && cell.z === this.cell.z && cell.level === this.cell.level) this.backFed = true;
  }

  override onFeederLinked(port: number, outwardDir: Dir): void {
    if (port === 0) this.feedDir = outwardDir;
  }

  buildGeometry(): void {
    let curve: -1 | 0 | 1 = 0;
    if (this.feedDir !== -1 && this.feedDir !== this.backDir) {
      curve = this.feedDir === rotateDir(3, this.rot) ? -1 : 1;
    }
    this.curve = curve;
    this.anim.curve = curve;
    this.lane.setLength(curve === 0 ? 1 : CURVE_LENGTH);
    this.lane.setPath(this, curve === 0 ? STRAIGHT : curve < 0 ? ARC_LEFT : ARC_RIGHT);
    this.lane.snapPoses();
  }

  protected override afterStep(_dt: number, host: LogiHost): void {
    this.anim.curve = this.curve;
    this.anim.speed = this.enabled ? host.v : 0;
  }

  override info(ctx: SimContext): BuildingInfo {
    const inf = super.info(ctx);
    inf.lines.splice(1, 0, { label: 'Speed', value: `${fmtNum(ctx.stat('belt.speed'))} tiles/s` });
    if (this.curve !== 0) inf.lines.push({ label: 'Shape', value: this.curve < 0 ? 'Curve (fed from the left)' : 'Curve (fed from the right)' });
    return inf;
  }
}

/** 3-cell ramp between the floor and the elevated level (variants 'up' / 'down'). */
export class ConveyorRamp extends ThroughBuilding {
  constructor(init: BuildingInit) { super(init, 3); }

  buildGeometry(): void {
    const H = WORLD.levelHeight;
    const up = this.variant !== 'down';
    const h0 = up ? 0 : H, h1 = up ? H : 0;
    this.lane.setPath(this, [0, 0.5, h0, 0.5, 0.5, h0, 2.5, 0.5, h1, 3, 0.5, h1]);
    this.lane.snapPoses();
  }
}

/** Vertical belt lift (1 cell, both levels). Carriage holds ~3 items; throughput equals a belt. */
export class BeltLift extends ThroughBuilding {
  static readonly LIFT_LENGTH = 2.5;
  static readonly LIFT_CAPACITY = 3;

  constructor(init: BuildingInit) {
    super(init, BeltLift.LIFT_LENGTH);
    this.lane.capacity = BeltLift.LIFT_CAPACITY;
  }

  buildGeometry(): void {
    const H = WORLD.levelHeight;
    const up = this.variant !== 'down';
    const h0 = up ? 0 : H, h1 = up ? H : 0;
    this.lane.setPath(this, [0, 0.5, h0, 0.5, 0.5, h0, 0.5, 0.5, h1, 1, 0.5, h1]);
    this.lane.snapPoses();
  }

  protected override afterStep(dt: number, host: LogiHost): void {
    const items = this.lane.items;
    if (items.length > 0) {
      const head = items[0];
      this.anim.phase = Math.max(0, Math.min(1, head.s / this.lane.len));
    } else {
      // Carriage returns to the entry when empty.
      const p = this.anim.phase ?? 0;
      this.anim.phase = Math.max(0, p - dt * this.lane.speed(host.v, host.d) / this.lane.len);
    }
  }

  override info(ctx: SimContext): BuildingInfo {
    const inf = super.info(ctx);
    inf.lines.push({ label: 'Direction', value: this.variant === 'down' ? 'Down (upper -> floor)' : 'Up (floor -> upper)' });
    return inf;
  }
}
