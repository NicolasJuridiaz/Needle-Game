/**
 * Run completion for CrazyGames `reportGameCompletedPercentage` (0..100): found needles over the total
 * (6 needles -> 0, 17, 33, 50, 67, 83, 100). A completed run is always 100, whatever the count says.
 * Pure: no SDK, no DOM, no sim imports.
 */
export function completionPercent(needlesFound: number, total: number, completed = false): number {
  if (completed) return 100;
  if (!Number.isFinite(needlesFound) || !Number.isFinite(total) || total <= 0) return 0;
  const p = Math.round((Math.max(0, needlesFound) / total) * 100);
  return Math.min(100, Math.max(0, p));
}

/** What `trackRunProgress` needs from the platform (implemented by `Platform`). */
export interface ProgressSink {
  /** New run or loaded save: report its current value (may be lower than the previous run's). */
  startRun(percent: number): void;
  /** Progress within the run: never reported lower than what the run already reported. */
  reportProgress(percent: number): void;
}

/** Structural view of a run (the Sim) — keeps this module free of sim imports. */
export interface ProgressRun {
  readonly progress: { readonly needlesFound: readonly unknown[] };
  readonly completed: boolean;
  readonly events: { on(type: 'needle:found' | 'game:completed', fn: () => void): () => void };
}

/**
 * Reports a run's completion: immediately (game start / load — a loaded save reports its real progress,
 * a new game 0), on every needle found and on completion (100). 'Keep playing' after completion stays at
 * 100 because the sink never reports lower within a run. Returns the unsubscribe function.
 */
export function trackRunProgress(sink: ProgressSink, run: ProgressRun, totalNeedles: number): () => void {
  const percent = () => completionPercent(run.progress.needlesFound.length, totalNeedles, run.completed);
  sink.startRun(percent());
  const offNeedle = run.events.on('needle:found', () => sink.reportProgress(percent()));
  const offDone = run.events.on('game:completed', () => sink.reportProgress(100));
  return () => { offNeedle(); offDone(); };
}
