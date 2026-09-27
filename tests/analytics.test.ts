/**
 * ANALYTICS (P0 Basic Launch): AnalyticsService + adapters + event catalog. ByteBrew is always mocked: no test
 * makes a network request.
 */
import { describe, expect, it, vi } from 'vitest';
import { Analytics } from '../src/platform/analytics';
import { createRemoteAdapter, privacyPolicyUrl, urlOptOut } from '../src/platform/analyticsConfig';
import {
  isValidName, LOCAL_EVENTS, REMOTE_EVENTS, toWireParams, toWireValue,
} from '../src/platform/analyticsEvents';
import { AnalyticsService, MAX_PENDING_EVENTS, MAX_REMOTE_EVENTS_PER_SESSION, NoopAnalyticsAdapter, type AnalyticsAdapter } from '../src/platform/analyticsService';
import { ByteBrewAnalyticsAdapter, type ByteBrewApi } from '../src/platform/bytebrewAdapter';

/** In-memory ByteBrew double: records custom events; `initAfter` polls until the session "arrives". */
function fakeByteBrew(o: { initAfter?: number; throwOnSend?: boolean; neverInit?: boolean } = {}) {
  let polls = 0;
  const api = {
    inits: [] as string[][],
    events: [] as { name: string; value?: object }[],
    stopped: 0,
    restarted: 0,
    initializeByteBrew(a: string, k: string, v: string) { api.inits.push([a, k, v]); },
    isByteBrewInitialized() { if (o.neverInit) return false; polls++; return polls > (o.initAfter ?? 0); },
    newCustomEvent(name: string, value?: object) {
      if (o.throwOnSend) throw new Error('network down');
      api.events.push(value === undefined ? { name } : { name, value });
    },
    stopTracking() { api.stopped++; },
    restartTracking() { api.restarted++; },
  };
  return api;
}

const noSleep = () => Promise.resolve();
const cfg = { appId: 'app', sdkKey: 'key', appVersion: '9.9.9' };

function adapter(api: ByteBrewApi, timeoutMs = 1000): ByteBrewAnalyticsAdapter {
  return new ByteBrewAnalyticsAdapter(cfg, () => Promise.resolve(api), timeoutMs, noSleep);
}

describe('event catalog and wire format (ByteBrew naming rules)', () => {
  it('every event name is snake_case with no spaces, periods or colons, and names are unique', () => {
    const all = [...REMOTE_EVENTS, ...LOCAL_EVENTS];
    expect(new Set(all).size).toBe(all.length);
    for (const n of all) {
      expect(isValidName(n), n).toBe(true);
      expect(n).not.toMatch(/[ .:]/);
    }
  });

  it('params are normalised: snake_case keys, string values, integers only, nothing empty', () => {
    const w = toWireParams({ machineType: 'scannerMk2', 'bad key.with:stuff': 3, avg_fps: 59.6, ok: true, gone: null, nan: NaN, empty: '' });
    expect(w).toEqual({ machine_type: 'scanner_mk2', bad_key_with_stuff: '3', avg_fps: '60', ok: 'true' });
    for (const [k, v] of Object.entries(w)) {
      expect(isValidName(k)).toBe(true);
      expect(v).not.toMatch(/[ .:]/);
    }
    expect(toWireValue('Needle of the Claw: 0.2')).toBe('needle_of_the_claw_0_2');
    expect(toWireValue('x'.repeat(100))!.length).toBeLessThanOrEqual(48);
  });
});

describe('AnalyticsService', () => {
  it('local analytics works with no remote configured (noop adapter)', async () => {
    const s = new AnalyticsService({ remote: new NoopAnalyticsAdapter() });
    await s.init();
    s.track('first_input', { a: 1 });
    expect(s.local.events().map((e) => e.name)).toEqual(['first_input']);
    expect(s.diagnostics()).toMatchObject({ adapter: 'noop', state: 'unavailable', sent: 0 });
  });

  it('missing ByteBrew keys -> noop adapter, the game keeps tracking locally', () => {
    expect(createRemoteAdapter({}).id).toBe('noop');
    expect(createRemoteAdapter({ VITE_BYTEBREW_WEB_APP_ID: 'x' }).id).toBe('noop');
    expect(createRemoteAdapter({ VITE_BYTEBREW_WEB_APP_ID: 'x', VITE_BYTEBREW_WEB_SDK_KEY: 'y' }).id).toBe('bytebrew');
    expect(createRemoteAdapter({ VITE_BYTEBREW_WEB_APP_ID: 'x', VITE_BYTEBREW_WEB_SDK_KEY: 'y', VITE_ANALYTICS_ENABLED: 'false' }).id).toBe('noop');
  });

  it('privacy policy link: only absolute https URLs; the notice depends on a real remote destination', () => {
    expect(privacyPolicyUrl({ VITE_PRIVACY_POLICY_URL: 'https://example.com/privacy' })).toBe('https://example.com/privacy');
    expect(privacyPolicyUrl({ VITE_PRIVACY_POLICY_URL: 'http://example.com/privacy' })).toBeNull();
    expect(privacyPolicyUrl({ VITE_PRIVACY_POLICY_URL: 'javascript:alert(1)' })).toBeNull();
    expect(privacyPolicyUrl({})).toBeNull();
    expect(new AnalyticsService({ remote: new NoopAnalyticsAdapter() }).hasRemote()).toBe(false);
    expect(new AnalyticsService({ remote: adapter(fakeByteBrew()) }).hasRemote()).toBe(true);
  });

  it('?analytics=0 opts out for the page load', () => {
    expect(urlOptOut('?analytics=0')).toBe(true);
    expect(urlOptOut('?debug=1&analytics=off')).toBe(true);
    expect(urlOptOut('?debug=1')).toBe(false);
    expect(urlOptOut(undefined)).toBe(false);
  });

  it('ByteBrew: initialises with the configured keys, queues events until the session exists, then sends them in order', async () => {
    const api = fakeByteBrew({ initAfter: 3 });
    const s = new AnalyticsService({ remote: adapter(api) });
    s.setContext(() => ({ game_version: '9.9.9', run_index: 1 }));
    s.track('game_session_start', { new_player: true });
    const p = s.init();
    s.track('first_input');
    await p;
    s.track('first_dig');
    expect(api.inits).toEqual([['app', 'key', '9.9.9']]);
    expect(api.events.map((e) => e.name)).toEqual(['game_session_start', 'first_input', 'first_dig']);
    expect(api.events[0].value).toEqual({ game_version: '9_9_9', run_index: '1', new_player: 'true' });
    expect(s.diagnostics()).toMatchObject({ adapter: 'bytebrew', state: 'ready', sent: 3, pending: 0 });
  });

  it('ByteBrew failing to load or to start never breaks the game (service turns local-only)', async () => {
    const broken: AnalyticsAdapter = new ByteBrewAnalyticsAdapter(cfg, () => Promise.reject(new Error('chunk blocked')), 1000, noSleep);
    const s = new AnalyticsService({ remote: broken });
    s.track('first_input');
    await expect(s.init()).resolves.toBeUndefined();
    expect(() => s.track('first_dig')).not.toThrow();
    expect(s.diagnostics().state).toBe('unavailable');
    expect(s.diagnostics().adapterStatus).toContain('chunk blocked');
    expect(s.local.events().map((e) => e.name)).toEqual(['first_input', 'first_dig']);

    const never = fakeByteBrew({ neverInit: true });
    const s2 = new AnalyticsService({ remote: adapter(never, 500) });
    s2.track('first_input');
    await s2.init();
    expect(s2.diagnostics().state).toBe('unavailable');
    expect(never.events).toHaveLength(0);
  });

  it('a throwing SDK call is swallowed', async () => {
    const api = fakeByteBrew({ throwOnSend: true });
    const s = new AnalyticsService({ remote: adapter(api) });
    await s.init();
    expect(() => s.track('first_input')).not.toThrow();
    expect(s.diagnostics()).toMatchObject({ sent: 0, dropped: 1 });
    const bad: AnalyticsAdapter = { id: 'bytebrew', init: () => Promise.resolve(true), send: () => { throw new Error('x'); }, setEnabled: () => { throw new Error('y'); }, status: () => { throw new Error('z'); } };
    const s2 = new AnalyticsService({ remote: bad });
    await s2.init();
    expect(() => { s2.track('first_input'); s2.setEnabled(false); s2.diagnostics(); }).not.toThrow();
    const s3 = new AnalyticsService({ remote: new NoopAnalyticsAdapter() });
    s3.setContext(() => { throw new Error('context broken'); });
    expect(() => s3.track('first_input')).not.toThrow();
  });

  it('disabled = no remote event (and ByteBrew tracking is stopped / restarted)', async () => {
    const api = fakeByteBrew();
    const s = new AnalyticsService({ remote: adapter(api), enabled: false });
    await s.init();
    s.track('first_input');
    expect(api.inits).toHaveLength(0);
    expect(api.events).toHaveLength(0);
    expect(s.local.events()).toHaveLength(1);
    s.setEnabled(true);
    await vi.waitFor(() => expect(s.diagnostics().state).toBe('ready'));
    s.track('first_dig');
    s.setEnabled(false);
    s.track('first_needle');
    expect(api.events.map((e) => e.name)).toEqual(['first_dig']);
    expect(api.stopped).toBe(1);
    s.setEnabled(true);
    expect(api.restarted).toBe(1);
  });

  it('local-only events never reach the remote adapter; the queue and the session total are capped', async () => {
    const api = fakeByteBrew();
    const s = new AnalyticsService({ remote: adapter(api) });
    for (let i = 0; i < MAX_PENDING_EVENTS + 50; i++) s.track('machine_built', { i });
    s.track('quit_state', { minutes: 3 });
    await s.init();
    expect(api.events).toHaveLength(MAX_PENDING_EVENTS);
    for (let i = 0; i < MAX_REMOTE_EVENTS_PER_SESSION; i++) s.track('machine_built');
    expect(api.events).toHaveLength(MAX_REMOTE_EVENTS_PER_SESSION);
    expect(api.events.some((e) => e.name === 'quit_state')).toBe(false);
  });

  it('keeps the existing local buffer (window.__pnAnalytics) as the local destination', () => {
    const local = new Analytics();
    const s = new AnalyticsService({ local });
    s.track('first_input');
    expect(local.events()[0].name).toBe('first_input');
  });
});
