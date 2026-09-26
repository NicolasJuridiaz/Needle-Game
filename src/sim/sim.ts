import { BALANCE } from '../config/balance';
import { BUILDABLES, LOGISTICS_TYPES } from '../config/buildables';
import { WORLD } from '../config/world';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { StaticBuilding, type Building, type BuildingCtor, type BuildingInfo } from './building';
import { footprintCells, inGridBounds, isFloorCell, occupiedCells, OccupancyGrid, rotatedSize } from './grid';
import { HayField } from './hayfield';
import type { BeltPlan, PlacementCheck, SimContext } from './interfaces';
import { Inventory } from './inventory';
import { Logistics } from './logistics/logistics';
import { LOGISTICS_CLASSES } from './logistics/index';
import { planBeltPath, type BeltPlanOptions } from './logistics/beltPlanner';
import { MACHINE_CLASSES } from './machines/index';
import { PlayerState } from './player';
import { PowerNetwork } from './power';
import { Progression } from './progression';
import type { BuildingType, Cell, Rot, Vec3 } from './types';
import { NEEDLE_COUNT } from '../config/needles';
import { migrateSave, SAVE_VERSION, type SaveData } from './save';

/** Max hay height (m) under a footprint that a new building can push aside. */
const MAX_HAY_UNDER_BUILDING = 1.2;

function classFor(type: BuildingType): BuildingCtor {
  return MACHINE_CLASSES[type] ?? LOGISTICS_CLASSES[type] ?? StaticBuilding;
}

/**
 * The whole game simulation. Engine-agnostic: runs in the browser (driven by the game loop)
 * and headless in Node (balance bot, tests).
 *
 * Tick order: logistics -> power -> buildings -> hay relaxation -> progression.
 */
export class Sim implements SimContext {
  readonly events = new EventBus();
  readonly rng: Rng;
  readonly seed: number;
  time = 0;
  tickCount = 0;

  readonly hay: HayField;
  readonly grid = new OccupancyGrid();
  readonly buildings = new Map<number, Building>();
  readonly logistics: Logistics;
  readonly power: PowerNetwork;
  readonly progress: Progression;
  readonly player = new PlayerState();

  /** Money paid per building (for refunds). */
  private paid = new Map<number, number>();
  private nextId = 1;
  private topologyDirty = true;
  completed = false;

  constructor(seed: number, opts: { generate?: boolean } = {}) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed ^ 0x51f15e);
    this.hay = new HayField();
    this.progress = new Progression(this.events);
    this.logistics = new Logistics(this, this.buildings);
    this.power = new PowerNetwork(this, this.buildings);
    this.progress.onUnlocked = (id) => {
      this.onTechChanged();
      if (id === 'f_expansion') this.openAnnex();
    };
    this.hay.onExposed = (id) => {
      const n = this.hay.needles.find((q) => q.id === id);
      if (n) this.events.emit('needle:exposed', { id, pos: { ...n.pos } });
    };
    if (opts.generate !== false) this.newGame();
  }

  /** Fresh run: generate the pile, place fixed buildings. */
  private newGame(): void {
    this.hay.generate(this.seed);
    this.applyAnnexBlock();
    const s = WORLD.fixed.sellStation;
    this.placeInternal('sellStation', { x: s.x, z: s.z, level: 0 }, s.rot, undefined, 0);
    this.progress.money = BALANCE.startMoney;
    this.progress.wp = BALANCE.startWP;
    this.topologyDirty = true;
  }

  // ===================================================================================
  // SimContext
  // ===================================================================================

  stat(key: string): number { return this.progress.stat(key); }

  needleSlipped(needleId: number, where: BuildingType, _pos: Vec3): void {
    // A needle that is already found stays found (never resurrected into the pile), even if a stale copy of
    // its id was still riding in a packet.
    const n = this.hay.needles.find((q) => q.id === needleId);
    if (!n || n.status === 'found') return;
    const p = this.hay.tossBack(needleId);
    this.progress.stats.needlesReturned++;
    this.events.emit('needle:returned', { id: needleId, pos: p, where });
    this.events.emit('toast', { text: 'A needle slipped through unscanned! It was tossed back onto the stack.', kind: 'warn', icon: 'needle' });
  }

  needleDetected(needleId: number, _scannerId: number, pos: Vec3): void {
    this.foundNeedle(needleId, 'scanner', pos);
  }

  creditExtraction(amount: number, source: 'manual' | 'rake' | 'arm' | 'collector' | 'vacuumTool', pos: Vec3): void {
    if (amount <= 0) return;
    const st = this.progress.stats;
    if (source === 'manual' || source === 'vacuumTool') st.hayExtractedManual += amount;
    else st.hayExtractedMachine += amount;
    if (source === 'arm') st.hayExtractedArm += amount;
    this.events.emit('hay:extracted', { amount, pos, source });
  }

  buildingInfo(id: number): BuildingInfo | null {
    const b = this.buildings.get(id);
    return b ? b.info(this) : null;
  }

  /** A needle has been found by any means. Applies buff, rewards, completion. */
  foundNeedle(id: number, by: 'manual' | 'scanner' | 'detector', pos: Vec3): void {
    const n = this.hay.needles.find((q) => q.id === id);
    if (!n || n.status === 'found') return;
    this.hay.markFound(id);
    n.status = 'found';
    n.foundAt = this.time;
    n.foundBy = by;
    this.progress.onNeedleFound(id, by, pos);
    if (!this.completed && this.progress.needlesFound.length >= NEEDLE_COUNT) {
      this.completed = true;
      this.progress.stats.completedAt = this.time;
      this.events.emit('game:completed', { time: this.time });
    }
  }

  // ===================================================================================
  // Tick
  // ===================================================================================

  tick(dt: number): void {
    if (this.topologyDirty) this.rebuildTopology();
    this.time += dt;
    this.tickCount++;
    this.progress.stats.playTime = this.time;
    this.player.cooldown = Math.max(0, this.player.cooldown - dt);

    this.logistics.tick(dt);
    this.power.tick(dt);
    for (const b of this.buildings.values()) {
      b.tick(dt, this);
      b.rateIn.update(dt);
      b.rateOut.update(dt);
    }
    this.hay.tick(dt);
    this.progress.tick(dt, this);
  }

  /** Mark port links / power connectivity for recomputation (after build changes or port unlocks). */
  markTopologyDirty(): void { this.topologyDirty = true; }

  rebuildTopology(): void {
    this.topologyDirty = false;
    const unlocked = (n: string) => this.progress.isUnlocked(n);
    for (const b of this.buildings.values()) b.refreshPorts(unlocked);
    this.logistics.relink();
    this.power.rebuild();
  }

  // ===================================================================================
  // Build API
  // ===================================================================================

  ownedCount(type: BuildingType): number {
    let n = 0;
    for (const b of this.buildings.values()) if (b.type === type) n++;
    return n;
  }

  nextCost(type: BuildingType): number {
    return this.progress.buildingCost(type, this.ownedCount(type));
  }

  /**
   * Validate a placement. `ignoreId` = a building being moved (its own cells don't block, no cost).
   */
  canPlace(type: BuildingType, cell: Cell, rot: Rot, variant?: string, ignoreId = 0): PlacementCheck {
    const def = BUILDABLES[type];
    const cells = occupiedCells(type, cell, rot, variant);
    const moving = ignoreId !== 0;
    const cost = moving ? 0 : this.nextCost(type);
    const fail = (reason: string, badCells: Cell[] = []): PlacementCheck => ({ ok: false, reason, cost, cells, badCells, network: -1 });

    if (!moving && !this.progress.buildingUnlocked(type)) return fail('Plans not unlocked (Work Tree)');
    if (!def.levels.includes(cell.level as 0 | 1)) return fail(cell.level === 1 ? 'Can only be built on the ground' : 'Must be built on the upper level');

    const expansion = this.progress.stat('global.warehouseExpansion') >= 1;
    const bad: Cell[] = [];
    for (const c of cells) {
      if (!inGridBounds(c.x, c.z) || !isFloorCell(c.x, c.z, expansion)) { bad.push(c); continue; }
      const occ = this.grid.get(c.x, c.z, c.level);
      if (occ !== 0 && occ !== ignoreId) bad.push(c);
    }
    if (bad.length) {
      const outside = bad.some((c) => !inGridBounds(c.x, c.z) || !isFloorCell(c.x, c.z, expansion));
      return fail(outside ? 'Outside the warehouse floor' : 'Space is occupied', bad);
    }

    // Level-1 machines need platforms underneath.
    if (cell.level === 1 && def.needsPlatformOnLevel1) {
      const noDeck = footprintCells(type, cell, rot).filter((c) => !this.grid.hasPlatform(c.x, c.z));
      if (noDeck.length) return fail('Needs a platform underneath', noDeck);
    }
    // Platforms: nothing tall below.
    if (type === 'platform') {
      const below = this.grid.get(cell.x, cell.z, 1);
      if (below !== 0 && below !== ignoreId) return fail('Something tall is in the way', [cell]);
    }

    // Hay: ground buildings can push aside a thin layer of loose hay only.
    if (cell.level === 0) {
      const [w, d] = rotatedSize(def, rot);
      const h = this.hay.maxHeightInRect(cell.x, cell.z, cell.x + w, cell.z + d);
      if (h > MAX_HAY_UNDER_BUILDING) return fail('Too much hay here - clear it first', footprintCells(type, cell, rot));
      // Don't trap the player inside a building.
      const p = this.player.pos;
      if (p.y < 2 && p.x > cell.x - 0.3 && p.x < cell.x + w + 0.3 && p.z > cell.z - 0.3 && p.z < cell.z + d + 0.3 && type !== 'platform') {
        return fail('You are standing there');
      }
    }

    if (!moving && this.progress.money < cost) return { ok: false, reason: `Need $${Math.ceil(cost - this.progress.money).toLocaleString('en-US')} more`, cost, cells, badCells: [], network: -1 };

    const c = { x: cell.x + rotatedSize(def, rot)[0] / 2, z: cell.z + rotatedSize(def, rot)[1] / 2 };
    return { ok: true, cost, cells, badCells: [], network: def.power > 0 ? this.power.networkAt(c.x, c.z) : -1 };
  }

  /** Place a building (pays for it). Returns null if invalid. */
  place(type: BuildingType, cell: Cell, rot: Rot, variant?: string): Building | null {
    const chk = this.canPlace(type, cell, rot, variant);
    if (!chk.ok) {
      if (chk.reason) this.events.emit('player:denied', { reason: chk.reason });
      return null;
    }
    if (chk.cost > 0 && !this.progress.spendMoney(chk.cost)) return null;
    return this.placeInternal(type, cell, rot, variant, chk.cost);
  }

  private placeInternal(type: BuildingType, cell: Cell, rot: Rot, variant: string | undefined, paid: number, id?: number): Building {
    const Ctor = classFor(type);
    const b = new Ctor({ id: id ?? this.nextId++, type, cell, rot, variant });
    if (id !== undefined) this.nextId = Math.max(this.nextId, id + 1);
    this.occupy(b, true);
    this.buildings.set(b.id, b);
    this.paid.set(b.id, paid);
    b.refreshPorts((n) => this.progress.isUnlocked(n));
    b.onPlaced(this);
    const st = this.progress.stats;
    if (LOGISTICS_TYPES.has(type)) st.beltsBuilt++;
    else if (type !== 'sellStation' && type !== 'platform' && type !== 'stairs' && type !== 'powerPole') st.machinesBuilt++;
    this.topologyDirty = true;
    this.events.emit('building:placed', { id: b.id, type, pos: b.center });
    return b;
  }

  private occupy(b: Building, on: boolean): void {
    for (const c of occupiedCells(b.type, b.cell, b.rot, b.variant)) this.grid.set(c.x, c.z, c.level, on ? b.id : 0);
    if (b.type === 'platform') this.grid.setPlatform(b.cell.x, b.cell.z, on);
    if (b.cell.level === 0) {
      const [w, d] = b.size;
      this.hay.setBlocked(b.cell.x, b.cell.z, b.cell.x + w, b.cell.z + d, on);
    }
  }

  canRemove(id: number): { ok: boolean; reason?: string; refund: number } {
    const b = this.buildings.get(id);
    if (!b) return { ok: false, reason: 'Nothing there', refund: 0 };
    if (!b.def.removable) return { ok: false, reason: 'Cannot be removed', refund: 0 };
    if (b.type === 'platform' && this.grid.get(b.cell.x, b.cell.z, 1) !== b.id) return { ok: false, reason: 'Remove what is on it first', refund: 0 };
    if (b.type === 'platform') {
      // Any level-1 machine standing on this deck?
      for (const o of this.buildings.values()) {
        if (o.id !== b.id && o.cell.level === 1 && o.def.needsPlatformOnLevel1 &&
            footprintCells(o.type, o.cell, o.rot).some((c) => c.x === b.cell.x && c.z === b.cell.z)) {
          return { ok: false, reason: 'Remove what is on it first', refund: 0 };
        }
      }
    }
    return { ok: true, refund: this.refundFor(b) };
  }

  private refundFor(b: Building): number {
    const frac = LOGISTICS_TYPES.has(b.type) ? BALANCE.refund.logistics : BALANCE.refund.default;
    return Math.floor((this.paid.get(b.id) ?? 0) * frac);
  }

  /** Demolish: refund + spill contents (raw hay as loose hay, products auto-sold). */
  remove(id: number): boolean {
    const chk = this.canRemove(id);
    const b = this.buildings.get(id);
    if (!chk.ok || !b) { if (chk.reason) this.events.emit('player:denied', { reason: chk.reason }); return false; }
    this.spillContents(b);
    b.onRemoved(this);
    this.occupy(b, false);
    this.buildings.delete(id);
    this.paid.delete(id);
    if (chk.refund > 0) this.progress.addMoney(chk.refund, 'refund');
    this.topologyDirty = true;
    this.events.emit('building:removed', { id, type: b.type, pos: b.center, refund: chk.refund });
    return true;
  }

  private spillContents(b: Building): void {
    const inv: Inventory = b.contents();
    const c = b.center;
    if (inv.hay > 0 || inv.needles.length) this.hay.deposit(c.x, c.z, inv.hay, inv.needles);
    if (inv.bale > 0) this.progress.recordSale('bale', inv.bale, false, c);
    if (inv.wrapped > 0) this.progress.recordSale('wrapped', inv.wrapped, false, c);
    b.clearContents();
  }

  canMove(id: number, cell: Cell, rot: Rot): PlacementCheck {
    const b = this.buildings.get(id);
    if (!b) return { ok: false, reason: 'Nothing there', cost: 0, cells: [], badCells: [], network: -1 };
    if (!b.def.movable) return { ok: false, reason: 'Cannot be moved', cost: 0, cells: [], badCells: [], network: -1 };
    return this.canPlace(b.type, cell, rot, b.variant, id);
  }

  /** Move a building keeping its contents and state. */
  move(id: number, cell: Cell, rot: Rot): boolean {
    const b = this.buildings.get(id);
    const chk = this.canMove(id, cell, rot);
    if (!b || !chk.ok) { if (chk.reason) this.events.emit('player:denied', { reason: chk.reason }); return false; }
    this.occupy(b, false);
    b.cell = { ...cell };
    b.rot = rot;
    this.occupy(b, true);
    b.refreshPorts((n) => this.progress.isUnlocked(n));
    this.topologyDirty = true;
    this.events.emit('building:moved', { id, type: b.type, pos: b.center });
    return true;
  }

  /** Change a variant in place (e.g. lift up/down) — only for logistics, free. */
  setVariant(id: number, variant: string): boolean {
    const b = this.buildings.get(id);
    if (!b || !b.def.variants?.[variant]) return false;
    this.occupy(b, false);
    const old = b.variant;
    b.variant = variant;
    const chk = this.canPlace(b.type, b.cell, b.rot, variant, id);
    if (!chk.ok) { b.variant = old; this.occupy(b, true); return false; }
    this.occupy(b, true);
    this.topologyDirty = true;
    return true;
  }

  planBelt(start: Cell, end: Cell, opts: BeltPlanOptions): BeltPlan {
    return planBeltPath(this, start, end, opts);
  }

  /** Build every new step of a belt plan (pays the total). */
  placeBelt(plan: BeltPlan): boolean {
    if (!plan.ok) return false;
    if (this.progress.money < plan.cost) { this.events.emit('player:denied', { reason: 'Not enough money' }); return false; }
    let placed = 0;
    for (const s of plan.steps) {
      if (s.existing) continue;
      if (this.place(s.type, s.cell, s.rot, s.variant)) placed++;
    }
    return placed > 0;
  }

  /** Called after a tech unlock: ports may appear (dual outputs, auto feed...), stats change. */
  onTechChanged(): void { this.topologyDirty = true; }

  // ===================================================================================
  // Lookup helpers
  // ===================================================================================

  buildingAtCell(x: number, z: number, level: number): Building | undefined {
    const id = this.grid.get(x, z, level);
    return id > 0 ? this.buildings.get(id) : undefined;
  }

  buildingsOfType(type: BuildingType): Building[] {
    const out: Building[] = [];
    for (const b of this.buildings.values()) if (b.type === type) out.push(b);
    return out;
  }

  /** Sell station (fixed). */
  get sellStation(): Building | undefined { return this.buildingsOfType('sellStation')[0]; }

  private applyAnnexBlock(): void {
    const A = WORLD.annex;
    const open = this.progress.stat('global.warehouseExpansion') >= 1;
    this.hay.setBlocked(A.minX, A.minZ, A.maxX, A.maxZ, !open);
  }

  /** Called by the game when Warehouse Expansion is unlocked. */
  openAnnex(): void { this.applyAnnexBlock(); this.topologyDirty = true; }

  // ===================================================================================
  // Save / load
  // ===================================================================================

  serialize(): SaveData {
    const buildings = [...this.buildings.values()].map((b) => ({
      id: b.id, type: b.type, cell: { ...b.cell }, rot: b.rot, variant: b.variant, enabled: b.enabled,
      paid: this.paid.get(b.id) ?? 0, state: b.saveState(),
    }));
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed: this.seed,
      time: this.time,
      completed: this.completed,
      nextId: this.nextId,
      rng: this.rng.state,
      progress: this.progress.serialize(),
      player: this.player.serialize(),
      hay: this.hay.serialize(),
      buildings,
    };
  }

  static fromSave(raw: unknown): Sim {
    const data = migrateSave(raw);
    const sim = new Sim(data.seed, { generate: false });
    sim.time = data.time;
    sim.completed = data.completed;
    sim.rng.state = data.rng;
    sim.progress.deserialize(data.progress);
    sim.player.deserialize(data.player);
    sim.hay.deserialize(data.hay);
    for (const s of data.buildings) {
      const b = sim.placeInternal(s.type, s.cell, s.rot, s.variant, s.paid, s.id);
      b.enabled = s.enabled;
      b.loadState(s.state);
    }
    sim.nextId = Math.max(sim.nextId, data.nextId);
    // Placement increments build stats; restore the saved ones.
    sim.progress.stats.machinesBuilt = data.progress.stats.machinesBuilt;
    sim.progress.stats.beltsBuilt = data.progress.stats.beltsBuilt;
    sim.applyAnnexBlock();
    sim.rebuildTopology();
    sim.events.emit('game:loaded', {});
    return sim;
  }
}
