import type { AnalyticsService } from '../platform/analyticsService';
import { freshProfile, loadProfile, PROFILE_KEY, saveProfile, type PlayerProfile } from './profile';
import type { RunTelemetryState } from './telemetry';
import type { KeyValueStorage } from './saveManager';
import type { GameTelemetry } from './telemetry';

/**
 * Analytics consent (P0.1): OPT-IN. Remote analytics (ByteBrew) starts only after an explicit, positive action of the
 * player ("Allow analytics" on the title-screen card, or switching the Settings toggle on).
 *
 *   unknown  (no stored choice)  -> ByteBrew never loaded/initialised, no request, no ByteBrew cookie, no analytics
 *                                   profile or run id persisted. The game is 100 % playable.
 *   granted                     -> ByteBrew loads and starts from that moment. Nothing from before is replayed.
 *   denied                      -> like unknown, and the card is not shown again. Settings can switch it back on.
 *
 * Stored under its own key (CONSENT_KEY) in the game's storage, separate from the run save. Only the word
 * 'granted' / 'denied' is stored: no id, no timestamp.
 */
export type ConsentState = 'unknown' | 'granted' | 'denied';
export type ConsentSource = 'prompt' | 'settings';

export const CONSENT_KEY = 'pn_analytics_consent_v1';

export function loadConsent(storage: KeyValueStorage): ConsentState {
  let v: unknown = null;
  try { v = storage.getJSON<unknown>(CONSENT_KEY); } catch { v = null; }
  return v === 'granted' || v === 'denied' ? v : 'unknown';
}

/** Analytics counters for this page: the stored profile only with consent, otherwise a fresh in-memory one. */
export function initialProfile(storage: KeyValueStorage, now: number): PlayerProfile {
  return loadConsent(storage) === 'granted' ? loadProfile(storage, now) : freshProfile(now);
}

export interface ConsentView {
  state: ConsentState;
  /** Remote analytics can run in this build/page (keys + privacy policy URL + no ?analytics=0). */
  available: boolean;
  /** Settings toggle position: on ONLY when granted and available. */
  on: boolean;
  /** Show the title-screen card (available and no choice made yet). */
  prompt: boolean;
}

export interface ConsentDeps {
  storage: KeyValueStorage;
  analytics: AnalyticsService;
  telemetry: GameTelemetry;
  /** In-memory analytics counters; persisted (PROFILE_KEY) only while consent is granted. */
  profile: PlayerProfile;
  /** Called after a withdrawal so the game drops analytics data from its save (GameMeta.telemetry). */
  onWithdrawn?: () => void;
}

export class AnalyticsConsentController {
  private current: ConsentState;

  constructor(private readonly d: ConsentDeps) {
    this.current = loadConsent(d.storage);
    // Analytics-only counters must not exist without consent (e.g. left by an older build): remove them.
    if (this.current !== 'granted') this.removeProfile();
  }

  get state(): ConsentState { return this.current; }
  get available(): boolean { return this.d.analytics.hasRemote(); }

  /** Remote tracking is on right now (and analytics data may be persisted with the save). */
  get tracking(): boolean { return this.current === 'granted' && this.available; }

  view(): ConsentView {
    const available = this.available;
    return { state: this.current, available, on: this.current === 'granted' && available, prompt: available && this.current === 'unknown' };
  }

  /** What to store in GameMeta.telemetry: the analytics run state only while tracking, else nothing. */
  telemetryForSave(): RunTelemetryState | undefined {
    return this.tracking ? this.d.telemetry.state() : undefined;
  }

  /** Persist the analytics counters (pn_profile) only while tracking. */
  persistProfile(): void {
    if (this.tracking) saveProfile(this.d.storage, this.d.profile);
  }

  /** Boot: start ByteBrew only for a player who already granted consent in a previous session. */
  start(): void {
    if (this.tracking) this.d.analytics.setEnabled(true);
  }

  /** Explicit positive action. Returns false when remote analytics is not available in this build. */
  grant(source: ConsentSource): boolean {
    if (!this.available) return false;
    if (this.current === 'granted') return true;
    this.current = 'granted';
    this.store('granted');
    saveProfile(this.d.storage, this.d.profile);
    this.d.analytics.setEnabled(true); // loads + initialises ByteBrew now (once per page; later: restartTracking)
    this.d.telemetry.onConsentGranted(source);
    return true;
  }

  /** "Continue without analytics" or Settings off. Stops tracking, forgets our analytics counters. */
  deny(): void {
    const was = this.current;
    this.current = 'denied';
    this.store('denied');
    this.d.analytics.setEnabled(false); // ByteBrew stopTracking() if it was running
    this.removeProfile();
    if (was === 'granted') this.d.onWithdrawn?.();
  }

  private store(s: 'granted' | 'denied'): void {
    try { this.d.storage.setJSON(CONSENT_KEY, s); } catch { /* the choice still applies to this session */ }
  }

  private removeProfile(): void {
    try { if (this.d.storage.getJSON(PROFILE_KEY) !== null) this.d.storage.remove(PROFILE_KEY); } catch { /* ignore */ }
  }
}
