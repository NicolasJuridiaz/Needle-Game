import { WORLD } from './world';
import { HAND_LEVEL_PICKUP } from './stamina';
import type { BranchId, BuildingType, Effect, ToolId } from '../sim/types';

/**
 * WORK TREE — unlocked with Work Points (WP), and for tech levels also with Money.
 * Rule: unlocking plans != owning the object. Plans make the object purchasable (Money) in the shop.
 *
 * LEVEL SYSTEM (RC2): every tool and machine family is ONE technology node with levels Lv.1 -> Lv.5.
 * - Lv.1 = the plans (or, for Hands / Hay Sell Value, the starting level: `levelBase: 1`).
 * - Lv.2..5 = upgrades, each paid with WP AND Money. They are global per technology: every existing and
 *   future unit of that family works at the technology's level (buildings read stats, never own levels).
 * Feature nodes (splitter modes, U-variants, lift, auto-feed ...) stay separate single-level unlocks.
 *
 * Requirements: `requires` gates Lv.1 (the first purchase); a level can add its own `req`. An entry is a
 * node id ("x_rake": owned at any level) or "id@N" (that technology at Lv.N or higher).
 *
 * `pos` = [col, row] inside the branch panel (row = depth). The UI draws dependency lines from `requires`.
 */
export interface TechLevel {
  /** Work Points. */
  cost: number;
  /** Money (0 = WP only). */
  money: number;
  effects: Effect[];
  /** Concise, player-facing effect text for this level. */
  desc: string;
  /** Extra requirements of this level ("id" or "id@N"). */
  req?: string[];
}

export interface TechNode {
  id: string;
  name: string;
  branch: BranchId;
  kind: 'plan' | 'upgrade' | 'feature';
  /** Requirements of the first purchase ("id" or "id@N"). */
  requires: string[];
  levels: TechLevel[];
  unlocks?: { building?: BuildingType[]; tool?: ToolId; wheelbarrow?: boolean };
  icon: string;
  pos: [number, number];
  /** Level-system technology (shown as "Lv. x / max"). */
  leveled?: boolean;
  /** 1 when the player starts at Lv.1 without buying anything (Hands, Hay Sell Value). Default 0. */
  levelBase?: 0 | 1;
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
/** WP-only level. */
const lvl = (cost: number, desc: string, ...effects: Effect[]): TechLevel => ({ cost, money: 0, desc, effects });
/** WP + Money level. */
const lvm = (cost: number, money: number, desc: string, ...effects: Effect[]): TechLevel => ({ cost, money, desc, effects });
/** Hands Lv.N: additive step on the base grab so `tool.hands.dig` equals HAND_LEVEL_PICKUP[N-1] (config/stamina.ts). */
const handStep = (level: number): Effect => up('tool.hands.dig', HAND_LEVEL_PICKUP[level - 1] - HAND_LEVEL_PICKUP[level - 2]);
/** Adds level requirements. */
const req = (l: TechLevel, ...r: string[]): TechLevel => ({ ...l, req: r });

/**
 * Hay Sell Value Lv.1 -> Lv.10: multiplier on the sale value of EVERY hay product (raw hay, bales and
 * wrapped bales keep their processing premium). Priced at ~2.5x (early) -> 4x (Lv.10) a normal upgrade
 * of the same tier: growing the whole economy competes with growing the factory.
 */
export const HAY_VALUE_MULTIPLIERS = [1, 1.1, 1.22, 1.35, 1.5, 1.68, 1.88, 2.1, 2.35, 2.65] as const;
const HAY_VALUE_WP = [1, 1, 1, 2, 2, 2, 2, 3, 3];
/** Reference price of a normal upgrade at the tier where each level is bought, and the premium over it. */
const HAY_VALUE_REF = [600, 1200, 2000, 3500, 6000, 9000, 14000, 21000, 30000];
const HAY_VALUE_PREMIUM = [2.5, 2.5, 3, 3, 3, 3.5, 3.5, 3.5, 4];

export const TECH_NODES: TechNode[] = [
  // =====================================================================================
  // A. PLAYER & TOOLS
  // =====================================================================================
  { id: 'p_hands', name: 'Hands', branch: 'player', kind: 'upgrade', requires: [], icon: 'hands', pos: [0, 0], leveled: true, levelBase: 1,
    levels: [
      lvm(1, 0, `Grab ${HAND_LEVEL_PICKUP[1]} hay per handful.`, handStep(2)),
      lvm(1, 150, `Grab ${HAND_LEVEL_PICKUP[2]} hay per handful, reach +0.6 m and a wider grab.`, handStep(3), up('tool.hands.reach', 0.6), mul('tool.hands.radius', 1.3)),
      lvm(1, 600, `Grab ${HAND_LEVEL_PICKUP[3]} hay per handful, 30% faster.`, handStep(4), mul('tool.hands.interval', 0.75)),
      lvm(2, 2000, `Big hands: ${HAND_LEVEL_PICKUP[4]} hay per handful, much wider.`, handStep(5), mul('tool.hands.radius', 1.4)),
    ] },
  { id: 'p_carry', name: 'Carry Capacity', branch: 'player', kind: 'upgrade', requires: [], icon: 'carry', pos: [2, 0],
    levels: [
      lvl(1, 'Carry +15 hay.', up('player.carry', 15)),
      lvl(2, 'Carry +30 hay.', up('player.carry', 30)),
    ] },
  { id: 'p_move', name: 'Movement Speed I', branch: 'player', kind: 'upgrade', requires: ['p_carry'], icon: 'boots', pos: [3, 1],
    levels: [lvl(1, 'Move 15% faster.', mul('player.moveSpeed', 1.15))] },
  { id: 'p_shovel', name: 'Shovel', branch: 'player', kind: 'plan', requires: ['p_hands@2'], icon: 'shovel', pos: [0, 1], leveled: true,
    unlocks: { tool: 'shovel' },
    levels: [
      lvl(1, 'Unlocks the Shovel in the Shop.'),
      lvm(1, 100, 'Wide blade: +60% hay over a wider area.', mul('tool.shovel.dig', 1.6), mul('tool.shovel.radius', 1.4)),
      lvm(1, 300, 'Quick scoop: 30% faster swings.', mul('tool.shovel.interval', 0.7)),
      lvm(1, 900, 'Steel shovel: +30% hay and +0.5 m reach.', mul('tool.shovel.dig', 1.3), up('tool.shovel.reach', 0.5)),
      lvm(2, 2500, 'Power shovel: +40% hay, wider and faster.', mul('tool.shovel.dig', 1.4), mul('tool.shovel.radius', 1.3), mul('tool.shovel.interval', 0.85)),
    ] },
  { id: 'p_bucket', name: 'Bucket', branch: 'player', kind: 'plan', requires: ['p_carry'], icon: 'bucket', pos: [2, 1], leveled: true,
    unlocks: { tool: 'bucket' },
    levels: [
      lvl(1, 'Unlocks the Bucket: big scoops and +40 carry.'),
      lvm(1, 250, 'Deeper bucket: +40% per scoop, +30 carry.', mul('tool.bucket.dig', 1.4), up('tool.bucket.carryBonus', 30)),
      lvm(1, 600, 'Quick dump: throw your load into hoppers and machines from 6 m.', set('tool.bucket.quickDump', 1)),
      lvm(1, 1500, 'Twin buckets: +60 carry, 20% faster scoops.', up('tool.bucket.carryBonus', 60), mul('tool.bucket.interval', 0.8)),
      lvm(2, 3500, 'Hauler: +50% per scoop, +100 carry, dump from 10 m.', mul('tool.bucket.dig', 1.5), up('tool.bucket.carryBonus', 100), up('tool.bucket.dumpRange', 4)),
    ] },
  { id: 'p_pitchfork', name: 'Pitchfork', branch: 'player', kind: 'plan', requires: ['p_shovel'], icon: 'pitchfork', pos: [0, 2], leveled: true,
    unlocks: { tool: 'pitchfork' },
    levels: [
      lvl(2, 'Unlocks the Pitchfork: fast, heavy stabs.'),
      lvm(1, 800, 'Wider tines: +50% hay per stab.', mul('tool.pitchfork.dig', 1.5), mul('tool.pitchfork.radius', 1.25)),
      lvm(1, 1800, 'Light fork: stabs 25% faster.', mul('tool.pitchfork.interval', 0.75)),
      lvm(1, 4000, 'Long handle: +1 m reach, wider bite.', up('tool.pitchfork.reach', 1), mul('tool.pitchfork.radius', 1.2)),
      lvm(2, 9000, 'Industrial fork: +50% hay, 15% faster.', mul('tool.pitchfork.dig', 1.5), mul('tool.pitchfork.interval', 0.85)),
    ] },
  { id: 'p_detector', name: 'Metal Detector', branch: 'player', kind: 'plan', requires: ['p_shovel'], icon: 'detector', pos: [1, 2], leveled: true,
    unlocks: { tool: 'detector' },
    levels: [
      lvl(3, 'Unlocks the Metal Detector: hunt needles by sound.'),
      lvm(1, 800, 'Range 7 -> 13 m.', up('tool.detector.range', 6)),
      lvm(1, 1800, 'Signal precision: clean signal with a distance readout.', set('tool.detector.precision', 1)),
      lvm(1, 4000, 'Deep coil: senses needles 2 m deep (was 0.8 m).', set('tool.detector.depth', 2)),
      lvm(2, 8000, 'Directional: an arrow points to the strongest signal; range 18 m, depth 2.6 m.', set('tool.detector.directional', 1), up('tool.detector.range', 5), set('tool.detector.depth', 2.6)),
    ] },
  { id: 'p_wheelbarrow', name: 'Wheelbarrow', branch: 'player', kind: 'plan', requires: ['p_bucket'], icon: 'wheelbarrow', pos: [2, 2], leveled: true,
    unlocks: { wheelbarrow: true },
    levels: [
      lvl(2, 'Unlocks the Wheelbarrow: park it, dig, push 200 hay at once.'),
      lvm(1, 900, 'Holds +200 hay.', up('wheelbarrow.capacity', 200)),
      lvm(1, 2000, 'Pneumatic wheel: almost no slowdown while pushing.', set('wheelbarrow.speedMul', 0.95)),
      lvm(1, 4500, 'Deep tub: +400 hay; collects dug hay from 9 m.', up('wheelbarrow.capacity', 400), up('wheelbarrow.collectRange', 3)),
      lvm(2, 9000, 'Hay wagon: +1,000 hay.', up('wheelbarrow.capacity', 1000)),
    ] },
  { id: 'p_vacuum', name: 'Vacuum Tool', branch: 'player', kind: 'plan', requires: ['p_pitchfork'], icon: 'vacuum', pos: [0, 3], leveled: true,
    unlocks: { tool: 'vacuum' },
    levels: [
      lvl(2, 'Unlocks the Vacuum Tool: continuous suction at range.'),
      lvm(1, 3000, 'Suction +50% hay/s.', mul('tool.vacuum.rate', 1.5)),
      lvm(1, 6000, 'Long nozzle: reach 8 m, wider cone.', up('tool.vacuum.reach', 3), mul('tool.vacuum.radius', 1.4)),
      lvm(1, 12000, 'Twin motor: suction +40%.', mul('tool.vacuum.rate', 1.4)),
      lvm(2, 22000, 'Industrial vacuum: +40% suction, 10 m reach, wider.', mul('tool.vacuum.rate', 1.4), up('tool.vacuum.reach', 2), mul('tool.vacuum.radius', 1.3)),
    ] },

  // =====================================================================================
  // B. EXTRACTION & INPUT
  // =====================================================================================
  { id: 'x_hopper', name: 'Hay Hopper', branch: 'extraction', kind: 'plan', requires: [], icon: 'hopper', pos: [0, 0], leveled: true,
    unlocks: { building: ['hopper'] },
    levels: [
      lvl(2, 'Unlocks the Hay Hopper: dump hay in, it feeds a belt.'),
      lvm(1, 800, 'Holds 1,000 hay (was 400).', set('hopper.capacity', 1000)),
      lvm(2, 2000, 'Output 40 -> 75 hay/s.', set('hopper.outputRate', 75)),
      lvm(2, 5000, 'Output 110 hay/s, holds 1,500.', set('hopper.outputRate', 110), set('hopper.capacity', 1500)),
      lvm(3, 10000, 'Second output port, holds 2,500.', set('hopper.dualOutput', 1), set('hopper.capacity', 2500)),
    ] },
  { id: 'x_rake', name: 'Piston Rake', branch: 'extraction', kind: 'plan', requires: ['f_generator'], icon: 'rake', pos: [1, 0], leveled: true,
    unlocks: { building: ['pistonRake'] },
    levels: [
      lvl(4, 'Unlocks the Piston Rake: your first automatic extractor.'),
      lvm(1, 2500, 'Faster pistons: cycles 25% faster.', mul('rake.cycleTime', 0.8)),
      lvm(2, 6000, 'Wide head: +50% width, +30% hay per cycle.', mul('rake.width', 1.5), mul('rake.push', 1.3)),
      lvm(2, 14000, 'Heavy push: +30% hay per cycle, 2 m more reach.', mul('rake.push', 1.3), up('rake.reach', 2)),
      lvm(3, 30000, 'Industrial Rake: +30% hay per cycle, 25% faster, +20% width, faster tray.', set('rake.industrial', 1), mul('rake.cycleTime', 0.8), mul('rake.push', 1.3), mul('rake.width', 1.2), mul('rake.trayOutputRate', 1.5)),
    ] },
  { id: 'x_rake_auto', name: 'Auto Output', branch: 'extraction', kind: 'feature', requires: ['x_rake'], icon: 'output', pos: [2, 1],
    levels: [lvl(1, 'Rake trays unload 3x faster, straight into belts and hoppers.', set('rake.autoOutput', 1), mul('rake.trayOutputRate', 3), mul('rake.trayCapacity', 2))] },
  { id: 'x_arm', name: 'Robotic Arm', branch: 'extraction', kind: 'plan', requires: ['x_rake', 'l_conveyor'], icon: 'arm', pos: [1, 2], leveled: true,
    unlocks: { building: ['roboticArm'] },
    levels: [
      lvl(5, 'Unlocks the Robotic Arm: grabs hay and drops it on belts.'),
      lvm(1, 4000, 'Bigger claw: 30 hay per swing (was 20).', set('arm.grab', 30)),
      lvm(2, 8000, 'Faster servos: arms move 55% faster.', mul('arm.speed', 1.25 * 1.25), mul('arm.rotSpeed', 1.15 * 1.15)),
      lvm(2, 20000, 'Long arm: reach 4.5 -> 7.5 m, swings 60% faster.', up('arm.reach', 3), mul('arm.rotSpeed', 1.6)),
      req(lvm(3, 40000, 'Advanced Robotic Arm: 40-hay claw, smart targeting, +50% throughput, new look.', set('arm.grab', 40), set('arm.smart', 1), set('arm.mk2', 1), mul('arm.throughputMul', 1.5)), 'l_conveyor@3'),
    ] },
  { id: 'x_collector', name: 'Vacuum Collector', branch: 'extraction', kind: 'plan', requires: ['x_arm@3', 'f_generator@3'], icon: 'collector', pos: [1, 3], leveled: true,
    unlocks: { building: ['vacuumCollector'] },
    levels: [
      lvl(3, 'Unlocks the Vacuum Collector: 50 hay/s industrial suction.'),
      lvm(1, 7200, 'Radius 6 -> 9 m.', up('collector.radius', 3)),
      lvm(2, 18000, 'Suction +50% hay/s.', mul('collector.rate', 1.5)),
      lvm(2, 30000, 'Output 130 hay/s, double buffer, 40% less power.', set('collector.outputRate', 130), mul('collector.buffer', 2), mul('collector.powerMul', 0.6)),
      req(lvm(3, 50000, 'Industrial Turbine: +60% suction, radius 10 m, new look.', set('collector.industrial', 1), mul('collector.rate', 1.6), up('collector.radius', 1)), 'f_generator@4'),
    ] },

  // =====================================================================================
  // C. LOGISTICS
  // =====================================================================================
  { id: 'l_conveyor', name: 'Conveyor Network', branch: 'logistics', kind: 'plan', requires: ['x_hopper'], icon: 'conveyor', pos: [1, 0], leveled: true,
    unlocks: { building: ['conveyor'] },
    levels: [
      lvl(3, 'Unlocks Conveyors: click start, click end, done. 50 hay/s.'),
      lvm(1, 1200, 'All belts +20% speed: 60 hay/s.', mul('belt.speed', 1.2)),
      lvm(2, 3200, 'All belts +25% speed: 75 hay/s.', mul('belt.speed', 1.25)),
      lvm(2, 10000, 'Items pack 25% closer: 100 hay/s.', mul('belt.spacing', 0.75)),
      lvm(3, 25000, 'High-speed belts, twice as fast: 200 hay/s.', mul('belt.speed', 2)),
    ] },
  { id: 'l_splitter', name: 'Splitter Plans', branch: 'logistics', kind: 'plan', requires: ['l_conveyor'], icon: 'splitter', pos: [0, 1],
    unlocks: { building: ['splitter'] },
    levels: [lvl(2, 'Unlocks the Splitter (Even mode).')] },
  { id: 'l_merger', name: 'Merger Plans', branch: 'logistics', kind: 'plan', requires: ['l_conveyor'], icon: 'merger', pos: [2, 1],
    unlocks: { building: ['merger'] },
    levels: [lvl(1, 'Unlocks the Merger.')] },
  { id: 'l_autoroute', name: 'Auto Route / Snap+', branch: 'logistics', kind: 'feature', requires: ['l_conveyor'], icon: 'route', pos: [3, 1],
    levels: [lvl(1, 'Belts path-find around obstacles and auto-connect ports.', set('global.autoRoute', 1))] },
  { id: 'l_alternating', name: 'Alternating Splitter', branch: 'logistics', kind: 'feature', requires: ['l_splitter'], icon: 'alternate', pos: [0, 2],
    levels: [lvl(1, 'Splitter mode: strict 1:1 alternation.')] },
  { id: 'l_usplitter', name: 'U-Splitter', branch: 'logistics', kind: 'plan', requires: ['l_splitter'], icon: 'usplitter', pos: [1, 2],
    unlocks: { building: ['uSplitter'] },
    levels: [lvl(1, 'Unlocks the compact Lane Splitter.')] },
  { id: 'l_umerger', name: 'U-Merger', branch: 'logistics', kind: 'plan', requires: ['l_merger'], icon: 'umerger', pos: [2, 2],
    unlocks: { building: ['uMerger'] },
    levels: [lvl(1, 'Unlocks the compact Lane Merger.')] },
  { id: 'l_lift', name: 'Belt Lift', branch: 'logistics', kind: 'plan', requires: ['l_conveyor@2', 'l_merger'], icon: 'lift', pos: [3, 2],
    unlocks: { building: ['beltLift', 'conveyorRamp'] },
    levels: [lvl(2, 'Unlocks Belt Lifts, Ramps and elevated belts to cross lines.')] },
  { id: 'l_priority', name: 'Priority Splitter', branch: 'logistics', kind: 'feature', requires: ['l_splitter'], icon: 'priority', pos: [0, 3],
    levels: [lvl(1, 'Splitter mode: primary output gets 2 of every 3 items.')] },
  { id: 'l_overflow', name: 'Overflow Splitter', branch: 'logistics', kind: 'feature', requires: ['l_priority'], icon: 'overflow', pos: [0, 4],
    levels: [lvl(2, 'Splitter mode: side outputs only get items when primary is blocked.')] },
  { id: 'l_smart', name: 'Smart Splitter', branch: 'logistics', kind: 'feature', requires: ['l_overflow', 'e_compressor'], icon: 'filter', pos: [1, 5],
    levels: [lvl(3, 'Splitter mode: filter an item type to the primary output.')] },

  // =====================================================================================
  // D. NEEDLE DETECTION
  // =====================================================================================
  { id: 'd_scanner', name: 'Needle Scanner', branch: 'detection', kind: 'plan', requires: ['l_splitter'], icon: 'scanner', pos: [0, 0], leveled: true,
    unlocks: { building: ['scannerMk1'] },
    levels: [
      lvl(5, 'Unlocks Scanner MK1: finds needles hidden in belt hay (60 hay/s).'),
      lvm(1, 4800, 'Batch 40 hay per cycle: 80 hay/s.', set('scanner.batch', 40)),
      lvm(2, 9600, 'Scan cycles 25% faster: 100 hay/s.', mul('scanner.cycle', 0.8)),
      lvm(2, 20000, 'Batch 50, 3x buffer, needles ejected without stopping the line: 125 hay/s.', set('scanner.batch', 50), mul('scanner.buffer', 3), mul('scanner2.buffer', 2), set('scanner.autoEject', 1)),
      req(lvm(3, 32000, 'Scanner MK2 plans (234 hay/s) and MK1 25% faster.', mul('scanner.cycle', 0.8), mul('scanner2.speedMul', 1.3)), 'l_conveyor@3'),
    ] },
  { id: 'd_dual_lane', name: 'Dual Lane Scan', branch: 'detection', kind: 'feature', requires: ['d_scanner@5'], icon: 'dual', pos: [0, 1],
    levels: [lvl(4, 'MK2 scanners open a second lane: double throughput.', set('scanner2.dualLane', 1))] },

  // =====================================================================================
  // E. PROCESSING, STORAGE & ECONOMY
  // =====================================================================================
  { id: 'e_hay_value', name: 'Hay Sell Value', branch: 'processing', kind: 'upgrade', requires: [], icon: 'money', pos: [0, 0], leveled: true, levelBase: 1,
    levels: HAY_VALUE_MULTIPLIERS.slice(1).map((m, i) => lvm(
      HAY_VALUE_WP[i], Math.round((HAY_VALUE_REF[i] * HAY_VALUE_PREMIUM[i]) / 100) * 100,
      `Every hay product sells at ×${m.toFixed(2)} (raw, bales, wrapped).`,
      set('econ.hayMul', m),
    )) },
  { id: 'e_order_reward', name: 'Order Reward I', branch: 'processing', kind: 'upgrade', requires: [], icon: 'order', pos: [3, 0],
    levels: [lvl(2, 'Orders pay 50% more money.', mul('econ.orderRewardMul', 1.5))] },
  { id: 'e_compressor', name: 'Compressor', branch: 'processing', kind: 'plan', requires: ['l_conveyor'], icon: 'compressor', pos: [0, 1], leveled: true,
    unlocks: { building: ['compressor'] },
    levels: [
      lvl(5, 'Unlocks the Compressor: 40 hay -> 1 bale ($60).'),
      lvm(1, 4800, 'Compressors work 25% faster.', mul('compressor.cycle', 0.8)),
      lvm(2, 12000, 'Batch efficiency: bales need 32 hay instead of 40.', set('compressor.hayPerBale', 32)),
      lvm(2, 22000, 'Hydraulic press: another 25% faster.', mul('compressor.cycle', 0.8)),
      lvm(3, 40000, 'Industrial Compressor: two chambers press two bales at once.', set('compressor.chambers', 2), mul('compressor.buffer', 2)),
    ] },
  { id: 'e_bale_value', name: 'Bale Value I', branch: 'processing', kind: 'upgrade', requires: ['e_compressor'], icon: 'money', pos: [1, 2],
    levels: [lvl(2, 'Bales sell for 25% more.', mul('econ.baleValue', 1.25))] },
  { id: 'e_silo', name: 'Silo', branch: 'processing', kind: 'plan', requires: ['l_splitter'], icon: 'silo', pos: [2, 1], leveled: true,
    unlocks: { building: ['silo'] },
    levels: [
      lvl(2, 'Unlocks the Silo: a 2,500 hay buffer.'),
      lvm(1, 3000, 'Silos hold 5,000.', set('silo.capacity', 5000)),
      lvm(2, 6000, 'Silos accept and unload 2x faster.', mul('silo.inputRate', 2), mul('silo.outputRate', 2)),
      lvm(2, 12000, 'Silos hold 10,000.', set('silo.capacity', 10000)),
      lvm(3, 20000, 'Mega silo: 20,000, second output port, unloads 50% faster.', set('silo.capacity', 20000), set('silo.dualOutput', 1), mul('silo.outputRate', 1.5)),
    ] },
  { id: 'e_wrapper', name: 'Bale Wrapper', branch: 'processing', kind: 'plan', requires: ['e_compressor', 'e_silo'], icon: 'wrapper', pos: [1, 3], leveled: true,
    unlocks: { building: ['wrapper'] },
    levels: [
      lvl(5, 'Unlocks the Bale Wrapper: bale -> wrapped bale ($110).'),
      lvm(1, 10000, 'Wrappers work 30% faster.', mul('wrapper.cycle', 0.77)),
      lvm(2, 18000, 'Wrappers work another 30% faster.', mul('wrapper.cycle', 0.77)),
      lvm(2, 28000, 'Tight film: wrapped bales sell for 25% more.', mul('econ.wrappedValue', 1.25)),
      req(lvm(3, 45000, 'Premium wrap: gold-striped film, wrapped bales +30% value.', set('wrapper.premium', 1), mul('econ.wrappedValue', 1.3)), 'e_compressor@3'),
    ] },

  // =====================================================================================
  // F. POWER & FACTORY
  // =====================================================================================
  { id: 'f_generator', name: 'Hay Generator', branch: 'power', kind: 'plan', requires: [], icon: 'generator', pos: [0, 0], leveled: true,
    unlocks: { building: ['hayGenerator'] },
    levels: [
      lvl(1, 'Unlocks the Hay Generator: burn hay, make 60 P.'),
      lvm(1, 1600, '90 P, firebox holds 500 hay.', mul('generator.output', 1.5), set('generator.firebox', 500)),
      lvm(2, 4000, '130 P, burns 30% less hay.', mul('generator.output', 130 / 90), mul('generator.burnRate', 0.7)),
      lvm(2, 12000, 'High-pressure boiler: 180 P, firebox 1,000.', mul('generator.output', 180 / 130), set('generator.firebox', 1000)),
      req(lvm(3, 25000, 'Industrial Generator: 290 P (burns 50% more).', set('generator.industrial', 1), mul('generator.output', 290 / 180), mul('generator.burnRate', 1.5)), 'f_pole@3'),
    ] },
  { id: 'f_pole', name: 'Power Pole', branch: 'power', kind: 'plan', requires: ['f_generator'], icon: 'pole', pos: [0, 1], leveled: true,
    unlocks: { building: ['powerPole'] },
    levels: [
      lvl(2, 'Unlocks Power Poles to carry power across the warehouse (8 m).'),
      lvm(1, 500, 'Range 8 -> 12 m.', set('pole.range', 12)),
      lvm(2, 1200, 'Each pole powers up to 12 machines (was 6).', set('pole.connections', 12)),
      lvm(2, 2500, 'Range 16 m, transmission loss 10% -> 3%.', set('pole.range', 16), set('power.loss', 0.03)),
      lvm(3, 5000, 'Range 20 m, 20 machines per pole.', set('pole.range', 20), set('pole.connections', 20)),
    ] },
  { id: 'f_autofeed', name: 'Auto Feed', branch: 'power', kind: 'feature', requires: ['f_generator'], icon: 'input', pos: [1, 1],
    levels: [lvl(2, 'Generators get a belt input port: no more hand stoking.', set('generator.autoFeed', 1))] },
  { id: 'f_build_range', name: 'Factory Build Range I', branch: 'power', kind: 'feature', requires: [], icon: 'range', pos: [3, 0],
    levels: [lvl(1, 'Place and remove buildings from 20 m away.', set('player.buildRange', 20))] },
  { id: 'f_platform', name: 'Platforms & Stairs', branch: 'power', kind: 'plan', requires: ['l_conveyor'], icon: 'platform', pos: [2, 1],
    unlocks: { building: ['platform', 'stairs'] },
    levels: [lvl(2, 'Unlocks Platforms and Stairs: build a second floor.', set('global.platforms', 1))] },
  { id: 'f_expansion', name: 'Warehouse Expansion I', branch: 'power', kind: 'feature', requires: ['f_platform'], icon: 'expand', pos: [2, 2],
    levels: [lvl(3, `Knock down the north wall: +${(WORLD.annex.maxX - WORLD.annex.minX) * (WORLD.annex.maxZ - WORLD.annex.minZ)} m² of factory floor.`, set('global.warehouseExpansion', 1))] },
];

export const TECH_BY_ID: Record<string, TechNode> = Object.fromEntries(TECH_NODES.map((n) => [n.id, n]));

/** Parses a requirement "id" / "id@N" -> [id, minimum owned level]. */
export function parseRequirement(r: string): [string, number] {
  const at = r.indexOf('@');
  if (at < 0) return [r, 1];
  const n = Number(r.slice(at + 1));
  return [r.slice(0, at), Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1];
}

/** Owned level -> displayed level (Lv.1 = plans, or the free starting level when `levelBase` is 1). */
export function displayLevel(node: TechNode, owned: number): number { return owned + (node.levelBase ?? 0); }
/** Highest displayed level of a node. */
export function maxDisplayLevel(node: TechNode): number { return node.levels.length + (node.levelBase ?? 0); }
/**
 * Minimum OWNED level that satisfies a requirement written in displayed levels: "x_arm@3" = Robotic Arm
 * Lv.3 = 3 owned levels; "p_hands@2" = Hands Lv.2 = 1 purchase.
 */
export function ownedLevelFor(node: TechNode | undefined, displayed: number): number {
  return Math.max(1, displayed - (node?.levelBase ?? 0));
}
/** Human label of a requirement: "Robotic Arm Lv.3" / "Splitter Plans". */
export function requirementLabel(r: string): string {
  const [id, lv] = parseRequirement(r);
  const n = TECH_BY_ID[id];
  const name = n?.name ?? id;
  return r.includes('@') ? `${name} Lv.${lv}` : name;
}
