import type { CrazyGameSettings, CrazyGamesSDK, CrazySettingsListener } from './sdk';
import { PlatformStorage, type Storage } from './storage';

/** A missing / blocked / failed / slow SDK reports 'disabled' (no-op adapter); see `initError` for why. */
export type PlatformEnv = 'crazygames' | 'local' | 'disabled';

/** SDK init must never hold the game hostage (blocked script, flaky network). */
export const SDK_INIT_TIMEOUT_MS = 5000;
/** `happytime` is meant for rare celebratory moments; ignore bursts (e.g. 6th needle + run complete). */
const HAPPYTIME_MIN_INTERVAL_MS = 5000;

function win(): Window | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/**
 * CrazyGames HTML5 SDK v3 wrapper. Uses only documented APIs, every call is guarded, and when the SDK is
 * unavailable (not loaded, blocked, init failure/timeout, 'disabled' environment) all calls become no-ops
 * and storage uses localStorage.
 */
export class Platform {
  readonly storage: Storage;
  /** Why the SDK is not active (null when it is), for diagnostics. */
  initError: string | null = null;

  private readonly store = new PlatformStorage();
  private sdk: CrazyGamesSDK | null = null;
  private environment: PlatformEnv = 'disabled';
  private initPromise: Promise<void> | null = null;
  private inGameplay = false;
  private inLoading = false;
  private muted = false;
  private lastProgress = -1;
  private lastHappytime = -Infinity;
  private touchOnly: boolean | null = null;
  private readonly muteListeners: ((muted: boolean) => void)[] = [];
  private readonly settingsListener: CrazySettingsListener = (s) => this.applySettings(s);

  constructor() {
    this.storage = this.store;
  }

  get env(): PlatformEnv { return this.environment; }
  get isMuted(): boolean { return this.muted; }
  /** True when the real SDK is active (environment 'crazygames' or 'local'). */
  get sdkActive(): boolean { return this.sdk !== null; }

  /** Initialise the SDK. Never throws, resolves within SDK_INIT_TIMEOUT_MS. Safe to call repeatedly. */
  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const sdk = win()?.CrazyGames?.SDK;
    if (!sdk || typeof sdk.init !== 'function') {
      this.fallback('SDK script not loaded');
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), SDK_INIT_TIMEOUT_MS); });
      const result = await Promise.race([Promise.resolve().then(() => sdk.init()).then(() => 'ok' as const), timeout]);
      if (result === 'timeout') {
        this.fallback(`SDK init timed out after ${SDK_INIT_TIMEOUT_MS} ms`);
        return;
      }
    } catch (err) {
      this.fallback(`SDK init failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    let env: unknown;
    try { env = sdk.environment; } catch { env = 'disabled'; }
    if (env !== 'crazygames' && env !== 'local') {
      this.fallback(`SDK environment is '${String(env)}'`);
      return;
    }
    this.sdk = sdk;
    this.environment = env;
    this.initError = null;
    try {
      const settings = sdk.game?.settings;
      if (settings) this.muted = !!settings.muteAudio;
      sdk.game?.addSettingsChangeListener?.(this.settingsListener);
    } catch (err) {
      console.warn('[platform] could not read SDK settings', err);
    }
    try {
      if (sdk.data && typeof sdk.data.getItem === 'function') this.store.useSdkData(sdk.data);
    } catch (err) {
      console.warn('[platform] SDK data module unavailable, using localStorage', err);
    }
  }

  private fallback(reason: string): void {
    this.sdk = null;
    this.environment = 'disabled';
    this.initError = reason;
    console.info(`[platform] CrazyGames SDK inactive (${reason}); running standalone`);
  }

  private applySettings(s: CrazyGameSettings | undefined): void {
    const m = !!s?.muteAudio;
    if (m === this.muted) return;
    this.muted = m;
    for (const cb of this.muteListeners) {
      try { cb(m); } catch (err) { console.error('[platform] mute listener failed', err); }
    }
  }

  /** Runs an SDK call; failures are logged, never thrown. */
  private call(name: string, fn: (sdk: CrazyGamesSDK) => void): void {
    const sdk = this.sdk;
    if (!sdk) return;
    try { fn(sdk); } catch (err) { console.warn(`[platform] SDK ${name} failed`, err); }
  }

  loadingStart(): void {
    if (this.inLoading) return;
    this.inLoading = true;
    this.call('loadingStart', (s) => s.game.loadingStart());
  }

  loadingStop(): void {
    if (!this.inLoading) return;
    this.inLoading = false;
    this.call('loadingStop', (s) => s.game.loadingStop());
  }

  /** Idempotent: the SDK sees exactly one start per stop. */
  gameplayStart(): void {
    if (this.inGameplay) return;
    this.inGameplay = true;
    this.call('gameplayStart', (s) => s.game.gameplayStart());
  }

  gameplayStop(): void {
    if (!this.inGameplay) return;
    this.inGameplay = false;
    this.call('gameplayStop', (s) => s.game.gameplayStop());
  }

  get isInGameplay(): boolean { return this.inGameplay; }

  happytime(): void {
    const t = nowMs();
    if (t - this.lastHappytime < HAPPYTIME_MIN_INTERVAL_MS) return;
    this.lastHappytime = t;
    this.call('happytime', (s) => s.game.happytime());
  }

  /** Completion percentage 0..100 (needles × 100 / 6). Only changes are forwarded. */
  reportProgress(pct: number): void {
    if (!Number.isFinite(pct)) return;
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    if (p === this.lastProgress) return;
    this.lastProgress = p;
    this.call('reportGameCompletedPercentage', (s) => {
      if (typeof s.game.reportGameCompletedPercentage === 'function') s.game.reportGameCompletedPercentage(p);
    });
  }

  /** Subscribe to CrazyGames `muteAudio` changes. Returns an unsubscribe function. */
  onMuteChange(cb: (muted: boolean) => void): () => void {
    this.muteListeners.push(cb);
    return () => {
      const i = this.muteListeners.indexOf(cb);
      if (i >= 0) this.muteListeners.splice(i, 1);
    };
  }

  setContext(obj: Record<string, unknown>): void {
    this.call('setGameContext', (s) => {
      if (typeof s.game.setGameContext === 'function') s.game.setGameContext(obj);
    });
  }

  clearContext(): void {
    this.call('clearGameContext', (s) => {
      if (typeof s.game.clearGameContext === 'function') s.game.clearGameContext();
    });
  }

  /**
   * Phones / tablets without a fine pointer (mouse, trackpad). The game is desktop-first (mouse look +
   * pointer lock), so touch-only devices get a notice. Uses the SDK device type when available.
   */
  isTouchOnlyDevice(): boolean {
    if (this.touchOnly !== null) return this.touchOnly;
    const w = win();
    if (!w) return false;
    const media = (q: string): boolean => {
      try { return typeof w.matchMedia === 'function' && w.matchMedia(q).matches; } catch { return false; }
    };
    const hasFinePointer = media('(any-pointer: fine)');
    let deviceType: string | undefined;
    try { deviceType = this.sdk?.user?.systemInfo?.device?.type; } catch { deviceType = undefined; }
    let result: boolean;
    if (deviceType === 'desktop') result = false;
    else if (deviceType === 'mobile' || deviceType === 'tablet') result = !hasFinePointer;
    else {
      const touch = (w.navigator?.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in w;
      result = touch && !hasFinePointer;
    }
    this.touchOnly = result;
    return result;
  }

  /** Detach the settings listener (tests / hot reload). */
  dispose(): void {
    this.call('removeSettingsChangeListener', (s) => s.game.removeSettingsChangeListener?.(this.settingsListener));
    this.muteListeners.length = 0;
  }
}
