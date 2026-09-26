import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, SDK_INIT_TIMEOUT_MS } from '../src/platform/crazygames';
import { MAX_ENTRY_BYTES, PlatformStorage, utf8Length } from '../src/platform/storage';
import { Analytics, ANALYTICS_BUFFER_SIZE, type AnalyticsDebugHandle, type AnalyticsEvent } from '../src/platform/analytics';
import type { CrazyGameSettings } from '../src/platform/sdk';

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

  it('reportProgress clamps, rounds and forwards only changes', async () => {
    const { f, p } = await ready();
    p.reportProgress(33.4);
    p.reportProgress(33);
    p.reportProgress(150);
    p.reportProgress(Number.NaN);
    p.reportProgress(-5);
    expect(f.calls).toEqual(['progress:33', 'progress:100', 'progress:0']);
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
