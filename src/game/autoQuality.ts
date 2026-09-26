import type { Quality } from '../render/quality';

/** Evaluation window: seconds of real gameplay (walking / building, window visible). */
export const AUTO_QUALITY_WINDOW = 15;
/** Average FPS over a window below this lowers the preset one step. */
export const AUTO_QUALITY_MIN_FPS = 24;
/**
 * Frames longer than this (coming back from a hidden tab, a breakpoint, a long GC pause) are not counted.
 * Slow frames below it are: a software-rendered GPU runs at ~1 FPS and must still trigger the failsafe.
 */
const MAX_COUNTED_FRAME = 2;
/** Seconds ignored after a quality change or when gameplay (re)starts: shader compiles, texture uploads. */
const SETTLE = 3;

const LOWER: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };

/**
 * GPU failsafe: when the player never picked a quality and the game runs below AUTO_QUALITY_MIN_FPS on
 * average over AUTO_QUALITY_WINDOW seconds of gameplay, step the preset down (high -> medium -> low).
 * Never raises quality, never overrides a manual choice. Pure: the Game feeds it frame times.
 */
export class AutoQuality {
  private settle = SETTLE;
  private time = 0;
  private frames = 0;

  /**
   * Feed one rendered frame. `active` = real gameplay is on screen. Returns the preset to switch to,
   * or null to keep the current one.
   */
  frame(frameSeconds: number, active: boolean, quality: Quality, manual: boolean): Quality | null {
    if (manual || !LOWER[quality]) return null;
    if (!active || !(frameSeconds > 0) || frameSeconds > MAX_COUNTED_FRAME) {
      if (!active) this.restart();
      return null;
    }
    if (this.settle > 0) { this.settle -= frameSeconds; return null; }
    this.time += frameSeconds;
    this.frames++;
    if (this.time < AUTO_QUALITY_WINDOW) return null;
    const fps = this.frames / this.time;
    this.restart();
    return fps < AUTO_QUALITY_MIN_FPS ? LOWER[quality] : null;
  }

  /** Start a fresh window after a settle period (quality changed, gameplay resumed). */
  restart(): void {
    this.settle = SETTLE;
    this.time = 0;
    this.frames = 0;
  }
}
