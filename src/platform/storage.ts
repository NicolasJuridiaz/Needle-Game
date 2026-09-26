import { DiagnosticLog } from './log';
import type { CrazyDataModule } from './sdk';

/**
 * Persistent key/value storage used by the game (run save `pn_save_v1`, settings `pn_settings`).
 * Backed by the CrazyGames Data module (environments `crazygames` / `local`) or by localStorage elsewhere.
 * Every operation is exception-safe: storage failures never crash the game, they return false / null.
 */
export interface Storage {
  getString(key: string): string | null;
  setString(key: string, value: string): boolean;
  getJSON<T>(key: string): T | null;
  setJSON(key: string, value: unknown): boolean;
  remove(key: string): void;
}

/** The synchronous localStorage-shaped surface shared by `window.localStorage` and `SDK.data`. */
export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StorageBackendKind = 'sdk' | 'localStorage' | 'memory';

/** CrazyGames allows 1 MB per game; keep a safety margin for the SDK's own bookkeeping. */
export const MAX_ENTRY_BYTES = 900 * 1024;

/** UTF-8 byte length without allocating (the data module limit is measured on the serialized payload). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const n = s.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { bytes += 4; i++; } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Fast guard: strings up to MAX/3 code units can never exceed MAX bytes. */
function exceedsLimit(s: string): boolean {
  if (s.length * 3 <= MAX_ENTRY_BYTES) return false;
  return utf8Length(s) > MAX_ENTRY_BYTES;
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === 'string') return e.code;
    if (typeof e.name === 'string') return e.name;
  }
  return 'other';
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** In-memory fallback when neither the SDK nor localStorage is usable (sandboxed iframes, privacy modes). */
class MemoryBackend implements KeyValueBackend {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

/** Resolves `globalThis.localStorage`; accessing it can itself throw (SecurityError) in some iframes. */
function resolveLocalStorage(): KeyValueBackend | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueBackend }).localStorage;
    if (!ls || typeof ls.getItem !== 'function') return null;
    const probe = '__pn_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Storage implementation with a switchable backend. Created before the SDK is initialised (localStorage),
 * then pointed at `SDK.data` by the Platform once the environment is known. If the Data module misbehaves
 * at runtime (disabled, throwing), the session falls back to localStorage (or memory) and keeps going.
 * Console output goes through a DiagnosticLog (shared with the Platform): at most one printed notice.
 */
export class PlatformStorage implements Storage {
  /** Last failure description (null after a successful write), for diagnostics / the pause menu. */
  lastError: string | null = null;
  private backend: KeyValueBackend;
  private kind: StorageBackendKind;

  constructor(private readonly log: DiagnosticLog = new DiagnosticLog()) {
    const ls = resolveLocalStorage();
    this.backend = ls ?? new MemoryBackend();
    this.kind = ls ? 'localStorage' : 'memory';
  }

  get backendKind(): StorageBackendKind { return this.kind; }

  /** Route all reads/writes through the CrazyGames Data module. Returns false (and keeps the current backend) if it is unusable. */
  useSdkData(data: CrazyDataModule): boolean {
    if (!data || typeof data.getItem !== 'function' || typeof data.setItem !== 'function' || typeof data.removeItem !== 'function') {
      this.log.warn(`[storage] CrazyGames data module unusable, using ${this.kind}`);
      return false;
    }
    this.backend = data;
    this.kind = 'sdk';
    return true;
  }

  getString(key: string): string | null {
    try {
      const v = this.backend.getItem(key);
      return typeof v === 'string' ? v : null;
    } catch (err) {
      if (this.handleBackendError(err, 'read', key)) return this.getString(key);
      return null;
    }
  }

  setString(key: string, value: string): boolean {
    if (exceedsLimit(value)) {
      this.lastError = `"${key}" is ${Math.round(utf8Length(value) / 1024)} KB (limit ${MAX_ENTRY_BYTES / 1024} KB)`;
      this.log.warn(`[storage] refused to write ${this.lastError}`);
      return false;
    }
    try {
      this.backend.setItem(key, value);
      this.lastError = null;
      return true;
    } catch (err) {
      if (this.handleBackendError(err, 'write', key)) return this.setString(key, value);
      return false;
    }
  }

  getJSON<T>(key: string): T | null {
    const raw = this.getString(key);
    if (raw === null || raw === '') return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.warn(`[storage] "${key}" holds invalid JSON, ignoring it`, err);
      return null;
    }
  }

  setJSON(key: string, value: unknown): boolean {
    let raw: string | undefined;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      this.lastError = `"${key}" could not be serialized: ${errorMessage(err)}`;
      this.log.warn(`[storage] ${this.lastError}`);
      return false;
    }
    if (raw === undefined) {
      this.lastError = `"${key}" is not serializable`;
      return false;
    }
    return this.setString(key, raw);
  }

  remove(key: string): void {
    try {
      this.backend.removeItem(key);
    } catch (err) {
      if (this.handleBackendError(err, 'remove', key)) this.remove(key);
    }
  }

  /**
   * Classifies a backend failure. Returns true when the backend was switched and the caller should retry:
   * any Data module failure other than its size limit (module disabled, SDK bug, `other`) moves this
   * session to localStorage / memory. A full store (SDK 1 MB limit, localStorage quota) is reported only.
   */
  private handleBackendError(err: unknown, op: string, key: string): boolean {
    const code = errorCode(err);
    this.lastError = `${op} "${key}" failed (${code}): ${errorMessage(err)}`;
    if (this.kind === 'sdk' && code !== 'dataLimitExcedeed') {
      const ls = resolveLocalStorage();
      this.backend = ls ?? new MemoryBackend();
      this.kind = ls ? 'localStorage' : 'memory';
      this.log.warn(`[storage] CrazyGames data module failed (${code}), using ${this.kind} for this session`);
      return true;
    }
    if (code === 'dataLimitExcedeed' || code === 'QuotaExceededError' || code === 'NS_ERROR_DOM_QUOTA_REACHED') {
      this.log.warn(`[storage] storage full: ${this.lastError}`);
    } else {
      this.log.warn(`[storage] ${this.lastError}`);
    }
    return false;
  }
}
