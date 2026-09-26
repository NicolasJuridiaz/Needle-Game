/**
 * BALANCE BOT — plays a full run headless with the REAL simulation and the same player actions the game uses.
 * No cheats: it earns money/WP legitimately, walks (time passes while walking), digs with cooldowns, sells at the
 * Market Chute, unlocks tech, buys tools and builds a factory from a scripted "trench" layout.
 *
 * It is a reasonable (not optimal) player. Its timeline is used to tune pacing towards 50-70 minutes.
 */
import { BALANCE } from '../../src/config/balance';
import { BUILDABLES } from '../../src/config/buildables';
import { TECH_BY_ID } from '../../src/config/techTree';
import { WORLD } from '../../src/config/world';
import type { Building } from '../../src/sim/building';
import { buildingCenter } from '../../src/sim/grid';
import {
  carryCapacity, detectorReading, playerDig, playerVacuum, spawnWheelbarrow, toggleWheelbarrow,
} from '../../src/sim/playerActions';
import { Sim } from '../../src/sim/sim';
import type { BuildingType, Cell, Rot, ToolId } from '../../src/sim/types';

export interface TimelineEntry { t: number; kind: string; detail: string }

export interface BotOptions {
  seed: number;
  maxMinutes: number;
  /** Extra human overhead multiplier on action durations (1.15 = 15% slower than perfect). */
  humanFactor: number;
  verbose: boolean;
}

const DT = BALANCE.tickDt;

/** Tech unlock priority (the bot unlocks the first affordable one whose prerequisites are met). */
const TECH_PRIORITY: string[] = [
  'p_grab', 'p_carry', 'p_shovel', 'p_bucket', 'p_wide_shovel', 'p_quick_scoop', 'p_detector', 'p_pitchfork', 'p_wheelbarrow',
  'p_move', 'p_det_range', 'p_wider_tines', 'p_fork_speed', 'p_barrow_cap', 'p_faster_push',
  'f_generator', 'x_rake', 'x_hopper', 'l_conveyor', 'f_pole', 'x_rake_speed', 'x_rake_auto', 'f_autofeed', 'l_splitter',
  'p_vacuum', 'p_det_depth', 'p_carry', 'x_rake_width', 'f_firebox', 'l_merger', 'x_arm', 'f_gen_output', 'd_scanner',
  'x_arm_speed', 'x_arm_grab', 'l_speed', 'e_compressor', 'x_arm_reach', 'e_silo', 'd_speed', 'd_batch', 'x_rake_push',
  'x_arm_rotation', 'd_buffer', 'd_eject', 'e_comp_speed', 'e_bale_value', 'e_hay_value', 'x_arm_smart', 'l_priority',
  'e_wrapper', 'f_fuel_eff', 'e_batch_eff', 'e_wrap_speed', 'l_lift', 'x_collector', 'x_arm_mk2', 'l_capacity',
  'd_mk2', 'x_col_suction', 'x_col_radius', 'e_double_chamber', 'f_industrial_gen', 'x_col_output', 'd_mk2_speed', 'd_dual_lane',
  'x_rake_industrial', 'e_premium_wrap', 'e_wrapped_value', 'x_col_turbine', 'e_order_reward', 'f_pole_range', 'l_overflow',
];

const TOOL_PRIORITY: (ToolId | 'wheelbarrow')[] = ['shovel', 'bucket', 'detector', 'pitchfork', 'wheelbarrow', 'vacuum'];

export class Bot {
  readonly sim: Sim;
  readonly log: TimelineEntry[] = [];
  private lastIdleCheck = 0;
  private idleSince = -1;
  /** Longest stretch (s) with no new purchase/unlock/order/needle. */
  longestNoDecision = 0;
  private lastDecisionAt = 0;
  private detectorSweepAt = -1e9;
  private trenchHeadX = -12;
  private mainLineBuilt = false;

  constructor(private readonly opts: BotOptions) {
    this.sim = new Sim(opts.seed);
    const ev = this.sim.events;
    ev.on('node:unlocked', (e) => this.mark('unlock', `${e.id} L${e.level}`));
    ev.on('tool:bought', (e) => this.mark('tool', String(e.tool)));
    ev.on('building:placed', (e) => { if (e.type !== 'conveyor') this.mark('build', e.type); });
    ev.on('order:completed', (e) => this.mark('order', `${e.id} +$${e.money} +${e.wp}WP`));
    ev.on('needle:found', (e) => this.mark('NEEDLE', `#${e.index + 1} by ${e.by} (${e.buffName}) progress=${(this.sim.hay.progress() * 100).toFixed(1)}%`));
    ev.on('needle:returned', (e) => this.mark('needleReturned', `#${e.id} from ${e.where}`));
    ev.on('milestone', (e) => this.mark('milestone', `${e.name} +${e.wp}WP`, false));
    ev.on('game:completed', () => this.mark('COMPLETE', `${(this.sim.time / 60).toFixed(1)} min`));
  }

  private mark(kind: string, detail: string, decision = true): void {
    const t = this.sim.time;
    this.log.push({ t, kind, detail });
    if (decision) {
      this.longestNoDecision = Math.max(this.longestNoDecision, t - this.lastDecisionAt);
      this.lastDecisionAt = t;
    }
    if (this.opts.verbose) console.log(`${fmt(t)}  ${kind.padEnd(14)} ${detail}`);
  }

  // =====================================================================================
  // Time & movement
  // =====================================================================================

  private advance(seconds: number): void {
    const n = Math.max(1, Math.round((seconds * this.opts.humanFactor) / DT));
    for (let i = 0; i < n; i++) {
      this.sim.tick(DT);
      // keep a held barrow next to the player
      const wb = this.sim.player.wheelbarrow;
      if (wb?.held) { wb.pos.x = this.sim.player.pos.x + 1; wb.pos.z = this.sim.player.pos.z; }
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

  // =====================================================================================
  // Economy decisions
  // =====================================================================================

  private spendWP(): void {
    const pr = this.sim.progress;
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of TECH_PRIORITY) {
        const node = TECH_BY_ID[id];
        if (!node) continue;
        if (pr.canUnlock(id).ok) { pr.unlock(id); changed = true; break; }
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

  private sellPoint(): { x: number; z: number } {
    const s = this.sim.sellStation!;
    const c = s.center;
    return { x: c.x + 2.3, z: c.z };
  }

  /** Dig until carry (and a parked barrow nearby) is full. */
  private digTrip(): number {
    const sim = this.sim;
    const sp = this.sellPoint();
    const target = sim.hay.findTarget(sp.x, sp.z, 90, 'nearest');
    if (!target) return 0;
    const tool = this.bestDigTool();
    sim.player.equipped = tool;
    const reach = tool === 'vacuum' ? sim.stat('tool.vacuum.reach') : sim.stat(`tool.${tool}.reach`);
    // stand a bit away from the target towards the sell point
    const dx = sp.x - target.x, dz = sp.z - target.z, dl = Math.hypot(dx, dz) || 1;
    const standX = target.x + (dx / dl) * Math.min(reach * 0.7, 2), standZ = target.z + (dz / dl) * Math.min(reach * 0.7, 2);
    // park the barrow next to us
    const wb = sim.player.wheelbarrow;
    if (wb?.held) { this.moveTo(standX, standZ); toggleWheelbarrow(sim); }
    else this.moveTo(standX, standZ);
    let got = 0;
    let guard = 0;
    while (guard++ < 2000) {
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
    // Feed hungry generators on the way (manual stoking).
    for (const g of sim.buildingsOfType('hayGenerator')) {
      const fuel = (g.anim.fuel ?? 0);
      if (fuel < 0.5 && sim.stat('generator.autoFeed') < 1 && !sim.player.carry.isEmpty()) {
        const c = g.center; this.moveTo(c.x - 2, c.z); g.interact(sim); this.advance(0.5);
      }
    }
    const sp = this.sellPoint();
    this.moveTo(sp.x, sp.z);
    sim.sellStation!.interact(sim);
    this.advance(0.6);
  }

  /** Empty rake trays (semi-automatic phase, before belts). */
  private emptyTrays(): void {
    const sim = this.sim;
    for (const r of [...sim.buildingsOfType('pistonRake'), ...sim.buildingsOfType('compressor')]) {
      if (sim.logistics.isLinked(r, 0)) continue;
      const inv = r.contents();
      if (inv.weight() < 30) continue;
      const c = r.center;
      this.moveTo(c.x - 1.5, c.z);
      r.interact(sim);
      this.advance(0.6);
      this.sellTrip();
    }
  }

  private detectorSweep(): void {
    const sim = this.sim;
    if (!sim.progress.ownedTools.has('detector')) return;
    if (sim.time - this.detectorSweepAt < 150) return;
    this.detectorSweepAt = sim.time;
    sim.player.equipped = 'detector';
    const P = WORLD.pile;
    const range = sim.stat('tool.detector.range');
    // lawnmower sweep over the pile footprint
    for (let z = P.cz - P.rz; z <= P.cz + P.rz; z += range * 1.4) {
      for (let x = P.cx - P.rx; x <= P.cx + P.rx; x += 2) {
        this.moveTo(x, z);
        const r = detectorReading(sim);
        if (r.strength > 0.05 && r.needleId >= 0) {
          const n = sim.hay.needles.find((q) => q.id === r.needleId);
          if (!n) continue;
          // home in (1.5x the straight distance) and dig down
          const d = Math.hypot(n.pos.x - x, n.pos.z - z);
          this.advance((d * 1.5) / sim.stat('player.moveSpeed'));
          sim.player.pos.x = n.pos.x - 1; sim.player.pos.z = n.pos.z;
          const tool = this.bestDigTool();
          sim.player.equipped = tool === 'vacuum' ? 'pitchfork' : tool;
          const t2 = sim.player.equipped;
          let guard = 0;
          while (n.status !== 'found' && guard++ < 400) {
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
  // Factory building (trench layout: main belt along z=0 flowing west into the Market Chute)
  // =====================================================================================

  private tryPlace(type: BuildingType, cell: Cell, rot: Rot, variant?: string): Building | null {
    if (!this.sim.progress.buildingUnlocked(type)) return null;
    const chk = this.sim.canPlace(type, cell, rot, variant);
    if (!chk.ok) return null;
    return this.sim.place(type, cell, rot, variant);
  }

  private buildFactory(): void {
    const sim = this.sim;
    const pr = sim.progress;
    const money = () => pr.money;

    // 1) Generator + rake (manual stoking, tray emptied by hand)
    if (sim.ownedCount('hayGenerator') === 0 && pr.buildingUnlocked('hayGenerator') && pr.buildingUnlocked('pistonRake')
      && money() >= sim.nextCost('hayGenerator') + sim.nextCost('pistonRake')) {
      this.tryPlace('hayGenerator', { x: -15, z: -6, level: 0 }, 0);
    }
    if (sim.ownedCount('pistonRake') === 0 && sim.ownedCount('hayGenerator') > 0) {
      const edge = this.pileEdgeX(0);
      this.tryPlace('pistonRake', { x: Math.floor(edge) - 3, z: -1, level: 0 }, 0);
    }
    // 2) Main line: rake output -> belt west -> market chute
    if (!this.mainLineBuilt && pr.buildingUnlocked('conveyor') && sim.ownedCount('pistonRake') > 0) {
      const rake = sim.buildingsOfType('pistonRake')[0];
      const out = rake.ports.find((p) => p.kind === 'out');
      if (out) {
        const start = { x: out.cell.x - 1, z: out.cell.z, level: 0 as const };
        const s = sim.sellStation!;
        const end = { x: s.cell.x + 3, z: s.cell.z + 1, level: 0 as const };
        const plan = sim.planBelt(start, end, { mode: 'zFirst', allowLevelChange: false });
        if (plan.ok && money() >= plan.cost && sim.placeBelt(plan)) { this.mainLineBuilt = true; this.mark('line', `main belt ${plan.steps.length} tiles`); }
      }
    }
    // 3) More extraction: arms along the trench, more rakes at the head.
    if (this.mainLineBuilt && pr.buildingUnlocked('roboticArm') && money() >= sim.nextCost('roboticArm') * 1.2 && sim.ownedCount('roboticArm') < 10) {
      this.placeArmNearTrench();
    }
    // 4) Power: poles to reach machines far from generators; more generators when overloaded.
    if (pr.buildingUnlocked('hayGenerator') && sim.power.totalDemand > sim.power.totalSupply * 0.95 && money() >= sim.nextCost('hayGenerator') * 1.5) {
      this.tryPlace('hayGenerator', { x: -15 - 4 * sim.ownedCount('hayGenerator'), z: -6, level: 0 }, 0);
    }
  }

  private pileEdgeX(z: number): number {
    for (let x = WORLD.interior.minX; x < WORLD.interior.maxX; x += 0.5) if (this.sim.hay.heightAt(x, z) > 0.3) return x;
    return WORLD.pile.cx;
  }

  private placeArmNearTrench(): void {
    const sim = this.sim;
    // Find a belt tile close to hay and put an arm beside it dropping onto it.
    const belts = sim.buildingsOfType('conveyor');
    let best: { cell: Cell; rot: Rot; score: number } | null = null;
    for (const b of belts) {
      for (const side of [-1, 1]) {
        const cell = { x: b.cell.x, z: b.cell.z + side, level: 0 as const };
        const rot: Rot = side < 0 ? 1 : 3; // face the belt
        const c = buildingCenter('roboticArm', cell, rot);
        const hay = sim.hay.unitsInRadius(c.x, c.z, sim.stat('arm.reach'));
        if (hay < 400) continue;
        if (!sim.canPlace('roboticArm', cell, rot).ok) continue;
        if (!best || hay > best.score) best = { cell, rot, score: hay };
      }
    }
    if (best) this.tryPlace('roboticArm', best.cell, best.rot);
  }

  // =====================================================================================
  // Main loop
  // =====================================================================================

  run(): { completed: boolean; minutes: number } {
    const sim = this.sim;
    const maxT = this.opts.maxMinutes * 60;
    while (sim.time < maxT && !sim.completed) {
      this.spendWP();
      this.buyTools();
      this.buildFactory();
      this.detectorSweep();
      this.emptyTrays();
      // Manual work continues all game long (players keep digging while the factory runs).
      const cap = carryCapacity(sim);
      if (cap > 0) {
        this.digTrip();
        this.sellTrip();
      } else this.advance(1);
      void BUILDABLES;
    }
    return { completed: sim.completed, minutes: sim.time / 60 };
  }
}

export function fmt(t: number): string {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
