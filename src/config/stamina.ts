/**
 * STAMINA + HAND LEVELS — single source of truth for the player's physical effort and how much hay the bare hands
 * take per grab. Only actions the player performs directly spend stamina (sprinting, digging with hands or any
 * hand-held tool, the hand vacuum). Machines, belts, robots and every other automation never touch it.
 */
export const STAMINA = {
  /** Full bar. */
  max: 100,
  /** Drain per second while actually sprinting (moving with Shift held). A full bar lasts ~8 s of sprint. */
  sprintPerSecond: 12,
  /** After running dry, sprint comes back only once the bar is refilled to this much (avoids stutter). */
  sprintResumeAt: 20,
  /**
   * Cost of one manual grab that takes `hay` units: base × hay^exponent. The exponent < 1 makes bigger grabs cheaper
   * per unit, so upgrades (Hand Lv, better tools) are real upgrades: Lv.1 = 1 hay for 2.0, Lv.5 = 20 hay for ~7.6
   * (0.38 per hay, ~5× more efficient), never 20× the cost.
   */
  pickupBase: 2,
  pickupExponent: 0.45,
  /** Hand vacuum (continuous suction): drain per second while it is actually sucking hay. */
  vacuumPerSecond: 5,
  /** Seconds without spending before the bar starts refilling. */
  regenDelay: 0.8,
  /** Refill per second. An empty bar is full again ~4 s after the delay. */
  regenPerSecond: 25,
} as const;

/** Stamina a manual grab of `hay` units costs. */
export function pickupStaminaCost(hay: number): number {
  if (!(hay > 0)) return 0;
  return STAMINA.pickupBase * Math.pow(hay, STAMINA.pickupExponent);
}

/**
 * Hay units the bare hands take per grab, by displayed Hands level (index 0 = Lv.1). Lv.5 matches the old base carry
 * (20). The Work Tree levels of "Hands" apply these as additive steps on `tool.hands.dig` (see techTree.ts).
 */
export const HAND_LEVEL_PICKUP: readonly number[] = [1, 3, 6, 12, 20];

/** Grab amount at a displayed Hands level (clamped to 1..5). */
export function handPickupAt(level: number): number {
  const i = Math.max(1, Math.min(HAND_LEVEL_PICKUP.length, Math.floor(level))) - 1;
  return HAND_LEVEL_PICKUP[i];
}
