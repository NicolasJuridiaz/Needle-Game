import type { EventBus } from '../core/events';
import type { Building, BuildingInfo } from './building';
import type { Inventory } from './inventory';
import type { BuildingType, Cell, ItemPacket, ItemType, NeedleState, Rot, ToolId, Vec3 } from './types';

/**
 * MODULE CONTRACTS.
 * Each interface is implemented by one module (see docs/ARCHITECTURE.md for ownership):
 *   IHayField        -> src/sim/hayfield.ts   (class HayField)
 *   ILogistics       -> src/sim/logistics/logistics.ts (class Logistics)
 *   IPowerNetwork    -> src/sim/power.ts      (class PowerNetwork)
 *   IProgression     -> src/sim/progression.ts(class Progression)
 *   PlayerState      -> src/sim/player.ts     (class PlayerState)
 *   SimContext       -> src/sim/sim.ts        (class Sim implements SimContext)
 */

// =====================================================================================
// Hay field (heightfield of loose hay covering the whole floor; the haystack is its initial state)
// =====================================================================================

export interface HayExtraction {
  /** Hay units removed. */
  units: number;
  /** Needles that were inside the removed material (now "inTransit"). */
  needles: number[];
  /** Centroid of the removed material (for FX). */
  pos: Vec3;
}

export interface DirtyRect { c0: number; r0: number; c1: number; r1: number }

export interface DetectorReading {
  /** 0..1 signal strength of the strongest detectable needle (0 = nothing). */
  strength: number;
  /** Horizontal distance (m) to it, if detectable. */
  distance: number;
  /** Unit vector (x,z) towards it, if detectable. */
  dirX: number;
  dirZ: number;
  /** A needle is within range but deeper than the detector can sense. */
  tooDeep: boolean;
  /** Needle id of the strongest signal (-1 if none). */
  needleId: number;
}

export interface IHayField {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  /** World x/z of the min corner of cell (0,0). Column index grows with +X, row index with +Z. */
  readonly originX: number;
  readonly originZ: number;
  /** Surface height (m) per cell, row-major: index = row * cols + col. */
  readonly heights: Float32Array;
  /** Hay units stored per metre of height in ONE cell. */
  readonly unitsPerMeter: number;
  /** Initial pile units (progress baseline). */
  readonly initialUnits: number;
  /** Needles (positions + status). Owned here because extraction/relaxation moves them. */
  readonly needles: NeedleState[];
  /** Optional hook: a buried needle became exposed on the surface (set by Sim). */
  onExposed?: (id: number) => void;

  /** Build the initial pile + place needles in their depth bands (deterministic for a seed). */
  generate(seed: number): void;

  /** Bilinear surface height at world (x,z); 0 where there is no hay. */
  heightAt(x: number, z: number): number;
  /** Units currently in the field. */
  totalUnits(): number;
  /** 0..1 fraction of the initial pile removed (loose hay put back counts as not removed). */
  progress(): number;

  /** Remove up to maxUnits within radius around (x,z), from the highest cells first. */
  extractRadius(x: number, z: number, radius: number, maxUnits: number): HayExtraction;
  /**
   * Rake: remove hay along a strip starting at (x,z) going along (dirX,dirZ) up to maxLength, `width` wide.
   * Takes from the nearest hay first. `reach` = distance to the furthest cell raked (for animation).
   */
  extractStrip(x: number, z: number, dirX: number, dirZ: number, width: number, maxLength: number, maxUnits: number): HayExtraction & { reach: number };
  /** Add loose hay around (x,z). Needles are placed on the new surface (status 'exposed'). */
  deposit(x: number, z: number, units: number, needles?: number[]): void;

  /**
   * Arm targeting: best cell within [minRadius, radius] of (x,z). With `behind`, only cells at least `margin`
   * metres behind (x,z) along the direction (fx,fz) qualify.
   */
  findTarget(x: number, z: number, radius: number, mode: 'nearest' | 'densest', minRadius?: number, behind?: { fx: number; fz: number; margin: number }): { x: number; z: number; height: number; units: number } | null;
  /** Hay units within a radius (status / UI). */
  unitsInRadius(x: number, z: number, radius: number): number;
  /** Max surface height inside an axis-aligned world rect (placement validation). */
  maxHeightInRect(x0: number, z0: number, x1: number, z1: number): number;
  /**
   * Block/unblock an axis-aligned world rect (building footprints, closed annex). Blocked cells hold no hay:
   * existing hay is pushed to the nearest free neighbours (conserved), and relaxation never flows into them.
   */
  setBlocked(x0: number, z0: number, x1: number, z1: number, blocked: boolean): void;

  /** Angle-of-repose relaxation + needle exposure. Budgeted per call. */
  tick(dt: number): void;

  /** Renderer: take and clear the dirty cell rect since the last call (null = nothing changed). */
  consumeDirtyRect(): DirtyRect | null;

  // ----- needles -----
  /** Metal detector reading at (x,z) for the given stats. `noise` in [0,1] adds jitter (1 = worst). */
  detectorReading(x: number, z: number, range: number, depth: number, noise: number): DetectorReading;
  /** Mark a needle found (removes it from the world). */
  markFound(id: number): void;
  /** An unscanned needle slipped through a machine: throw it back onto the upper pile surface. */
  tossBack(id: number): Vec3;
  /** Exposed needle close to (x,y,z) within `radius` (for pickup), or -1. */
  exposedNeedleNear(x: number, y: number, z: number, radius: number): number;

  serialize(): HaySave;
  deserialize(s: HaySave): void;
}

export interface HaySave {
  /** Quantised heights (uint16, 1 unit = 1 mm) base64-encoded. */
  heights: string;
  blocked: string;
  initialUnits: number;
  /** Hay units per metre of height in one cell (fixed at generation). */
  unitsPerMeter?: number;
  /** Seeded state for tossBack placement. */
  rng?: number;
  needles: NeedleState[];
}

// =====================================================================================
// Logistics (belts, splitters, mergers, lifts, ramps) + port linking
// =====================================================================================

export interface BeltItemView {
  /** Stable id for interpolation. */
  uid: number;
  type: ItemType;
  x: number; y: number; z: number;
  /** Yaw (radians, three.js convention) for orienting bales. */
  yaw: number;
  /** Packet carries a hidden needle (renderer may add a tiny glint - optional). */
  hidden: boolean;
}

export interface ILogistics {
  /** Rebuild every port link (and conveyor curve inputs). Call after any build change or port unlock. */
  relink(): void;
  /** Advance belts, splitters, mergers, lifts. Called once per sim tick BEFORE machines tick. */
  tick(dt: number): void;
  /** Hand `item` from `from`'s out-port to its linked target. Returns false if blocked/unlinked. */
  pushOut(from: Building, port: number, item: ItemPacket): boolean;
  canPushOut(from: Building, port: number, item: ItemPacket): boolean;
  /** True if the out-port has a link. */
  isLinked(from: Building, port: number): boolean;
  /** Iterate all items currently on logistics buildings, positions interpolated by `alpha` (0..1 into the next tick). */
  forEachItem(alpha: number, cb: (v: BeltItemView) => void): void;
  /** Total items on belts (perf / debug). */
  itemCount(): number;
}

// =====================================================================================
// Power
// =====================================================================================

export interface PowerNetworkInfo {
  id: number;
  supply: number;      // P available after losses
  demand: number;      // P requested
  satisfaction: number;// 0..1
  generators: number[];
  poles: number[];
  consumers: number[];
}

export interface IPowerNetwork {
  /** Recompute connectivity (after build changes / range upgrades). */
  rebuild(): void;
  /** Distribute power: sets building.powerSatisfaction and building.network, generator loads. */
  tick(dt: number): void;
  readonly networks: PowerNetworkInfo[];
  /** Totals over all networks (HUD). */
  readonly totalSupply: number;
  readonly totalDemand: number;
  /** Pole-pole and pole-generator wires for rendering. */
  readonly wires: { a: number; b: number }[];
  /** Pole/generator -> consumer links for rendering thin cables. */
  readonly feeds: { from: number; to: number }[];
  /** Would a machine at world (x,z) be powered (for build ghost feedback)? Returns network id or -1. */
  networkAt(x: number, z: number): number;
}

// =====================================================================================
// Progression (money, WP, stats, work tree, shop, orders, milestones, needle buffs, run stats)
// =====================================================================================

export interface RunStats {
  playTime: number;
  haySold: number; baleSold: number; wrappedSold: number;
  hayViaBelt: number;           // hay-eq delivered to sell by belts/ports
  hayExtractedManual: number; hayExtractedMachine: number; hayExtractedArm: number;
  hayScanned: number; hayBurned: number;
  moneyEarned: number; wpEarned: number;
  peakPower: number; peakThroughput: number; // hay-eq/s delivered (smoothed)
  machinesBuilt: number; beltsBuilt: number;
  needlesReturned: number;
  firstSaleAt: number; completedAt: number;
}

export interface OrderRuntime {
  id: string;
  /** Counter value when the order became active (cumulative metrics). */
  base: number;
  progress: number;
  completed: boolean;
  /** Shown on the order board; stays until completed. */
  active?: boolean;
}

export interface UnlockCheck { ok: boolean; reason?: string; cost?: number }

export interface IProgression {
  money: number;
  wp: number;
  /** Node id -> unlocked level (1..n). */
  readonly nodes: Map<string, number>;
  readonly stats: RunStats;
  /** Needle ids in discovery order. */
  readonly needlesFound: number[];
  readonly ownedTools: Set<ToolId>;
  hasWheelbarrow: boolean;

  /** Computed stat value (base + tech effects + needle buffs). Cached; cheap to call. */
  stat(key: string): number;
  isUnlocked(nodeId: string): boolean;
  nodeLevel(nodeId: string): number;

  canUnlock(nodeId: string): UnlockCheck;
  /** Spend WP to unlock the next level of a node. Emits node:unlocked, recomputes stats. */
  unlock(nodeId: string): boolean;

  /** Is the building type's plan unlocked? */
  buildingUnlocked(type: BuildingType): boolean;
  /** Money cost of the next unit of a building type given how many are owned. */
  buildingCost(type: BuildingType, owned: number): number;
  canBuyTool(tool: ToolId | 'wheelbarrow'): UnlockCheck;
  buyTool(tool: ToolId | 'wheelbarrow'): boolean;

  addMoney(amount: number, source: 'sale' | 'order' | 'needle' | 'milestone' | 'refund'): void;
  spendMoney(amount: number): boolean;
  addWP(amount: number, source: 'order' | 'needle' | 'milestone'): void;

  /** Record a sale (value computed from stats). Returns money earned. */
  recordSale(item: ItemType, amount: number, viaBelt: boolean, pos: Vec3): number;
  /** A needle was found: applies the next buff, grants WP + money. Returns buff index. */
  onNeedleFound(id: number, by: 'manual' | 'scanner' | 'detector', pos: Vec3): number;

  /** Optional hook called after every successful unlock (set by Sim to refresh ports/power/annex). */
  onUnlocked?: (id: string) => void;

  readonly orders: OrderRuntime[];
  /** Active (visible) orders, max 3. Returns a reused array - do not mutate. */
  activeOrders(): OrderRuntime[];
  /** Money/WP an order actually pays (after multipliers). */
  orderReward(def: import('../config/orders').OrderDef): { money: number; wp: number };
  /** Current delivered hay-equivalent per second (sliding window). */
  stableRate(): number;
  readonly flags: Set<string>;
  hasFlag(flag: string): boolean;
  /** Returns true the first time a flag is set. */
  setFlag(flag: string): boolean;
  readonly milestonesDone: Set<string>;

  /** Orders, milestones, stable-rate tracking. */
  tick(dt: number, ctx: SimContext): void;

  serialize(): ProgressSave;
  deserialize(s: ProgressSave): void;
}

export interface ProgressSave {
  money: number; wp: number;
  nodes: [string, number][];
  stats: RunStats;
  needlesFound: number[];
  ownedTools: ToolId[];
  hasWheelbarrow: boolean;
  orders: OrderRuntime[];
  milestones: string[];
  flags: string[];
  stableBuckets?: number[];
  stableElapsed?: number;
}

// =====================================================================================
// Player (sim-side state; the FPS controller lives in src/game)
// =====================================================================================

export interface WheelbarrowState {
  pos: Vec3;
  yaw: number;
  held: boolean;
  inv: Inventory;
}

export interface PlayerSave {
  pos: Vec3; yaw: number; pitch: number;
  carry: ReturnType<Inventory['toJSON']>;
  equipped: ToolId;
  wheelbarrow: { pos: Vec3; yaw: number; held: boolean; inv: ReturnType<Inventory['toJSON']> } | null;
}

// =====================================================================================
// Build API results
// =====================================================================================

export interface PlacementCheck {
  ok: boolean;
  /** Player-facing reason when not ok ("Blocked", "Needs a platform", "Clear the hay first"...). */
  reason?: string;
  cost: number;
  /** Cells the building would occupy (for ghost colouring). */
  cells: Cell[];
  /** Subset of cells that are the problem. */
  badCells: Cell[];
  /** Power network the machine would join (-1 none) - for ghost feedback. */
  network: number;
}

export interface BeltPlanStep {
  type: 'conveyor' | 'conveyorRamp' | 'beltLift';
  cell: Cell;
  rot: Rot;
  variant?: string;
  /** Existing building id at this cell that the plan connects into (not placed). */
  existing?: number;
}

export interface BeltPlan {
  ok: boolean;
  reason?: string;
  steps: BeltPlanStep[];
  cost: number;
  /** Connects to an input port at the end / output port at the start. */
  connectsStart: boolean;
  connectsEnd: boolean;
}

// =====================================================================================
// Sim context passed to building ticks (implemented by Sim)
// =====================================================================================

export interface SimContext {
  readonly time: number;
  readonly events: EventBus;
  readonly hay: IHayField;
  readonly logistics: ILogistics;
  readonly power: IPowerNetwork;
  readonly progress: IProgression;
  readonly player: import('./player').PlayerState;
  readonly buildings: Map<number, Building>;
  stat(key: string): number;
  /** Needle hidden in a packet reached a consumer (sell/generator/compressor) unscanned: toss it back. */
  needleSlipped(needleId: number, where: BuildingType, pos: Vec3): void;
  /** A scanner detected a needle. */
  needleDetected(needleId: number, scannerId: number, pos: Vec3): void;
  /** Credit extracted hay to stats + events. */
  creditExtraction(amount: number, source: 'manual' | 'rake' | 'arm' | 'collector' | 'vacuumTool', pos: Vec3): void;
  buildingInfo(id: number): BuildingInfo | null;
}
