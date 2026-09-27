/**
 * GAME TELEMETRY + WELCOME BACK + SAVE ENVELOPE v2 (P0 Basic Launch), against the real Sim.
 * Remote analytics is a recording double: nothing leaves the process.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEEDLE_BANDS } from '../src/config/needles';
import { loadProfile, PROFILE_KEY, saveProfile, freshProfile, type PlayerProfile } from '../src/game/profile';
import { ENVELOPE_VERSION, SAVE_KEY, SaveManager, type GameMeta, type KeyValueStorage } from '../src/game/saveManager';
import {
  GameTelemetry, MAX_ERRORS_PER_CODE, PLAYTIME_CHECKPOINTS, PROGRESS_MARKS, type RunTelemetryState,
} from '../src/game/telemetry';
import { WELCOME_BACK_MIN_AWAY_S, welcomeBackInfo } from '../src/game/welcomeBack';
import { isValidName, toWireParams } from '../src/platform/analyticsEvents';
import { AnalyticsService, type AnalyticsAdapter } from '../src/platform/analyticsService';
import { Sim } from '../src/sim/sim';
import type { BuildingType } from '../src/sim/types';
import { findSpot, grantTech, parkPlayer, rich } from './support/simKit';

class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getJSON<T>(k: string): T | null { const v = this.map.get(k); return v === undefined ? null : (JSON.parse(v) as T); }
  setJSON(k: string, v: unknown): boolean { this.map.set(k, JSON.stringify(v)); return true; }
  remove(k: string): void { this.map.delete(k); }
}

/** Remote adapter double: records what would be sent to ByteBrew. */
function recorder() {
  const sent: { name: string; params: Record<string, string> }[] = [];
  const remote: AnalyticsAdapter = {
    id: 'bytebrew', init: () => Promise.resolve(true), send: (name, params) => sent.push({ name, params }),
    setEnabled: () => {}, status: () => 'recorder',
  };
  return { sent, remote };
}

async function setup(profile: PlayerProfile = freshProfile(1)) {
  const rec = recorder();
  const analytics = new AnalyticsService({ remote: rec.remote });
  await analytics.init();
  let clock = 1_000_000;
  const tel = new GameTelemetry({
    analytics, profile, version: '0.2.0-test', platform: () => 'web',
    perf: () => ({ quality: 'medium', drawCalls: 120, triangles: 450_000, deviceClass: 'desktop' }),
    now: () => clock,
  });
  const names = () => rec.sent.map((e) => e.name);
  const count = (n: string) => rec.sent.filter((e) => e.name === n).length;
  const last = (n: string) => [...rec.sent].reverse().find((e) => e.name === n);
  return { rec, analytics, tel, profile, names, count, last, advance: (ms: number) => { clock += ms; } };
}

function build(sim: Sim, type: BuildingType): void {
  const spot = findSpot(sim, type, -28, -8, -24, -10);
  expect(spot, `room for ${type}`).not.toBeNull();
  expect(sim.place(type, spot!.cell, spot!.rot), type).not.toBeNull();
}

const COMMON = ['game_version', 'platform', 'run_id', 'run_index', 'elapsed_seconds', 'hay_remaining', 'money', 'work_points', 'needle_count'];

describe('GameTelemetry: new run, funnel, dedupe', () => {
  it('session start + run start, every remote event carries the common context', async () => {
    const t = await setup();
    t.tel.sessionStart({ hasSave: false, activeRun: false, saveVersion: null });
    const sim = new Sim(11);
    t.tel.attachRun(sim, undefined, true);
    expect(t.names().slice(0, 3)).toEqual(['game_session_start', 'run_start', 'order_started']);
    expect(t.rec.sent[0].params).toMatchObject({ new_player: 'true', returning_player: 'false', has_active_run: 'false', session_index: '1' });
    expect(t.last('run_start')!.params).toMatchObject({ starting_hay: '750000', is_new_game: 'true', run_index: '1', hay_remaining: '100' });
    for (const e of t.rec.sent.slice(1)) for (const k of COMMON) expect(e.params, `${e.name}.${k}`).toHaveProperty(k);
    for (const e of t.rec.sent) {
      expect(isValidName(e.name)).toBe(true);
      for (const [k, v] of Object.entries(e.params)) { expect(isValidName(k)).toBe(true); expect(v).not.toMatch(/[ .:]/); }
    }
  });

  it('first_* milestones fire once per run; machine_built fires per machine; logistics only at count milestones', async () => {
    const t = await setup();
    const sim = new Sim(12);
    parkPlayer(sim); rich(sim);
    t.tel.attachRun(sim, undefined, true);
    for (const spec of ['x_rake@1', 'x_arm@1', 'l_conveyor@1', 'f_generator@1']) grantTech(sim.progress, spec);
    build(sim, 'pistonRake');
    build(sim, 'pistonRake');
    build(sim, 'roboticArm');
    for (let i = 0; i < 12; i++) build(sim, 'conveyor');
    expect(t.count('first_rake')).toBe(1);
    expect(t.count('first_robotic_arm')).toBe(1);
    expect(t.count('first_machine')).toBe(1);
    expect(t.count('first_conveyor')).toBe(1);
    expect(t.count('machine_built')).toBe(3 + 2); // 2 rakes + arm + logistics at 1 and 10 pieces
    const rake2 = t.rec.sent.filter((e) => e.name === 'machine_built' && e.params.machine_type === 'piston_rake')[1];
    expect(rake2.params).toMatchObject({ total_of_type: '2', technology_level: '1' });
    expect(t.last('machine_built')!.params).toMatchObject({ machine_type: 'logistics', total_of_type: '10' });
    // Work Tree purchases are classified: technology / tool / hay value / feature, each once per purchase.
    expect(t.names()).toContain('technology_upgrade');
    expect(t.count('first_worktree_purchase')).toBe(1);
    grantTech(sim.progress, 'p_shovel@2');
    const shovel = t.rec.sent.filter((e) => e.name === 'tool_upgrade' && e.params.tool_id === 'p_shovel');
    expect(shovel.map((e) => [e.params.from_level, e.params.to_level])).toEqual([['0', '1'], ['1', '2']]);
    expect(t.count('first_tool_upgrade')).toBe(1);
    grantTech(sim.progress, 'e_hay_value@3');
    expect(t.rec.sent.filter((e) => e.name === 'hay_value_upgrade').map((e) => e.params.to_level)).toEqual(['2', '3']);
    expect(t.last('hay_value_upgrade')!.params).toHaveProperty('money_cost');
  });

  it('needle_found carries the depth band, method and scanner; progress marks and checkpoints fire once', async () => {
    const t = await setup();
    const sim = new Sim(13);
    t.tel.attachRun(sim, undefined, true);
    sim.progress.onNeedleFound(1, 'manual', { x: 0, y: 1, z: 0 });
    sim.progress.onNeedleFound(1, 'manual', { x: 0, y: 1, z: 0 }); // duplicate report: ignored by the sim
    const nf = t.rec.sent.filter((e) => e.name === 'needle_found');
    expect(nf).toHaveLength(1);
    expect(nf[0].params).toMatchObject({ needle_index: '1', depth_band: 'band_2', depth_band_min_percent: String(Math.round(NEEDLE_BANDS[1][0] * 100)), detection_method: 'manual', current_scanner: 'none', needle_count: '1' });
    expect(t.count('first_needle')).toBe(1);

    (sim.hay as unknown as { progress: () => number }).progress = () => 0.27;
    sim.time = 700;
    t.tel.frame(1.1, true);
    t.tel.frame(1.1, true);
    expect(t.rec.sent.filter((e) => e.name === 'run_progress').map((e) => e.params.percent)).toEqual(['10', '25']);
    expect(t.rec.sent.filter((e) => e.name === 'playtime_checkpoint').map((e) => e.params.seconds)).toEqual(['60', '180', '300', '600']);
    expect(t.last('run_progress')!.params).toMatchObject({ total_buildings: '0', robotic_arms: '0', stage: 'manual' });
    expect(PROGRESS_MARKS).toEqual([10, 25, 50, 75, 90, 100]);
    expect(PLAYTIME_CHECKPOINTS).toEqual([60, 180, 300, 600, 900, 1800, 2700, 3600]);
  });

  it('reloading a save never re-sends milestones (dedupe is persisted with the run)', async () => {
    const storage = new MemStorage();
    const saves = new SaveManager(storage);
    const a = await setup();
    const sim = new Sim(14);
    parkPlayer(sim); rich(sim);
    const meta: GameMeta = { hintsDone: [], continuedAfterCompletion: false };
    meta.telemetry = a.tel.attachRun(sim, undefined, true);
    grantTech(sim.progress, 'x_rake@1');
    build(sim, 'pistonRake');
    sim.time = 400;
    a.tel.frame(1.1, true);
    meta.telemetry = a.tel.state();
    expect(saves.save(sim, meta)).toBe(true);

    const b = await setup(a.profile);
    const loaded = saves.load()!;
    expect(loaded.meta.telemetry!.runId).toBe(meta.telemetry.runId);
    b.tel.attachRun(loaded.sim, loaded.meta.telemetry, false);
    b.tel.frame(1.1, true);
    build(loaded.sim, 'pistonRake');
    expect(b.names()).toEqual(['machine_built']); // no run_start, no first_rake, no checkpoint 60/180/300 again
    expect(b.rec.sent[0].params.run_id).toBe(meta.telemetry.runId);
  });

  it('game_error is deduplicated per code and carries no message', async () => {
    const t = await setup();
    t.tel.attachRun(new Sim(15), undefined, true);
    for (let i = 0; i < 10; i++) t.tel.error('save_failed', 'save', true);
    const errs = t.rec.sent.filter((e) => e.name === 'game_error');
    expect(errs).toHaveLength(MAX_ERRORS_PER_CODE);
    expect(Object.keys(errs[0].params)).not.toContain('message');
    expect(errs[0].params).toMatchObject({ error_code: 'save_failed', system: 'save', recoverable: 'true' });
  });

  it('performance_snapshot: discrete, from real frame times, once per moment', async () => {
    const t = await setup();
    t.tel.attachRun(new Sim(16), undefined, true);
    for (let i = 0; i < 310 * 50; i++) t.tel.frame(1 / 50, true); // 310 s of gameplay at 50 FPS
    const snaps = t.rec.sent.filter((e) => e.name === 'performance_snapshot');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].params).toMatchObject({ moment: 'session_300', avg_fps: '50', p10_fps: '50', quality_preset: 'medium', draw_calls: '120', triangles_k: '450', device_class: 'desktop' });
  });

  it('first-time menu opens and first input are reported once per run', async () => {
    const t = await setup();
    t.tel.attachRun(new Sim(17), undefined, true);
    for (const m of ['workTree', 'play', 'workTree', 'shop', 'orders', 'build', 'paused', 'shop']) t.tel.onMode(m);
    t.tel.onPlayerStart();
    t.tel.onPlayerStart();
    expect(t.rec.sent.filter((e) => e.name === 'menu_first_open').map((e) => e.params.menu)).toEqual(['work_tree', 'shop', 'orders', 'build', 'pause']);
    expect(t.count('first_input')).toBe(1);
  });
});

describe('Pre-telemetry saves (RC1 / RC2 envelope v1)', () => {
  it('a real RC1 late save loads, gets a run identity, sends nothing for the past and keeps the factory identical', async () => {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/rc1-late-save.json'), 'utf8'));
    const storage = new MemStorage();
    storage.setJSON(SAVE_KEY, raw); // stored exactly as the RC1 build wrote it: no `v`, no meta.telemetry
    const saves = new SaveManager(storage);
    const loaded = saves.load()!;
    expect(saves.loadedEnvelopeVersion).toBe(1);
    expect(saves.loadedSaveVersion).toBe(1);
    expect(loaded.meta.telemetry).toBeUndefined();
    const before = JSON.stringify({ ...loaded.sim.serialize(), savedAt: 0 });

    const t = await setup();
    t.tel.sessionStart({ hasSave: true, activeRun: true, saveVersion: saves.loadedSaveVersion });
    const state = t.tel.attachRun(loaded.sim, undefined, false);
    t.tel.frame(1.1, true);
    expect(t.names()).toEqual(['game_session_start']);
    expect(t.rec.sent[0].params).toMatchObject({ new_player: 'false', returning_player: 'true', save_version: '1' });
    expect(state.runIndex).toBe(1);
    for (const k of ['first_machine', 'first_robotic_arm', 'first_scanner', 'first_needle', 'scanner_unlock', 'progress_10', 'checkpoint_600', 'menu_work_tree']) {
      expect(t.tel.hasFired(k), k).toBe(true);
    }
    // Gameplay state untouched by telemetry.
    expect(JSON.stringify({ ...loaded.sim.serialize(), savedAt: 0 })).toBe(before);

    // Re-saved as envelope v2 with telemetry; the sim part is unchanged.
    const meta: GameMeta = { ...loaded.meta, telemetry: t.tel.state() };
    expect(saves.save(loaded.sim, meta)).toBe(true);
    const env = storage.getJSON<{ v: number; sim: { version: number }; meta: GameMeta }>(SAVE_KEY)!;
    expect(env.v).toBe(ENVELOPE_VERSION);
    expect(env.sim.version).toBe(2);
    expect(env.meta.telemetry!.runId).toBe(state.runId);
    const again = new SaveManager(storage).load()!;
    expect(again.meta.telemetry!.fired).toEqual(expect.arrayContaining(['first_robotic_arm', 'progress_10']));
    expect(JSON.stringify({ ...again.sim.serialize(), savedAt: 0 })).toBe(before);
  });

  it('a malformed telemetry block is ignored (backfilled), never crashes the load', () => {
    const storage = new MemStorage();
    const sim = new Sim(18);
    new SaveManager(storage).save(sim, { hintsDone: [], continuedAfterCompletion: false, telemetry: { v: 7 } as unknown as RunTelemetryState });
    const loaded = new SaveManager(storage).load();
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.telemetry).toBeUndefined();
  });
});

describe('Player profile', () => {
  it('counts sessions and runs across New Run; bad data falls back to a fresh profile', async () => {
    const storage = new MemStorage();
    const p = loadProfile(storage, 5);
    expect(p).toMatchObject({ sessions: 0, runsStarted: 0 });
    const t = await setup(p);
    t.tel.sessionStart({ hasSave: false, activeRun: false, saveVersion: null });
    t.tel.attachRun(new Sim(19), undefined, true);
    t.tel.attachRun(new Sim(20), undefined, true);
    expect(t.rec.sent.filter((e) => e.name === 'run_start').map((e) => e.params.run_index)).toEqual(['1', '2']);
    saveProfile(storage, p);
    expect(loadProfile(storage, 9)).toMatchObject({ sessions: 1, runsStarted: 2 });
    storage.map.set(PROFILE_KEY, '{"sessions":"lots","runsStarted":-3}');
    expect(loadProfile(storage, 9)).toMatchObject({ sessions: 0, runsStarted: 0 });

    // A later session reports the time since the last one and returning_player.
    const t2 = await setup(loadProfile(storage, 9));
    t2.profile.lastSeenAt = 400_000; // the test clock is at 1_000_000 ms
    t2.tel.sessionStart({ hasSave: true, activeRun: true, saveVersion: 2 });
    expect(t2.rec.sent[0].params).toMatchObject({ returning_player: 'true', time_since_last_session_seconds: '600', session_index: '1' }); // profile was reset by the bad data above
  });
});

describe('Welcome Back', () => {
  const played = () => { const s = new Sim(21); s.time = 900; return s; };
  const now = 10_000_000_000;

  it('not on a new run, not after a short absence, shown after the threshold', () => {
    const fresh = new Sim(22);
    expect(welcomeBackInfo(fresh, now - 3_600_000, now)).toBeNull(); // run not started
    expect(welcomeBackInfo(played(), 0, now)).toBeNull(); // no save time
    expect(welcomeBackInfo(played(), now - 20_000, now)).toBeNull(); // accidental reload
    expect(welcomeBackInfo(played(), now - (WELCOME_BACK_MIN_AWAY_S - 1) * 1000, now)).toBeNull();
    expect(welcomeBackInfo(played(), now - WELCOME_BACK_MIN_AWAY_S * 1000, now)).not.toBeNull();
  });

  it('shows real run data', () => {
    const sim = played();
    sim.progress.addMoney(12_450, 'milestone');
    sim.progress.onNeedleFound(0, 'manual', { x: 0, y: 1, z: 0 });
    sim.progress.onNeedleFound(1, 'scanner', { x: 0, y: 1, z: 0 });
    const info = welcomeBackInfo(sim, now - 2 * 3_600_000, now)!;
    expect(info).toMatchObject({
      secondsAway: 7200, needlesFound: 2, needlesTotal: 6, objective: 'Find needle #3 of 6', stage: 'manual',
      money: Math.floor(sim.progress.money), playedSeconds: 900, pilePercent: 0, hayPerSecond: 0,
    });
    expect(info.orders.length).toBeGreaterThan(0);
  });

  it('is read-only: money, hay, needles, buildings and time are unchanged', () => {
    const sim = played();
    rich(sim);
    const before = JSON.stringify({ ...sim.serialize(), savedAt: 0 });
    for (let i = 0; i < 5; i++) welcomeBackInfo(sim, now - 86_400_000, now);
    expect(JSON.stringify({ ...sim.serialize(), savedAt: 0 })).toBe(before);
  });

  it('shown / continue events, continue only once', async () => {
    const t = await setup();
    const sim = played();
    t.tel.attachRun(sim, undefined, false);
    const info = welcomeBackInfo(sim, now - 2 * 3_600_000, now)!;
    t.tel.onWelcomeBack(info);
    t.tel.onPlayerStart();
    t.tel.onPlayerStart();
    expect(t.rec.sent.filter((e) => e.name.startsWith('welcome_back')).map((e) => e.name)).toEqual(['welcome_back_shown', 'welcome_back_continue']);
    expect(t.last('welcome_back_shown')!.params).toMatchObject({ seconds_away: '7200', run_progress: '0', current_stage: 'manual' });
  });
});

describe('wire params stay small', () => {
  it('no event sends more than 24 params or long values', async () => {
    const t = await setup();
    const sim = new Sim(23);
    t.tel.attachRun(sim, undefined, true);
    sim.progress.onNeedleFound(2, 'detector', { x: 0, y: 1, z: 0 });
    for (const e of t.rec.sent) {
      expect(Object.keys(e.params).length).toBeLessThanOrEqual(24);
      for (const v of Object.values(e.params)) expect(v.length).toBeLessThanOrEqual(48);
    }
    expect(toWireParams({ a: 1 })).toEqual({ a: '1' });
  });
});
