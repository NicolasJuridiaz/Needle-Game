/**
 * ANALYTICS CONSENT (P0.1, opt-in): unknown / granted / denied, against the real Sim, SaveManager, GameTelemetry,
 * AnalyticsService and ByteBrewAnalyticsAdapter. ByteBrew itself is a double: no network.
 * "Reload" = a new boot on the same storage, wired exactly like Game (initialProfile -> GameTelemetry ->
 * AnalyticsConsentController.start -> sessionStart -> load/attach), with the controller's save rules.
 */
import { describe, expect, it } from 'vitest';
import { AnalyticsConsentController, CONSENT_KEY, initialProfile, loadConsent } from '../src/game/analyticsConsent';
import { PROFILE_KEY } from '../src/game/profile';
import { SAVE_KEY, SaveManager, type GameMeta, type KeyValueStorage } from '../src/game/saveManager';
import { GameTelemetry } from '../src/game/telemetry';
import { createRemoteAdapter } from '../src/platform/analyticsConfig';
import { AnalyticsService } from '../src/platform/analyticsService';
import type { ByteBrewApi } from '../src/platform/bytebrewAdapter';
import { Sim } from '../src/sim/sim';
import { findSpot, grantTech, parkPlayer, rich } from './support/simKit';

class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getJSON<T>(k: string): T | null { const v = this.map.get(k); return v === undefined ? null : (JSON.parse(v) as T); }
  setJSON(k: string, v: unknown): boolean { this.map.set(k, JSON.stringify(v)); return true; }
  remove(k: string): void { this.map.delete(k); }
}

/** One ByteBrew "account" shared across reloads: counts SDK loads, inits and events. */
function byteBrewWorld() {
  const w = {
    loads: 0, inits: 0, stops: 0, restarts: 0,
    events: [] as { name: string; value?: Record<string, string> }[],
    api: null as ByteBrewApi | null,
  };
  const api: ByteBrewApi = {
    initializeByteBrew: () => { w.inits++; },
    isByteBrewInitialized: () => w.inits > 0,
    newCustomEvent: (name: string, value?: object) => { w.events.push({ name, value: value as Record<string, string> }); },
    stopTracking: () => { w.stops++; },
    restartTracking: () => { w.restarts++; },
  };
  w.api = api;
  return w;
}
type World = ReturnType<typeof byteBrewWorld>;

const FULL_ENV = { VITE_BYTEBREW_WEB_APP_ID: 'app', VITE_BYTEBREW_WEB_SDK_KEY: 'key', VITE_PRIVACY_POLICY_URL: 'https://example.com/privacy' };

/** A page load of the game (the analytics part of Game's constructor). */
async function boot(storage: MemStorage, world: World, env: Record<string, string> = FULL_ENV, seed = 41) {
  const remote = createRemoteAdapter(env, { loader: async () => { world.loads++; return world.api!; } });
  const analytics = new AnalyticsService({ remote, enabled: false });
  const profile = initialProfile(storage, 1_000_000);
  const telemetry = new GameTelemetry({ analytics, profile, version: 't', platform: () => 'web', perf: () => ({ quality: 'low', drawCalls: 0, triangles: 0, deviceClass: 'unknown' }), now: () => 1_000_000 });
  const saves = new SaveManager(storage);
  let meta: GameMeta = { hintsDone: [], continuedAfterCompletion: false };
  let sim!: Sim;
  const save = () => { meta.telemetry = consent.telemetryForSave(); saves.save(sim, meta); consent.persistProfile(); };
  const consent = new AnalyticsConsentController({ storage, analytics, telemetry, profile, onWithdrawn: () => { meta.telemetry = undefined; save(); } });
  consent.start();
  const hadSave = saves.hasSave();
  const loaded = saves.load();
  telemetry.sessionStart({ hasSave: hadSave, activeRun: !!loaded, saveVersion: saves.loadedSaveVersion });
  if (loaded) { meta = loaded.meta; sim = loaded.sim; meta.telemetry = telemetry.attachRun(sim, meta.telemetry, false); }
  else { sim = new Sim(seed); meta.telemetry = telemetry.attachRun(sim, undefined, true); }
  consent.persistProfile();
  await analytics.init();
  await settle();
  return { analytics, telemetry, consent, sim, save, saves, meta: () => meta, local: () => analytics.local.events().map((e) => e.name) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const names = (w: World) => w.events.map((e) => e.name);

function playSomeFirstSteps(sim: Sim): void {
  parkPlayer(sim); rich(sim);
  grantTech(sim.progress, 'x_rake@1');
  const spot = findSpot(sim, 'pistonRake', -28, -8, -24, -10)!;
  sim.place('pistonRake', spot.cell, spot.rot);
  sim.time = 400;
}

describe('fresh user (consent unknown)', () => {
  it('game runs and saves; ByteBrew never loaded or initialised; zero remote events; prompt shown; setting off', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w);
    playSomeFirstSteps(g.sim);
    g.telemetry.frame(1.1, true);
    g.save();
    expect(w.loads).toBe(0);
    expect(w.inits).toBe(0);
    expect(w.events).toHaveLength(0);
    expect(g.local()).toEqual(expect.arrayContaining(['game_session_start', 'run_start', 'first_rake'])); // local debug buffer only
    expect(g.consent.view()).toEqual({ state: 'unknown', available: true, on: false, prompt: true });
    // Nothing analytics-only persisted: no consent key, no profile, no run id in the save.
    expect(storage.map.has(CONSENT_KEY)).toBe(false);
    expect(storage.map.has(PROFILE_KEY)).toBe(false);
    const env = JSON.parse(storage.map.get(SAVE_KEY)!);
    expect(env.meta.telemetry).toBeUndefined();
    // The run itself is saved and reloads.
    const again = new SaveManager(storage).load()!;
    expect(again.sim.buildings.size).toBe(g.sim.buildings.size);
  });
});

describe('accept', () => {
  it('explicit Allow -> granted; ByteBrew initialises once; only new events are sent (no retro funnel); persists across reload', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w);
    playSomeFirstSteps(g.sim); // first_machine, first_rake, machine_built, checkpoints ... happen BEFORE consent
    g.telemetry.frame(1.1, true);
    expect(g.consent.grant('prompt')).toBe(true);
    await settle(); await settle();
    expect(w.loads).toBe(1);
    expect(w.inits).toBe(1);
    expect(names(w)).toEqual(['analytics_consent_granted']);
    expect(w.events[0].value).toMatchObject({ source: 'prompt', stage: 'automation', run_index: '1' });
    // New actions after consent are sent; pre-consent milestones are never sent.
    const spot = findSpot(g.sim, 'pistonRake', -28, -8, -24, -10)!;
    g.sim.place('pistonRake', spot.cell, spot.rot);
    expect(names(w)).toEqual(['analytics_consent_granted', 'machine_built']);
    for (const n of ['game_session_start', 'run_start', 'first_rake', 'first_machine', 'playtime_checkpoint']) expect(names(w)).not.toContain(n);
    g.consent.grant('settings'); // idempotent
    expect(w.inits).toBe(1);
    g.save();
    expect(loadConsent(storage)).toBe('granted');
    expect(storage.map.has(PROFILE_KEY)).toBe(true);

    // Reload: granted remembered, no prompt, tracking starts at boot, still no duplicate firsts.
    const g2 = await boot(storage, w);
    await settle();
    expect(g2.consent.view()).toMatchObject({ state: 'granted', on: true, prompt: false });
    expect(w.inits).toBe(2); // one per page load
    const after = names(w).slice(2);
    expect(after).toEqual(['game_session_start']);
    expect(w.events.at(-1)!.value).toMatchObject({ returning_player: 'true' });
  });
});

describe('reject', () => {
  it('Continue without analytics -> denied; ByteBrew never initialised; game works; persists; no prompt after reload', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w);
    g.consent.deny();
    playSomeFirstSteps(g.sim);
    g.telemetry.frame(1.1, true);
    g.save();
    expect(w.loads + w.inits + w.events.length).toBe(0);
    expect(loadConsent(storage)).toBe('denied');
    expect(storage.map.has(PROFILE_KEY)).toBe(false);
    const g2 = await boot(storage, w);
    expect(g2.consent.view()).toEqual({ state: 'denied', available: true, on: false, prompt: false });
    expect(g2.sim.buildings.size).toBe(g.sim.buildings.size); // the run continues
    expect(w.loads + w.inits + w.events.length).toBe(0);
  });
});

describe('withdraw', () => {
  it('granted -> denied: stopTracking, no later events, analytics data removed from save and profile, reload stays denied', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w);
    g.consent.grant('prompt');
    await settle(); await settle();
    playSomeFirstSteps(g.sim);
    g.save();
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).meta.telemetry).toBeDefined();
    const sentBefore = w.events.length;
    g.consent.deny();
    expect(w.stops).toBe(1);
    g.telemetry.frame(1.1, true);
    const spot = findSpot(g.sim, 'pistonRake', -28, -8, -24, -10)!;
    g.sim.place('pistonRake', spot.cell, spot.rot);
    expect(w.events.length).toBe(sentBefore);
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).meta.telemetry).toBeUndefined();
    expect(storage.map.has(PROFILE_KEY)).toBe(false);
    const g2 = await boot(storage, w);
    expect(g2.consent.state).toBe('denied');
    expect(w.events.length).toBe(sentBefore);
    expect(w.inits).toBe(1);
  });
});

describe('re-enable', () => {
  it('denied -> granted from Settings: initialises safely and new events flow', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w);
    g.consent.deny();
    expect(g.consent.grant('settings')).toBe(true);
    await settle(); await settle();
    expect(w.inits).toBe(1);
    expect(names(w)).toEqual(['analytics_consent_granted']);
    expect(w.events[0].value).toMatchObject({ source: 'settings' });
    g.telemetry.onMode('shop');
    expect(names(w)).toEqual(['analytics_consent_granted', 'menu_first_open']);
    // Same page: off then on again uses stopTracking / restartTracking, never a second init.
    g.consent.deny();
    g.consent.grant('settings');
    expect(w.stops).toBe(1);
    expect(w.restarts).toBe(1);
    expect(w.inits).toBe(1);
  });
});

describe('missing configuration', () => {
  for (const [label, env] of [
    ['no keys', { VITE_PRIVACY_POLICY_URL: 'https://example.com/privacy' }],
    ['no privacy policy URL', { VITE_BYTEBREW_WEB_APP_ID: 'app', VITE_BYTEBREW_WEB_SDK_KEY: 'key' }],
    ['analytics disabled for the build', { ...FULL_ENV, VITE_ANALYTICS_ENABLED: 'false' }],
  ] as const) {
    it(`${label}: the game works, no prompt, consent cannot be granted, nothing remote`, async () => {
      const storage = new MemStorage(), w = byteBrewWorld();
      const g = await boot(storage, w, env as Record<string, string>);
      playSomeFirstSteps(g.sim);
      g.save();
      expect(g.consent.view()).toEqual({ state: 'unknown', available: false, on: false, prompt: false });
      expect(g.consent.grant('settings')).toBe(false);
      expect(loadConsent(storage)).toBe('unknown');
      expect(w.loads + w.inits + w.events.length).toBe(0);
      expect(new SaveManager(storage).load()).not.toBeNull();
    });
  }

  it('a previously granted player on a build without remote analytics: nothing starts, no profile written', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    storage.setJSON(CONSENT_KEY, 'granted');
    const g = await boot(storage, w, {});
    g.save();
    expect(g.consent.view()).toMatchObject({ state: 'granted', available: false, on: false });
    expect(w.loads + w.inits).toBe(0);
    expect(JSON.parse(storage.map.get(SAVE_KEY)!).meta.telemetry).toBeUndefined();
  });

  it('a stale analytics profile (older build) is removed when there is no consent; bad consent values read as unknown', () => {
    const storage = new MemStorage();
    storage.setJSON(PROFILE_KEY, { v: 1, sessions: 9, runsStarted: 3, firstSeenAt: 1, lastSeenAt: 2 });
    storage.map.set(CONSENT_KEY, '"yes please"');
    expect(loadConsent(storage)).toBe('unknown');
    const analytics = new AnalyticsService({ enabled: false });
    const profile = initialProfile(storage, 5);
    expect(profile.sessions).toBe(0);
    const telemetry = new GameTelemetry({ analytics, profile, version: 't', platform: () => 'web', perf: () => ({ quality: 'low', drawCalls: 0, triangles: 0, deviceClass: 'unknown' }) });
    new AnalyticsConsentController({ storage, analytics, telemetry, profile });
    expect(storage.map.has(PROFILE_KEY)).toBe(false);
  });
});

describe('development / debugging', () => {
  it('the local debug buffer still records telemetry without consent and without any remote request', async () => {
    const storage = new MemStorage(), w = byteBrewWorld();
    const g = await boot(storage, w, {});
    g.telemetry.onMode('workTree');
    expect(g.local()).toContain('menu_first_open');
    expect(g.analytics.diagnostics()).toMatchObject({ adapter: 'noop', enabled: false, sent: 0 });
    expect(w.loads).toBe(0);
  });
});
