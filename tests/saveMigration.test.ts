/**
 * SAVE MIGRATION RC1 (save v1, one node per upgrade) -> RC2 (save v2, technology levels Lv.1-5).
 * - hand-made v1 node lists map to the documented levels (plans + every old upgrade, flagship -> Lv.5);
 * - a REAL RC1 late-game save (tests/fixtures/rc1-late-save.json, 151 buildings, 4/6 needles, written by the
 *   RC1 build) loads, keeps its factory, pile and money, runs, and re-saves as v2 byte-stable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayLevel, TECH_BY_ID } from '../src/config/techTree';
import { migrateSave, RC1_TO_RC2, SAVE_VERSION } from '../src/sim/save';
import { Sim } from '../src/sim/sim';
import { run } from './support/simKit';

const lv = (sim: Sim, id: string) => displayLevel(TECH_BY_ID[id], sim.progress.nodeLevel(id));

/** A v1 save: today's save shape with an RC1 node list. */
function v1Save(nodes: [string, number][]): unknown {
  const sim = new Sim(77);
  const data = JSON.parse(JSON.stringify(sim.serialize()));
  data.version = 1;
  data.progress.nodes = nodes;
  return data;
}

describe('save migration RC1 -> RC2', () => {
  it('bumps the save version', () => {
    expect(SAVE_VERSION).toBe(2);
    const m = migrateSave(v1Save([]));
    expect(m.version).toBe(2);
  });

  it('maps plans + old upgrades to technology levels (favourable, capped at Lv.5)', () => {
    const sim = Sim.fromSave(v1Save([
      ['p_grab', 1], ['p_carry', 2], ['p_shovel', 1], ['p_wide_shovel', 1], ['p_quick_scoop', 1],
      ['x_hopper', 1], ['f_generator', 1], ['f_gen_output', 2], ['f_firebox', 1],
      ['x_rake', 1], ['x_rake_speed', 2], ['x_rake_auto', 1],
      ['l_conveyor', 1], ['l_speed', 2], ['l_splitter', 1],
      ['x_arm', 1], ['x_arm_speed', 2], ['x_arm_grab', 2], ['x_arm_reach', 2],
      ['d_scanner', 1], ['d_speed', 1],
      ['e_hay_value', 1], ['e_silo', 1], ['e_silo_dual', 1],
      ['gone_node', 3],
    ]));
    expect(lv(sim, 'p_hands')).toBe(2); // Bigger Grab -> Hands Lv.2
    expect(sim.progress.nodeLevel('p_carry')).toBe(2); // kept its id
    expect(lv(sim, 'p_shovel')).toBe(3); // plans + 2 upgrades
    expect(lv(sim, 'x_hopper')).toBe(1);
    expect(lv(sim, 'f_generator')).toBe(4); // plans + 2 + 1
    expect(lv(sim, 'x_rake')).toBe(3);
    expect(sim.progress.isUnlocked('x_rake_auto')).toBe(true);
    expect(lv(sim, 'l_conveyor')).toBe(3);
    expect(sim.progress.isUnlocked('l_splitter')).toBe(true);
    expect(lv(sim, 'x_arm')).toBe(5); // 1 + 6 upgrade levels, capped
    expect(lv(sim, 'd_scanner')).toBe(2);
    expect(lv(sim, 'e_hay_value')).toBe(3); // Raw Hay Value I (+25 % raw) -> Hay Sell Value Lv.3 (x1.22 on everything)
    expect(lv(sim, 'e_silo')).toBe(5); // Silo Dual Output (flagship) -> Lv.5 keeps the second port
    expect(sim.progress.nodes.has('gone_node')).toBe(false);
    expect(sim.progress.nodes.has('x_arm_speed')).toBe(false);
    // No money was charged for the converted levels.
    expect(sim.progress.money).toBe(0);
  });

  it('owning an old flagship node gives Lv.5 (MK2 scanner, Industrial Rake/Generator, Double Chamber ...)', () => {
    const sim = Sim.fromSave(v1Save([
      ['d_scanner', 1], ['d_mk2', 1], ['x_rake', 1], ['x_rake_industrial', 1], ['f_generator', 1], ['f_industrial_gen', 1],
      ['e_compressor', 1], ['e_double_chamber', 1], ['e_wrapper', 1], ['e_premium_wrap', 1], ['x_collector', 1], ['x_col_turbine', 1],
      ['x_hopper', 1], ['x_hopper_dual', 1],
    ]));
    for (const id of ['d_scanner', 'x_rake', 'f_generator', 'e_compressor', 'e_wrapper', 'x_collector', 'x_hopper']) expect(lv(sim, id), id).toBe(5);
    expect(sim.progress.buildingUnlocked('scannerMk2')).toBe(true);
  });

  it('every RC1 node id is either kept or covered by the migration table', () => {
    const rc1 = ['p_grab', 'p_carry', 'p_move', 'p_shovel', 'p_wide_shovel', 'p_quick_scoop', 'p_bucket', 'p_quick_dump', 'p_pitchfork',
      'p_wider_tines', 'p_fork_speed', 'p_wheelbarrow', 'p_barrow_cap', 'p_faster_push', 'p_vacuum', 'p_vac_suction', 'p_vac_range',
      'p_detector', 'p_det_range', 'p_det_precision', 'p_det_depth', 'p_det_direction', 'x_hopper', 'x_hopper_cap', 'x_hopper_out',
      'x_hopper_dual', 'x_rake', 'x_rake_speed', 'x_rake_width', 'x_rake_auto', 'x_rake_push', 'x_rake_industrial', 'x_arm',
      'x_arm_speed', 'x_arm_reach', 'x_arm_grab', 'x_arm_rotation', 'x_arm_smart', 'x_arm_mk2', 'x_collector', 'x_col_radius',
      'x_col_suction', 'x_col_output', 'x_col_efficiency', 'x_col_turbine', 'l_conveyor', 'l_speed', 'l_capacity', 'l_splitter',
      'l_merger', 'l_autoroute', 'l_alternating', 'l_usplitter', 'l_umerger', 'l_priority', 'l_overflow', 'l_lift', 'l_smart',
      'd_scanner', 'd_speed', 'd_batch', 'd_buffer', 'd_eject', 'd_mk2', 'd_mk2_speed', 'd_dual_lane', 'e_hay_value',
      'e_order_reward', 'e_compressor', 'e_comp_speed', 'e_batch_eff', 'e_bale_value', 'e_double_chamber', 'e_silo', 'e_silo_cap',
      'e_silo_in', 'e_silo_out', 'e_silo_dual', 'e_wrapper', 'e_wrap_speed', 'e_premium_wrap', 'e_wrapped_value', 'f_generator',
      'f_pole', 'f_gen_output', 'f_firebox', 'f_autofeed', 'f_fuel_eff', 'f_pole_range', 'f_pole_conn', 'f_power_loss',
      'f_industrial_gen', 'f_build_range', 'f_platform', 'f_expansion'];
    const covered = new Set(Object.values(RC1_TO_RC2).flatMap((m) => [m.plan, ...m.upgrades].filter(Boolean) as string[]));
    covered.add('e_hay_value');
    for (const id of rc1) expect(covered.has(id) || !!TECH_BY_ID[id], `${id} is lost by the migration`).toBe(true);
  });

  it('a real RC1 late-game save loads, keeps the factory, runs and re-saves as v2 byte-stable', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/rc1-late-save.json'), 'utf8')) as { sim: Record<string, unknown> };
    expect(raw.sim.version).toBe(1);
    const rc1 = raw.sim as { buildings: unknown[]; progress: { money: number; wp: number; needlesFound: number[] }; hay: { initialUnits: number } };
    const sim = Sim.fromSave(JSON.parse(JSON.stringify(raw.sim)));
    expect(sim.buildings.size).toBe(rc1.buildings.length);
    expect(sim.progress.money).toBeCloseTo(rc1.progress.money, 6);
    expect(sim.progress.wp).toBe(rc1.progress.wp);
    expect(sim.progress.needlesFound).toEqual(rc1.progress.needlesFound);
    expect(sim.hay.initialUnits).toBe(rc1.hay.initialUnits); // the RC1 pile size is kept (290k), not the new default
    // The RC1 factory had the MK2 scanner, arm MK2, industrial generator, double chamber: all at Lv.5 now.
    for (const id of ['d_scanner', 'x_arm', 'f_generator', 'e_compressor']) expect(lv(sim, id), id).toBe(5);
    expect(sim.progress.buildingUnlocked('scannerMk2')).toBe(true);
    const sold0 = sim.progress.stats.moneyEarned;
    run(sim, 60);
    expect(sim.progress.stats.moneyEarned).toBeGreaterThan(sold0);
    const v2 = JSON.parse(JSON.stringify(sim.serialize()));
    expect(v2.version).toBe(2);
    const again = Sim.fromSave(JSON.parse(JSON.stringify(v2)));
    const a = { ...again.serialize(), savedAt: 0 }, b = { ...v2, savedAt: 0 };
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
