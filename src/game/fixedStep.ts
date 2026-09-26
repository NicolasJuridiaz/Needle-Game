/**
 * Fixed-step accumulator for the simulation. The sim always advances in `step`-second ticks regardless of the
 * display refresh rate; at most `maxSteps` ticks run per frame (after that the backlog is dropped, so a stall
 * slows the game down instead of spiralling).
 */
export interface FixedStepState { accumulator: number }

/** Adds `dt` and runs as many whole ticks as fit. Returns the interpolation alpha (0..1) into the next tick. */
export function advanceFixed(state: FixedStepState, dt: number, step: number, maxSteps: number, tick: (dt: number) => void): number {
  state.accumulator += dt;
  let steps = 0;
  while (state.accumulator >= step && steps < maxSteps) {
    tick(step);
    state.accumulator -= step;
    steps++;
  }
  if (steps === maxSteps) state.accumulator = 0;
  return state.accumulator / step;
}
