import { STAMINA } from '../config/stamina';

/**
 * The player's physical effort (config/stamina.ts). Engine-agnostic. Only direct player actions spend it
 * (the FPS controller for sprint, playerDig / playerVacuum for manual hay); it refills in Sim.tick after
 * `regenDelay` seconds without spending. Not saved: a loaded game starts rested (documented decision).
 */
export class Stamina {
  value: number = STAMINA.max;
  /** Seconds since the last spend (regen starts after STAMINA.regenDelay). */
  private idle = Infinity;
  /** True after running dry while sprinting, until the bar reaches STAMINA.sprintResumeAt. */
  exhausted = false;

  get max(): number { return STAMINA.max; }
  get fraction(): number { return this.value / STAMINA.max; }

  /** Spends `amount` if the whole amount is available. Returns false (and spends nothing) otherwise. */
  trySpend(amount: number): boolean {
    if (!(amount > 0)) return true;
    if (this.value + 1e-9 < amount) return false;
    this.value = Math.max(0, this.value - amount);
    this.idle = 0;
    return true;
  }

  /** Continuous drain (sprint, vacuum). Returns the fraction of `dt` that could be paid (0..1). */
  drain(perSecond: number, dt: number): number {
    if (!(perSecond > 0) || !(dt > 0)) return 1;
    const want = perSecond * dt;
    const paid = Math.min(this.value, want);
    this.value -= paid;
    this.idle = 0;
    if (this.value <= 1e-9) { this.value = 0; this.exhausted = true; }
    return paid / want;
  }

  /** Sprint allowed now? (not while exhausted: the bar must refill to sprintResumeAt first). */
  canSprint(): boolean { return !this.exhausted && this.value > 0; }

  /** Regeneration; called every sim tick. */
  tick(dt: number): void {
    this.idle += dt;
    if (this.idle >= STAMINA.regenDelay && this.value < STAMINA.max) {
      this.value = Math.min(STAMINA.max, this.value + STAMINA.regenPerSecond * dt);
    }
    if (this.exhausted && this.value >= STAMINA.sprintResumeAt) this.exhausted = false;
  }

  /** Back to a full, rested bar (new game, loaded save). */
  reset(): void { this.value = STAMINA.max; this.idle = Infinity; this.exhausted = false; }
}
