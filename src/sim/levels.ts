import { BUILDABLES, LOGISTICS_TYPES } from '../config/buildables';
import { displayLevel, maxDisplayLevel, parseRequirement, TECH_BY_ID, type TechNode } from '../config/techTree';
import type { BuildingType } from './types';

/**
 * Level-system helpers (engine-agnostic). A building works at the level of its TECHNOLOGY (global per
 * technology, never per instance): Robotic Arm Lv.4 means every arm, placed before or after, is Lv.4.
 */

/** Technology whose level a building type follows (belts, splitters, mergers, lifts: the Conveyor Network). */
export function techForBuilding(type: BuildingType): TechNode | null {
  if (LOGISTICS_TYPES.has(type)) return TECH_BY_ID.l_conveyor ?? null;
  const req = BUILDABLES[type]?.requiresNode;
  if (!req) return null;
  const node = TECH_BY_ID[parseRequirement(req)[0]];
  return node?.leveled ? node : null;
}

export interface TechLevelView {
  node: TechNode;
  /** Displayed level (Lv.1..max). */
  level: number;
  max: number;
  /** Description of the next level, null at max. */
  next: string | null;
}

/** Current displayed level of a technology given the owned level count. */
export function techLevelView(node: TechNode, owned: number): TechLevelView {
  const max = maxDisplayLevel(node);
  const level = Math.max(1, displayLevel(node, owned));
  return { node, level, max, next: owned < node.levels.length ? node.levels[owned].desc : null };
}
