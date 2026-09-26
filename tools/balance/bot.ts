/**
 * BALANCE BOT — plays a full run headless with the REAL simulation and the same player actions the game uses.
 * No cheats: it earns money/WP legitimately, walks (time passes while walking), digs with cooldowns, sells at the
 * Market Chute, unlocks tech, buys tools and builds a factory with real placements, belts and power.
 *
 * Factory layout ("trunk"): one main belt along row z = 0 from the pile's west foot to the Market Chute.
 * Going downstream (west): rake at the trunk head -> arms / side rakes / collectors side-loading along it ->
 * hand-dump hopper -> scanner -> fuel splitter (2 generators) -> processing splitter (bypass to the chute's
 * north input) -> silo -> compressor -> wrapper -> chute. The trunk grows east into the pile as it is cleared
 * and starved extractors are moved forward, like a player would.
 *
 * It is a reasonable (not optimal) player. Its timeline is used to tune pacing towards 50-70 minutes.
 */
import { BALANCE } from '../../src/config/balance';
import { ORDER_BY_ID } from '../../src/config/orders';
import { TECH_BY_ID } from '../../src/config/techTree';
import { WORLD } from '../../src/config/world';
import type { Building } from '../../src/sim/building';
import { buildingCenter, localToOffset, rotatedSize } from '../../src/sim/grid';
import { BUILDABLES } from '../../src/config/buildables';
import {
  carryCapacity, detectorReading, playerDig, playerVacuum, spawnWheelbarrow, toggleWheelbarrow,
} from '../../src/sim/playerActions';
import { Sim } from '../../src/sim/sim';
import { DIR_DX, DIR_DZ, oppositeDir, type BuildingType, type Cell, type Dir, type Rot, type ToolId } from '../../src/sim/types';

export interface TimelineEntry { t: number; kind: string; detail: string }

export interface BotOptions {
  seed: number;
  maxMinutes: number;
  /** Extra human overhead multiplier on action durations (1.15 = 15% slower than perfect). */
  humanFactor: number;
  verbose: boolean;
}

/** State captured at every meaningful decision (gap analysis). */
export interface DecisionEntry {
  t: number; event: string; money: number; wp: number; delivered: number; extract: number; power: string;
  savingWP: string; waitingMoney: string; orders: string; needles: number;
}

export interface Gap { from: DecisionEntry; to: DecisionEntry; seconds: number }

export interface Snapshot {
  t: number; money: number; wp: number; pile: number; needles: number;
  extract: number; delivered: number; power: string; machines: number; bottleneck: string;
}

const DT = BALANCE.tickDt;

/**
 * Work Tree priority, roughly the GDD's intended order. The bot SAVES for the first node it can reach
 * (prerequisites met) instead of spending WP on anything cheaper further down.
 */
const TECH_PRIORITY: string[] = [
  'p_grab', 'p_carry', 'p_shovel', 'p_bucket', 'p_detector', 'p_pitchfork', 'p_wide_shovel', 'p_quick_scoop', 'p_wheelbarrow',
  'x_hopper', 'f_generator', 'x_rake', 'l_conveyor', 'f_pole', 'x_rake_auto', 'l_splitter', 'p_det_range', 'x_rake_speed',
  'x_arm', 'f_autofeed', 'f_gen_output', 'd_scanner', 'x_arm_grab', 'x_arm_speed', 'l_speed', 'e_silo', 'e_compressor',
  'x_arm_reach', 'd_speed', 'f_firebox', 'd_batch', 'e_comp_speed', 'e_wrapper', 'x_collector', 'd_mk2', 'p_det_depth',
  'f_pole_conn', 'x_rake_push', 'x_hopper_out', 'p_vacuum', 'e_bale_value', 'f_fuel_eff', 'x_arm_mk2', 'l_capacity',
  'f_industrial_gen', 'e_double_chamber', 'e_wrap_speed', 'e_wrapped_value', 'e_premium_wrap', 'x_col_suction',
  'x_col_radius', 'd_mk2_speed', 'e_order_reward', 'e_hay_value', 'e_silo_out', 'f_pole_range', 'x_rake_width',
  'x_rake_industrial', 'x_arm_rotation', 'x_arm_smart', 'p_det_precision', 'p_det_direction', 'd_buffer', 'd_eject',
  'x_col_output', 'x_col_efficiency', 'x_col_turbine', 'p_move', 'p_barrow_cap', 'p_faster_push', 'p_fork_speed',
  'p_wider_tines', 'p_vac_suction', 'p_vac_range', 'e_batch_eff', 'e_silo_cap', 'e_silo_in', 'l_merger', 'l_priority',
  'l_overflow', 'f_power_loss', 'd_dual_lane', 'x_hopper_cap', 'x_hopper_dual', 'e_silo_dual',
];

const TOOL_PRIORITY: (ToolId | 'wheelbarrow')[] = ['shovel', 'bucket', 'detector', 'pitchfork', 'wheelbarrow', 'vacuum'];

// ----- Layout (row z = TZ, items flow west) --------------------------------------------------------
const TZ = 0;
const CORNER_X = -29;           // trunk turns south here, enters the chute's east input at (-30, 5)
const WRAP_X = -28;             // wrapper cells x -28..-26
const COMP_X = -24;             // compressor cells x -24..-22
const SILO_X = -20;             // silo cells x -20..-18 (z -1..1)
const PROC_SPLIT_X = -17;       // processing splitter; north output = bypass
const FUEL_SPLIT_X = -15;       // fuel splitter: generators south/north
const GEN_SLOTS: { cell: Cell; rot: Rot }[] = [
  { cell: { x: -16, z: 1, level: 0 }, rot: 1 },   // input at (-15, 1) facing north
  { cell: { x: -16, z: -3, level: 0 }, rot: 3 },  // input at (-15, -1) facing south
];
const SCAN_X = -13;             // scanner MK1 cells x -13..-11 (MK2: -13..-10)
const HOPPER_CELL: Cell = { x: -10, z: 1, level: 0 }; // rot 3: output at (-10, 1) facing north onto the trunk
/** North feeder hopper (rot 1): output at (-9, -1) facing south onto the trunk; input at (-10, -2) from (-10, -3). */
const HOPPER_N_CELL: Cell = { x: -10, z: -2, level: 0 };
/** Feeder arcs around the pile foot: row z = +-ARC_Z flowing west, then along x = -10 into the hoppers. */
const ARC_Z = 12;
const ARC_X_EAST = 17;
const HEAD_X0 = -9;             // initial trunk head
const RAKE_X0 = -8;             // head rake (rot 0) cells x -8..-7, z -1..1

type Stage = 'manual' | 'rake' | 'trunk';

/** Cells reserved by the layout (poles must never land there). [x0, z0, x1, z1] inclusive. */
const RESERVED: [number, number, number, number][] = [
  [-31, -5, 20, -4],              // bypass row z = -4 (and a margin)
  [-31, -5, -29, 9],              // chute columns
  [-30, -1, -9, 1],               // trunk + inline machines (z -1..1)
  [-17, -4, -14, 4],              // generators + splitters
  [HOPPER_N_CELL.x, HOPPER_N_CELL.z, HOPPER_N_CELL.x + 1, HOPPER_N_CELL.z + 1],
  [HOPPER_CELL.x, HOPPER_CELL.z, HOPPER_CELL.x + 1, HOPPER_CELL.z + 1],
  [-11, -ARC_Z, -10, ARC_Z],      // arc columns
  [-11, ARC_Z, ARC_X_EAST, ARC_Z], [-11, -ARC_Z, ARC_X_EAST, -ARC_Z], // arc rows
];
/** Seconds a human spends per placement (shop, aim, rotate, confirm) and per moved machine. */
const BUILD_TIME_MACHINE = 5;
const BUILD_TIME_BELT = 0.8;
const MOVE_TIME = 6;

const isReserved = (x: number, z: number): boolean => RESERVED.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);

export class Bot {
  readonly sim: Sim;
  readonly log: TimelineEntry[] = [];
  readonly snapshots: Snapshot[] = [];
  /** Longest stretch (s) with no new purchase/unlock/order/needle. */
  longestNoDecision = 0;
  longestNoDecisionAt = 0;
  readonly decisions: DecisionEntry[] = [];
  /** Tech node the bot is saving Work Points for ('' = none). */
  private savingWP = '';
  private lastUnlockAt = 0;
  /** Building the bot wants but cannot afford yet ('' = none). */
  private waitingMoney = '';
  private lastDecisionAt = 0;
  private detectorSweepAt = -1e9;
  private headX = HEAD_X0;
  private trunkBuilt = false;
  private bypassBuilt = false;
  private arcs = { south: false, north: false };
  /** A build site blocked by hay: manual digging goes there until it is clear. */
  private digFocus: { x: number; z: number } | null = null;
  private digFocusSince = -1;
  private starvedSince = new Map<number, number>();
  private lastSnapshot = 0;
  private lastFactoryCheck = -1e9;
  stage: Stage = 'manual';

  constructor(private readonly opts: BotOptions) {
    this.sim = new Sim(opts.seed);
    const ev = this.sim.events;
    ev.on('node:unlocked', (e) => this.mark('unlock', `${e.id} L${e.level}`));
    ev.on('tool:bought', (e) => this.mark('tool', String(e.tool)));
    ev.on('building:placed', (e) => { if (e.type !== 'conveyor') this.mark('build', e.type); });
    ev.on('order:completed', (e) => this.mark('order', `${e.id} +$${e.money} +${e.wp}WP`));
    ev.on('needle:found', (e) => this.mark('NEEDLE', `#${e.index + 1} by ${e.by} (${e.buffName}) pile=${(this.sim.hay.progress() * 100).toFixed(1)}%`));
    ev.on('needle:returned', (e) => this.mark('needleReturned', `#${e.id} from ${e.where}`, false));
    ev.on('milestone', (e) => this.mark('milestone', `${e.name} +${e.wp}WP`, false));
    ev.on('game:completed', () => this.mark('COMPLETE', `${(this.sim.time / 60).toFixed(1)} min`));
  }

  private mark(kind: string, detail: string, decision = true): void {
    const t = this.sim.time;
    this.log.push({ t, kind, detail });
    if (decision) {
      if (t - this.lastDecisionAt > this.longestNoDecision) { this.longestNoDecision = t - this.lastDecisionAt; this.longestNoDecisionAt = this.lastDecisionAt; }
      this.lastDecisionAt = t;
      this.decisions.push(this.stateEntry(`${kind} ${detail}`));
    }
    if (this.opts.verbose) console.log(`${fmt(t)}  ${kind.padEnd(14)} ${detail}`);
  }

  private stateEntry(event: string): DecisionEntry {
    const sim = this.sim;
    let extract = 0;
    for (const b of sim.buildings.values()) {
      if (b.type === 'pistonRake' || b.type === 'roboticArm' || b.type === 'vacuumCollector') extract += b.rateOut.value;
    }
    const orders = sim.progress.activeOrders().map((o) => `${o.id}:${Math.round(o.progress)}`).join(' ');
    return {
      t: sim.time, event, money: Math.round(sim.progress.money), wp: sim.progress.wp,
      delivered: Math.round(sim.progress.stableRate()), extract: Math.round(extract),
      power: `${Math.round(sim.power.totalDemand)}/${Math.round(sim.power.totalSupply)}`,
      savingWP: this.savingWP, waitingMoney: this.waitingMoney, orders, needles: sim.progress.needlesFound.length,
    };
  }

  /** Stretches longer than `limit` seconds without a decision, with the state at both ends. */
  gaps(limit = 240): Gap[] {
    const out: Gap[] = [];
    const list = [this.stateEntry('start'), ...this.decisions];
    list[0].t = 0;
    for (let i = 1; i < list.length; i++) {
      const dt = list[i].t - list[i - 1].t;
      if (dt > limit) out.push({ from: list[i - 1], to: list[i], seconds: dt });
    }
    return out;
  }

  // =====================================================================================
  // Time & movement
  // =====================================================================================

  private advance(seconds: number): void {
    const n = Math.max(1, Math.round((seconds * this.opts.humanFactor) / DT));
    for (let i = 0; i < n; i++) {
      this.sim.tick(DT);
      const wb = this.sim.player.wheelbarrow;
      if (wb?.held) { wb.pos.x = this.sim.player.pos.x + 1; wb.pos.z = this.sim.player.pos.z; }
      if (this.sim.time - this.lastSnapshot >= 300) this.snapshot();
    }
  }

  private moveTo(x: number, z: number): void {
    const p = this.sim.player.pos;
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist < 0.05) return;
    let speed = this.sim.stat('player.moveSpeed') * (dist > 6 ? this.sim.stat('player.sprintMul') : 1);
    if (this.sim.player.wheelbarrow?.held) speed *= this.sim.stat('wheelbarrow.speedMul');
    this.advance(dist / speed + 0.3);
    p.x = x; p.z = z;
    p.y = Math.max(0, this.sim.hay.heightAt(x, z) - 0.1);
  }

  private snapshot(): void {
    const sim = this.sim;
    this.lastSnapshot = sim.time;
    let extract = 0;
    let bottleneck = '';
    for (const b of sim.buildings.values()) {
      if (b.type === 'pistonRake' || b.type === 'roboticArm' || b.type === 'vacuumCollector') extract += b.rateOut.value;
    }
    const trunk = sim.buildingAtCell(CORNER_X + 1, TZ, 0);
    const scanner = sim.buildingsOfType('scannerMk1')[0] ?? sim.buildingsOfType('scannerMk2')[0];
    const blockedArms = sim.buildingsOfType('roboticArm').filter((a) => a.status === 'outputBlocked').length;
    if (blockedArms) bottleneck += `arms blocked x${blockedArms} `;
    if (scanner && (scanner.status === 'running' || scanner.status === 'processing') && scanner.info(sim).lines.some((l) => l.tone === 'warn')) bottleneck += 'scanner full ';
    if (sim.power.totalDemand > sim.power.totalSupply + 0.5) bottleneck += `power ${Math.round(sim.power.totalDemand)}/${Math.round(sim.power.totalSupply)} `;
    const comp = sim.buildingsOfType('compressor')[0];
    if (comp && comp.status === 'outputBlocked') bottleneck += 'compressor blocked ';
    void trunk;
    this.snapshots.push({
      t: sim.time, money: Math.round(sim.progress.money), wp: sim.progress.wp, pile: +(sim.hay.progress() * 100).toFixed(1),
      needles: sim.progress.needlesFound.length, extract: Math.round(extract), delivered: Math.round(sim.progress.stableRate()),
      power: `${Math.round(sim.power.totalDemand)}/${Math.round(sim.power.totalSupply)}`,
      machines: sim.progress.stats.machinesBuilt, bottleneck: bottleneck.trim(),
    });
  }

  // =====================================================================================
  // Economy decisions
  // =====================================================================================

  private spendWP(): void {
    const pr = this.sim.progress;
    this.savingWP = '';
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of TECH_PRIORITY) {
        const node = TECH_BY_ID[id];
        if (!node) continue;
        const level = pr.nodeLevel(id);
        if (level >= node.levels.length) continue;
        if (!node.requires.every((r) => pr.isUnlocked(r))) continue;
        if (pr.canUnlock(id).ok) { pr.unlock(id); this.lastUnlockAt = this.sim.time; changed = true; break; }
        // Reachable but not affordable: save WP for it - unless saving has dragged on; then, like a player,
        // grab the cheapest upgrade that is affordable right now.
        this.savingWP = `${id} (${node.levels[level].cost} WP)`;
        if (node.levels[level].cost >= 4 && pr.wp < node.levels[level].cost - 1 && this.sim.time - this.lastUnlockAt > 150) {
          let cheapest: string | null = null, cost = Infinity;
          for (const other of TECH_PRIORITY) {
            const o = TECH_BY_ID[other];
            if (!o || !pr.canUnlock(other).ok) continue;
            const c = o.levels[pr.nodeLevel(other)].cost;
            if (c < cost) { cost = c; cheapest = other; }
          }
          if (cheapest) { pr.unlock(cheapest); this.lastUnlockAt = this.sim.time; changed = true; break; }
        }
        return;
      }
    }
  }

  private buyTools(): void {
    const pr = this.sim.progress;
    for (const t of TOOL_PRIORITY) {
      if (t === 'wheelbarrow' ? pr.hasWheelbarrow : pr.ownedTools.has(t)) continue;
      if (pr.canBuyTool(t).ok && pr.buyTool(t)) {
        if (t === 'wheelbarrow') spawnWheelbarrow(this.sim);
      }
    }
  }

  private bestDigTool(): ToolId {
    const pr = this.sim.progress;
    let best: ToolId = 'hands', bestRate = 0;
    for (const t of ['hands', 'shovel', 'bucket', 'pitchfork'] as ToolId[]) {
      if (!pr.ownedTools.has(t)) continue;
      const rate = this.sim.stat(`tool.${t}.dig`) / this.sim.stat(`tool.${t}.interval`);
      if (rate > bestRate) { bestRate = rate; best = t; }
    }
    if (pr.ownedTools.has('vacuum') && this.sim.stat('tool.vacuum.rate') > bestRate) return 'vacuum';
    return best;
  }

  // =====================================================================================
  // Manual work
  // =====================================================================================

  /** Where the bot drops its hay: the hand-dump hopper once the trunk carries it, else the chute. */
  private dropTarget(): { b: Building; x: number; z: number } {
    const sim = this.sim;
    const hopper = sim.buildingsOfType('hopper')[0];
    if (hopper && this.trunkBuilt && sim.logistics.isLinked(hopper, 6) && hopper.contents().weight() < sim.stat('hopper.capacity') * 0.6) {
      const c = hopper.center;
      return { b: hopper, x: c.x - 0.5, z: c.z + 2 };
    }
    const s = sim.sellStation!;
    const c = s.center;
    return { b: s, x: c.x + 2.3, z: c.z };
  }

  /** Dig until carry (and a parked barrow nearby) is full. */
  private digTrip(): number {
    const sim = this.sim;
    const dp = this.dropTarget();
    const focus = this.digFocus ? sim.hay.findTarget(this.digFocus.x, this.digFocus.z, 1.5, 'densest') : null;
    if (this.digFocus && !focus) this.digFocus = null;
    const near = focus ?? sim.hay.findTarget(dp.x, dp.z, 90, 'nearest');
    if (!near) return 0;
    // Walk a little further in to a thick spot (a player does not scrape the thin carpet at the foot).
    const target = focus ?? sim.hay.findTarget(near.x, near.z, 7, 'densest') ?? near;
    const tool = this.bestDigTool();
    sim.player.equipped = tool;
    const reach = tool === 'vacuum' ? sim.stat('tool.vacuum.reach') : sim.stat(`tool.${tool}.reach`);
    const dx = dp.x - target.x, dz = dp.z - target.z, dl = Math.hypot(dx, dz) || 1;
    const standX = target.x + (dx / dl) * Math.min(reach * 0.7, 2), standZ = target.z + (dz / dl) * Math.min(reach * 0.7, 2);
    const wb = sim.player.wheelbarrow;
    if (wb?.held) { this.moveTo(standX, standZ); toggleWheelbarrow(sim); }
    else this.moveTo(standX, standZ);
    let got = 0;
    let guard = 0;
    let poor = 0;
    const perAction = tool === 'vacuum' ? sim.stat('tool.vacuum.rate') * 0.25 : sim.stat(`tool.${tool}.dig`);
    while (guard++ < 600) {
      const t2 = sim.hay.findTarget(standX, standZ, reach, 'densest') ?? sim.hay.findTarget(standX, standZ, reach, 'nearest');
      if (!t2) break;
      if (tool === 'vacuum') {
        const r = playerVacuum(sim, 0.25, t2.x, t2.height, t2.z);
        this.advance(0.25);
        got += r.amount;
        if (r.full || r.amount <= 0) break;
      } else {
        const r = playerDig(sim, tool, t2.x, t2.height, t2.z);
        got += r.amount;
        this.advance(sim.stat(`tool.${tool}.interval`));
        if (r.full) break;
        poor = r.amount < perAction * 0.3 ? poor + 1 : 0;
        if (poor >= 4) break;
      }
    }
    return got;
  }

  private sellTrip(): void {
    const sim = this.sim;
    const wb = sim.player.wheelbarrow;
    if (wb && !wb.held && Math.hypot(wb.pos.x - sim.player.pos.x, wb.pos.z - sim.player.pos.z) < 8) {
      this.moveTo(wb.pos.x - 1, wb.pos.z);
      toggleWheelbarrow(sim);
    }
    // Feed hungry generators on the way (manual stoking) until Auto Feed is running.
    for (const g of sim.buildingsOfType('hayGenerator')) {
      const fed = sim.stat('generator.autoFeed') >= 1 && sim.logistics.isLinked(sim.buildingAtCell(FUEL_SPLIT_X, TZ, 0) ?? g, 0);
      if (!fed && (g.anim.fuel ?? 0) < 0.5 && !sim.player.carry.isEmpty()) {
        const c = g.center; this.moveTo(c.x, c.z + 2.5); g.interact(sim); this.advance(0.5);
      }
    }
    const dp = this.dropTarget();
    this.moveTo(dp.x, dp.z);
    dp.b.interact(sim);
    this.advance(0.6);
  }

  /** Empty rake trays that are not connected to a belt yet. */
  private emptyTrays(): void {
    const sim = this.sim;
    for (const r of [...sim.buildingsOfType('pistonRake'), ...sim.buildingsOfType('compressor')]) {
      if (sim.logistics.isLinked(r, r.type === 'pistonRake' ? 0 : 2)) continue;
      const inv = r.contents();
      if (inv.weight() < 30) continue;
      const c = r.center;
      this.moveTo(c.x - 2, c.z);
      r.interact(sim);
      this.advance(0.6);
      this.sellTrip();
    }
  }

  private detectorSweep(): void {
    const sim = this.sim;
    if (!sim.progress.ownedTools.has('detector')) return;
    const interval = sim.progress.needlesFound.length >= 3 ? 240 : 150;
    if (sim.time - this.detectorSweepAt < interval) return;
    this.detectorSweepAt = sim.time;
    sim.player.equipped = 'detector';
    const P = WORLD.pile;
    const range = sim.stat('tool.detector.range');
    for (let z = P.cz - P.rz; z <= P.cz + P.rz; z += range * 1.4) {
      for (let x = P.cx - P.rx; x <= P.cx + P.rx; x += 2) {
        this.moveTo(x, z);
        const r = detectorReading(sim);
        if (r.strength > 0.05 && r.needleId >= 0) {
          const n = sim.hay.needles.find((q) => q.id === r.needleId);
          if (!n) continue;
          const d = Math.hypot(n.pos.x - x, n.pos.z - z);
          this.advance((d * 1.5) / sim.stat('player.moveSpeed'));
          sim.player.pos.x = n.pos.x - 1; sim.player.pos.z = n.pos.z;
          const tool = this.bestDigTool();
          sim.player.equipped = tool === 'vacuum' ? (sim.progress.ownedTools.has('pitchfork') ? 'pitchfork' : 'shovel') : tool;
          const t2 = sim.player.equipped;
          let guard = 0;
          while (n.status !== 'found' && guard++ < 400) {
            if (n.status === 'exposed') { this.advance(0.5); sim.foundNeedle(n.id, 'detector', n.pos); break; }
            const h = sim.hay.heightAt(n.pos.x, n.pos.z);
            const res = playerDig(sim, t2, n.pos.x, h, n.pos.z);
            this.advance(sim.stat(`tool.${t2}.interval`));
            if (res.full) { this.sellTrip(); sim.player.pos.x = n.pos.x - 1; sim.player.pos.z = n.pos.z; }
          }
          return;
        }
      }
    }
  }

  // =====================================================================================
  // Building helpers
  // =====================================================================================

  /** Walk next to a site (not onto it) and place. */
  private tryPlace(type: BuildingType, cell: Cell, rot: Rot, variant?: string): Building | null {
    const sim = this.sim;
    if (!sim.progress.buildingUnlocked(type)) return null;
    this.standClearOf(cell);
    const chk = sim.canPlace(type, cell, rot, variant);
    if (!chk.ok) return null;
    const b = sim.place(type, cell, rot, variant);
    if (b) {
      sim.rebuildTopology();
      // Human build overhead: pick the item in the shop, aim, rotate, confirm (belts are dragged).
      this.advance(type === 'conveyor' ? BUILD_TIME_BELT : BUILD_TIME_MACHINE);
    }
    return b;
  }

  private standClearOf(cell: Cell): void {
    const p = this.sim.player.pos;
    const tx = cell.x + 0.5, tz = cell.z < TZ ? cell.z - 4.5 : cell.z + 5.5;
    if (Math.hypot(p.x - tx, p.z - tz) > 3) this.moveTo(tx, tz);
  }

  private removeAt(x: number, z: number): boolean {
    const b = this.sim.buildingAtCell(x, z, 0);
    return b ? this.sim.remove(b.id) : true;
  }

  /** Replace trunk belts under a machine footprint (x0..x1 on the trunk row) with the machine. */
  private insertMachine(type: BuildingType, cell: Cell, rot: Rot, x0: number, x1: number): Building | null {
    const sim = this.sim;
    if (!sim.progress.buildingUnlocked(type)) return null;
    if (sim.progress.money < sim.nextCost(type) + 200) { this.waitingMoney ||= `${type} ($${sim.nextCost(type)})`; return null; }
    const removed: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const b = sim.buildingAtCell(x, TZ, 0);
      if (b && b.type !== 'conveyor') return null;
      if (b) { sim.remove(b.id); removed.push(x); }
    }
    const m = this.tryPlace(type, cell, rot);
    if (!m) { for (const x of removed) this.tryPlace('conveyor', { x, z: TZ, level: 0 }, 2); return null; }
    this.ensurePower(m);
    return m;
  }

  /** Make sure a powered building is on a network: place poles (chained if needed). */
  private ensurePower(b: Building): void {
    const sim = this.sim;
    if (!b.needsPower) return;
    sim.rebuildTopology();
    const live = (n: number) => n >= 0 && (sim.power.networks[n]?.generators.length ?? 0) > 0;
    if (live(b.network)) return;
    if (!sim.progress.buildingUnlocked('powerPole')) return;
    const range = sim.stat('pole.range');
    for (let guard = 0; guard < 5 && !live(b.network); guard++) {
      // Only chain from poles that actually reach a generator (never extend an island).
      const nodes = [...sim.buildingsOfType('powerPole').filter((p) => live(p.network)), ...sim.buildingsOfType('hayGenerator')];
      if (!nodes.length) return;
      const c = b.center;
      let best: { cell: Cell; score: number } | null = null;
      for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
        const cell: Cell = { x: Math.floor(c.x) + dx, z: Math.floor(c.z) + dz, level: 0 };
        if (isReserved(cell.x, cell.z)) continue;
        const pc = { x: cell.x + 0.5, z: cell.z + 0.5 };
        const dMachine = Math.hypot(pc.x - c.x, pc.z - c.z);
        if (dMachine > range - 0.5) continue;
        let dNet = Infinity;
        for (const n of nodes) dNet = Math.min(dNet, Math.hypot(n.center.x - pc.x, n.center.z - pc.z));
        if (!sim.canPlace('powerPole', cell, 0).ok) continue;
        const score = dNet <= range - 0.3 ? dMachine : 1000 + dNet;
        if (!best || score < best.score) best = { cell, score };
      }
      if (!best) return;
      if (best.score >= 1000) {
        // Chain towards the nearest network node: place a pole range-1 away from it towards the machine.
        let near = nodes[0];
        for (const n of nodes) if (Math.hypot(n.center.x - c.x, n.center.z - c.z) < Math.hypot(near.center.x - c.x, near.center.z - c.z)) near = n;
        const dx = c.x - near.center.x, dz = c.z - near.center.z, d = Math.hypot(dx, dz) || 1;
        const k = Math.min(range - 1, d);
        const tx = Math.floor(near.center.x + (dx / d) * k), tz = Math.floor(near.center.z + (dz / d) * k);
        let placed = false;
        for (let r = 0; r <= 2 && !placed; r++) for (let ox = -r; ox <= r && !placed; ox++) for (let oz = -r; oz <= r && !placed; oz++) {
          const cell: Cell = { x: tx + ox, z: tz + oz, level: 0 };
          if (isReserved(cell.x, cell.z)) continue;
          if (this.tryPlace('powerPole', cell, 0)) placed = true;
        }
        if (!placed) return;
      } else if (!this.tryPlace('powerPole', best.cell, 0)) return;
      sim.rebuildTopology();
    }
  }

  // =====================================================================================
  // Factory
  // =====================================================================================

  private buildFactory(): void {
    const sim = this.sim;
    const pr = sim.progress;
    this.waitingMoney = '';
    const money = () => pr.money;

    // 1) First generator + head rake (tray emptied by hand until the trunk exists).
    // A player builds and stokes the generator as soon as its plan is unlocked (the Stoke the Fire order asks for it).
    if (sim.ownedCount('hayGenerator') === 0 && pr.buildingUnlocked('hayGenerator') && money() >= sim.nextCost('hayGenerator')) {
      const g = this.tryPlace('hayGenerator', GEN_SLOTS[0].cell, GEN_SLOTS[0].rot);
      if (g) this.stage = 'rake';
    }
    if (sim.ownedCount('pistonRake') === 0 && sim.ownedCount('hayGenerator') > 0 && money() >= sim.nextCost('pistonRake')) {
      // Preferred spot at the pile foot; after a minute of clearing hay, settle for one metre further out.
      let r = this.placeHeadRake(RAKE_X0);
      if (!r && this.digFocusSince >= 0 && sim.time - this.digFocusSince > 150) {
        // One metre further out; lift the trunk's head belt if it is already there.
        const x = RAKE_X0 - 1;
        const belt = sim.buildingAtCell(x, TZ, 0);
        if (belt?.type === 'conveyor') sim.remove(belt.id);
        r = this.placeHeadRake(x);
        if (!r && belt?.type === 'conveyor') this.tryPlace('conveyor', { x, z: TZ, level: 0 }, 2);
      }
      if (r) this.ensurePower(r);
    }

    // 2) The trunk: hopper + belts from the head to the chute.
    const rakeReady = sim.ownedCount('pistonRake') > 0 || !pr.buildingUnlocked('pistonRake');
    if (!this.trunkBuilt && rakeReady && pr.buildingUnlocked('conveyor') && pr.buildingUnlocked('hopper')
      && money() >= sim.nextCost('hopper') + 30 * sim.nextCost('conveyor')) {
      this.buildTrunk();
    }
    if (!this.trunkBuilt) {
      for (const b of [...sim.buildings.values()]) if (b.needsPower && b.status === 'noPower') this.ensurePower(b);
      return;
    }

    // A fallback head rake (one metre out) goes back to its proper spot as soon as it fits.
    const fallback = sim.buildingsOfType('pistonRake').find((r) => r.rot === 0 && r.cell.z === TZ - 1 && r.cell.x < RAKE_X0);
    if (fallback && sim.canMove(fallback.id, { x: RAKE_X0, z: TZ - 1, level: 0 }, 0).ok) {
      const oldX = fallback.cell.x;
      sim.move(fallback.id, { x: RAKE_X0, z: TZ - 1, level: 0 }, 0);
      this.advance(MOVE_TIME);
      for (let x = oldX; x < RAKE_X0; x++) if (!sim.buildingAtCell(x, TZ, 0)) this.tryPlace('conveyor', { x, z: TZ, level: 0 }, 2);
      sim.rebuildTopology();
    } else if (fallback && !this.digFocus) this.digFocus = { x: RAKE_X0 + 1, z: TZ + 0.5 };

    // Keep the head rake fed and the trunk growing into the cleared pile.
    this.advanceHead();

    // 3) Inline machines, in the GDD's order, as plans and money allow.
    const at = (x: number) => sim.buildingAtCell(x, TZ, 0);
    if (at(SCAN_X)?.type === 'conveyor' && pr.buildingUnlocked('scannerMk1')) {
      if (this.insertMachine('scannerMk1', { x: SCAN_X, z: TZ - 1, level: 0 }, 2, SCAN_X, SCAN_X + 2)) this.mark('line', 'scanner MK1 on the trunk');
    }
    // Scanner MK2: into the south feeder arc next to its corner (4 free cells; the MK1 stays on the trunk).
    if (this.arcs.south && !sim.buildingsOfType('scannerMk2').length && pr.buildingUnlocked('scannerMk2')
      && money() >= sim.nextCost('scannerMk2') + 2000) {
      const cell: Cell = { x: -9, z: ARC_Z - 1, level: 0 };
      const removed: { x: number; z: number; type: BuildingType; rot: Rot }[] = [];
      for (let x = -9; x <= -6; x++) for (const z of [ARC_Z - 1, ARC_Z]) {
        const b = sim.buildingAtCell(x, z, 0);
        if (b && (b.type === 'conveyor' || b.type === 'roboticArm' || b.type === 'powerPole')) { removed.push({ x: b.cell.x, z: b.cell.z, type: b.type, rot: b.rot }); sim.remove(b.id); }
      }
      const mk2 = this.tryPlace('scannerMk2', cell, 2);
      if (mk2) { this.ensurePower(mk2); this.mark('line', 'scanner MK2 on the south arc'); }
      else for (const r of removed) if (r.type === 'conveyor') this.tryPlace('conveyor', { x: r.x, z: r.z, level: 0 }, r.rot);
    }
    // Fuel splitter + second generator (Auto Feed).
    if (at(FUEL_SPLIT_X)?.type === 'conveyor' && pr.buildingUnlocked('splitter') && pr.isUnlocked('f_autofeed') && money() >= sim.nextCost('splitter') + 100) {
      if (this.insertMachine('splitter', { x: FUEL_SPLIT_X, z: TZ, level: 0 }, 2, FUEL_SPLIT_X, FUEL_SPLIT_X)) this.mark('line', 'fuel splitter (auto feed)');
    }
    // Processing bypass: splitter + belt round to the chute's north input.
    if (!this.bypassBuilt && pr.buildingUnlocked('splitter') && (pr.buildingUnlocked('silo') || pr.buildingUnlocked('compressor'))
      && money() >= sim.nextCost('splitter') + 40 * sim.nextCost('conveyor')) {
      this.buildBypass();
    }
    if (this.bypassBuilt) {
      if (at(SILO_X + 1)?.type === 'conveyor' && pr.buildingUnlocked('silo')) {
        if (this.insertMachine('silo', { x: SILO_X, z: TZ - 1, level: 0 }, 2, SILO_X, SILO_X + 2)) this.mark('line', 'silo');
      }
      if (at(COMP_X + 1)?.type === 'conveyor' && pr.buildingUnlocked('compressor')) {
        if (this.insertMachine('compressor', { x: COMP_X, z: TZ - 1, level: 0 }, 2, COMP_X, COMP_X + 2)) this.mark('line', 'compressor');
      }
      if (at(WRAP_X + 1)?.type === 'conveyor' && sim.buildingsOfType('compressor').length && pr.buildingUnlocked('wrapper')) {
        if (this.insertMachine('wrapper', { x: WRAP_X, z: TZ - 1, level: 0 }, 2, WRAP_X, WRAP_X + 2)) this.mark('line', 'wrapper');
      }
    }

    // 4) Power: second generator when short, generator upgrades are tech.
    const short = sim.power.totalDemand > sim.power.totalSupply * 0.95;
    if (short && sim.ownedCount('hayGenerator') < GEN_SLOTS.length && money() >= sim.nextCost('hayGenerator') * 1.2) {
      const slot = GEN_SLOTS[sim.ownedCount('hayGenerator')];
      const g = this.tryPlace('hayGenerator', slot.cell, slot.rot);
      if (g) { g.interact(sim); }
    }

    // Feeder arcs around the pile foot for arms (and later collectors).
    // Built as soon as there is something to feed them: side rakes first (GDD: rake line), arms later.
    const extractorCost = pr.buildingUnlocked('roboticArm') ? sim.nextCost('roboticArm') : sim.nextCost('pistonRake');
    if (pr.buildingUnlocked('roboticArm') || pr.buildingUnlocked('pistonRake')) {
      if (!this.arcs.south && money() >= sim.nextCost('conveyor') * 40 + extractorCost) this.buildArc(1);
      else if (this.arcs.south && !this.arcs.north && money() >= sim.nextCost('hopper') + sim.nextCost('conveyor') * 40 + extractorCost) this.buildArc(-1);
    }

    // 5) Extraction along the belts (only while power is not the bottleneck).
    if (!short || sim.ownedCount('hayGenerator') < GEN_SLOTS.length) this.addExtractors();

    // Stockpile order: close the valve (switch the compressor off) until the silo holds enough, like a player would.
    const stock = pr.activeOrders().find((o) => o.id === 'o_stockpile');
    const comp = sim.buildingsOfType('compressor')[0];
    if (comp) {
      const want = stock ? (ORDER_BY_ID.o_stockpile.target) : 0;
      const stored = sim.buildingsOfType('silo').reduce((n, b) => n + b.contents().weight(), 0);
      const hold = !!stock && stored < want * 1.05;
      if (comp.enabled === hold) { comp.enabled = !hold; this.mark('tweak', hold ? 'compressor OFF to fill the silo' : 'compressor back ON', false); }
    }

    // 6) Move starved extractors forward.
    this.relocateStarved();

    // 7) Anything left without power (placed before poles existed, pole limit reached...) gets a pole.
    for (const b of [...sim.buildings.values()]) if (b.needsPower && b.status === 'noPower') this.ensurePower(b);
  }

  /** Belt arc along the pile's south (side 1) or north (side -1) foot, ending in a hopper beside the trunk. */
  private buildArc(side: 1 | -1): void {
    const sim = this.sim;
    if (side > 0 && !sim.buildingsOfType('hopper').some((h) => h.cell.z === HOPPER_CELL.z)) {
      if (!this.tryPlace('hopper', HOPPER_CELL, 3)) return;
    }
    if (side < 0 && !sim.buildingsOfType('hopper').some((h) => h.cell.z === HOPPER_N_CELL.z)) {
      // The arc must end in its hopper. A fallback head rake may sit on that spot: push it forward first.
      const rake = sim.buildingsOfType('pistonRake').find((r) => r.rot === 0 && r.cell.z === TZ - 1 && r.cell.x < RAKE_X0);
      if (rake && sim.canMove(rake.id, { x: RAKE_X0, z: TZ - 1, level: 0 }, 0).ok) {
        const oldX = rake.cell.x;
        sim.move(rake.id, { x: RAKE_X0, z: TZ - 1, level: 0 }, 0);
        this.advance(MOVE_TIME);
        for (let x = oldX; x < RAKE_X0; x++) if (!sim.buildingAtCell(x, TZ, 0)) this.tryPlace('conveyor', { x, z: TZ, level: 0 }, 2);
        sim.rebuildTopology();
      }
      if (!this.tryPlace('hopper', HOPPER_N_CELL, 1)) return;
    }
    const z = side * ARC_Z;
    const tiles: { x: number; z: number; rot: Rot }[] = [];
    for (let x = ARC_X_EAST; x > -10; x--) tiles.push({ x, z, rot: 2 });
    const colRot: Rot = side > 0 ? 3 : 1;
    tiles.push({ x: -10, z, rot: colRot });
    const zEnd = side > 0 ? 3 : -3;
    for (let zz = z - side; side > 0 ? zz >= zEnd : zz <= zEnd; zz -= side) tiles.push({ x: -10, z: zz, rot: colRot });
    let placed = 0;
    for (const t of tiles) {
      if (sim.buildingAtCell(t.x, t.z, 0)) continue;
      if (this.tryPlace('conveyor', { x: t.x, z: t.z, level: 0 }, t.rot)) placed++;
    }
    if (side > 0) this.arcs.south = true; else this.arcs.north = true;
    this.mark('line', `${side > 0 ? 'south' : 'north'} feeder arc (${placed} tiles)`);
  }

  private placeHeadRake(x: number): Building | null {
    const cell: Cell = { x, z: TZ - 1, level: 0 };
    const r = this.tryPlace('pistonRake', cell, 0);
    if (r) { this.digFocus = null; this.digFocusSince = -1; return r; }
    const chk = this.sim.canPlace('pistonRake', cell, 0);
    if ((chk.reason ?? '').startsWith('Too much hay')) {
      this.digFocus = { x: x + 1, z: TZ + 0.5 };
      if (this.digFocusSince < 0) this.digFocusSince = this.sim.time;
    }
    return null;
  }

  private buildTrunk(): void {
    const sim = this.sim;
    const tiles: { x: number; z: number; rot: Rot }[] = [];
    for (let x = HEAD_X0; x > CORNER_X; x--) tiles.push({ x, z: TZ, rot: 2 });
    for (let z = TZ; z < 5; z++) tiles.push({ x: CORNER_X, z, rot: 1 });
    tiles.push({ x: CORNER_X, z: 5, rot: 2 });
    for (const t of tiles) {
      if (sim.buildingAtCell(t.x, t.z, 0)) continue;
      if (!this.tryPlace('conveyor', { x: t.x, z: t.z, level: 0 }, t.rot)) {
        this.mark('warn', `trunk tile blocked at ${t.x},${t.z}`, false);
      }
    }
    const hopper = this.tryPlace('hopper', HOPPER_CELL, 3); // may be retried later if the head rake sits there
    this.trunkBuilt = true;
    this.stage = 'trunk';
    this.mark('line', `trunk built (${tiles.length} tiles)${hopper ? ' + hand-dump hopper' : ''}`);
  }

  private buildBypass(): void {
    const sim = this.sim;
    const sp = this.insertMachine('splitter', { x: PROC_SPLIT_X, z: TZ, level: 0 }, 2, PROC_SPLIT_X, PROC_SPLIT_X);
    if (!sp) return;
    const tiles: { x: number; z: number; rot: Rot }[] = [];
    for (let z = TZ - 1; z > -4; z--) tiles.push({ x: PROC_SPLIT_X, z, rot: 3 });
    tiles.push({ x: PROC_SPLIT_X, z: -4, rot: 2 });
    for (let x = PROC_SPLIT_X - 1; x > -30; x--) tiles.push({ x, z: -4, rot: 2 });
    for (let z = -4; z < 5; z++) tiles.push({ x: -30, z, rot: 1 });
    for (const t of tiles) {
      if (sim.buildingAtCell(t.x, t.z, 0)) continue;
      if (!this.tryPlace('conveyor', { x: t.x, z: t.z, level: 0 }, t.rot)) this.mark('warn', `bypass tile blocked at ${t.x},${t.z}`, false);
    }
    this.bypassBuilt = true;
    this.mark('line', 'processing splitter + bypass');
  }

  /** Move the head rake forward when it runs dry and extend the trunk behind it. */
  private advanceHead(): void {
    const sim = this.sim;
    const rake = sim.buildingsOfType('pistonRake').find((r) => r.rot === 0 && r.cell.z === TZ - 1);
    if (!rake) {
      if (sim.progress.money >= sim.nextCost('pistonRake') + 500) {
        const r = this.placeHeadRake(this.headX + 1);
        if (r) this.ensurePower(r);
      }
      return;
    }
    if (rake.status !== 'noHay') return;
    const maxX = WORLD.interior.maxX - 3;
    for (let nx = rake.cell.x + 1; nx <= maxX; nx++) {
      if (!sim.canMove(rake.id, { x: nx, z: TZ - 1, level: 0 }, 0).ok) continue;
      const oldX = rake.cell.x;
      if (!sim.move(rake.id, { x: nx, z: TZ - 1, level: 0 }, 0)) return;
      this.advance(MOVE_TIME);
      for (let x = oldX; x < nx; x++) {
        if (!sim.buildingAtCell(x, TZ, 0)) this.tryPlace('conveyor', { x, z: TZ, level: 0 }, 2);
      }
      this.headX = nx - 1;
      this.ensurePower(rake);
      sim.rebuildTopology();
      return;
    }
  }

  /** Belt tiles that extractors may side-load onto. */
  private slotBelts(): Building[] {
    const out: Building[] = [];
    for (const b of this.sim.buildingsOfType('conveyor')) {
      if (b.cell.x < HEAD_X0 - 1 && Math.abs(b.cell.z) < ARC_Z - 1) continue; // processing / chute area
      if (b.cell.x < -11) continue;
      out.push(b);
    }
    return out;
  }

  /**
   * Candidate slots for an extractor next to any feeder belt: the machine's output faces the belt's side and
   * its front faces away from the belt (into the pile).
   */
  private sideSlots(type: BuildingType): { cell: Cell; rot: Rot }[] {
    const out: { cell: Cell; rot: Rot }[] = [];
    const def = BUILDABLES[type];
    const outPort = def.ports.find((p) => p.kind === 'out')!;
    for (const belt of this.slotBelts()) {
      const flow = belt.rot as Dir;
      for (const side of [((flow + 1) & 3) as Dir, ((flow + 3) & 3) as Dir]) {
        // Machine rotation: its out-port (local dir outPort.dir) must face back towards the belt.
        const want = oppositeDir(side);
        const rot = (((want - outPort.dir) % 4) + 4) % 4 as Rot;
        const [w, d] = def.footprint;
        const [ox, oz] = localToOffset(outPort.cell[0], outPort.cell[1], w, d, rot);
        const portCell = { x: belt.cell.x + DIR_DX[side], z: belt.cell.z + DIR_DZ[side] };
        out.push({ cell: { x: portCell.x - ox, z: portCell.z - oz, level: 0 }, rot });
      }
    }
    return out;
  }

  private reachOf(type: BuildingType): number {
    const s = this.sim;
    return type === 'roboticArm' ? s.stat('arm.reach') : type === 'vacuumCollector' ? s.stat('collector.radius') : s.stat('rake.reach');
  }

  private bestSlot(type: BuildingType, ignoreId = 0): { cell: Cell; rot: Rot; hay: number } | null {
    const sim = this.sim;
    let best: { cell: Cell; rot: Rot; hay: number } | null = null;
    const reach = this.reachOf(type);
    for (const s of this.sideSlots(type)) {
      const chk = ignoreId ? sim.canMove(ignoreId, s.cell, s.rot) : sim.canPlace(type, s.cell, s.rot);
      if (!chk.ok && !(chk.reason ?? '').startsWith('Need $')) continue;
      const c = buildingCenter(type, s.cell, s.rot);
      let hay: number;
      if (type === 'pistonRake') {
        const [w] = rotatedSize(BUILDABLES[type], s.rot);
        const off = w / 2 + reach / 2;
        hay = sim.hay.unitsInRadius(c.x + DIR_DX[s.rot] * off, c.z + DIR_DZ[s.rot] * off, reach / 2);
      } else hay = sim.hay.unitsInRadius(c.x, c.z, reach);
      // Share hay with neighbours of the same kind.
      for (const o of sim.buildingsOfType(type)) {
        if (o.id === ignoreId) continue;
        const d = Math.hypot(o.center.x - c.x, o.center.z - c.z);
        if (d < reach * 1.2) hay *= 0.6;
      }
      if (!best || hay > best.hay) best = { ...s, hay };
    }
    return best;
  }

  private addExtractors(): void {
    const sim = this.sim;
    const pr = sim.progress;
    // Saving for a newly unlocked flagship machine: stop adding arms/rakes once a basic line is running.
    const flagship = (['vacuumCollector', 'scannerMk2'] as BuildingType[]).find((t) => pr.buildingUnlocked(t) && sim.ownedCount(t) === 0);
    const saving = flagship !== undefined && sim.ownedCount('roboticArm') >= 6;
    const order: BuildingType[] = ['vacuumCollector', 'roboticArm', 'pistonRake'];
    for (const type of order) {
      if (!pr.buildingUnlocked(type)) continue;
      const cap = type === 'roboticArm' ? 20 : type === 'vacuumCollector' ? 4 : 4;
      if (sim.ownedCount(type) >= cap) continue;
      if (saving && type !== flagship) { this.waitingMoney ||= `${flagship} ($${sim.nextCost(flagship!)})`; continue; }
      const cost = sim.nextCost(type);
      if (pr.money < cost * 1.15 + 300) { this.waitingMoney ||= `${type} ($${cost})`; continue; }
      const slot = this.bestSlot(type);
      const minHay = type === 'vacuumCollector' ? 1500 : 800;
      if (!slot || slot.hay < minHay) continue;
      const b = this.tryPlace(type, slot.cell, slot.rot);
      if (b) { this.ensurePower(b); return; }
    }
  }

  private relocateStarved(): void {
    const sim = this.sim;
    for (const b of sim.buildings.values()) {
      if (b.type !== 'roboticArm' && b.type !== 'vacuumCollector' && !(b.type === 'pistonRake' && b.rot !== 0)) continue;
      if (b.status !== 'noHay') { this.starvedSince.delete(b.id); continue; }
      const since = this.starvedSince.get(b.id) ?? sim.time;
      this.starvedSince.set(b.id, since);
      if (sim.time - since < 20) continue;
      const slot = this.bestSlot(b.type, b.id);
      if (!slot || slot.hay < 600) continue;
      this.standClearOf(slot.cell);
      if (sim.move(b.id, slot.cell, slot.rot)) {
        this.advance(MOVE_TIME);
        this.mark('move', `${b.type} to ${slot.cell.x},${slot.cell.z} (starved)`);
        this.starvedSince.delete(b.id);
        sim.rebuildTopology();
        this.ensurePower(b);
      }
    }
  }

  // =====================================================================================
  // Main loop
  // =====================================================================================

  run(): { completed: boolean; minutes: number } {
    const sim = this.sim;
    const maxT = this.opts.maxMinutes * 60;
    this.snapshot();
    while (sim.time < maxT && !sim.completed) {
      this.spendWP();
      this.buyTools();
      if (sim.time - this.lastFactoryCheck > 5) { this.lastFactoryCheck = sim.time; this.buildFactory(); }
      this.detectorSweep();
      this.emptyTrays();
      const cap = carryCapacity(sim);
      if (cap > 0) {
        this.digTrip();
        this.sellTrip();
      } else this.advance(1);
    }
    this.snapshot();
    return { completed: sim.completed, minutes: sim.time / 60 };
  }
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
