import { BUILDABLES, type BuildableDef } from '../config/buildables';
import { BALANCE } from '../config/balance';
import { buildingCenter, resolvePorts, rotatedSize } from './grid';
import { Inventory } from './inventory';
import type { SimContext } from './interfaces';
import type { BuildingType, Cell, Dir, ItemPacket, MachineStatus, Rot, Vec3, WorldPort } from './types';

export interface PortLink {
  target: Building;
  /** Port index (definition index) on the target. */
  port: number;
}

export interface InfoLine { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }

export interface BuildingInfo {
  title: string;
  status: MachineStatus;
  /** Short human explanation of the status, e.g. "Output blocked - connect a belt". */
  statusText: string;
  lines: InfoLine[];
}

export type InteractionKind = 'deposit' | 'take' | 'cycleMode' | 'feed' | 'collectNeedle' | 'info';

export interface InteractionOption {
  kind: InteractionKind;
  /** Prompt text, e.g. "Sell 35 hay" or "Take 120 hay". */
  label: string;
  enabled: boolean;
  /** Why it is disabled, e.g. "Carrying nothing". */
  reason?: string;
}

export interface BuildingInit {
  id: number;
  type: BuildingType;
  cell: Cell;
  rot: Rot;
  variant?: string;
}

/** Exponential moving average of a flow (units/s). */
export class RateMeter {
  private acc = 0;
  value = 0;
  add(units: number): void { this.acc += units; }
  /** Call once per tick. tau = smoothing time constant (s). */
  update(dt: number, tau = 3): void {
    const inst = this.acc / dt;
    this.acc = 0;
    const k = 1 - Math.exp(-dt / tau);
    this.value += (inst - this.value) * k;
  }
}

/**
 * Base class for everything placed on the build grid (machines, belts, storage, power, platforms).
 * Subclasses implement tick/accept/etc. The renderer only reads `anim`, `status`, `ports`, position and info().
 */
export abstract class Building {
  readonly id: number;
  readonly type: BuildingType;
  readonly def: BuildableDef;
  cell: Cell;
  rot: Rot;
  variant?: string;

  /** Player on/off switch. */
  enabled = true;
  status: MachineStatus = 'idle';

  /** Resolved world ports (only those currently unlocked). */
  ports: WorldPort[] = [];
  /** Links indexed by port DEFINITION index (sparse). Filled by Logistics.relink(). */
  links: (PortLink | null)[] = [];

  /** 0..1 power satisfaction of this building's network (1 for unpowered buildings). */
  powerSatisfaction = 1;
  /** Network id this building is attached to (-1 = none). */
  network = -1;

  /** Plain numbers for the renderer (e.g. { yaw, ext, fill, phase }). Semantics documented per type. */
  anim: Record<string, number> = {};

  /** Measured output throughput (hay-equivalent per second). */
  readonly rateOut = new RateMeter();
  /** Measured input throughput (hay-equivalent per second). */
  readonly rateIn = new RateMeter();

  constructor(init: BuildingInit) {
    this.id = init.id;
    this.type = init.type;
    this.def = BUILDABLES[init.type];
    this.cell = { ...init.cell };
    this.rot = init.rot;
    this.variant = init.variant ?? this.def.defaultVariant;
  }

  get center(): Vec3 { return buildingCenter(this.type, this.cell, this.rot); }
  get size(): [number, number] { return rotatedSize(this.def, this.rot); }
  get needsPower(): boolean { return this.def.power > 0; }

  /** Recompute world ports (after placement, move, or a tech unlock that adds ports). */
  refreshPorts(isUnlocked: (node: string) => boolean): void {
    this.ports = resolvePorts(this.type, this.cell, this.rot, this.variant, isUnlocked);
    const max = this.ports.reduce((m, p) => Math.max(m, p.index), -1);
    this.links = new Array(max + 1).fill(null);
  }

  port(index: number): WorldPort | undefined { return this.ports.find((p) => p.index === index); }
  outPorts(): WorldPort[] { return this.ports.filter((p) => p.kind === 'out'); }
  inPorts(): WorldPort[] { return this.ports.filter((p) => p.kind === 'in'); }

  /**
   * Which of my INPUT ports sits at `cell` and faces `outwardDir` (the direction pointing from my cell
   * towards the neighbour that wants to feed me)? Returns the port definition index or -1.
   * Conveyors override this to support automatic curves (side feeding).
   */
  inputPortAt(cell: Cell, outwardDir: Dir): number {
    for (const p of this.ports) {
      if (p.kind === 'in' && p.dir === outwardDir && p.cell.x === cell.x && p.cell.z === cell.z && p.cell.level === cell.level) return p.index;
    }
    return -1;
  }

  /** Can this building take `item` through input port `port` right now? */
  canAccept(_item: ItemPacket, _port: number, _ctx: SimContext): boolean { return false; }
  /** Take `item` (only called after canAccept returned true). */
  accept(_item: ItemPacket, _port: number, _ctx: SimContext): void { /* override */ }

  /** Fixed-step update. */
  tick(_dt: number, _ctx: SimContext): void { /* override */ }

  /**
   * Current power draw in P (before global multipliers). Default: nominal when working, idle fraction otherwise.
   * Unpowered building types return 0.
   */
  powerDraw(_ctx: SimContext): number {
    if (!this.needsPower || !this.enabled) return 0;
    const working = this.status === 'running' || this.status === 'processing' || this.status === 'lowPower';
    return this.def.power * (working ? 1 : BALANCE.idlePowerFraction);
  }

  /**
   * Speed multiplier for processing this tick: 0 when disabled/unpowered,
   * power satisfaction when overloaded, times the global machine speed stat.
   */
  speedFactor(ctx: SimContext): number {
    if (!this.enabled) return 0;
    const p = this.needsPower ? this.powerSatisfaction : 1;
    return p * ctx.stat('global.machineSpeed');
  }

  /**
   * Standard power gate: sets status to disabled/noPower and returns false if the machine cannot run.
   * Returns true when it may run (possibly slowed: check speedFactor).
   */
  protected powerGate(ctx: SimContext): boolean {
    if (!this.enabled) { this.setStatus('disabled', ctx); return false; }
    if (this.needsPower && (this.network < 0 || this.powerSatisfaction <= 0.001)) { this.setStatus('noPower', ctx); return false; }
    return true;
  }

  setStatus(s: MachineStatus, ctx: SimContext): void {
    if (this.status === s) return;
    this.status = s;
    ctx.events.emit('building:status', { id: this.id, type: this.type, status: s });
  }

  /** Try to send an item out of port `port` to whatever is linked there. */
  protected pushOut(port: number, item: ItemPacket, ctx: SimContext): boolean {
    return ctx.logistics.pushOut(this, port, item);
  }

  protected canPushOut(port: number, item: ItemPacket, ctx: SimContext): boolean {
    return ctx.logistics.canPushOut(this, port, item);
  }

  /** Items held inside (spilled as loose hay on demolish, or preserved on move). */
  contents(): Inventory { return new Inventory(); }
  /** Remove all contents (after they were spilled/transferred). */
  clearContents(): void { /* override */ }

  /** Serialize internal state (buffers, timers, modes). Must be JSON-safe. */
  saveState(): unknown { return {}; }
  loadState(_s: unknown): void { /* override */ }

  /** Tooltip data when the player aims at it. */
  info(_ctx: SimContext): BuildingInfo {
    return { title: this.def.name, status: this.status, statusText: '', lines: [] };
  }

  /** What pressing E does here (null = nothing). */
  interaction(_ctx: SimContext): InteractionOption | null { return null; }
  /** Perform the E action. Returns true if something happened. */
  interact(_ctx: SimContext): boolean { return false; }

  onPlaced(_ctx: SimContext): void { /* override */ }
  onRemoved(_ctx: SimContext): void { /* override */ }
}

/** Buildings with no behaviour (platforms, stairs, poles). */
export class StaticBuilding extends Building {}

export type BuildingCtor = new (init: BuildingInit) => Building;
