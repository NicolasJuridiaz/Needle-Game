import type { HaySave, PlayerSave, ProgressSave } from './interfaces';
import type { BuildingType, Cell, Rot } from './types';

/**
 * Versioned save format. Bump SAVE_VERSION when the shape changes and add a step to MIGRATIONS
 * that upgrades the previous version in place. Never break old saves.
 */
export const SAVE_VERSION = 1;

export interface SavedBuilding {
  id: number;
  type: BuildingType;
  cell: Cell;
  rot: Rot;
  variant?: string;
  enabled: boolean;
  paid: number;
  state: unknown;
}

export interface SaveData {
  version: number;
  savedAt: number;
  seed: number;
  time: number;
  completed: boolean;
  nextId: number;
  rng: number;
  progress: ProgressSave;
  player: PlayerSave;
  hay: HaySave;
  buildings: SavedBuilding[];
}

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[v] upgrades a save from version v to v+1. */
const MIGRATIONS: Record<number, Migration> = {
  // 1: (d) => { ...; d.version = 2; return d; },
};

export function migrateSave(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid save');
  let data = raw as Record<string, unknown>;
  let v = typeof data.version === 'number' ? data.version : 0;
  if (v > SAVE_VERSION) throw new Error(`Save version ${v} is newer than this game (${SAVE_VERSION})`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from save version ${v}`);
    data = m(data);
    v = data.version as number;
  }
  return data as unknown as SaveData;
}
