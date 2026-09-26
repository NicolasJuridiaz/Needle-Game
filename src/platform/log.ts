/** Most recent platform notices kept for diagnostics (`Platform.diagnostics`). */
export const DIAGNOSTIC_HISTORY = 40;

function verboseByDefault(): boolean {
  try {
    const search = typeof location === 'undefined' ? '' : location.search;
    return new URLSearchParams(search).get('debug') === '1';
  } catch {
    return false;
  }
}

function describe(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown };
    const code = typeof e.code === 'string' ? `${e.code}: ` : '';
    if (typeof e.message === 'string') return code + e.message;
  }
  return String(err);
}

/**
 * Console output of the platform layer (SDK wrapper + storage). A blocked, failing or misbehaving SDK must
 * never spam the console: only the FIRST notice of a page is printed (console.info / console.warn), later
 * ones are only recorded in `entries`. With `?debug=1` every notice is printed.
 */
export class DiagnosticLog {
  /** Recorded notices, oldest first (at most DIAGNOSTIC_HISTORY). */
  readonly entries: string[] = [];
  private printed = false;

  constructor(private readonly verbose = verboseByDefault()) {}

  info(message: string, err?: unknown): void { this.emit('info', message, err); }
  warn(message: string, err?: unknown): void { this.emit('warn', message, err); }

  /** Number of notices printed to the console so far (0 or 1 unless verbose). */
  get printedCount(): number { return this.printed ? 1 : 0; }

  private emit(level: 'info' | 'warn', message: string, err: unknown): void {
    this.entries.push(err === undefined ? message : `${message} (${describe(err)})`);
    if (this.entries.length > DIAGNOSTIC_HISTORY) this.entries.shift();
    if (this.printed && !this.verbose) return;
    this.printed = true;
    const text = this.verbose ? message : `${message} — further platform notices are silenced (?debug=1 shows them)`;
    try {
      if (err === undefined) console[level](text); else console[level](text, err);
    } catch { /* console unavailable */ }
  }
}
