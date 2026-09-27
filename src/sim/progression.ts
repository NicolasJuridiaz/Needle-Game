import { BALANCE } from '../config/balance';
import { BUILDABLES, LOGISTICS_TYPES } from '../config/buildables';
import { ITEMS } from '../config/items';
import { MILESTONES, type MilestoneDef } from '../config/milestones';
import { NEEDLE_BUFFS } from '../config/needles';
import { MAX_ACTIVE_ORDERS, ORDERS, type OrderDef, type OrderMetric } from '../config/orders';
import { BASE_STATS } from '../config/stats';
import { ownedLevelFor, parseRequirement, requirementLabel, TECH_BY_ID, TECH_NODES } from '../config/techTree';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { EventBus } from '../core/events';
import type { Building } from './building';
import type { IProgression, OrderRuntime, ProgressSave, RunStats, SimContext, UnlockCheck } from './interfaces';
import { TOOL_ORDER, type BuildingType, type Effect, type ItemType, type MachineStatus, type ToolId, type Vec3 } from './types';

/**
 * Progression: money, Work Points, stats (base + Work Tree + needle buffs), shop rules, orders,
 * milestones, needle buffs and run statistics. Engine-agnostic (no DOM / three.js).
 * See docs/ARCHITECTURE.md §4.4.
 */

// =====================================================================================
// Static indexes built once from config
// =====================================================================================

const BASE = new Map<string, number>(Object.entries(BASE_STATS));

interface TechEffectRef { node: string; level: number; effect: Effect }

/** Tech effects grouped by stat, in tree order then level order (the fold order of `stat()`). */
const TECH_EFFECTS = new Map<string, TechEffectRef[]>();
for (const node of TECH_NODES) {
  node.levels.forEach((lv, i) => {
    for (const effect of lv.effects) {
      let list = TECH_EFFECTS.get(effect.stat);
      if (!list) { list = []; TECH_EFFECTS.set(effect.stat, list); }
      list.push({ node: node.id, level: i + 1, effect });
    }
  });
}

const ORDER_INDEX = new Map<string, number>(ORDERS.map((o, i) => [o.id, i]));
/** ORDERS[i].after resolved to order indices. */
const ORDER_AFTER: number[][] = ORDERS.map((o) => o.after.map((id) => ORDER_INDEX.get(id) ?? -1));

const CUMULATIVE_METRICS: ReadonlySet<OrderMetric> = new Set<OrderMetric>([
  'sell', 'sellViaBelt', 'extractManual', 'extractMachine', 'extractArm', 'burn', 'scan',
]);

const SOLD_STAT: Record<ItemType, 'haySold' | 'baleSold' | 'wrappedSold'> = {
  hay: 'haySold', bale: 'baleSold', wrapped: 'wrappedSold',
};

/** Building types that do not count as "machines" for milestones. */
const NON_MACHINE_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  ...LOGISTICS_TYPES, 'sellStation', 'platform', 'stairs', 'powerPole',
]);

const WORKING_STATUSES: ReadonlySet<MachineStatus> = new Set<MachineStatus>(['running', 'processing', 'lowPower']);

/** Minimum time (s) between two `order:progress` events of the same order (UI refresh cadence, ~4/s). */
const ORDER_PROGRESS_EVENT_INTERVAL = 0.25;
/** Resolution of the stable-rate sliding window (number of buckets spanning BALANCE.stableWindow). */
const STABLE_BUCKETS = 60;
/** Tolerance for float accumulation when comparing progress against targets. */
const EPS = 1e-6;

function createRunStats(): RunStats {
  return {
    playTime: 0,
    haySold: 0, baleSold: 0, wrappedSold: 0,
    hayViaBelt: 0,
    hayExtractedManual: 0, hayExtractedMachine: 0, hayExtractedArm: 0,
    hayScanned: 0, hayBurned: 0,
    moneyEarned: 0, wpEarned: 0,
    peakPower: 0, peakThroughput: 0,
    machinesBuilt: 0, beltsBuilt: 0,
    needlesReturned: 0,
    firstSaleAt: -1, completedAt: -1,
  };
}

function applyEffect(v: number, e: Effect): number {
  switch (e.op) {
    case 'add': return v + e.value;
    case 'mul': return v * e.value;
    case 'set': return e.value;
  }
}

const finiteOr = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Runtime state of one order. `active` (visible on the board) is persisted so the set of visible
 * orders never reshuffles: once shown, an order stays until completed.
 */
export interface OrderState extends OrderRuntime {
  active: boolean;
}

/** Per-tick snapshot of building-derived metrics (computed lazily, at most once per tick). */
interface BuildingMetrics { machines: number; belts: number; powered: number; silo: number }

export class Progression implements IProgression {
  money = 0;
  wp = 0;
  readonly nodes = new Map<string, number>();
  readonly stats: RunStats = createRunStats();
  readonly needlesFound: number[] = [];
  readonly ownedTools = new Set<ToolId>(['hands']);
  hasWheelbarrow = false;
  /** One entry per ORDERS definition, same order. */
  readonly orders: OrderState[] = ORDERS.map((o) => ({ id: o.id, base: 0, progress: 0, completed: false, active: false }));
  readonly milestonesDone = new Set<string>();
  /** One-shot flags for onboarding hints / analytics ("first_sale_tracked", ...). Persisted. */
  readonly flags = new Set<string>();

  onUnlocked?: (id: string) => void;

  private readonly statCache = new Map<string, number>();
  private readonly reportedUnknownStats = new Set<string>();

  /** Active orders in list order (the array returned by activeOrders()) and their ORDERS indices. */
  private readonly active: OrderState[] = [];
  private readonly activeIdx: number[] = [];
  private readonly lastProgressEventAt = new Float64Array(ORDERS.length);
  private readonly lastProgressEventValue = new Float64Array(ORDERS.length);
  /** Progression-local clock (s), advanced by tick(). */
  private clock = 0;

  /** Stable-rate tracker: ring of STABLE_BUCKETS full buckets + 1 current bucket (hay-eq delivered). */
  private readonly stableBuckets = new Float64Array(STABLE_BUCKETS + 1);
  private stableHead = 0;
  private stableBucketElapsed = 0;
  private stableFullSum = 0;

  private pileCache = NaN;
  private metricsValid = false;
  private readonly metrics: BuildingMetrics = { machines: 0, belts: 0, powered: 0, silo: 0 };
  private readonly countBuilding = (b: Building): void => {
    const m = this.metrics;
    if (b.type === 'conveyor') m.belts++;
    if (!NON_MACHINE_TYPES.has(b.type)) m.machines++;
    if (b.def.power > 0 && b.network >= 0 && b.powerSatisfaction > 0 && WORKING_STATUSES.has(b.status)) m.powered++;
    if (b.type === 'silo') m.silo += b.contents().weight();
  };

  constructor(private readonly events: EventBus) {
    this.fillActiveOrders(false);
  }

  // ===================================================================================
  // Stats
  // ===================================================================================

  stat(key: string): number {
    const cached = this.statCache.get(key);
    if (cached !== undefined) return cached;
    const v = this.computeStat(key);
    this.statCache.set(key, v);
    return v;
  }

  private computeStat(key: string): number {
    const base = BASE.get(key);
    if (base === undefined) {
      if (!this.reportedUnknownStats.has(key)) {
        this.reportedUnknownStats.add(key);
        console.error(`[progression] Unknown stat "${key}" (add it to config/stats.ts)`);
      }
      return 0;
    }
    let add = 0;
    let mul = 1;
    let set = 0;
    let hasSet = false;
    const refs = TECH_EFFECTS.get(key);
    if (refs) {
      for (const r of refs) {
        if (this.nodeLevel(r.node) < r.level) continue;
        const e = r.effect;
        if (e.op === 'add') add += e.value;
        else if (e.op === 'mul') mul *= e.value;
        else { set = e.value; hasSet = true; }
      }
    }
    let v = hasSet ? set : (base + add) * mul;
    const buffs = Math.min(this.needlesFound.length, NEEDLE_BUFFS.length);
    for (let k = 0; k < buffs; k++) {
      for (const e of NEEDLE_BUFFS[k].effects) if (e.stat === key) v = applyEffect(v, e);
    }
    return v;
  }

  private invalidateStats(): void { this.statCache.clear(); }

  // ===================================================================================
  // Work Tree
  // ===================================================================================

  isUnlocked(req: string): boolean {
    if (req.indexOf('@') < 0) return this.nodeLevel(req) >= 1;
    const [id, lv] = parseRequirement(req);
    return this.nodeLevel(id) >= ownedLevelFor(TECH_BY_ID[id], lv);
  }

  nodeLevel(nodeId: string): number { return this.nodes.get(nodeId) ?? 0; }

  canUnlock(nodeId: string): UnlockCheck {
    const node = TECH_BY_ID[nodeId];
    if (!node) return { ok: false, reason: 'Unknown upgrade' };
    const level = this.nodeLevel(nodeId);
    if (level >= node.levels.length) return { ok: false, reason: 'Maxed' };
    const next = node.levels[level];
    const cost = next.cost;
    const money = next.money;
    const reqs = level === 0 ? [...node.requires, ...(next.req ?? [])] : next.req ?? [];
    for (const r of reqs) {
      if (!this.isUnlocked(r)) return { ok: false, reason: `Requires ${requirementLabel(r)}`, cost, money };
    }
    if (this.wp < cost) return { ok: false, reason: `Need ${Math.ceil(cost - this.wp)} more WP`, cost, money };
    if (this.money < money) return { ok: false, reason: `Need $${Math.ceil(money - this.money).toLocaleString('en-US')} more`, cost, money };
    return { ok: true, cost, money };
  }

  unlock(nodeId: string): boolean {
    const chk = this.canUnlock(nodeId);
    if (!chk.ok || chk.cost === undefined) return false;
    const money = chk.money ?? 0;
    if (money > 0 && !this.spendMoney(money)) return false;
    const level = this.nodeLevel(nodeId) + 1;
    if (chk.cost > 0) {
      this.wp -= chk.cost;
      this.events.emit('wp:changed', { wp: this.wp, delta: -chk.cost });
    }
    this.nodes.set(nodeId, level);
    this.invalidateStats();
    this.events.emit('node:unlocked', { id: nodeId, level });
    this.onUnlocked?.(nodeId);
    return true;
  }

  // ===================================================================================
  // Shop
  // ===================================================================================

  buildingUnlocked(type: BuildingType): boolean {
    const req = BUILDABLES[type].requiresNode;
    return req === null || this.isUnlocked(req);
  }

  buildingCost(type: BuildingType, owned: number): number {
    const def = BUILDABLES[type];
    return Math.round(def.cost * Math.pow(def.costGrowth, Math.max(0, owned)));
  }

  canBuyTool(tool: ToolId | 'wheelbarrow'): UnlockCheck {
    let requiresNode: string | null;
    let cost: number;
    let owned: boolean;
    if (tool === 'wheelbarrow') {
      requiresNode = WHEELBARROW.requiresNode;
      cost = WHEELBARROW.cost;
      owned = this.hasWheelbarrow;
    } else {
      const def = TOOLS[tool];
      if (!def) return { ok: false, reason: 'Unknown tool' };
      requiresNode = def.requiresNode;
      cost = def.cost;
      owned = this.ownedTools.has(tool);
    }
    if (owned) return { ok: false, reason: 'Already owned', cost };
    if (requiresNode !== null && !this.isUnlocked(requiresNode)) {
      return { ok: false, reason: `Unlock ${requirementLabel(requiresNode)} in the Work Tree`, cost };
    }
    if (this.money < cost) return { ok: false, reason: `Need $${Math.ceil(cost - this.money).toLocaleString('en-US')} more`, cost };
    return { ok: true, cost };
  }

  buyTool(tool: ToolId | 'wheelbarrow'): boolean {
    const chk = this.canBuyTool(tool);
    if (!chk.ok || chk.cost === undefined) return false;
    if (!this.spendMoney(chk.cost)) return false;
    if (tool === 'wheelbarrow') this.hasWheelbarrow = true;
    else this.ownedTools.add(tool);
    this.events.emit('tool:bought', { tool });
    return true;
  }

  // ===================================================================================
  // Economy
  // ===================================================================================

  addMoney(amount: number, source: 'sale' | 'order' | 'needle' | 'milestone' | 'refund'): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.money += amount;
    if (source !== 'refund') this.stats.moneyEarned += amount;
    this.events.emit('money:changed', { money: this.money, delta: amount });
  }

  spendMoney(amount: number): boolean {
    if (!(amount >= 0) || !Number.isFinite(amount)) return false;
    if (amount === 0) return true;
    if (this.money < amount) return false;
    this.money = Math.max(0, this.money - amount);
    this.events.emit('money:changed', { money: this.money, delta: -amount });
    return true;
  }

  addWP(amount: number, _source: 'order' | 'needle' | 'milestone'): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.wp += amount;
    this.stats.wpEarned += amount;
    this.events.emit('wp:changed', { wp: this.wp, delta: amount });
  }

  recordSale(item: ItemType, amount: number, viaBelt: boolean, pos: Vec3): number {
    const def = ITEMS[item];
    if (!def || !(amount > 0) || !Number.isFinite(amount)) return 0;
    const value = amount * this.stat(def.valueStat) * this.stat('econ.hayMul') * this.stat('econ.saleMul');
    const hayEq = amount * BALANCE.hayEquivalent[item];
    const st = this.stats;
    st[SOLD_STAT[item]] += amount;
    if (viaBelt) st.hayViaBelt += hayEq;
    if (st.firstSaleAt < 0) st.firstSaleAt = st.playTime;
    this.stableBuckets[this.stableHead] += hayEq;
    this.addMoney(value, 'sale');
    this.events.emit('sale', { item, amount, value, pos: { x: pos.x, y: pos.y, z: pos.z }, viaBelt });
    return value;
  }

  /** Delivered hay-equivalent per second averaged over the last BALANCE.stableWindow seconds. */
  stableRate(): number {
    const oldest = (this.stableHead + 1) % this.stableBuckets.length;
    const f = this.stableBucketElapsed / (BALANCE.stableWindow / STABLE_BUCKETS);
    const delivered = this.stableBuckets[this.stableHead] + this.stableFullSum - this.stableBuckets[oldest] * f;
    return Math.max(0, delivered / BALANCE.stableWindow);
  }

  private advanceStableWindow(dt: number): void {
    const bucketLen = BALANCE.stableWindow / STABLE_BUCKETS;
    const buckets = this.stableBuckets;
    this.stableBucketElapsed += dt;
    if (this.stableBucketElapsed >= bucketLen * buckets.length) {
      // A gap longer than the whole window: nothing of the past remains inside it.
      buckets.fill(0);
      this.stableFullSum = 0;
      this.stableBucketElapsed %= bucketLen;
      return;
    }
    let rotated = false;
    while (this.stableBucketElapsed >= bucketLen) {
      this.stableBucketElapsed -= bucketLen;
      this.stableHead = (this.stableHead + 1) % buckets.length;
      buckets[this.stableHead] = 0;
      rotated = true;
    }
    if (rotated) {
      // Recomputed exactly (once per bucket) instead of incrementally to avoid float drift.
      let sum = 0;
      for (let i = 0; i < buckets.length; i++) if (i !== this.stableHead) sum += buckets[i];
      this.stableFullSum = sum;
    }
  }

  private resetStableWindow(): void {
    this.stableBuckets.fill(0);
    this.stableHead = 0;
    this.stableBucketElapsed = 0;
    this.stableFullSum = 0;
  }

  /** Window buckets oldest -> newest (the last one is the bucket being filled). */
  private saveStableWindow(): number[] {
    const b = this.stableBuckets;
    const out: number[] = [];
    for (let k = 1; k <= b.length; k++) out.push(b[(this.stableHead + k) % b.length]);
    return out;
  }

  /** Restores a saved window (a save without one, or of another resolution, starts empty). */
  private loadStableWindow(buckets: unknown, elapsed: unknown): void {
    this.resetStableWindow();
    const b = this.stableBuckets;
    if (!Array.isArray(buckets) || buckets.length !== b.length) return;
    for (let i = 0; i < b.length; i++) b[i] = Math.max(0, finiteOr(buckets[i], 0));
    this.stableHead = b.length - 1;
    const bucketLen = BALANCE.stableWindow / STABLE_BUCKETS;
    this.stableBucketElapsed = Math.min(Math.max(0, finiteOr(elapsed, 0)), bucketLen);
    let sum = 0;
    for (let i = 0; i < b.length; i++) if (i !== this.stableHead) sum += b[i];
    this.stableFullSum = sum;
  }

  // ===================================================================================
  // Needles
  // ===================================================================================

  onNeedleFound(id: number, by: 'manual' | 'scanner' | 'detector', pos: Vec3): number {
    const existing = this.needlesFound.indexOf(id);
    if (existing >= 0) return existing;
    this.needlesFound.push(id);
    const k = this.needlesFound.length - 1;
    this.invalidateStats();
    const buff = k < NEEDLE_BUFFS.length ? NEEDLE_BUFFS[k] : undefined;
    const money = buff?.money ?? 0;
    this.addWP(BALANCE.needleWP, 'needle');
    this.addMoney(money, 'needle');
    this.events.emit('needle:found', {
      id, index: k, pos: { x: pos.x, y: pos.y, z: pos.z }, by,
      buffName: buff?.name ?? '', buffDesc: buff?.desc ?? '',
      wp: BALANCE.needleWP, money,
    });
    return k;
  }

  // ===================================================================================
  // Flags (one-shot onboarding / analytics markers)
  // ===================================================================================

  hasFlag(flag: string): boolean { return this.flags.has(flag); }

  /** Sets a flag. Returns true if it was not set before (i.e. "do the one-shot thing now"). */
  setFlag(flag: string): boolean {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    return true;
  }

  // ===================================================================================
  // Orders
  // ===================================================================================

  activeOrders(): OrderRuntime[] { return this.active; }

  /** Money + WP actually paid for completing an order right now (money scaled by econ.orderRewardMul). */
  orderReward(def: OrderDef): { money: number; wp: number } {
    return { money: Math.round(def.reward.money * this.stat('econ.orderRewardMul')), wp: def.reward.wp };
  }

  private orderAvailable(i: number): boolean {
    for (const j of ORDER_AFTER[i]) if (j < 0 || !this.orders[j].completed) return false;
    return true;
  }

  /** Current value of a cumulative order counter. */
  private orderCounter(def: OrderDef): number {
    const s = this.stats;
    switch (def.metric) {
      case 'sell': return s[SOLD_STAT[def.item ?? 'hay']];
      case 'sellViaBelt': return s.hayViaBelt;
      case 'extractManual': return s.hayExtractedManual;
      case 'extractMachine': return s.hayExtractedMachine;
      case 'extractArm': return s.hayExtractedArm;
      case 'burn': return s.hayBurned;
      case 'scan': return s.hayScanned;
      default: return 0;
    }
  }

  /** Current progress value of order i (not clamped). */
  private orderValue(i: number, ctx: SimContext): number {
    const def = ORDERS[i];
    if (CUMULATIVE_METRICS.has(def.metric)) return this.orderCounter(def) - this.orders[i].base;
    switch (def.metric) {
      case 'needles': return this.needlesFound.length;
      case 'poweredMachines': return this.buildingMetrics(ctx).powered;
      case 'powerGen': return ctx.power.totalSupply;
      case 'siloStored': return this.buildingMetrics(ctx).silo;
      case 'stableRate': return this.stableRate();
      case 'pileProgress': return this.pileProgress(ctx);
      default: return 0;
    }
  }

  /** Activate available orders (list order) into free board slots; rebuilds the active list. */
  private fillActiveOrders(emit: boolean): void {
    let count = 0;
    for (const o of this.orders) if (o.active && !o.completed) count++;
    for (let i = 0; i < ORDERS.length && count < MAX_ACTIVE_ORDERS; i++) {
      const rt = this.orders[i];
      if (rt.active || rt.completed || !this.orderAvailable(i)) continue;
      const def = ORDERS[i];
      rt.active = true;
      rt.base = CUMULATIVE_METRICS.has(def.metric) ? this.orderCounter(def) : 0;
      rt.progress = 0;
      this.lastProgressEventAt[i] = -Infinity;
      this.lastProgressEventValue[i] = 0;
      count++;
      if (emit) this.events.emit('order:available', { id: def.id });
    }
    this.active.length = 0;
    this.activeIdx.length = 0;
    for (let i = 0; i < this.orders.length; i++) {
      const rt = this.orders[i];
      if (rt.active && !rt.completed) { this.active.push(rt); this.activeIdx.push(i); }
    }
  }

  private emitOrderProgress(i: number, progress: number): void {
    this.lastProgressEventAt[i] = this.clock;
    this.lastProgressEventValue[i] = progress;
    this.events.emit('order:progress', { id: ORDERS[i].id, progress, target: ORDERS[i].target });
  }

  private completeOrder(i: number): void {
    const def = ORDERS[i];
    const rt = this.orders[i];
    rt.progress = def.target;
    rt.completed = true;
    rt.active = false;
    this.emitOrderProgress(i, def.target);
    const reward = this.orderReward(def);
    this.addMoney(reward.money, 'order');
    this.addWP(reward.wp, 'order');
    this.events.emit('order:completed', { id: def.id, money: reward.money, wp: reward.wp });
  }

  private updateOrders(ctx: SimContext): void {
    let completed = false;
    for (let a = 0; a < this.activeIdx.length; a++) {
      const i = this.activeIdx[a];
      const def = ORDERS[i];
      const value = this.orderValue(i, ctx);
      if (value >= def.target - EPS) {
        this.completeOrder(i);
        completed = true;
        continue;
      }
      const progress = Math.max(0, value);
      const rt = this.orders[i];
      rt.progress = progress;
      if (progress !== this.lastProgressEventValue[i] && this.clock - this.lastProgressEventAt[i] >= ORDER_PROGRESS_EVENT_INTERVAL) {
        this.emitOrderProgress(i, progress);
      }
    }
    if (completed) this.fillActiveOrders(true);
  }

  // ===================================================================================
  // Milestones
  // ===================================================================================

  private milestoneValue(m: MilestoneDef, ctx: SimContext): number {
    const s = this.stats;
    switch (m.metric) {
      case 'firstSale': return s.firstSaleAt >= 0 ? 1 : 0;
      case 'haySoldTotal': return s.haySold;
      case 'baleSoldTotal': return s.baleSold;
      case 'wrappedSoldTotal': return s.wrappedSold;
      case 'moneyEarnedTotal': return s.moneyEarned;
      case 'hayScannedTotal': return s.hayScanned;
      case 'pileProgress': return this.pileProgress(ctx);
      case 'machinesOwned': return this.buildingMetrics(ctx).machines;
      case 'beltsOwned': return this.buildingMetrics(ctx).belts;
    }
  }

  private updateMilestones(ctx: SimContext): void {
    for (const m of MILESTONES) {
      if (this.milestonesDone.has(m.id)) continue;
      if (this.milestoneValue(m, ctx) < m.target - EPS) continue;
      this.milestonesDone.add(m.id);
      this.addWP(m.reward.wp, 'milestone');
      this.addMoney(m.reward.money, 'milestone');
      this.events.emit('milestone', { id: m.id, name: m.name, wp: m.reward.wp, money: m.reward.money });
    }
  }

  // ===================================================================================
  // Tick
  // ===================================================================================

  private pileProgress(ctx: SimContext): number {
    if (Number.isNaN(this.pileCache)) this.pileCache = ctx.hay.progress();
    return this.pileCache;
  }

  private buildingMetrics(ctx: SimContext): BuildingMetrics {
    if (!this.metricsValid) {
      const m = this.metrics;
      m.machines = 0; m.belts = 0; m.powered = 0; m.silo = 0;
      ctx.buildings.forEach(this.countBuilding);
      this.metricsValid = true;
    }
    return this.metrics;
  }

  tick(dt: number, ctx: SimContext): void {
    const step = dt > 0 && Number.isFinite(dt) ? dt : 0;
    this.clock += step;
    this.pileCache = NaN;
    this.metricsValid = false;
    this.advanceStableWindow(step);
    const rate = this.stableRate();
    if (rate > this.stats.peakThroughput) this.stats.peakThroughput = rate;
    this.updateOrders(ctx);
    this.updateMilestones(ctx);
  }

  // ===================================================================================
  // Save / load
  // ===================================================================================

  serialize(): ProgressSave {
    const orders: OrderState[] = this.orders.map((o) => ({ id: o.id, base: o.base, progress: o.progress, completed: o.completed, active: o.active }));
    return {
      money: this.money,
      wp: this.wp,
      nodes: [...this.nodes],
      stats: { ...this.stats },
      needlesFound: [...this.needlesFound],
      ownedTools: [...this.ownedTools],
      hasWheelbarrow: this.hasWheelbarrow,
      orders,
      milestones: [...this.milestonesDone],
      flags: [...this.flags],
      stableBuckets: this.saveStableWindow(),
      stableElapsed: this.stableBucketElapsed,
    };
  }

  deserialize(s: ProgressSave): void {
    this.money = Math.max(0, finiteOr(s.money, 0));
    this.wp = Math.max(0, finiteOr(s.wp, 0));

    this.nodes.clear();
    for (const [id, level] of s.nodes ?? []) {
      const node = TECH_BY_ID[id];
      const lv = Math.min(Math.floor(finiteOr(level, 0)), node?.levels.length ?? 0);
      if (node && lv >= 1) this.nodes.set(id, lv);
    }

    const fresh = createRunStats();
    for (const key of Object.keys(fresh) as (keyof RunStats)[]) this.stats[key] = finiteOr(s.stats?.[key], fresh[key]);

    this.needlesFound.length = 0;
    for (const id of s.needlesFound ?? []) if (Number.isInteger(id) && !this.needlesFound.includes(id)) this.needlesFound.push(id);

    this.ownedTools.clear();
    this.ownedTools.add('hands');
    for (const t of s.ownedTools ?? []) if (TOOL_ORDER.includes(t)) this.ownedTools.add(t);
    this.hasWheelbarrow = s.hasWheelbarrow === true;

    const saved = new Map<string, Partial<OrderState>>();
    for (const o of (s.orders ?? []) as Partial<OrderState>[]) if (o && typeof o.id === 'string') saved.set(o.id, o);
    let slots = MAX_ACTIVE_ORDERS;
    this.orders.forEach((rt, i) => {
      const o = saved.get(rt.id);
      rt.completed = o?.completed === true;
      rt.base = finiteOr(o?.base, 0);
      rt.progress = rt.completed ? ORDERS[i].target : Math.max(0, finiteOr(o?.progress, 0));
      rt.active = !rt.completed && o?.active === true && slots > 0 && this.orderAvailable(i);
      if (rt.active) slots--;
      this.lastProgressEventAt[i] = -Infinity;
      this.lastProgressEventValue[i] = rt.progress;
    });
    this.fillActiveOrders(false);

    this.milestonesDone.clear();
    for (const id of s.milestones ?? []) if (MILESTONES.some((m) => m.id === id)) this.milestonesDone.add(id);

    this.flags.clear();
    for (const f of s.flags ?? []) if (typeof f === 'string') this.flags.add(f);

    this.loadStableWindow(s.stableBuckets, s.stableElapsed);
    this.clock = 0;
    this.invalidateStats();
  }
}
