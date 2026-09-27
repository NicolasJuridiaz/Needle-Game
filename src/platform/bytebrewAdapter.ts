import type { WireParams } from './analyticsEvents';
import type { AnalyticsAdapter } from './analyticsService';

/**
 * ByteBrew remote analytics (bytebrew-web-sdk, https://docs.bytebrew.io/sdk/javascript).
 * THE ONLY FILE THAT IMPORTS BYTEBREW. The SDK is loaded lazily (its own chunk) and only when both keys are
 * configured, so builds without keys never download it.
 *
 * `initializeByteBrew` is fire-and-forget: it fetches a session key asynchronously. We wait for
 * `isByteBrewInitialized()` (polling, with a timeout) before sending, so no event is sent into an
 * uninitialised SDK; AnalyticsService queues events meanwhile.
 */

/** The subset of the SDK we use (bytebrew-web-sdk 1.0.x `ByteBrew` static class). */
export interface ByteBrewApi {
  initializeByteBrew(appID: string, appKey: string, appVersion: string): void;
  isByteBrewInitialized(): boolean;
  newCustomEvent(eventName: string, value?: object): void;
  stopTracking(): void;
  restartTracking(): void;
}

export interface ByteBrewConfig {
  appId: string;
  sdkKey: string;
  appVersion: string;
}

export type ByteBrewLoader = () => Promise<ByteBrewApi>;

/** Give up on ByteBrew after this long without a session (blocked request, bad keys, offline). */
export const BYTEBREW_INIT_TIMEOUT_MS = 10_000;
const POLL_MS = 250;

const defaultLoader: ByteBrewLoader = async () => (await import('bytebrew-web-sdk')).ByteBrew as unknown as ByteBrewApi;

export class ByteBrewAnalyticsAdapter implements AnalyticsAdapter {
  readonly id = 'bytebrew' as const;
  private api: ByteBrewApi | null = null;
  private ready = false;
  private error: string | null = null;
  private stopped = false;

  constructor(
    private readonly cfg: ByteBrewConfig,
    private readonly loader: ByteBrewLoader = defaultLoader,
    private readonly timeoutMs = BYTEBREW_INIT_TIMEOUT_MS,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async init(): Promise<boolean> {
    try {
      this.api = await this.loader();
      this.api.initializeByteBrew(this.cfg.appId, this.cfg.sdkKey, this.cfg.appVersion);
      for (let waited = 0; waited <= this.timeoutMs; waited += POLL_MS) {
        if (this.api.isByteBrewInitialized()) { this.ready = true; return true; }
        await this.sleep(POLL_MS);
      }
      this.error = `no session after ${this.timeoutMs} ms`;
      return false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  send(name: string, params: WireParams): void {
    if (!this.ready || !this.api || this.stopped) return;
    if (Object.keys(params).length) this.api.newCustomEvent(name, params);
    else this.api.newCustomEvent(name);
  }

  setEnabled(enabled: boolean): void {
    if (!this.api) { this.stopped = !enabled; return; }
    if (!enabled && !this.stopped) { this.stopped = true; this.api.stopTracking(); }
    else if (enabled && this.stopped) { this.stopped = false; this.api.restartTracking(); }
  }

  status(): string {
    if (this.error) return `bytebrew failed: ${this.error}`;
    if (!this.api) return 'bytebrew loading';
    let init = false;
    try { init = this.api.isByteBrewInitialized(); } catch { init = false; }
    return `bytebrew ${this.ready ? 'ready' : 'waiting for session'}${init ? '' : ' (sdk not initialised)'}${this.stopped ? ' (tracking stopped)' : ''}`;
  }
}
