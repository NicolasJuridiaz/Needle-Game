/** One analytics event. `t` = seconds since the session started (Analytics construction). */
export interface AnalyticsEvent {
  name: string;
  t: number;
  props?: Record<string, unknown>;
}

export type AnalyticsSink = (e: AnalyticsEvent) => void;

/** QA handle published as `window.__pnAnalytics`. */
export interface AnalyticsDebugHandle {
  /** Buffered events, oldest first. */
  events(): AnalyticsEvent[];
  /** Buffered events as a JSON string (copy/paste export for QA). */
  dump(): string;
  readonly analytics: Analytics;
}

export const ANALYTICS_BUFFER_SIZE = 500;
/** pagehide can be followed by beforeunload / a bfcache restore; ignore duplicate session ends. */
const SESSION_END_DEDUPE_S = 1;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function debugEnabled(): boolean {
  try {
    const search = typeof location === 'undefined' ? '' : location.search;
    return new URLSearchParams(search).get('debug') === '1';
  } catch {
    return false;
  }
}

/**
 * Lightweight analytics: session-relative timestamps, an in-memory ring buffer (QA export via
 * `window.__pnAnalytics`), pluggable sinks (remote backends), console output with `?debug=1`.
 * Tracking never throws.
 */
export class Analytics {
  /** Every event is forwarded to each sink (exceptions are caught per sink). */
  readonly sinks: AnalyticsSink[] = [];
  readonly sessionStart = nowMs();

  private readonly ring: (AnalyticsEvent | undefined)[] = new Array(ANALYTICS_BUFFER_SIZE);
  private head = 0;
  private count = 0;
  private total = 0;
  private readonly seen = new Set<string>();
  private lastSessionEnd = -Infinity;

  constructor() {
    if (debugEnabled()) {
      this.sinks.push((e) => console.info(`%c[analytics] %c${e.name}`, 'color:#b9975b', 'color:#f2c14e;font-weight:600', `t=${e.t}s`, e.props ?? ''));
    }
    if (typeof window !== 'undefined') {
      const handle: AnalyticsDebugHandle = {
        events: () => this.events(),
        dump: () => JSON.stringify(this.events()),
        analytics: this,
      };
      (window as unknown as { __pnAnalytics?: AnalyticsDebugHandle }).__pnAnalytics = handle;
    }
  }

  /** Seconds since the session started (millisecond precision). */
  sessionTime(): number {
    return Math.round(nowMs() - this.sessionStart) / 1000;
  }

  track(name: string, props?: Record<string, unknown>): void {
    const e: AnalyticsEvent = props === undefined ? { name, t: this.sessionTime() } : { name, t: this.sessionTime(), props };
    this.ring[this.head] = e;
    this.head = (this.head + 1) % ANALYTICS_BUFFER_SIZE;
    if (this.count < ANALYTICS_BUFFER_SIZE) this.count++;
    this.total++;
    for (let i = 0; i < this.sinks.length; i++) {
      try { this.sinks[i](e); } catch (err) { console.warn('[analytics] sink failed', err); }
    }
  }

  /** Tracks `name` only the first time it is seen this session (funnel "first_*" events). */
  once(name: string, props?: Record<string, unknown>): void {
    if (this.seen.has(name)) return;
    this.seen.add(name);
    this.track(name, props);
  }

  hasTracked(name: string): boolean { return this.seen.has(name); }

  /** `session_duration` (call on pagehide). Duplicate calls within a second are ignored. */
  trackSessionEnd(): void {
    const t = this.sessionTime();
    if (t - this.lastSessionEnd < SESSION_END_DEDUPE_S) return;
    this.lastSessionEnd = t;
    this.track('session_duration', { seconds: Math.round(t), events: this.total });
  }

  /** Buffered events, oldest first (at most ANALYTICS_BUFFER_SIZE). */
  events(): AnalyticsEvent[] {
    const out: AnalyticsEvent[] = [];
    const start = (this.head - this.count + ANALYTICS_BUFFER_SIZE) % ANALYTICS_BUFFER_SIZE;
    for (let i = 0; i < this.count; i++) {
      const e = this.ring[(start + i) % ANALYTICS_BUFFER_SIZE];
      if (e) out.push(e);
    }
    return out;
  }

  /** Total events tracked this session (including those evicted from the buffer). */
  get totalTracked(): number { return this.total; }
}
