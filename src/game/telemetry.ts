import { LOGISTICS_TYPES } from '../config/buildables';
import { NEEDLE_BANDS } from '../config/needles';
import { displayLevel, TECH_BY_ID } from '../config/techTree';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { AnalyticsEventName, AnalyticsParams } from '../platform/analyticsEvents';
import type { AnalyticsService } from '../platform/analyticsService';
import { techForBuilding } from '../sim/levels';
import type { Sim } from '../sim/sim';
import type { BuildingType } from '../sim/types';
import type { PlayerProfile } from './profile';
import { runStage, type WelcomeBackInfo } from './welcomeBack';

/**
 * Game-side telemetry: turns sim/game events into the analytics catalog (src/platform/analyticsEvents.ts).
 * The game layer only talks to this class and to AnalyticsService; nothing here knows the remote provider.
 *
 * Run-level dedupe ("first_*", progress marks, checkpoints) is persisted in the save (GameMeta.telemetry), so
 * reloading a save never re-sends them. Saves written before this system existed are backfilled silently from
 * their state (nothing is sent for what already happened).
 */

/** Persisted with the run (GameMeta.telemetry). */
export interface RunTelemetryState {
  v: 1;
  runId: string;
  runIndex: number;
  /** Keys already sent for this run: 'first_rake', 'progress_25', 'checkpoint_600', 'menu_shop', ... */
  fired: string[];
  /** Order id -> sim time when it became active (-1 = unknown, backfilled). */
  orderStarts: Record<string, number>;
}

/** Share of the haystack removed at which `run_progress` fires (integer percent). */
export const PROGRESS_MARKS = [10, 25, 50, 75, 90, 100] as const;
/** In-game seconds (sim time: counts only while the run is running) at which `playtime_checkpoint` fires. */
export const PLAYTIME_CHECKPOINTS = [60, 180, 300, 600, 900, 1800, 2700, 3600] as const;
/** Session gameplay seconds at which a performance snapshot is taken (plus late game and run complete). */
export const PERF_SNAPSHOT_SESSION_S = [300, 900] as const;
/** In-game seconds from which the run counts as "late game" for the performance snapshot. */
export const PERF_LATE_GAME_S = 2700;
/** Logistics pieces are too many to report one by one: only these totals send `machine_built`. */
export const LOGISTICS_REPORT_COUNTS = [1, 10, 25, 50, 100, 150, 200, 300] as const;
/** Most `game_error` events per error code and in total, per page session. */
export const MAX_ERRORS_PER_CODE = 3;
export const MAX_ERRORS_TOTAL = 10;

const MACHINE_FIRST: Partial<Record<BuildingType, AnalyticsEventName>> = {
  pistonRake: 'first_rake', roboticArm: 'first_robotic_arm', scannerMk1: 'first_scanner',
  vacuumCollector: 'first_vacuum_collector', scannerMk2: 'first_scanner_mk2',
};
/** Not machines: fixed station, walkways, poles (poles are reported through power, not needed here). */
const NOT_MACHINES = new Set<BuildingType>(['sellStation', 'platform', 'stairs', 'powerPole']);

export interface PerfProbe { quality: string; drawCalls: number; triangles: number; deviceClass: string }

export interface TelemetryDeps {
  analytics: AnalyticsService;
  profile: PlayerProfile;
  version: string;
  platform: () => string;
  perf: () => PerfProbe;
  now?: () => number;
}

function randomId(): string {
  try {
    const b = new Uint8Array(8);
    globalThis.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
}

function counts(sim: Sim): Map<BuildingType, number> {
  const m = new Map<BuildingType, number>();
  for (const b of sim.buildings.values()) m.set(b.type, (m.get(b.type) ?? 0) + 1);
  return m;
}

/** Factory summary used by run_progress / run_complete / machine_built. */
function factory(sim: Sim): AnalyticsParams {
  const c = counts(sim);
  let logistics = 0, total = 0;
  for (const [t, n] of c) {
    if (t === 'sellStation') continue;
    total += n;
    if (LOGISTICS_TYPES.has(t)) logistics += n;
  }
  return {
    total_buildings: total,
    robotic_arms: c.get('roboticArm') ?? 0,
    conveyors: logistics,
    scanners: (c.get('scannerMk1') ?? 0) + (c.get('scannerMk2') ?? 0),
    vacuum_collectors: c.get('vacuumCollector') ?? 0,
  };
}

export class GameTelemetry {
  private sim!: Sim;
  private run!: RunTelemetryState;
  private fired = new Set<string>();
  private unsub: (() => void)[] = [];
  private tick = 0;
  // page-session state (not persisted)
  private sessionPlay = 0;
  private perfDone = new Set<string>();
  private fpsWindow: number[] = [];
  private frameAcc = 0;
  private frameCount = 0;
  private readonly errorCounts = new Map<string, number>();
  private errorsTotal = 0;
  private welcome: WelcomeBackInfo | null = null;

  constructor(private readonly d: TelemetryDeps) {
    d.analytics.setContext(() => this.context());
  }

  private now(): number { return this.d.now ? this.d.now() : Date.now(); }

  /** Common parameters of every remote event. */
  context(): AnalyticsParams {
    const s = this.sim;
    if (!s) return { game_version: this.d.version, platform: this.d.platform() };
    return {
      game_version: this.d.version,
      platform: this.d.platform(),
      run_id: this.run.runId,
      run_index: this.run.runIndex,
      elapsed_seconds: Math.floor(s.time),
      hay_remaining: Math.round((1 - s.hay.progress()) * 100),
      money: Math.floor(s.progress.money),
      work_points: Math.floor(s.progress.wp),
      needle_count: s.progress.needlesFound.length,
    };
  }

  // ===================================================================================
  // Session / run lifecycle
  // ===================================================================================

  /** Once per page load, before the first run is attached. */
  sessionStart(o: { hasSave: boolean; activeRun: boolean; saveVersion: number | null }): void {
    const p = this.d.profile;
    const now = this.now();
    const newPlayer = p.sessions === 0 && !o.hasSave;
    const since = p.lastSeenAt > 0 ? Math.max(0, Math.floor((now - p.lastSeenAt) / 1000)) : null;
    p.sessions++;
    p.lastSeenAt = now;
    this.d.analytics.track('game_session_start', {
      new_player: newPlayer,
      returning_player: !newPlayer,
      has_active_run: o.activeRun,
      save_version: o.saveVersion,
      session_index: p.sessions,
      time_since_last_session_seconds: since,
    });
  }

  /**
   * Attach a run. `state` = the persisted telemetry of a loaded save (undefined for a new run or a save from before
   * telemetry existed). Returns the state to persist in GameMeta.
   */
  attachRun(sim: Sim, state: RunTelemetryState | undefined, isNewGame: boolean): RunTelemetryState {
    this.detach();
    this.sim = sim;
    const p = this.d.profile;
    if (state && state.v === 1 && typeof state.runId === 'string') {
      this.run = { v: 1, runId: state.runId, runIndex: state.runIndex, fired: [...(state.fired ?? [])], orderStarts: { ...(state.orderStarts ?? {}) } };
      this.fired = new Set(this.run.fired);
    } else if (isNewGame) {
      p.runsStarted++;
      this.run = { v: 1, runId: randomId(), runIndex: p.runsStarted, fired: [], orderStarts: {} };
      this.fired = new Set();
      this.d.analytics.track('run_start', { starting_hay: Math.round(sim.hay.initialUnits), is_new_game: true });
      for (const o of sim.progress.activeOrders()) this.orderStarted(o.id);
    } else {
      // A save from before telemetry: give it an identity and mark what already happened, without sending it.
      p.runsStarted = Math.max(1, p.runsStarted);
      this.run = { v: 1, runId: randomId(), runIndex: p.runsStarted, fired: [], orderStarts: {} };
      this.fired = new Set();
      this.backfill();
    }
    this.subscribe();
    return this.run;
  }

  /** Persisted state (GameMeta.telemetry). */
  state(): RunTelemetryState { this.run.fired = [...this.fired]; return this.run; }

  detach(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  /** Marks everything the loaded run has already done as sent (pre-telemetry saves). Sends nothing. */
  private backfill(): void {
    const s = this.sim, pr = s.progress, st = pr.stats, c = counts(s);
    const mark = (k: string, cond: boolean) => { if (cond) this.fired.add(k); };
    mark('first_input', s.time > 0);
    mark('first_dig', st.hayExtractedManual > 0);
    mark('first_hay_processed', st.haySold + st.baleSold + st.wrappedSold > 0);
    mark('first_tool_purchase', pr.ownedTools.size > 1 || pr.hasWheelbarrow);
    mark('first_tool_upgrade', [...pr.nodes.keys()].some((id) => TECH_BY_ID[id]?.branch === 'player' && TECH_BY_ID[id]?.leveled));
    mark('first_worktree_purchase', pr.nodes.size > 0);
    mark('first_order_completed', pr.orders.some((o) => o.completed));
    mark('first_machine', [...c.keys()].some((t) => !NOT_MACHINES.has(t) && !LOGISTICS_TYPES.has(t)));
    mark('first_conveyor', (c.get('conveyor') ?? 0) > 0);
    mark('first_automation', st.hayExtractedMachine + st.hayExtractedArm > 0);
    mark('first_needle', pr.needlesFound.length > 0);
    for (const [t, ev] of Object.entries(MACHINE_FIRST)) mark(ev as string, (c.get(t as BuildingType) ?? 0) > 0);
    mark('scanner_unlock', pr.isUnlocked('d_scanner'));
    mark('vacuum_collector_unlock', pr.isUnlocked('x_collector'));
    mark('scanner_mk2_unlock', pr.isUnlocked('d_scanner@5'));
    for (const m of ['work_tree', 'shop', 'orders', 'build', 'pause']) this.fired.add(`menu_${m}`); // unknown: never report late "firsts"
    const pct = s.hay.progress() * 100;
    for (const m of PROGRESS_MARKS) mark(`progress_${m}`, pct >= m);
    for (const t of PLAYTIME_CHECKPOINTS) mark(`checkpoint_${t}`, s.time >= t);
    mark('run_complete', s.completed);
    for (const o of pr.activeOrders()) this.run.orderStarts[o.id] = -1;
  }

  /** Sends `name` once per run (key defaults to the event name). */
  private first(name: AnalyticsEventName, params?: AnalyticsParams, key: string = name): void {
    if (this.fired.has(key)) return;
    this.fired.add(key);
    this.d.analytics.track(name, params);
  }

  hasFired(key: string): boolean { return this.fired.has(key); }

  // ===================================================================================
  // Sim events
  // ===================================================================================

  private subscribe(): void {
    const ev = this.sim.events;
    const on: typeof ev.on = (t, fn) => { const u = ev.on(t, fn); this.unsub.push(u); return u; };
    on('building:placed', (e) => this.onBuilt(e.type));
    on('node:unlocked', (e) => this.onNode(e.id, e.level));
    on('tool:bought', (e) => {
      const money = e.tool === 'wheelbarrow' ? WHEELBARROW.cost : TOOLS[e.tool]?.cost;
      this.d.analytics.track('tool_purchase', { tool_id: e.tool, money_cost: money });
      this.first('first_tool_purchase', { tool_id: e.tool });
    });
    on('sale', () => this.first('first_hay_processed'));
    on('hay:extracted', (e) => {
      if (e.source === 'manual' || e.source === 'vacuumTool') this.first('first_dig');
      else this.first('first_automation', { source: e.source });
    });
    on('order:available', (e) => this.orderStarted(e.id));
    on('order:completed', (e) => {
      const start = this.run.orderStarts[e.id];
      const duration = start !== undefined && start >= 0 ? Math.round(this.sim.time - start) : null;
      delete this.run.orderStarts[e.id];
      this.d.analytics.track('order_completed', { order_id: e.id, duration_seconds: duration, reward_money: e.money, reward_wp: e.wp });
      this.first('first_order_completed', { order_id: e.id });
    });
    on('needle:found', (e) => {
      const band = NEEDLE_BANDS[e.id];
      const c = counts(this.sim);
      const scanner = (c.get('scannerMk2') ?? 0) > 0 ? 'mk2' : (c.get('scannerMk1') ?? 0) > 0 ? 'mk1' : 'none';
      this.d.analytics.track('needle_found', {
        needle_index: e.index + 1,
        depth_band: band ? `band_${e.id + 1}` : 'unknown',
        depth_band_min_percent: band ? Math.round(band[0] * 100) : null,
        detection_method: e.by,
        current_scanner: scanner,
        has_detector: this.sim.progress.ownedTools.has('detector'),
      });
      this.first('first_needle', { detection_method: e.by });
    });
    on('game:completed', () => {
      this.first('run_complete', { ...factory(this.sim), minutes: Math.round(this.sim.time / 60) });
      this.perfSnapshot('run_complete');
    });
  }

  private orderStarted(id: string): void {
    if (this.run.orderStarts[id] !== undefined) return;
    this.run.orderStarts[id] = this.sim.time;
    this.d.analytics.track('order_started', { order_id: id });
  }

  private onBuilt(type: BuildingType): void {
    if (type === 'sellStation') return;
    const c = counts(this.sim);
    let total = 0;
    for (const [t, n] of c) if (t !== 'sellStation') total += n;
    if (LOGISTICS_TYPES.has(type)) {
      let logistics = 0;
      for (const [t, n] of c) if (LOGISTICS_TYPES.has(t)) logistics += n;
      if ((LOGISTICS_REPORT_COUNTS as readonly number[]).includes(logistics)) {
        this.d.analytics.track('machine_built', { machine_type: 'logistics', last_piece: type, technology_level: this.techLevel(type), total_of_type: logistics, total_buildings: total });
      }
      if (type === 'conveyor') this.first('first_conveyor');
      return;
    }
    if (NOT_MACHINES.has(type)) return;
    this.d.analytics.track('machine_built', { machine_type: type, technology_level: this.techLevel(type), total_of_type: c.get(type) ?? 0, total_buildings: total });
    this.first('first_machine', { machine_type: type });
    const ev = MACHINE_FIRST[type];
    if (ev) this.first(ev);
  }

  private techLevel(type: BuildingType): number | null {
    const node = techForBuilding(type);
    return node ? displayLevel(node, this.sim.progress.nodeLevel(node.id)) : null;
  }

  private onNode(id: string, owned: number): void {
    const node = TECH_BY_ID[id];
    if (!node) return;
    const lv = node.levels[owned - 1];
    const cost = { money_cost: lv?.money ?? 0, wp_cost: lv?.cost ?? 0 };
    const from = displayLevel(node, owned - 1), to = displayLevel(node, owned);
    if (id === 'e_hay_value') this.d.analytics.track('hay_value_upgrade', { from_level: from, to_level: to, ...cost });
    else if (node.leveled && node.branch === 'player') {
      this.d.analytics.track('tool_upgrade', { tool_id: id, from_level: from, to_level: to, ...cost });
      this.first('first_tool_upgrade', { tool_id: id });
    } else if (node.leveled) this.d.analytics.track('technology_upgrade', { technology_id: id, from_level: from, to_level: to, ...cost });
    else this.d.analytics.track('worktree_purchase', { node_id: id, level: owned, ...cost });
    this.first('first_worktree_purchase', { node_id: id });
    if (id === 'd_scanner' && owned === 1) this.first('scanner_unlock');
    if (id === 'x_collector' && owned === 1) this.first('vacuum_collector_unlock');
    if (id === 'd_scanner' && this.sim.progress.isUnlocked('d_scanner@5')) this.first('scanner_mk2_unlock');
  }

  // ===================================================================================
  // Game hooks
  // ===================================================================================

  /**
   * The player just allowed remote analytics. Sends ONE snapshot of where measurement starts. Everything that happened
   * before (session start, first_*, purchases ...) stays local: those keys are already in `fired`, so they are
   * never sent later either.
   */
  onConsentGranted(source: 'prompt' | 'settings'): void {
    const s = this.sim;
    this.d.analytics.track('analytics_consent_granted', {
      source,
      stage: s ? runStage(s) : 'none',
      has_active_run: !!s && s.time > 0 && !s.completed,
      ...(s ? factory(s) : {}),
    });
  }

  /** The player clicked into the game. */
  onPlayerStart(): void {
    this.first('first_input');
    if (this.welcome) {
      this.d.analytics.track('welcome_back_continue', { seconds_away: this.welcome.secondsAway });
      this.welcome = null;
    }
  }

  /** Mode changes: first time each important menu is opened in this run. */
  onMode(mode: string): void {
    const menu = mode === 'workTree' ? 'work_tree' : mode === 'shop' ? 'shop' : mode === 'orders' ? 'orders' : mode === 'build' ? 'build' : mode === 'paused' ? 'pause' : null;
    if (menu) this.first('menu_first_open', { menu }, `menu_${menu}`);
  }

  /** The Welcome Back card is on screen (called once per load). */
  onWelcomeBack(info: WelcomeBackInfo): void {
    this.welcome = info;
    this.d.analytics.track('welcome_back_shown', { seconds_away: info.secondsAway, run_progress: info.pilePercent, current_stage: info.stage });
  }

  /**
   * Per rendered frame: `realDt` = real frame time, `gameplay` = the player is in play/build with the tab visible.
   * Discrete checks (progress, checkpoints, performance) run once per second.
   */
  frame(realDt: number, gameplay: boolean): void {
    if (gameplay && realDt > 0 && realDt < 2) {
      this.sessionPlay += realDt;
      this.frameAcc += realDt;
      this.frameCount++;
      if (this.frameAcc >= 1) {
        this.fpsWindow.push(this.frameCount / this.frameAcc);
        if (this.fpsWindow.length > 60) this.fpsWindow.shift();
        this.frameAcc = 0;
        this.frameCount = 0;
      }
    }
    this.tick += realDt;
    if (this.tick < 1) return;
    this.tick = 0;
    this.checkProgress();
    for (const t of PERF_SNAPSHOT_SESSION_S) if (this.sessionPlay >= t) this.perfSnapshot(`session_${t}`);
    if (this.sim && this.sim.time >= PERF_LATE_GAME_S && this.sessionPlay >= 60) this.perfSnapshot('late_game');
  }

  private checkProgress(): void {
    const s = this.sim;
    if (!s) return;
    const pct = s.hay.progress() * 100;
    for (const m of PROGRESS_MARKS) {
      if (pct < m || this.fired.has(`progress_${m}`)) continue;
      this.fired.add(`progress_${m}`);
      this.d.analytics.track('run_progress', { percent: m, ...factory(s), wp_remaining: Math.floor(s.progress.wp), stage: runStage(s) });
    }
    for (const t of PLAYTIME_CHECKPOINTS) {
      if (s.time < t || this.fired.has(`checkpoint_${t}`)) continue;
      this.fired.add(`checkpoint_${t}`);
      this.d.analytics.track('playtime_checkpoint', { seconds: t, stage: runStage(s), session_play_seconds: Math.floor(this.sessionPlay) });
    }
  }

  /** Discrete performance sample (average and 10th-percentile FPS over the last minute of gameplay). */
  perfSnapshot(moment: string): void {
    if (this.perfDone.has(moment) || this.fpsWindow.length < 5) return;
    this.perfDone.add(moment);
    const sorted = [...this.fpsWindow].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    let probe: PerfProbe = { quality: 'unknown', drawCalls: 0, triangles: 0, deviceClass: 'unknown' };
    try { probe = this.d.perf(); } catch { /* keep defaults */ }
    let buildings = 0;
    if (this.sim) for (const b of this.sim.buildings.values()) if (b.type !== 'sellStation') buildings++;
    this.d.analytics.track('performance_snapshot', {
      moment, quality_preset: probe.quality, avg_fps: avg, p10_fps: p10, draw_calls: probe.drawCalls,
      triangles_k: probe.triangles / 1000, total_buildings: buildings, device_class: probe.deviceClass,
    });
  }

  /** Serious errors only; deduplicated per code and capped per session. No messages or stacks are sent. */
  error(code: string, system: string, recoverable: boolean): void {
    const n = this.errorCounts.get(code) ?? 0;
    if (n >= MAX_ERRORS_PER_CODE || this.errorsTotal >= MAX_ERRORS_TOTAL) return;
    this.errorCounts.set(code, n + 1);
    this.errorsTotal++;
    this.d.analytics.track('game_error', { error_code: code, system, recoverable, occurrence: n + 1 });
  }

  /** Keeps the profile's "last seen" fresh (called when the game saves). */
  touch(): void { this.d.profile.lastSeenAt = this.now(); }
}
