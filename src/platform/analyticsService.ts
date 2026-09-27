import { Analytics } from './analytics';
import {
  isRemoteEvent, isValidName, toWireParams, type AnalyticsEventName, type AnalyticsParams, type WireParams,
} from './analyticsEvents';

/**
 * A remote analytics destination. Implementations: ByteBrewAnalyticsAdapter (src/platform/bytebrewAdapter.ts),
 * NoopAnalyticsAdapter. The game never talks to an adapter directly: only AnalyticsService does.
 */
export interface AnalyticsAdapter {
  readonly id: 'bytebrew' | 'noop';
  /** Resolves true when the adapter can send. Must never throw or hang (adapters time out themselves). */
  init(): Promise<boolean>;
  send(name: string, params: WireParams): void;
  /** Tracking opt-out / opt-in (ByteBrew stopTracking / restartTracking). */
  setEnabled(enabled: boolean): void;
  /** Adapter-level diagnostics for the QA handle. */
  status(): string;
}

export class NoopAnalyticsAdapter implements AnalyticsAdapter {
  readonly id = 'noop' as const;
  constructor(private readonly reason = 'not configured') {}
  init(): Promise<boolean> { return Promise.resolve(false); }
  send(): void { /* nothing */ }
  setEnabled(): void { /* nothing */ }
  status(): string { return `noop (${this.reason})`; }
}

/** Most remote events per page session (a runaway loop can never flood the provider). */
export const MAX_REMOTE_EVENTS_PER_SESSION = 1500;
/** Events kept while the remote adapter is still initialising. */
export const MAX_PENDING_EVENTS = 200;

export interface AnalyticsServiceOptions {
  /** Remote destination; NoopAnalyticsAdapter when ByteBrew is not configured. */
  remote?: AnalyticsAdapter;
  /** Local in-memory buffer (always on: QA, tests, `window.__pnAnalytics`). */
  local?: Analytics;
  /** Initial opt-in state (settings / URL / env). */
  enabled?: boolean;
}

export interface AnalyticsDiagnostics {
  adapter: string;
  adapterStatus: string;
  state: 'idle' | 'initialising' | 'ready' | 'unavailable';
  enabled: boolean;
  sent: number;
  pending: number;
  dropped: number;
  lastSent: { name: string; params: WireParams }[];
}

/**
 * The only analytics entry point of the game.
 * - Every event goes to the local buffer (Analytics) and, when enabled, remote events go to the adapter.
 * - Common context (version, platform, run, money ...) is merged into every remote event by `setContext`.
 * - Never throws into gameplay, never blocks: before the adapter is ready events wait in a small queue,
 *   an adapter that fails to initialise turns the service local-only.
 */
export class AnalyticsService {
  readonly local: Analytics;
  private readonly remote: AnalyticsAdapter;
  private enabled: boolean;
  private state: AnalyticsDiagnostics['state'] = 'idle';
  private initPromise: Promise<void> | null = null;
  private context: () => AnalyticsParams = () => ({});
  private readonly pending: { name: string; params: WireParams }[] = [];
  private sent = 0;
  private dropped = 0;
  private readonly lastSent: { name: string; params: WireParams }[] = [];

  constructor(opts: AnalyticsServiceOptions = {}) {
    this.local = opts.local ?? new Analytics();
    this.remote = opts.remote ?? new NoopAnalyticsAdapter();
    this.enabled = opts.enabled ?? true;
  }

  /** Initialise the remote adapter. Never throws; resolves when the adapter is ready or has given up. */
  init(): Promise<void> {
    if (!this.enabled) return Promise.resolve(); // started later by setEnabled(true)
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.state = 'initialising';
    let ok = false;
    try { ok = await this.remote.init(); } catch { ok = false; }
    this.state = ok ? 'ready' : 'unavailable';
    if (ok) this.flush();
    else { this.dropped += this.pending.length; this.pending.length = 0; }
  }

  /** Common parameters merged into every remote event (evaluated at send time). */
  setContext(provider: () => AnalyticsParams): void { this.context = provider; }

  isEnabled(): boolean { return this.enabled; }

  /** A real remote destination is configured (data can leave the browser when enabled). */
  hasRemote(): boolean { return this.remote.id !== 'noop'; }

  /** Opt-out / opt-in. Disabled: nothing reaches the adapter (the local buffer keeps working). */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    try { this.remote.setEnabled(enabled); } catch { /* adapter trouble never reaches the game */ }
    if (!enabled) { this.dropped += this.pending.length; this.pending.length = 0; return; }
    if (this.state === 'idle') void this.init();
  }

  track(name: AnalyticsEventName, params?: AnalyticsParams): void {
    try {
      this.local.track(name, params);
      if (!this.enabled || !isRemoteEvent(name) || !isValidName(name)) return;
      if (this.state === 'unavailable') return;
      let ctx: AnalyticsParams = {};
      try { ctx = this.context(); } catch { ctx = {}; }
      const wire = toWireParams({ ...ctx, ...params });
      if (this.state !== 'ready') {
        if (this.pending.length < MAX_PENDING_EVENTS) this.pending.push({ name, params: wire });
        else this.dropped++;
        return;
      }
      this.send(name, wire);
    } catch (err) {
      // Analytics must never break the game.
      this.dropped++;
      if (import.meta.env?.DEV) console.warn('[analytics] track failed', err);
    }
  }

  private flush(): void {
    const q = this.pending.splice(0);
    for (const e of q) this.send(e.name, e.params);
  }

  private send(name: string, params: WireParams): void {
    if (this.sent >= MAX_REMOTE_EVENTS_PER_SESSION) { this.dropped++; return; }
    try {
      this.remote.send(name, params);
      this.sent++;
      this.lastSent.push({ name, params });
      if (this.lastSent.length > 20) this.lastSent.shift();
    } catch {
      this.dropped++;
    }
  }

  diagnostics(): AnalyticsDiagnostics {
    let adapterStatus = '';
    try { adapterStatus = this.remote.status(); } catch { adapterStatus = 'status failed'; }
    return {
      adapter: this.remote.id, adapterStatus, state: this.state, enabled: this.enabled,
      sent: this.sent, pending: this.pending.length, dropped: this.dropped, lastSent: this.lastSent.slice(),
    };
  }
}
