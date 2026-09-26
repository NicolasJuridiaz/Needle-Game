import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEEDLE_COUNT } from '../src/config/needles';
import { Platform, SDK_INIT_TIMEOUT_MS } from '../src/platform/crazygames';
import { DIAGNOSTIC_HISTORY, DiagnosticLog } from '../src/platform/log';
import { completionPercent, trackRunProgress } from '../src/platform/progress';
import { MAX_ENTRY_BYTES, PlatformStorage, utf8Length } from '../src/platform/storage';
import { Analytics, ANALYTICS_BUFFER_SIZE, type AnalyticsDebugHandle, type AnalyticsEvent } from '../src/platform/analytics';
import type { CrazyGameSettings } from '../src/platform/sdk';
import { Sim } from '../src/sim/sim';

class MemLocalStorage {
  readonly map = new Map<string, string>();
  failWith: unknown = null;
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void {
    if (this.failWith) throw this.failWith;
    this.map.set(k, v);
  }
  removeItem(k: string): void { this.map.delete(k); }
}

interface FakeSdkOptions {
  env?: string;
  init?: () => Promise<void>;
  muted?: boolean;
  device?: 'desktop' | 'tablet' | 'mobile';
}

function fakeSdk(o: FakeSdkOptions = {}) {
  const calls: string[] = [];
  const store = new Map<string, string>();
  const listeners: ((s: CrazyGameSettings) => void)[] = [];
  const data = {
    failWith: null as unknown,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: vi.fn((k: string, v: string) => {
      if (data.failWith) throw data.failWith;
      store.set(k, v);
    }),
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  const sdk = {
    environment: o.env ?? 'crazygames',
    init: o.init ?? (() => Promise.resolve()),
    game: {
      settings: { muteAudio: o.muted ?? false, disableChat: false },
      loadingStart: () => calls.push('loadingStart'),
      loadingStop: () => calls.push('loadingStop'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
      happytime: () => calls.push('happytime'),
      reportGameCompletedPercentage: (p: number) => calls.push(`progress:${p}`),
      addSettingsChangeListener: (fn: (s: CrazyGameSettings) => void) => listeners.push(fn),
      removeSettingsChangeListener: (fn: (s: CrazyGameSettings) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      setGameContext: (ctx: Record<string, unknown>) => calls.push(`context:${JSON.stringify(ctx)}`),
      clearGameContext: () => calls.push('clearContext'),
    },
    data,
    user: { systemInfo: { device: { type: o.device ?? 'desktop' } } },
  };
  return {
    sdk,
    calls,
    store,
    data,
    changeSettings(s: CrazyGameSettings) { for (const l of listeners) l(s); },
    listenerCount: () => listeners.length,
  };
}

type G = { window?: unknown; localStorage?: unknown; location?: unknown };
const g = globalThis as unknown as G;
let ls: MemLocalStorage;

beforeEach(() => {
  ls = new MemLocalStorage();
  g.localStorage = ls;
  g.window = {};
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete g.window;
  delete g.localStorage;
  delete g.location;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function withSdk(f: ReturnType<typeof fakeSdk>): void {
  g.window = { CrazyGames: { SDK: f.sdk } };
}

describe('Platform init / fallback', () => {
  it('falls back to a no-op adapter when the SDK script is missing', async () => {
    const p = new Platform();
    await p.init();
    expect(p.env).toBe('disabled');
    expect(p.sdkActive).toBe(false);
    expect(p.initError).toMatch(/not loaded/);
    expect(() => { p.gameplayStart(); p.gameplayStop(); p.happytime(); p.reportProgress(50); p.setContext({ a: 1 }); }).not.toThrow();
    expect(p.storage.setJSON('k', { a: 1 })).toBe(true);
    expect(ls.getItem('k')).toBe('{"a":1}');
  });

  it('falls back when window itself is missing (Node / worker)', async () => {
    delete g.window;
    const p = new Platform();
    await p.init();
    expect(p.env).toBe('disabled');
    expect(p.isTouchOnlyDevice()).toBe(false);
  });

  it('falls back when init() rejects', async () => {
    const f = fakeSdk({ init: () => Promise.reject(new Error('blocked')) });
    withSdk(f);
    const p = new Platform();
    await expect(p.init()).resolves.toBeUndefined();
    expect(p.env).toBe('disabled');
    expect(p.initError).toMatch(/blocked/);
    p.gameplayStart();
    expect(f.calls).toEqual([]);
    p.storage.setString('x', 'y');
    expect(ls.getItem('x')).toBe('y');
    expect(f.store.size).toBe(0);
  });

  it('falls back when init() throws synchronously', async () => {
    const f = fakeSdk({ init: () => { throw new Error('sync boom'); } });
    withSdk(f);
    const p = new Platform();
    await p.init();
    expect(p.env).toBe('disabled');
  });

  it('times out a slow init and ignores its late resolution', async () => {
    vi.useFakeTimers();
    let resolveInit!: () => void;
    const f = fakeSdk({ init: () => new Promise<void>((r) => { resolveInit = r; }) });
    withSdk(f);
    const p = new Platform();
    let done = false;
    const pr = p.init().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(SDK_INIT_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pr;
    expect(done).toBe(true);
    expect(p.env).toBe('disabled');
    expect(p.initError).toMatch(/timed out/);
    resolveInit();
    await vi.advanceTimersByTimeAsync(10);
    expect(p.env).toBe('disabled');
    p.gameplayStart();
    expect(f.calls).toEqual([]);
  });

  it("treats the 'disabled' environment as no SDK", async () => {
    const f = fakeSdk({ env: 'disabled' });
    withSdk(f);
    const p = new Platform();
    await p.init();
    expect(p.env).toBe('disabled');
    p.loadingStart();
    expect(f.calls).toEqual([]);
  });

  it('activates the SDK in crazygames / local environments and inits only once', async () => {
    const init = vi.fn(() => Promise.resolve());
    const f = fakeSdk({ env: 'local', init });
    withSdk(f);
    const p = new Platform();
    await Promise.all([p.init(), p.init()]);
    await p.init();
    expect(init).toHaveBeenCalledTimes(1);
    expect(p.env).toBe('local');
    expect(p.sdkActive).toBe(true);
    expect(p.initError).toBeNull();
  });
});

describe('Platform lifecycle calls', () => {
  async function ready(o: FakeSdkOptions = {}) {
    const f = fakeSdk(o);
    withSdk(f);
    const p = new Platform();
    await p.init();
    return { f, p };
  }

  it('gameplayStart / gameplayStop are idempotent and never duplicated', async () => {
    const { f, p } = await ready();
    p.gameplayStop(); // not started yet: ignored
    p.gameplayStart();
    p.gameplayStart();
    p.gameplayStop();
    p.gameplayStop();
    p.gameplayStart();
    expect(f.calls).toEqual(['gameplayStart', 'gameplayStop', 'gameplayStart']);
    expect(p.isInGameplay).toBe(true);
  });

  it('loadingStart / loadingStop are paired', async () => {
    const { f, p } = await ready();
    p.loadingStop();
    p.loadingStart();
    p.loadingStart();
    p.loadingStop();
    expect(f.calls).toEqual(['loadingStart', 'loadingStop']);
  });

  it('SDK exceptions never escape', async () => {
    const { f, p } = await ready();
    f.sdk.game.gameplayStart = () => { throw new Error('sdk bug'); };
    expect(() => p.gameplayStart()).not.toThrow();
  });

  it('reportProgress clamps, rounds and forwards only increases within a run', async () => {
    const { f, p } = await ready();
    p.reportProgress(33.4);
    p.reportProgress(33);
    p.reportProgress(150);
    p.reportProgress(Number.NaN);
    p.reportProgress(-5);
    p.reportProgress(80);
    expect(f.calls).toEqual(['progress:33', 'progress:100']);
    expect(p.reportedProgress).toBe(100);
    // A new run may go back down (and is always reported, even when unchanged).
    p.startRun(0);
    p.startRun(0);
    p.reportProgress(17);
    expect(f.calls).toEqual(['progress:33', 'progress:100', 'progress:0', 'progress:0', 'progress:17']);
  });

  it('happytime is rate limited', async () => {
    const { f, p } = await ready();
    p.happytime();
    p.happytime();
    expect(f.calls.filter((c) => c === 'happytime')).toHaveLength(1);
  });

  it('forwards game context', async () => {
    const { f, p } = await ready();
    p.setContext({ needles: 2 });
    p.clearContext();
    expect(f.calls).toEqual(['context:{"needles":2}', 'clearContext']);
  });

  it('reads muteAudio and notifies only on changes', async () => {
    const { f, p } = await ready({ muted: true });
    expect(p.isMuted).toBe(true);
    const seen: boolean[] = [];
    const off = p.onMuteChange((m) => seen.push(m));
    f.changeSettings({ muteAudio: true, disableChat: false });
    f.changeSettings({ muteAudio: false, disableChat: false });
    f.changeSettings({ muteAudio: false, disableChat: true });
    off();
    f.changeSettings({ muteAudio: true, disableChat: false });
    expect(seen).toEqual([false]);
    expect(p.isMuted).toBe(true);
    p.dispose();
    expect(f.listenerCount()).toBe(0);
  });

  it('detects touch-only devices from SDK system info', async () => {
    const mobile = await ready({ device: 'mobile' });
    expect(mobile.p.isTouchOnlyDevice()).toBe(true);
    const desktop = await ready({ device: 'desktop' });
    expect(desktop.p.isTouchOnlyDevice()).toBe(false);
  });

  it('detects touch-only devices from media queries without the SDK', async () => {
    g.window = { navigator: { maxTouchPoints: 5 }, matchMedia: (q: string) => ({ matches: q !== '(any-pointer: fine)' }) };
    const p = new Platform();
    await p.init();
    expect(p.isTouchOnlyDevice()).toBe(true);
    g.window = { navigator: { maxTouchPoints: 5 }, matchMedia: () => ({ matches: true }) };
    const laptop = new Platform();
    await laptop.init();
    expect(laptop.isTouchOnlyDevice()).toBe(false);
  });
});

describe('Storage', () => {
  it('uses SDK.data in the crazygames environment', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    expect(p.storage.setJSON('pn_save_v1', { v: 1, list: [1, 2] })).toBe(true);
    expect(f.store.get('pn_save_v1')).toBe('{"v":1,"list":[1,2]}');
    expect(ls.getItem('pn_save_v1')).toBeNull();
    expect(p.storage.getJSON<{ v: number }>('pn_save_v1')?.v).toBe(1);
    p.storage.remove('pn_save_v1');
    expect(p.storage.getJSON('pn_save_v1')).toBeNull();
  });

  it('refuses entries above the size guard without touching the backend', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    const big = 'x'.repeat(MAX_ENTRY_BYTES + 1);
    expect(p.storage.setString('big', big)).toBe(false);
    expect(f.data.setItem).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    // multi-byte characters count as UTF-8 bytes: 310k x 'é' (2 bytes) = 620 KB passes, 'あ' (3 bytes) = 930 KB fails
    expect(p.storage.setString('fr', 'é'.repeat(310_000))).toBe(true);
    expect(p.storage.setString('jp', 'あ'.repeat(310_000))).toBe(false);
    expect(p.storage.setJSON('ok', { s: 'x'.repeat(1000) })).toBe(true);
  });

  it('handles dataLimitExcedeed without throwing', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    f.data.failWith = { code: 'dataLimitExcedeed', message: 'Data limit exceeded' };
    let ok = true;
    expect(() => { ok = p.storage.setJSON('pn_save_v1', { a: 1 }); }).not.toThrow();
    expect(ok).toBe(false);
    expect((p.storage as PlatformStorage).lastError).toMatch(/dataLimitExcedeed/);
    f.data.failWith = null;
    expect(p.storage.setJSON('pn_save_v1', { a: 2 })).toBe(true);
    expect((p.storage as PlatformStorage).lastError).toBeNull();
  });

  it('switches to localStorage when the data module is disabled', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    f.data.failWith = { code: 'dataModuleDisabled', message: 'Data module is disabled' };
    expect(p.storage.setString('k', 'v')).toBe(true);
    expect(ls.getItem('k')).toBe('v');
    expect((p.storage as PlatformStorage).backendKind).toBe('localStorage');
  });

  it('returns null for corrupt JSON and false for unserializable values', () => {
    const s = new PlatformStorage();
    ls.map.set('bad', '{not json');
    expect(s.getJSON('bad')).toBeNull();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(s.setJSON('cyclic', cyclic)).toBe(false);
    expect(s.setJSON('undef', undefined)).toBe(false);
    expect(s.getJSON('missing')).toBeNull();
  });

  it('survives localStorage quota errors and inaccessible localStorage', () => {
    const s = new PlatformStorage();
    ls.failWith = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    expect(s.setString('k', 'v')).toBe(false);
    ls.failWith = null;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    const mem = new PlatformStorage();
    expect(mem.backendKind).toBe('memory');
    expect(mem.setJSON('k', { a: 1 })).toBe(true);
    expect(mem.getJSON<{ a: number }>('k')?.a).toBe(1);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: ls });
  });

  it('utf8Length matches TextEncoder', () => {
    for (const s of ['', 'abc', 'é', 'あい', '😀x', '\ud800']) {
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
    }
  });
});

describe('Analytics', () => {
  it('once() tracks a name only the first time', () => {
    const a = new Analytics();
    a.once('first_sale', { v: 1 });
    a.once('first_sale', { v: 2 });
    a.track('sale');
    a.track('sale');
    const names = a.events().map((e) => e.name);
    expect(names).toEqual(['first_sale', 'sale', 'sale']);
    expect(a.events()[0].props).toEqual({ v: 1 });
    expect(a.hasTracked('first_sale')).toBe(true);
  });

  it('caps the ring buffer and keeps the newest events in order', () => {
    const a = new Analytics();
    for (let i = 0; i < ANALYTICS_BUFFER_SIZE + 123; i++) a.track('e', { i });
    const ev = a.events();
    expect(ev).toHaveLength(ANALYTICS_BUFFER_SIZE);
    expect(ev[0].props?.i).toBe(123);
    expect(ev[ev.length - 1].props?.i).toBe(ANALYTICS_BUFFER_SIZE + 122);
    expect(a.totalTracked).toBe(ANALYTICS_BUFFER_SIZE + 123);
  });

  it('uses session-relative timestamps and feeds sinks (a failing sink does not break others)', () => {
    vi.useFakeTimers();
    const a = new Analytics();
    const got: AnalyticsEvent[] = [];
    a.sinks.push(() => { throw new Error('remote down'); });
    a.sinks.push((e) => got.push(e));
    vi.advanceTimersByTime(2500);
    a.track('game_start');
    expect(got).toHaveLength(1);
    expect(got[0].t).toBeGreaterThanOrEqual(2.4);
    expect(got[0].t).toBeLessThan(3);
    expect(got[0].props).toBeUndefined();
  });

  it('exposes the buffer as window.__pnAnalytics', () => {
    const a = new Analytics();
    a.track('game_loaded', { hasSave: false });
    const h = (g.window as { __pnAnalytics?: AnalyticsDebugHandle }).__pnAnalytics!;
    expect(h.analytics).toBe(a);
    expect(h.events().map((e) => e.name)).toEqual(['game_loaded']);
    expect(JSON.parse(h.dump())[0].props.hasSave).toBe(false);
  });

  it('logs to the console only with ?debug=1', () => {
    const info = console.info as unknown as ReturnType<typeof vi.fn>;
    new Analytics().track('quiet');
    expect(info).not.toHaveBeenCalled();
    g.location = { search: '?debug=1' };
    new Analytics().track('loud');
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('trackSessionEnd emits session_duration once per page hide', () => {
    const a = new Analytics();
    a.track('x');
    a.trackSessionEnd();
    a.trackSessionEnd();
    const ends = a.events().filter((e) => e.name === 'session_duration');
    expect(ends).toHaveLength(1);
    expect(ends[0].props).toMatchObject({ events: 1 });
  });
});

// ---------------------------------------------------------------------------------------------
// CrazyGames completion percentage
// ---------------------------------------------------------------------------------------------

describe('Completion progress (reportGameCompletedPercentage)', () => {
  async function sdkPlatform() {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    const progress = () => f.calls.filter((c) => c.startsWith('progress:')).map((c) => Number(c.slice(9)));
    return { f, p, progress };
  }
  const findAll = (sim: Sim, n = Infinity) => {
    let k = 0;
    for (const nd of sim.hay.needles) { if (k++ >= n) break; sim.foundNeedle(nd.id, 'manual', nd.pos); }
  };
  const roundTrip = (sim: Sim) => Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));

  it('completionPercent maps found needles to an integer 0..100', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => completionPercent(n, 6))).toEqual([0, 17, 33, 50, 67, 83, 100]);
    expect(completionPercent(2, 6, true)).toBe(100);
    expect(completionPercent(9, 6)).toBe(100);
    expect(completionPercent(-1, 6)).toBe(0);
    expect(completionPercent(3, 0)).toBe(0);
    expect(completionPercent(Number.NaN, 6)).toBe(0);
    expect(completionPercent(3, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('new game reports 0, every needle updates it, completion reports 100, keep playing never goes lower', async () => {
    const { p, progress } = await sdkPlatform();
    const sim = new Sim(1234);
    expect(sim.hay.needles.length).toBe(NEEDLE_COUNT);
    const off = trackRunProgress(p, sim, NEEDLE_COUNT);
    expect(progress()).toEqual([0]);
    findAll(sim);
    expect(sim.completed).toBe(true);
    const steps = Array.from({ length: NEEDLE_COUNT }, (_, i) => completionPercent(i + 1, NEEDLE_COUNT));
    expect(progress()).toEqual([0, ...steps]);
    expect(progress().at(-1)).toBe(100);
    // Keep playing: the run goes on, nothing can pull the reported value down.
    for (let i = 0; i < 40; i++) sim.tick(0.05);
    p.reportProgress(50);
    p.reportProgress(completionPercent(sim.progress.needlesFound.length, NEEDLE_COUNT, sim.completed));
    const values = progress();
    expect(values.slice(values.indexOf(100))).toEqual([100]);
    expect(p.reportedProgress).toBe(100);
    off();
  });

  it('a loaded save reports its real progress on load (partial and completed runs)', async () => {
    const partial = new Sim(77);
    findAll(partial, 2);
    const a = await sdkPlatform();
    trackRunProgress(a.p, roundTrip(partial), NEEDLE_COUNT);
    expect(a.progress()).toEqual([completionPercent(2, NEEDLE_COUNT)]);

    const done = new Sim(78);
    findAll(done);
    const b = await sdkPlatform();
    const loaded = roundTrip(done);
    expect(loaded.completed).toBe(true);
    trackRunProgress(b.p, loaded, NEEDLE_COUNT);
    expect(b.progress()).toEqual([100]);
  });

  it('a New Run after completion reports 0 again', async () => {
    const { p, progress } = await sdkPlatform();
    const first = new Sim(5);
    const off = trackRunProgress(p, first, NEEDLE_COUNT);
    findAll(first);
    off();
    const second = new Sim(6);
    trackRunProgress(p, second, NEEDLE_COUNT);
    expect(progress().at(-1)).toBe(0);
    findAll(second, 1);
    expect(progress().at(-1)).toBe(completionPercent(1, NEEDLE_COUNT));
    // The finished run's events no longer report anything.
    first.events.emit('game:completed', { time: 1 });
    expect(progress().at(-1)).toBe(completionPercent(1, NEEDLE_COUNT));
  });

  it('progress tracking is a no-op without the SDK (and never throws)', async () => {
    const p = new Platform();
    await p.init();
    const sim = new Sim(3);
    expect(() => { trackRunProgress(p, sim, NEEDLE_COUNT); findAll(sim); }).not.toThrow();
    expect(p.reportedProgress).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------
// SDK failure isolation: the game keeps running, storage falls back, the console stays quiet
// ---------------------------------------------------------------------------------------------

describe('SDK failure isolation', () => {
  const notices = () => vi.mocked(console.info).mock.calls.length + vi.mocked(console.warn).mock.calls.length;

  /** Every Platform entry point the game uses, several times over (per-call spam would show up). */
  function exercise(p: Platform): void {
    for (let i = 0; i < 6; i++) {
      p.loadingStart(); p.loadingStop();
      p.gameplayStart(); p.gameplayStop();
      p.happytime();
      p.startRun(0); p.reportProgress(20 + i * 10);
      p.setContext({ minutes: i }); p.clearContext();
      p.isTouchOnlyDevice();
      p.onMuteChange(() => {})();
      p.storage.setJSON('pn_save_v1', { v: i });
      p.storage.getJSON('pn_save_v1');
      p.storage.setString('pn_settings', '{"quality":"low"}');
      p.storage.remove('pn_save_corrupt');
    }
    p.dispose();
  }

  function expectStandalone(p: Platform): void {
    expect(p.env).toBe('disabled');
    expect(p.sdkActive).toBe(false);
    expect(() => exercise(p)).not.toThrow();
    expect(ls.getItem('pn_save_v1')).toBe('{"v":5}');
    expect(ls.getItem('pn_settings')).toBe('{"quality":"low"}');
    expect((p.storage as PlatformStorage).backendKind).toBe('localStorage');
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(1);
  }

  it('SDK script blocked (window.CrazyGames undefined)', async () => {
    const p = new Platform();
    await expect(p.init()).resolves.toBeUndefined();
    expectStandalone(p);
  });

  it('window.CrazyGames access throws', async () => {
    g.window = Object.defineProperty({}, 'CrazyGames', { get() { throw new Error('blocked by extension'); } });
    const p = new Platform();
    await expect(p.init()).resolves.toBeUndefined();
    expectStandalone(p);
  });

  it('SDK present but init() rejects', async () => {
    const f = fakeSdk({ init: () => Promise.reject(new Error('network')) });
    withSdk(f);
    const p = new Platform();
    await expect(p.init()).resolves.toBeUndefined();
    expectStandalone(p);
    expect(f.calls).toEqual([]);
    expect(f.store.size).toBe(0);
  });

  it('SDK init() never settles (timeout)', async () => {
    vi.useFakeTimers();
    const f = fakeSdk({ init: () => new Promise<void>(() => {}) });
    withSdk(f);
    const p = new Platform();
    const done = p.init();
    await vi.advanceTimersByTimeAsync(SDK_INIT_TIMEOUT_MS);
    await expect(done).resolves.toBeUndefined();
    expect(p.initError).toMatch(/timed out/);
    expectStandalone(p);
    expect(f.calls).toEqual([]);
  });

  it("SDK environment 'disabled'", async () => {
    const f = fakeSdk({ env: 'disabled' });
    withSdk(f);
    const p = new Platform();
    await p.init();
    expectStandalone(p);
    expect(f.calls).toEqual([]);
    expect(f.data.setItem).not.toHaveBeenCalled();
  });

  it('every SDK method throwing at runtime: no exception, storage moves to localStorage, one notice at most', async () => {
    const boom = (): never => { throw new Error('sdk bug'); };
    const game = new Proxy({}, { get: (_t, key) => (key === 'settings' ? boom() : boom) });
    const data = { getItem: vi.fn(boom), setItem: vi.fn(boom), removeItem: vi.fn(boom), clear: boom };
    g.window = {
      CrazyGames: {
        SDK: {
          environment: 'crazygames', init: () => Promise.resolve(), game, data,
          user: Object.defineProperty({}, 'systemInfo', { get: boom }),
        },
      },
    };
    const p = new Platform();
    await p.init();
    expect(p.env).toBe('crazygames');
    expect(() => exercise(p)).not.toThrow();
    expect(data.setItem).toHaveBeenCalledTimes(1); // first failure moves the session to localStorage
    expect((p.storage as PlatformStorage).backendKind).toBe('localStorage');
    expect(ls.getItem('pn_save_v1')).toBe('{"v":5}');
    expect(p.storage.getJSON<{ v: number }>('pn_save_v1')?.v).toBe(5);
    expect(notices()).toBeLessThanOrEqual(1);
    expect(p.diagnostics.length).toBeGreaterThan(1); // the rest is recorded, not printed
  });

  it('individual SDK game methods throwing are isolated (gameplayStart, happytime, progress, context)', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    for (const k of ['gameplayStart', 'gameplayStop', 'happytime', 'reportGameCompletedPercentage', 'setGameContext', 'loadingStart'] as const) {
      (f.sdk.game as Record<string, unknown>)[k] = () => { throw new Error(`${k} broke`); };
    }
    expect(() => exercise(p)).not.toThrow();
    expect(notices()).toBe(1);
    // Storage was fine all along: still the Data module.
    expect((p.storage as PlatformStorage).backendKind).toBe('sdk');
    expect(f.store.get('pn_save_v1')).toBe('{"v":5}');
  });

  it('a throwing SDK data.getItem falls back to localStorage for reads', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    ls.map.set('pn_settings', '{"quality":"high"}');
    (f.data as { getItem: unknown }).getItem = () => { throw { code: 'other', message: 'storage not ready' }; };
    expect(p.storage.getJSON<{ quality: string }>('pn_settings')?.quality).toBe('high');
    expect((p.storage as PlatformStorage).backendKind).toBe('localStorage');
    expect(notices()).toBe(1);
  });

  it('dataLimitExcedeed stays on the Data module (reported, not split across backends)', async () => {
    const f = fakeSdk();
    withSdk(f);
    const p = new Platform();
    await p.init();
    f.data.failWith = { code: 'dataLimitExcedeed', message: 'too big' };
    for (let i = 0; i < 5; i++) expect(p.storage.setJSON('pn_save_v1', { i })).toBe(false);
    expect((p.storage as PlatformStorage).backendKind).toBe('sdk');
    expect(ls.getItem('pn_save_v1')).toBeNull();
    expect(notices()).toBe(1);
  });

  it('an SDK without a usable data module keeps localStorage', async () => {
    const f = fakeSdk();
    (f.sdk as { data: unknown }).data = { getItem: () => null };
    withSdk(f);
    const p = new Platform();
    await p.init();
    expect(p.sdkActive).toBe(true);
    expect((p.storage as PlatformStorage).backendKind).toBe('localStorage');
    expect(p.storage.setString('k', 'v')).toBe(true);
    expect(ls.getItem('k')).toBe('v');
    expect(notices()).toBe(1);
  });
});

describe('DiagnosticLog', () => {
  it('prints only the first notice, records the rest', () => {
    const log = new DiagnosticLog(false);
    log.info('a');
    log.warn('b', new Error('x'));
    log.warn('c');
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
    expect(log.entries).toEqual(['a', 'b (x)', 'c']);
    expect(log.printedCount).toBe(1);
  });

  it('prints everything in verbose (?debug=1) mode and caps its history', () => {
    const log = new DiagnosticLog(true);
    for (let i = 0; i < DIAGNOSTIC_HISTORY + 5; i++) log.warn(`w${i}`);
    expect(console.warn).toHaveBeenCalledTimes(DIAGNOSTIC_HISTORY + 5);
    expect(log.entries).toHaveLength(DIAGNOSTIC_HISTORY);
    expect(log.entries[0]).toBe('w5');
  });

  it('defaults to verbose with ?debug=1', () => {
    g.location = { search: '?debug=1' };
    const log = new DiagnosticLog();
    log.info('one');
    log.info('two');
    expect(console.info).toHaveBeenCalledTimes(2);
  });
});
