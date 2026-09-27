import type { HaySave, PlayerSave, ProgressSave } from './interfaces';
import type { BuildingType, Cell, Rot } from './types';

/**
 * Versioned save format. Bump SAVE_VERSION when the shape changes and add a step to MIGRATIONS
 * that upgrades the previous version in place. Never break old saves.
 */
export const SAVE_VERSION = 2;

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

/**
 * RC1 -> RC2 (Level System). RC1 had one node per upgrade; RC2 has one technology node per tool / machine
 * with levels Lv.1..5. For each technology: new level = plans (Lv.1) + every old upgrade level of that
 * family, capped at Lv.5; owning the old flagship node (MK2, Industrial ..., dual output) gives Lv.5 so the
 * factory keeps what it had. Favourable to the player: no money is charged for the converted levels.
 * Feature / plan nodes that still exist keep their id. Old Raw Hay Value I (+25 % raw hay) -> Hay Sell Value
 * Lv.3 (1.22x, now on every product).
 */
interface TechMigration { plan: string | null; upgrades: string[]; flagship?: string[]; max: number; base?: number }
export const RC1_TO_RC2: Record<string, TechMigration> = {
  p_hands: { plan: null, upgrades: ['p_grab'], max: 4 },
  p_shovel: { plan: 'p_shovel', upgrades: ['p_wide_shovel', 'p_quick_scoop'], max: 5 },
  p_bucket: { plan: 'p_bucket', upgrades: ['p_quick_dump'], max: 5 },
  p_pitchfork: { plan: 'p_pitchfork', upgrades: ['p_wider_tines', 'p_fork_speed'], max: 5 },
  p_wheelbarrow: { plan: 'p_wheelbarrow', upgrades: ['p_barrow_cap', 'p_faster_push'], max: 5 },
  p_vacuum: { plan: 'p_vacuum', upgrades: ['p_vac_suction', 'p_vac_range'], max: 5 },
  p_detector: { plan: 'p_detector', upgrades: ['p_det_range', 'p_det_precision', 'p_det_depth', 'p_det_direction'], max: 5 },
  x_hopper: { plan: 'x_hopper', upgrades: ['x_hopper_cap', 'x_hopper_out', 'x_hopper_dual'], flagship: ['x_hopper_dual'], max: 5 },
  x_rake: { plan: 'x_rake', upgrades: ['x_rake_speed', 'x_rake_width', 'x_rake_push', 'x_rake_industrial'], flagship: ['x_rake_industrial'], max: 5 },
  x_arm: { plan: 'x_arm', upgrades: ['x_arm_speed', 'x_arm_reach', 'x_arm_grab', 'x_arm_rotation', 'x_arm_smart', 'x_arm_mk2'], flagship: ['x_arm_mk2'], max: 5 },
  x_collector: { plan: 'x_collector', upgrades: ['x_col_radius', 'x_col_suction', 'x_col_output', 'x_col_efficiency', 'x_col_turbine'], flagship: ['x_col_turbine'], max: 5 },
  l_conveyor: { plan: 'l_conveyor', upgrades: ['l_speed', 'l_capacity'], max: 5 },
  d_scanner: { plan: 'd_scanner', upgrades: ['d_speed', 'd_batch', 'd_buffer', 'd_eject', 'd_mk2', 'd_mk2_speed'], flagship: ['d_mk2'], max: 5 },
  e_hay_value: { plan: null, upgrades: [], flagship: [], max: 9, base: 0 },
  e_compressor: { plan: 'e_compressor', upgrades: ['e_comp_speed', 'e_batch_eff', 'e_double_chamber'], flagship: ['e_double_chamber'], max: 5 },
  e_silo: { plan: 'e_silo', upgrades: ['e_silo_cap', 'e_silo_in', 'e_silo_out', 'e_silo_dual'], flagship: ['e_silo_dual'], max: 5 },
  e_wrapper: { plan: 'e_wrapper', upgrades: ['e_wrap_speed', 'e_premium_wrap', 'e_wrapped_value'], flagship: ['e_premium_wrap'], max: 5 },
  f_generator: { plan: 'f_generator', upgrades: ['f_gen_output', 'f_firebox', 'f_fuel_eff', 'f_industrial_gen'], flagship: ['f_industrial_gen'], max: 5 },
  f_pole: { plan: 'f_pole', upgrades: ['f_pole_range', 'f_pole_conn', 'f_power_loss'], max: 5 },
};

function migrateNodesRc1(nodes: unknown): [string, number][] {
  const old = new Map<string, number>();
  if (Array.isArray(nodes)) {
    for (const e of nodes) {
      if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] >= 1) old.set(e[0], Math.floor(e[1]));
    }
  }
  const out = new Map<string, number>();
  const consumed = new Set<string>();
  for (const [id, m] of Object.entries(RC1_TO_RC2)) {
    if (m.plan) consumed.add(m.plan);
    for (const u of m.upgrades) consumed.add(u);
    let level: number;
    if (id === 'e_hay_value') level = old.has('e_hay_value') ? 2 : 0;
    else if (m.plan === null) level = m.upgrades.reduce((a, u) => a + (old.get(u) ?? 0), 0);
    else if (!old.has(m.plan)) level = 0;
    else {
      level = 1 + m.upgrades.reduce((a, u) => a + (old.get(u) ?? 0), 0);
      if (m.flagship?.some((f) => old.has(f))) level = m.max;
    }
    if (level > 0) out.set(id, Math.min(m.max, level));
  }
  consumed.add('e_hay_value');
  // Nodes that kept their id (features, plans without levels, p_carry ...). Unknown ids are dropped on load.
  for (const [id, lv] of old) if (!consumed.has(id) && !out.has(id)) out.set(id, lv);
  return [...out];
}

/** MIGRATIONS[v] upgrades a save from version v to v+1. */
const MIGRATIONS: Record<number, Migration> = {
  1: (d) => {
    const progress = (d.progress && typeof d.progress === 'object' ? d.progress : {}) as Record<string, unknown>;
    progress.nodes = migrateNodesRc1(progress.nodes);
    d.progress = progress;
    d.version = 2;
    return d;
  },
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
