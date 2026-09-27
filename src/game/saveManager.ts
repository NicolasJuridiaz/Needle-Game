import { Sim } from '../sim/sim';
import type { RunTelemetryState } from './telemetry';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings';

/** Minimal storage surface (implemented by src/platform/storage.ts: CrazyGames data module or localStorage). */
export interface KeyValueStorage {
  getJSON<T>(key: string): T | null;
  setJSON(key: string, value: unknown): boolean;
  remove(key: string): void;
}

export const SAVE_KEY = 'pn_save_v1';
export const SETTINGS_KEY = 'pn_settings';
const CORRUPT_KEY = 'pn_save_corrupt';

/**
 * Envelope (game layer) version, independent of the sim SAVE_VERSION (src/sim/save.ts):
 * 1 = RC1/RC2 (no `v` field): { sim, meta: { hintsDone, continuedAfterCompletion } }
 * 2 = P0 analytics: + meta.telemetry (run id/index, analytics dedupe). Additive: v1 envelopes load unchanged
 *     and get their telemetry backfilled from the run state (GameTelemetry.attachRun).
 */
export const ENVELOPE_VERSION = 2;

/** Extra game-layer state stored alongside the sim save. */
export interface GameMeta {
  hintsDone: string[];
  continuedAfterCompletion: boolean;
  /** Analytics dedupe for this run (absent in v1 envelopes). */
  telemetry?: RunTelemetryState;
}

interface SaveEnvelope { v?: number; sim: unknown; meta: GameMeta }

/**
 * Versioned run persistence: save -> close -> reload -> continue.
 * The sim save carries its own version + migrations (src/sim/save.ts).
 */
export class SaveManager {
  lastSavedAt = 0;
  lastError: string | null = null;
  /** Sim save version of the last loaded save as stored (before migration), null if none was loaded. */
  loadedSaveVersion: number | null = null;
  /** Envelope version of the last loaded save as stored. */
  loadedEnvelopeVersion: number | null = null;

  constructor(private readonly storage: KeyValueStorage) {}

  hasSave(): boolean { return this.storage.getJSON<SaveEnvelope>(SAVE_KEY) !== null; }

  save(sim: Sim, meta: GameMeta): boolean {
    try {
      const env: SaveEnvelope = { v: ENVELOPE_VERSION, sim: sim.serialize(), meta };
      const ok = this.storage.setJSON(SAVE_KEY, env);
      if (ok) { this.lastSavedAt = Date.now(); this.lastError = null; }
      else this.lastError = 'Storage refused the save';
      return ok;
    } catch (err) {
      this.lastError = String(err);
      console.error('[save] failed', err);
      return false;
    }
  }

  /** Returns the restored sim + meta, or null (no save / unreadable save -> backed up, fresh start). */
  load(): { sim: Sim; meta: GameMeta } | null {
    const env = this.storage.getJSON<SaveEnvelope>(SAVE_KEY);
    if (!env) return null;
    try {
      const stored = (env.sim as { version?: unknown })?.version;
      const sim = Sim.fromSave(env.sim);
      const meta: GameMeta = { hintsDone: env.meta?.hintsDone ?? [], continuedAfterCompletion: !!env.meta?.continuedAfterCompletion };
      const tel = env.meta?.telemetry;
      if (tel && typeof tel === 'object' && tel.v === 1 && typeof tel.runId === 'string') meta.telemetry = tel;
      this.loadedSaveVersion = typeof stored === 'number' ? stored : null;
      this.loadedEnvelopeVersion = typeof env.v === 'number' ? env.v : 1;
      this.lastSavedAt = (env.sim as { savedAt?: number })?.savedAt ?? Date.now();
      return { sim, meta };
    } catch (err) {
      console.error('[save] could not load save, starting fresh (backup kept)', err);
      try { this.storage.setJSON(CORRUPT_KEY, env); } catch { /* ignore */ }
      this.storage.remove(SAVE_KEY);
      this.lastError = 'Save could not be loaded';
      return null;
    }
  }

  clear(): void { this.storage.remove(SAVE_KEY); }

  loadSettings(): Settings { return sanitizeSettings(this.storage.getJSON<Partial<Settings>>(SETTINGS_KEY) ?? DEFAULT_SETTINGS); }
  saveSettings(s: Settings): void { this.storage.setJSON(SETTINGS_KEY, s); }
}
