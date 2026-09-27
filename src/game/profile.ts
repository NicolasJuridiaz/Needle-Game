import type { KeyValueStorage } from './saveManager';

/**
 * Player-level counters that outlive a run (New Run keeps them). Stored under its own key in the same storage
 * as the save (CrazyGames Data module / localStorage). No identifiers: counts and timestamps only.
 */
export interface PlayerProfile {
  v: 1;
  /** Page sessions started (this one included once `beginSession` ran). */
  sessions: number;
  /** Runs started on this device/account (the current run's `run_index`). */
  runsStarted: number;
  /** Epoch ms of the first session, of the last time the game was seen alive (autosave / tab hide). */
  firstSeenAt: number;
  lastSeenAt: number;
}

export const PROFILE_KEY = 'pn_profile';

export function freshProfile(now: number): PlayerProfile {
  return { v: 1, sessions: 0, runsStarted: 0, firstSeenAt: now, lastSeenAt: 0 };
}

/** Reads the profile; anything missing or malformed falls back to a fresh one (never throws). */
export function loadProfile(storage: KeyValueStorage, now: number): PlayerProfile {
  let raw: Partial<PlayerProfile> | null = null;
  try { raw = storage.getJSON<Partial<PlayerProfile>>(PROFILE_KEY); } catch { raw = null; }
  const p = freshProfile(now);
  if (!raw || typeof raw !== 'object') return p;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  p.sessions = n(raw.sessions, 0);
  p.runsStarted = n(raw.runsStarted, 0);
  p.firstSeenAt = n(raw.firstSeenAt, now) || now;
  p.lastSeenAt = n(raw.lastSeenAt, 0);
  return p;
}

export function saveProfile(storage: KeyValueStorage, p: PlayerProfile): void {
  try { storage.setJSON(PROFILE_KEY, p); } catch { /* telemetry state never breaks the game */ }
}
