import type { BranchId, BuildingType, Effect, ToolId } from '../sim/types';

/**
 * WORK TREE — unlocked with Work Points (WP).
 * Rule: unlocking plans != owning the object. Plans make the object purchasable (Money) in the shop.
 * Upgrades are global: they affect every existing and future unit immediately.
 *
 * `pos` = [col, row] inside the branch panel (row = depth). The UI draws dependency lines from `requires`.
 */
export interface TechLevel {
  cost: number;
  effects: Effect[];
  /** Concise, player-facing effect text for this level. */
  desc: string;
}

export interface TechNode {
  id: string;
  name: string;
  branch: BranchId;
  kind: 'plan' | 'upgrade' | 'feature';
  /** All required nodes must have at least level 1. */
  requires: string[];
  levels: TechLevel[];
  unlocks?: { building?: BuildingType[]; tool?: ToolId; wheelbarrow?: boolean };
  icon: string;
  pos: [number, number];
}

export interface BranchDef { id: BranchId; name: string; color: string; icon: string }

export const BRANCHES: BranchDef[] = [
  { id: 'player', name: 'Player & Tools', color: '#f2b544', icon: 'hands' },
  { id: 'extraction', name: 'Extraction', color: '#f07a3a', icon: 'arm' },
  { id: 'logistics', name: 'Logistics', color: '#5aa6e8', icon: 'conveyor' },
  { id: 'detection', name: 'Needle Detection', color: '#3fd0c0', icon: 'scanner' },
  { id: 'processing', name: 'Processing & Economy', color: '#7cc85a', icon: 'compressor' },
  { id: 'power', name: 'Power & Factory', color: '#e0584f', icon: 'generator' },
];

const up = (stat: string, value: number): Effect => ({ stat, op: 'add', value });
const mul = (stat: string, value: number): Effect => ({ stat, op: 'mul', value });
const set = (stat: string, value: number): Effect => ({ stat, op: 'set', value });
const lvl = (cost: number, desc: string, ...effects: Effect[]): TechLevel => ({ cost, desc, effects });

export const TECH_NODES: TechNode[] = [
  // =====================================================================================
  // A. PLAYER & TOOLS
  // =====================================================================================
  { id: 'p_grab', name: 'Bigger Grab', branch: 'player', kind: 'upgrade', requires: [], icon: 'hands', pos: [0, 0],
    levels: [lvl(1, 'Hands grab twice as much hay.', mul('tool.hands.dig', 2))] },
  { id: 'p_carry', name: 'Carry Capacity', branch: 'player', kind: 'upgrade', requires: [], icon: 'carry', pos: [4, 0],
    levels: [
      lvl(1, 'Carry +15 hay.', up('player.carry', 15)),
      lvl(2, 'Carry +30 hay.', up('player.carry', 30)),
    ] },
  { id: 'p_move', name: 'Movement Speed I', branch: 'player', kind: 'upgrade', requires: ['p_carry'], icon: 'boots', pos: [5, 1],
    levels: [lvl(1, 'Move 15% faster.', mul('player.moveSpeed', 1.15))] },
  { id: 'p_shovel', name: 'Shovel Plans', branch: 'player', kind: 'plan', requires: ['p_grab'], icon: 'shovel', pos: [0, 1],
    unlocks: { tool: 'shovel' },
    levels: [lvl(1, 'Unlocks the Shovel in the Shop.')] },
  { id: 'p_wide_shovel', name: 'Wide Shovel', branch: 'player', kind: 'upgrade', requires: ['p_shovel'], icon: 'shovel', pos: [0, 2],
    levels: [lvl(1, 'Shovel scoops +60% hay over a wider area.', mul('tool.shovel.dig', 1.6), mul('tool.shovel.radius', 1.4))] },
  { id: 'p_quick_scoop', name: 'Quick Scoop', branch: 'player', kind: 'upgrade', requires: ['p_shovel'], icon: 'speed', pos: [1, 2],
    levels: [lvl(1, 'Shovel swings 30% faster.', mul('tool.shovel.interval', 0.7))] },
  { id: 'p_bucket', name: 'Bucket Plans', branch: 'player', kind: 'plan', requires: ['p_carry'], icon: 'bucket', pos: [4, 1],
    unlocks: { tool: 'bucket' },
    levels: [lvl(1, 'Unlocks the Bucket: big scoops and +40 carry.')] },
  { id: 'p_quick_dump', name: 'Quick Dump', branch: 'player', kind: 'upgrade', requires: ['p_bucket'], icon: 'dump', pos: [5, 2],
    levels: [lvl(1, 'Throw your load into hoppers and machines from 6 m.', set('tool.bucket.quickDump', 1))] },
  { id: 'p_pitchfork', name: 'Pitchfork Plans', branch: 'player', kind: 'plan', requires: ['p_shovel'], icon: 'pitchfork', pos: [0, 3],
    unlocks: { tool: 'pitchfork' },
    levels: [lvl(2, 'Unlocks the Pitchfork: fast, heavy stabs.')] },
  { id: 'p_wider_tines', name: 'Wider Tines', branch: 'player', kind: 'upgrade', requires: ['p_pitchfork'], icon: 'pitchfork', pos: [0, 4],
    levels: [lvl(1, 'Pitchfork lifts +50% hay.', mul('tool.pitchfork.dig', 1.5), mul('tool.pitchfork.radius', 1.25))] },
  { id: 'p_fork_speed', name: 'Pitchfork Speed I', branch: 'player', kind: 'upgrade', requires: ['p_pitchfork'], icon: 'speed', pos: [1, 4],
    levels: [lvl(1, 'Pitchfork stabs 25% faster.', mul('tool.pitchfork.interval', 0.75))] },
  { id: 'p_wheelbarrow', name: 'Wheelbarrow Plans', branch: 'player', kind: 'plan', requires: ['p_bucket'], icon: 'wheelbarrow', pos: [4, 2],
    unlocks: { wheelbarrow: true },
    levels: [lvl(2, 'Unlocks the Wheelbarrow: park it, dig, push 200 hay at once.')] },
  { id: 'p_barrow_cap', name: 'Wheelbarrow Capacity I', branch: 'player', kind: 'upgrade', requires: ['p_wheelbarrow'], icon: 'wheelbarrow', pos: [4, 3],
    levels: [lvl(1, 'Wheelbarrow holds +200 hay.', up('wheelbarrow.capacity', 200))] },
  { id: 'p_faster_push', name: 'Faster Push', branch: 'player', kind: 'upgrade', requires: ['p_wheelbarrow'], icon: 'boots', pos: [5, 3],
    levels: [lvl(1, 'Almost no slowdown while pushing the wheelbarrow.', set('wheelbarrow.speedMul', 0.95))] },
  { id: 'p_vacuum', name: 'Vacuum Tool Plans', branch: 'player', kind: 'plan', requires: ['p_pitchfork'], icon: 'vacuum', pos: [0, 5],
    unlocks: { tool: 'vacuum' },
    levels: [lvl(2, 'Unlocks the Vacuum Tool: continuous suction at range.')] },
  { id: 'p_vac_suction', name: 'Vacuum Suction I', branch: 'player', kind: 'upgrade', requires: ['p_vacuum'], icon: 'vacuum', pos: [0, 6],
    levels: [lvl(2, 'Vacuum Tool sucks +50% hay/s.', mul('tool.vacuum.rate', 1.5))] },
  { id: 'p_vac_range', name: 'Vacuum Range I', branch: 'player', kind: 'upgrade', requires: ['p_vacuum'], icon: 'range', pos: [1, 6],
    levels: [lvl(1, 'Vacuum Tool reaches 8 m and a wider cone.', set('tool.vacuum.reach', 8), mul('tool.vacuum.radius', 1.4))] },
  { id: 'p_detector', name: 'Metal Detector Plans', branch: 'player', kind: 'plan', requires: ['p_shovel'], icon: 'detector', pos: [2, 2],
    unlocks: { tool: 'detector' },
    levels: [lvl(3, 'Unlocks the Metal Detector: hunt needles by sound.')] },
  { id: 'p_det_range', name: 'Detector Range I', branch: 'player', kind: 'upgrade', requires: ['p_detector'], icon: 'range', pos: [2, 3],
    levels: [lvl(1, 'Detects needles from 13 m away.', set('tool.detector.range', 13))] },
  { id: 'p_det_precision', name: 'Signal Precision I', branch: 'player', kind: 'upgrade', requires: ['p_detector'], icon: 'precision', pos: [3, 3],
    levels: [lvl(1, 'Clean, noise-free signal with a distance readout.', set('tool.detector.precision', 1))] },
  { id: 'p_det_depth', name: 'Depth Detection', branch: 'player', kind: 'upgrade', requires: ['p_det_range'], icon: 'depth', pos: [2, 4],
    levels: [lvl(2, 'Senses needles up to 2 m deep (was 0.8 m).', set('tool.detector.depth', 2))] },
  { id: 'p_det_direction', name: 'Directional Signal', branch: 'player', kind: 'upgrade', requires: ['p_det_precision'], icon: 'compass', pos: [3, 4],
    levels: [lvl(2, 'An arrow points towards the strongest signal.', set('tool.detector.directional', 1))] },

  // =====================================================================================
  // B. EXTRACTION & INPUT
  // =====================================================================================
  { id: 'x_hopper', name: 'Hopper Plans', branch: 'extraction', kind: 'plan', requires: [], icon: 'hopper', pos: [0, 0],
    unlocks: { building: ['hopper'] },
    levels: [lvl(2, 'Unlocks the Hay Hopper: dump hay in, it feeds a belt.')] },
  { id: 'x_hopper_cap', name: 'Hopper Capacity I', branch: 'extraction', kind: 'upgrade', requires: ['x_hopper'], icon: 'capacity', pos: [0, 1],
    levels: [lvl(1, 'Hoppers hold 1,000 hay.', set('hopper.capacity', 1000))] },
  { id: 'x_hopper_out', name: 'Hopper Output I', branch: 'extraction', kind: 'upgrade', requires: ['x_hopper'], icon: 'speed', pos: [1, 1],
    levels: [lvl(1, 'Hopper output 40 -> 75 hay/s.', set('hopper.outputRate', 75))] },
  { id: 'x_hopper_dual', name: 'Dual Hopper Output', branch: 'extraction', kind: 'upgrade', requires: ['x_hopper_out'], icon: 'split', pos: [1, 2],
    levels: [lvl(2, 'Hoppers get a second output port.', set('hopper.dualOutput', 1))] },

  { id: 'x_rake', name: 'Piston Rake Plans', branch: 'extraction', kind: 'plan', requires: ['f_generator'], icon: 'rake', pos: [2, 0],
    unlocks: { building: ['pistonRake'] },
    levels: [lvl(4, 'Unlocks the Piston Rake: your first automatic extractor.')] },
  { id: 'x_rake_speed', name: 'Rake Speed', branch: 'extraction', kind: 'upgrade', requires: ['x_rake'], icon: 'speed', pos: [2, 1],
    levels: [
      lvl(1, 'Rake cycles 25% faster.', mul('rake.cycleTime', 0.8)),
      lvl(2, 'Rake cycles another 25% faster.', mul('rake.cycleTime', 0.8)),
    ] },
  { id: 'x_rake_width', name: 'Rake Width', branch: 'extraction', kind: 'upgrade', requires: ['x_rake'], icon: 'width', pos: [3, 1],
    levels: [
      lvl(1, 'Wider rake head: +30% hay per cycle.', mul('rake.width', 1.5), mul('rake.push', 1.3)),
      lvl(2, 'Even wider: another +30% hay per cycle.', mul('rake.width', 1.35), mul('rake.push', 1.3)),
    ] },
  { id: 'x_rake_auto', name: 'Auto Output', branch: 'extraction', kind: 'upgrade', requires: ['x_rake'], icon: 'output', pos: [4, 1],
    levels: [lvl(1, 'Tray unloads 3x faster, straight into belts and hoppers.', set('rake.autoOutput', 1), mul('rake.trayOutputRate', 3), mul('rake.trayCapacity', 2))] },
  { id: 'x_rake_push', name: 'Stronger Push', branch: 'extraction', kind: 'upgrade', requires: ['x_rake_speed'], icon: 'strength', pos: [2, 2],
    levels: [lvl(2, '+50% hay per cycle and 2 m more reach.', mul('rake.push', 1.5), up('rake.reach', 2))] },
  { id: 'x_rake_industrial', name: 'Industrial Rake', branch: 'extraction', kind: 'upgrade', requires: ['x_rake_push', 'x_rake_width'], icon: 'industrial', pos: [3, 2],
    levels: [lvl(3, 'Heavy-duty rakes: +50% speed and hay per cycle.', set('rake.industrial', 1), mul('rake.cycleTime', 0.67), mul('rake.push', 1.5), mul('rake.trayOutputRate', 1.5))] },

  { id: 'x_arm', name: 'Robotic Arm Plans', branch: 'extraction', kind: 'plan', requires: ['x_rake', 'l_conveyor'], icon: 'arm', pos: [3, 3],
    unlocks: { building: ['roboticArm'] },
    levels: [lvl(5, 'Unlocks the Robotic Arm: grabs hay and drops it on belts.')] },
  { id: 'x_arm_speed', name: 'Faster Servos', branch: 'extraction', kind: 'upgrade', requires: ['x_arm'], icon: 'speed', pos: [2, 4],
    levels: [
      lvl(2, 'Arms move 25% faster.', mul('arm.speed', 1.25), mul('arm.rotSpeed', 1.15)),
      lvl(3, 'Arms move another 25% faster.', mul('arm.speed', 1.25), mul('arm.rotSpeed', 1.15)),
    ] },
  { id: 'x_arm_reach', name: 'Extended Arm', branch: 'extraction', kind: 'upgrade', requires: ['x_arm'], icon: 'range', pos: [3, 4],
    levels: [
      lvl(1, 'Arm reach 4.5 -> 6 m.', set('arm.reach', 6)),
      lvl(2, 'Arm reach 6 -> 7.5 m.', set('arm.reach', 7.5)),
    ] },
  { id: 'x_arm_grab', name: 'Bigger Claw', branch: 'extraction', kind: 'upgrade', requires: ['x_arm'], icon: 'claw', pos: [4, 4],
    levels: [
      lvl(2, 'Arms grab 30 hay per swing (was 20).', set('arm.grab', 30)),
      lvl(3, 'Arms grab 40 hay per swing.', set('arm.grab', 40)),
    ] },
  { id: 'x_arm_rotation', name: 'Faster Rotation', branch: 'extraction', kind: 'upgrade', requires: ['x_arm_speed'], icon: 'rotate', pos: [2, 5],
    levels: [lvl(2, 'Arms swing 60% faster.', mul('arm.rotSpeed', 1.6))] },
  { id: 'x_arm_smart', name: 'Smart Targeting', branch: 'extraction', kind: 'upgrade', requires: ['x_arm_reach'], icon: 'target', pos: [3, 5],
    levels: [lvl(2, 'Arms pick the densest hay in reach: always full claws.', set('arm.smart', 1))] },
  { id: 'x_arm_mk2', name: 'Robotic Arm MK2', branch: 'extraction', kind: 'upgrade', requires: ['x_arm_speed', 'x_arm_grab'], icon: 'industrial', pos: [4, 5],
    levels: [lvl(5, 'All arms upgraded to MK2: +50% throughput, new look.', set('arm.mk2', 1), mul('arm.throughputMul', 1.5))] },

  { id: 'x_collector', name: 'Vacuum Collector Plans', branch: 'extraction', kind: 'plan', requires: ['x_arm_grab', 'f_gen_output'], icon: 'collector', pos: [5, 6],
    unlocks: { building: ['vacuumCollector'] },
    levels: [lvl(3, 'Unlocks the Vacuum Collector: 50 hay/s industrial suction.')] },
  { id: 'x_col_radius', name: 'Collector Radius I', branch: 'extraction', kind: 'upgrade', requires: ['x_collector'], icon: 'range', pos: [4, 7],
    levels: [lvl(2, 'Collector radius 6 -> 9 m.', set('collector.radius', 9))] },
  { id: 'x_col_suction', name: 'Collector Suction I', branch: 'extraction', kind: 'upgrade', requires: ['x_collector'], icon: 'vacuum', pos: [5, 7],
    levels: [lvl(3, 'Collectors suck +50% hay/s.', mul('collector.rate', 1.5))] },
  { id: 'x_col_output', name: 'Collector Output I', branch: 'extraction', kind: 'upgrade', requires: ['x_collector'], icon: 'output', pos: [6, 7],
    levels: [lvl(2, 'Output 60 -> 130 hay/s and a bigger internal buffer.', set('collector.outputRate', 130), mul('collector.buffer', 2))] },
  { id: 'x_col_efficiency', name: 'Power Efficiency', branch: 'extraction', kind: 'upgrade', requires: ['x_col_suction'], icon: 'power', pos: [5, 8],
    levels: [lvl(2, 'Collectors use 40% less power.', mul('collector.powerMul', 0.6))] },
  { id: 'x_col_turbine', name: 'Industrial Turbine', branch: 'extraction', kind: 'upgrade', requires: ['x_col_suction', 'x_col_radius'], icon: 'industrial', pos: [4, 8],
    levels: [lvl(5, 'Twin-turbine collectors: +60% suction, new look.', set('collector.industrial', 1), mul('collector.rate', 1.6))] },

  // =====================================================================================
  // C. LOGISTICS
  // =====================================================================================
  { id: 'l_conveyor', name: 'Conveyor Plans', branch: 'logistics', kind: 'plan', requires: ['x_hopper'], icon: 'conveyor', pos: [1, 0],
    unlocks: { building: ['conveyor'] },
    levels: [lvl(3, 'Unlocks Conveyors: click start, click end, done.')] },
  { id: 'l_speed', name: 'Belt Speed', branch: 'logistics', kind: 'upgrade', requires: ['l_conveyor'], icon: 'speed', pos: [0, 1],
    levels: [
      lvl(3, 'Belts 50 -> 75 hay/s.', mul('belt.speed', 1.5)),
      lvl(5, 'Belts 75 -> 100 hay/s.', mul('belt.speed', 4 / 3)),
    ] },
  { id: 'l_capacity', name: 'Belt Capacity I', branch: 'logistics', kind: 'upgrade', requires: ['l_speed'], icon: 'capacity', pos: [0, 2],
    levels: [lvl(6, 'Items pack 25% closer on belts (+33% throughput).', mul('belt.spacing', 0.75))] },
  { id: 'l_splitter', name: 'Splitter Plans', branch: 'logistics', kind: 'plan', requires: ['l_conveyor'], icon: 'splitter', pos: [1, 1],
    unlocks: { building: ['splitter'] },
    levels: [lvl(2, 'Unlocks the Splitter (Even mode).')] },
  { id: 'l_merger', name: 'Merger Plans', branch: 'logistics', kind: 'plan', requires: ['l_conveyor'], icon: 'merger', pos: [2, 1],
    unlocks: { building: ['merger'] },
    levels: [lvl(1, 'Unlocks the Merger.')] },
  { id: 'l_autoroute', name: 'Auto Route / Snap+', branch: 'logistics', kind: 'feature', requires: ['l_conveyor'], icon: 'route', pos: [3, 1],
    levels: [lvl(1, 'Belts path-find around obstacles and auto-connect ports.', set('global.autoRoute', 1))] },
  { id: 'l_alternating', name: 'Alternating Splitter', branch: 'logistics', kind: 'feature', requires: ['l_splitter'], icon: 'alternate', pos: [1, 2],
    levels: [lvl(1, 'Splitter mode: strict 1:1 alternation.')] },
  { id: 'l_usplitter', name: 'U-Splitter', branch: 'logistics', kind: 'plan', requires: ['l_splitter'], icon: 'usplitter', pos: [2, 2],
    unlocks: { building: ['uSplitter'] },
    levels: [lvl(1, 'Unlocks the compact Lane Splitter.')] },
  { id: 'l_umerger', name: 'U-Merger', branch: 'logistics', kind: 'plan', requires: ['l_merger'], icon: 'umerger', pos: [3, 2],
    unlocks: { building: ['uMerger'] },
    levels: [lvl(1, 'Unlocks the compact Lane Merger.')] },
  { id: 'l_priority', name: 'Priority Splitter', branch: 'logistics', kind: 'feature', requires: ['l_splitter'], icon: 'priority', pos: [1, 3],
    levels: [lvl(1, 'Splitter mode: primary output gets 2 of every 3 items.')] },
  { id: 'l_overflow', name: 'Overflow Splitter', branch: 'logistics', kind: 'feature', requires: ['l_priority'], icon: 'overflow', pos: [1, 4],
    levels: [lvl(2, 'Splitter mode: side outputs only get items when primary is blocked.')] },
  { id: 'l_lift', name: 'Belt Lift', branch: 'logistics', kind: 'plan', requires: ['l_speed', 'l_merger'], icon: 'lift', pos: [0, 3],
    unlocks: { building: ['beltLift', 'conveyorRamp'] },
    levels: [lvl(2, 'Unlocks Belt Lifts, Ramps and elevated belts to cross lines.')] },
  { id: 'l_smart', name: 'Smart Splitter', branch: 'logistics', kind: 'feature', requires: ['l_overflow', 'e_compressor'], icon: 'filter', pos: [2, 5],
    levels: [lvl(3, 'Splitter mode: filter an item type to the primary output.')] },

  // =====================================================================================
  // D. NEEDLE DETECTION
  // =====================================================================================
  { id: 'd_scanner', name: 'Scanner MK1 Plans', branch: 'detection', kind: 'plan', requires: ['l_splitter'], icon: 'scanner', pos: [1, 0],
    unlocks: { building: ['scannerMk1'] },
    levels: [lvl(5, 'Unlocks the Needle Scanner: finds needles hidden in belt hay.')] },
  { id: 'd_speed', name: 'Scan Speed', branch: 'detection', kind: 'upgrade', requires: ['d_scanner'], icon: 'speed', pos: [0, 1],
    levels: [
      lvl(2, 'Scan cycles 25% faster.', mul('scanner.cycle', 0.8)),
      lvl(3, 'Scan cycles another 25% faster.', mul('scanner.cycle', 0.8)),
    ] },
  { id: 'd_batch', name: 'Batch Size', branch: 'detection', kind: 'upgrade', requires: ['d_scanner'], icon: 'capacity', pos: [1, 1],
    levels: [
      lvl(2, 'Scans 40 hay per cycle (was 30).', set('scanner.batch', 40)),
      lvl(3, 'Scans 50 hay per cycle.', set('scanner.batch', 50)),
    ] },
  { id: 'd_buffer', name: 'Scanner Buffer', branch: 'detection', kind: 'upgrade', requires: ['d_scanner'], icon: 'buffer', pos: [2, 1],
    levels: [lvl(1, 'Scanner MK1 buffers 3x more hay, MK2 2x, to absorb spikes.', mul('scanner.buffer', 3), mul('scanner2.buffer', 2))] },
  { id: 'd_eject', name: 'Auto Needle Eject', branch: 'detection', kind: 'upgrade', requires: ['d_buffer'], icon: 'eject', pos: [2, 2],
    levels: [lvl(2, 'Scanners eject needles without stopping the line.', set('scanner.autoEject', 1))] },
  { id: 'd_mk2', name: 'Scanner MK2 Plans', branch: 'detection', kind: 'plan', requires: ['d_speed', 'd_batch'], icon: 'scanner2', pos: [1, 3],
    unlocks: { building: ['scannerMk2'] },
    levels: [lvl(3, 'Unlocks Scanner MK2: 180 hay/s, auto-eject built in.')] },
  { id: 'd_mk2_speed', name: 'Scanner MK2 Speed', branch: 'detection', kind: 'upgrade', requires: ['d_mk2'], icon: 'speed', pos: [0, 4],
    levels: [lvl(3, 'MK2 scanners +30% throughput.', mul('scanner2.speedMul', 1.3))] },
  { id: 'd_dual_lane', name: 'Dual Lane Scan', branch: 'detection', kind: 'upgrade', requires: ['d_mk2'], icon: 'dual', pos: [2, 4],
    levels: [lvl(4, 'MK2 scanners open a second lane: double throughput.', set('scanner2.dualLane', 1))] },

  // =====================================================================================
  // E. PROCESSING, STORAGE & ECONOMY
  // =====================================================================================
  { id: 'e_hay_value', name: 'Raw Hay Value I', branch: 'processing', kind: 'upgrade', requires: [], icon: 'money', pos: [0, 0],
    levels: [lvl(2, 'Raw hay sells for 25% more.', mul('econ.hayValue', 1.25))] },
  { id: 'e_order_reward', name: 'Order Reward I', branch: 'processing', kind: 'upgrade', requires: [], icon: 'order', pos: [4, 0],
    levels: [lvl(2, 'Orders pay 50% more money.', mul('econ.orderRewardMul', 1.5))] },
  { id: 'e_compressor', name: 'Compressor Plans', branch: 'processing', kind: 'plan', requires: ['l_conveyor'], icon: 'compressor', pos: [1, 1],
    unlocks: { building: ['compressor'] },
    levels: [lvl(5, 'Unlocks the Compressor: 40 hay -> 1 bale ($60).')] },
  { id: 'e_comp_speed', name: 'Compression Speed', branch: 'processing', kind: 'upgrade', requires: ['e_compressor'], icon: 'speed', pos: [0, 2],
    levels: [
      lvl(2, 'Compressors work 25% faster.', mul('compressor.cycle', 0.8)),
      lvl(3, 'Compressors work another 25% faster.', mul('compressor.cycle', 0.8)),
    ] },
  { id: 'e_batch_eff', name: 'Batch Efficiency', branch: 'processing', kind: 'upgrade', requires: ['e_compressor'], icon: 'efficiency', pos: [1, 2],
    levels: [lvl(2, 'Bales need 32 hay instead of 40.', set('compressor.hayPerBale', 32))] },
  { id: 'e_bale_value', name: 'Bale Value I', branch: 'processing', kind: 'upgrade', requires: ['e_compressor'], icon: 'money', pos: [2, 2],
    levels: [lvl(2, 'Bales sell for 25% more.', mul('econ.baleValue', 1.25))] },
  { id: 'e_double_chamber', name: 'Double Chamber', branch: 'processing', kind: 'upgrade', requires: ['e_comp_speed'], icon: 'dual', pos: [0, 3],
    levels: [lvl(4, 'Compressors press two bales at once.', set('compressor.chambers', 2), mul('compressor.buffer', 2))] },
  { id: 'e_silo', name: 'Silo Plans', branch: 'processing', kind: 'plan', requires: ['l_splitter'], icon: 'silo', pos: [4, 1],
    unlocks: { building: ['silo'] },
    levels: [lvl(2, 'Unlocks the Silo: a 2,500 hay buffer.')] },
  { id: 'e_silo_cap', name: 'Silo Capacity', branch: 'processing', kind: 'upgrade', requires: ['e_silo'], icon: 'capacity', pos: [3, 2],
    levels: [
      lvl(1, 'Silos hold 5,000.', set('silo.capacity', 5000)),
      lvl(2, 'Silos hold 10,000.', set('silo.capacity', 10000)),
    ] },
  { id: 'e_silo_in', name: 'Silo Input I', branch: 'processing', kind: 'upgrade', requires: ['e_silo'], icon: 'input', pos: [4, 2],
    levels: [lvl(1, 'Silos accept 2x faster.', mul('silo.inputRate', 2))] },
  { id: 'e_silo_out', name: 'Silo Output I', branch: 'processing', kind: 'upgrade', requires: ['e_silo'], icon: 'output', pos: [5, 2],
    levels: [lvl(1, 'Silos unload 2x faster.', mul('silo.outputRate', 2))] },
  { id: 'e_silo_dual', name: 'Silo Dual Output', branch: 'processing', kind: 'upgrade', requires: ['e_silo_out'], icon: 'split', pos: [5, 3],
    levels: [lvl(2, 'Silos get a second output port.', set('silo.dualOutput', 1))] },
  { id: 'e_wrapper', name: 'Wrapper Plans', branch: 'processing', kind: 'plan', requires: ['e_compressor', 'e_silo'], icon: 'wrapper', pos: [2, 4],
    unlocks: { building: ['wrapper'] },
    levels: [lvl(5, 'Unlocks the Bale Wrapper: bale -> wrapped bale ($110).')] },
  { id: 'e_wrap_speed', name: 'Wrap Speed', branch: 'processing', kind: 'upgrade', requires: ['e_wrapper'], icon: 'speed', pos: [1, 5],
    levels: [
      lvl(2, 'Wrappers work 30% faster.', mul('wrapper.cycle', 0.77)),
      lvl(3, 'Wrappers work another 30% faster.', mul('wrapper.cycle', 0.77)),
    ] },
  { id: 'e_premium_wrap', name: 'Premium Wrap', branch: 'processing', kind: 'upgrade', requires: ['e_wrapper'], icon: 'premium', pos: [2, 5],
    levels: [lvl(3, 'Gold-striped premium film: wrapped bales +30% value.', set('wrapper.premium', 1), mul('econ.wrappedValue', 1.3))] },
  { id: 'e_wrapped_value', name: 'Wrapped Value I', branch: 'processing', kind: 'upgrade', requires: ['e_wrapper'], icon: 'money', pos: [3, 5],
    levels: [lvl(3, 'Wrapped bales sell for 25% more.', mul('econ.wrappedValue', 1.25))] },

  // =====================================================================================
  // F. POWER & FACTORY
  // =====================================================================================
  { id: 'f_generator', name: 'Hay Generator Plans', branch: 'power', kind: 'plan', requires: [], icon: 'generator', pos: [1, 0],
    unlocks: { building: ['hayGenerator'] },
    levels: [lvl(1, 'Unlocks the Hay Generator: burn hay, make power.')] },
  { id: 'f_pole', name: 'Power Pole Plans', branch: 'power', kind: 'plan', requires: ['f_generator'], icon: 'pole', pos: [0, 1],
    unlocks: { building: ['powerPole'] },
    levels: [lvl(2, 'Unlocks Power Poles to carry power across the warehouse.')] },
  { id: 'f_gen_output', name: 'Generator Output', branch: 'power', kind: 'upgrade', requires: ['f_generator'], icon: 'power', pos: [1, 1],
    levels: [
      // Multipliers, not `set`: a set would override later multipliers (Industrial Generator x2, needle buffs).
      lvl(2, 'Generators make 90 P (was 60).', mul('generator.output', 1.5)),
      lvl(3, 'Generators make 130 P.', mul('generator.output', 130 / 90)),
    ] },
  { id: 'f_firebox', name: 'Bigger Firebox', branch: 'power', kind: 'upgrade', requires: ['f_generator'], icon: 'fire', pos: [2, 1],
    levels: [lvl(1, 'Fireboxes hold 500 hay of fuel.', set('generator.firebox', 500))] },
  { id: 'f_autofeed', name: 'Auto Feed', branch: 'power', kind: 'upgrade', requires: ['f_generator'], icon: 'input', pos: [3, 1],
    levels: [lvl(2, 'Generators get a belt input port: no more hand stoking.', set('generator.autoFeed', 1))] },
  { id: 'f_fuel_eff', name: 'Fuel Efficiency I', branch: 'power', kind: 'upgrade', requires: ['f_firebox'], icon: 'efficiency', pos: [2, 2],
    levels: [lvl(2, 'Generators burn 30% less hay.', mul('generator.burnRate', 0.7))] },
  { id: 'f_pole_range', name: 'Pole Range', branch: 'power', kind: 'upgrade', requires: ['f_pole'], icon: 'range', pos: [0, 2],
    levels: [
      lvl(1, 'Pole range 8 -> 12 m.', set('pole.range', 12)),
      lvl(2, 'Pole range 12 -> 16 m.', set('pole.range', 16)),
    ] },
  { id: 'f_pole_conn', name: 'Connection Limit I', branch: 'power', kind: 'upgrade', requires: ['f_pole'], icon: 'links', pos: [0, 3],
    levels: [lvl(1, 'Each pole powers up to 12 machines (was 6).', set('pole.connections', 12))] },
  { id: 'f_power_loss', name: 'Power Loss Reduction', branch: 'power', kind: 'upgrade', requires: ['f_pole_range'], icon: 'efficiency', pos: [1, 3],
    levels: [lvl(2, 'Transmission loss 10% -> 3%.', set('power.loss', 0.03))] },
  { id: 'f_industrial_gen', name: 'Industrial Generator', branch: 'power', kind: 'upgrade', requires: ['f_gen_output', 'f_fuel_eff'], icon: 'industrial', pos: [2, 3],
    levels: [lvl(5, 'Industrial boilers: generators make 2x power.', set('generator.industrial', 1), mul('generator.output', 2), mul('generator.burnRate', 1.5))] },
  { id: 'f_build_range', name: 'Factory Build Range I', branch: 'power', kind: 'feature', requires: [], icon: 'range', pos: [5, 0],
    levels: [lvl(1, 'Place and remove buildings from 20 m away.', set('player.buildRange', 20))] },
  { id: 'f_platform', name: 'Platforms & Stairs', branch: 'power', kind: 'plan', requires: ['l_conveyor'], icon: 'platform', pos: [4, 1],
    unlocks: { building: ['platform', 'stairs'] },
    levels: [lvl(2, 'Unlocks Platforms and Stairs: build a second floor.', set('global.platforms', 1))] },
  { id: 'f_expansion', name: 'Warehouse Expansion I', branch: 'power', kind: 'feature', requires: ['f_platform'], icon: 'expand', pos: [4, 2],
    levels: [lvl(3, 'Knock down the north wall: +900 m² of factory floor.', set('global.warehouseExpansion', 1))] },
];

export const TECH_BY_ID: Record<string, TechNode> = Object.fromEntries(TECH_NODES.map((n) => [n.id, n]));
