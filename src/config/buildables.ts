import type { BuildCategory, BuildingType, ItemType, PortDef } from '../sim/types';

/**
 * Occupancy entry in LOCAL frame: which cells (and at which level offset) a building blocks.
 * If omitted, a building occupies every footprint cell at its base level.
 */
export interface OccupancyDef { cell: [number, number]; levelOffset: 0 | 1 }

export interface VariantDef {
  label: string;
  ports: PortDef[];
  occupancy?: OccupancyDef[];
}

export interface BuildableDef {
  id: BuildingType;
  name: string;
  category: BuildCategory;
  /** Short player-facing description (one line). */
  desc: string;
  /** Tech node that unlocks the plans. null = always available. */
  requiresNode: string | null;
  /** Money cost of the first unit. */
  cost: number;
  /** Cost multiplier per additional unit already owned (1 = flat price). */
  costGrowth: number;
  /** Footprint in LOCAL frame: w along forward (+X at rot 0), d across. */
  footprint: [number, number];
  /** Visual/collision height (m). */
  height: number;
  /** Nominal power draw (P). 0 = unpowered. */
  power: number;
  /** Ports in local frame (ignored when `variants` is set). */
  ports: PortDef[];
  variants?: Record<string, VariantDef>;
  defaultVariant?: string;
  occupancy?: OccupancyDef[];
  /** Allowed base levels. */
  levels: (0 | 1)[];
  /** On level 1, requires a platform under every footprint cell (machines). Belts/logistics don't. */
  needsPlatformOnLevel1: boolean;
  /** Can the player remove it? */
  removable: boolean;
  /** Can the player move it (pick up & place, contents kept)? */
  movable: boolean;
  /** Short throughput label for shop cards, e.g. "15 hay/s". Computed live by UI when possible. */
  throughputLabel: string;
  /** Items accepted by manual interaction (player deposits with E). */
  manualInput?: ItemType[];
  /** Player can take items from it with E. */
  manualOutput?: boolean;
  icon: string;
  /** Shop sort order. */
  order: number;
}

const HAY: ItemType[] = ['hay'];
const ANY: ItemType[] | undefined = undefined;

export const BUILDABLES: Record<BuildingType, BuildableDef> = {
  sellStation: {
    id: 'sellStation', name: 'Market Chute', category: 'factory',
    desc: 'Sells everything delivered to it. Counts towards Orders.',
    requiresNode: null, cost: 0, costGrowth: 1, footprint: [3, 4], height: 3.4, power: 0,
    ports: [
      { kind: 'in', cell: [2, 0], dir: 0, items: ANY }, { kind: 'in', cell: [2, 1], dir: 0, items: ANY },
      { kind: 'in', cell: [2, 2], dir: 0, items: ANY }, { kind: 'in', cell: [2, 3], dir: 0, items: ANY },
      { kind: 'in', cell: [1, 0], dir: 3, items: ANY }, { kind: 'in', cell: [2, 0], dir: 3, items: ANY },
      { kind: 'in', cell: [1, 3], dir: 1, items: ANY }, { kind: 'in', cell: [2, 3], dir: 1, items: ANY },
    ],
    levels: [0], needsPlatformOnLevel1: false, removable: false, movable: false,
    throughputLabel: 'Unlimited', manualInput: ['hay', 'bale', 'wrapped'], icon: 'sell', order: 0,
  },

  // ----- Extraction ---------------------------------------------------------------------------
  hopper: {
    id: 'hopper', name: 'Hay Hopper', category: 'extraction',
    desc: 'Dump hay in by hand or by belt; it feeds a conveyor.',
    requiresNode: 'x_hopper', cost: 700, costGrowth: 1.12, footprint: [2, 2], height: 2.2, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY }, { kind: 'in', cell: [0, 1], dir: 2, items: ANY },
      { kind: 'in', cell: [0, 0], dir: 3, items: ANY }, { kind: 'in', cell: [1, 0], dir: 3, items: ANY },
      { kind: 'in', cell: [0, 1], dir: 1, items: ANY }, { kind: 'in', cell: [1, 1], dir: 1, items: ANY },
      { kind: 'out', cell: [1, 0], dir: 0, items: ANY, label: 'Output' },
      { kind: 'out', cell: [1, 1], dir: 0, items: ANY, label: 'Output B', requiresNode: 'x_hopper_dual' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '40 hay/s out', manualInput: ['hay', 'bale', 'wrapped'], manualOutput: true, icon: 'hopper', order: 10,
  },
  pistonRake: {
    id: 'pistonRake', name: 'Piston Rake', category: 'extraction',
    desc: 'Place facing the haystack. Rakes hay into its tray.',
    requiresNode: 'x_rake', cost: 3000, costGrowth: 1.15, footprint: [2, 3], height: 2.4, power: 10,
    ports: [{ kind: 'out', cell: [0, 1], dir: 2, items: HAY, label: 'Tray chute' }],
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: '15 hay/s', manualOutput: true, icon: 'rake', order: 11,
  },
  roboticArm: {
    id: 'roboticArm', name: 'Robotic Arm', category: 'extraction',
    desc: 'Grabs hay within reach and drops it in front (belt, hopper or floor).',
    requiresNode: 'x_arm', cost: 9000, costGrowth: 1.16, footprint: [1, 1], height: 3.0, power: 15,
    ports: [{ kind: 'out', cell: [0, 0], dir: 0, items: HAY, label: 'Drop point' }],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '10 hay/s', icon: 'arm', order: 12,
  },
  vacuumCollector: {
    id: 'vacuumCollector', name: 'Vacuum Collector', category: 'extraction',
    desc: 'Industrial suction: devours hay in a wide radius. Power hungry.',
    requiresNode: 'x_collector', cost: 22000, costGrowth: 1.2, footprint: [3, 3], height: 3.6, power: 50,
    ports: [{ kind: 'out', cell: [0, 1], dir: 2, items: HAY, label: 'Output' }],
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: '50 hay/s', manualOutput: true, icon: 'collector', order: 13,
  },

  // ----- Logistics --------------------------------------------------------------------------
  conveyor: {
    id: 'conveyor', name: 'Conveyor', category: 'logistics',
    desc: 'Moves items. Curves are automatic.',
    requiresNode: 'l_conveyor', cost: 12, costGrowth: 1, footprint: [1, 1], height: 0.6, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY },
      { kind: 'out', cell: [0, 0], dir: 0, items: ANY },
    ],
    levels: [0, 1], needsPlatformOnLevel1: false, removable: true, movable: false,
    throughputLabel: '50 hay/s', icon: 'conveyor', order: 20,
  },
  conveyorRamp: {
    id: 'conveyorRamp', name: 'Conveyor Ramp', category: 'logistics',
    desc: 'Carries items between floor level and elevated level.',
    requiresNode: 'l_lift', cost: 60, costGrowth: 1, footprint: [3, 1], height: 3.0, power: 0,
    ports: [],
    variants: {
      up: {
        label: 'Up',
        ports: [
          { kind: 'in', cell: [0, 0], dir: 2, items: ANY, levelOffset: 0 },
          { kind: 'out', cell: [2, 0], dir: 0, items: ANY, levelOffset: 1 },
        ],
        occupancy: [
          { cell: [0, 0], levelOffset: 0 }, { cell: [1, 0], levelOffset: 0 }, { cell: [2, 0], levelOffset: 0 },
          { cell: [2, 0], levelOffset: 1 },
        ],
      },
      down: {
        label: 'Down',
        ports: [
          { kind: 'in', cell: [0, 0], dir: 2, items: ANY, levelOffset: 1 },
          { kind: 'out', cell: [2, 0], dir: 0, items: ANY, levelOffset: 0 },
        ],
        occupancy: [
          { cell: [0, 0], levelOffset: 0 }, { cell: [1, 0], levelOffset: 0 }, { cell: [2, 0], levelOffset: 0 },
          { cell: [0, 0], levelOffset: 1 },
        ],
      },
    },
    defaultVariant: 'up',
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: false,
    throughputLabel: 'Belt speed', icon: 'ramp', order: 26,
  },
  splitter: {
    id: 'splitter', name: 'Splitter', category: 'logistics',
    desc: '1 input, up to 3 outputs. Interact to change mode.',
    requiresNode: 'l_splitter', cost: 150, costGrowth: 1, footprint: [1, 1], height: 0.9, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY },
      { kind: 'out', cell: [0, 0], dir: 0, items: ANY, label: 'Primary' },
      { kind: 'out', cell: [0, 0], dir: 3, items: ANY, label: 'Left' },
      { kind: 'out', cell: [0, 0], dir: 1, items: ANY, label: 'Right' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: 'Belt speed', icon: 'splitter', order: 21,
  },
  merger: {
    id: 'merger', name: 'Merger', category: 'logistics',
    desc: 'Up to 3 inputs merged into 1 output, fairly.',
    requiresNode: 'l_merger', cost: 150, costGrowth: 1, footprint: [1, 1], height: 0.9, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY },
      { kind: 'in', cell: [0, 0], dir: 3, items: ANY },
      { kind: 'in', cell: [0, 0], dir: 1, items: ANY },
      { kind: 'out', cell: [0, 0], dir: 0, items: ANY },
    ],
    levels: [0, 1], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: 'Belt speed', icon: 'merger', order: 22,
  },
  uSplitter: {
    id: 'uSplitter', name: 'Lane Splitter (U)', category: 'logistics',
    desc: 'Compact: splits one lane into two parallel lanes.',
    requiresNode: 'l_usplitter', cost: 220, costGrowth: 1, footprint: [1, 2], height: 0.9, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY },
      { kind: 'out', cell: [0, 0], dir: 0, items: ANY, label: 'Lane A' },
      { kind: 'out', cell: [0, 1], dir: 0, items: ANY, label: 'Lane B' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: 'Belt speed', icon: 'usplitter', order: 23,
  },
  uMerger: {
    id: 'uMerger', name: 'Lane Merger (U)', category: 'logistics',
    desc: 'Compact: merges two parallel lanes into one.',
    requiresNode: 'l_umerger', cost: 220, costGrowth: 1, footprint: [1, 2], height: 0.9, power: 0,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ANY },
      { kind: 'in', cell: [0, 1], dir: 2, items: ANY },
      { kind: 'out', cell: [0, 0], dir: 0, items: ANY },
    ],
    levels: [0, 1], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: 'Belt speed', icon: 'umerger', order: 24,
  },
  beltLift: {
    id: 'beltLift', name: 'Belt Lift', category: 'logistics',
    desc: 'Vertical lift: moves items up or down one level.',
    requiresNode: 'l_lift', cost: 400, costGrowth: 1, footprint: [1, 1], height: 3.4, power: 0,
    ports: [],
    variants: {
      up: {
        label: 'Up',
        ports: [
          { kind: 'in', cell: [0, 0], dir: 2, items: ANY, levelOffset: 0 },
          { kind: 'out', cell: [0, 0], dir: 0, items: ANY, levelOffset: 1 },
        ],
        occupancy: [{ cell: [0, 0], levelOffset: 0 }, { cell: [0, 0], levelOffset: 1 }],
      },
      down: {
        label: 'Down',
        ports: [
          { kind: 'in', cell: [0, 0], dir: 2, items: ANY, levelOffset: 1 },
          { kind: 'out', cell: [0, 0], dir: 0, items: ANY, levelOffset: 0 },
        ],
        occupancy: [{ cell: [0, 0], levelOffset: 0 }, { cell: [0, 0], levelOffset: 1 }],
      },
    },
    defaultVariant: 'up',
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: 'Belt speed', icon: 'lift', order: 25,
  },

  // ----- Detection -----------------------------------------------------------------------
  scannerMk1: {
    id: 'scannerMk1', name: 'Needle Scanner MK1', category: 'detection',
    desc: 'Inline scanner. Never misses a needle - but has limited throughput.',
    requiresNode: 'd_scanner', cost: 11000, costGrowth: 1.18, footprint: [3, 2], height: 2.6, power: 20,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: HAY, label: 'Input' },
      { kind: 'out', cell: [2, 0], dir: 0, items: HAY, label: 'Output' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '60 hay/s', manualInput: ['hay'], icon: 'scanner', order: 30,
  },
  scannerMk2: {
    id: 'scannerMk2', name: 'Needle Scanner MK2', category: 'detection',
    desc: 'High-throughput scanner with automatic needle ejection.',
    requiresNode: 'd_mk2', cost: 24000, costGrowth: 1.2, footprint: [4, 2], height: 3.2, power: 40,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: HAY, label: 'Lane A in' },
      { kind: 'out', cell: [3, 0], dir: 0, items: HAY, label: 'Lane A out' },
      { kind: 'in', cell: [0, 1], dir: 2, items: HAY, label: 'Lane B in', requiresNode: 'd_dual_lane' },
      { kind: 'out', cell: [3, 1], dir: 0, items: HAY, label: 'Lane B out', requiresNode: 'd_dual_lane' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '180 hay/s', manualInput: ['hay'], icon: 'scanner2', order: 31,
  },

  // ----- Processing -----------------------------------------------------------------------
  compressor: {
    id: 'compressor', name: 'Compressor', category: 'processing',
    desc: 'Presses raw hay into bales worth more.',
    requiresNode: 'e_compressor', cost: 13000, costGrowth: 1.18, footprint: [3, 2], height: 2.8, power: 25,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: HAY, label: 'Hay in' },
      { kind: 'in', cell: [0, 1], dir: 2, items: HAY, label: 'Hay in' },
      { kind: 'out', cell: [2, 0], dir: 0, items: ['bale'], label: 'Bales out' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '60 hay/s', manualInput: ['hay'], manualOutput: true, icon: 'compressor', order: 40,
  },
  wrapper: {
    id: 'wrapper', name: 'Bale Wrapper', category: 'processing',
    desc: 'Wraps bales in plastic. Wrapped bales sell for much more.',
    requiresNode: 'e_wrapper', cost: 20000, costGrowth: 1.18, footprint: [3, 2], height: 2.8, power: 30,
    ports: [
      { kind: 'in', cell: [0, 0], dir: 2, items: ['bale'], label: 'Bales in' },
      { kind: 'out', cell: [2, 0], dir: 0, items: ['wrapped'], label: 'Wrapped out' },
    ],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '1 bale/s', manualInput: ['bale'], manualOutput: true, icon: 'wrapper', order: 41,
  },

  // ----- Storage ------------------------------------------------------------------------
  silo: {
    id: 'silo', name: 'Silo', category: 'storage',
    desc: 'Buffer between fast and slow parts of the line. Shows its fill level.',
    requiresNode: 'e_silo', cost: 6000, costGrowth: 1.12, footprint: [3, 3], height: 7, power: 0,
    ports: [
      { kind: 'in', cell: [0, 1], dir: 2, items: ANY, label: 'Input' },
      { kind: 'in', cell: [1, 0], dir: 3, items: ANY, label: 'Input' },
      { kind: 'in', cell: [1, 2], dir: 1, items: ANY, label: 'Input' },
      { kind: 'out', cell: [2, 1], dir: 0, items: ANY, label: 'Output' },
      { kind: 'out', cell: [2, 0], dir: 0, items: ANY, label: 'Output B', requiresNode: 'e_silo_dual' },
    ],
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: '2,500 buffer', manualInput: ['hay', 'bale', 'wrapped'], manualOutput: true, icon: 'silo', order: 50,
  },

  // ----- Power ----------------------------------------------------------------------------
  hayGenerator: {
    id: 'hayGenerator', name: 'Hay Generator', category: 'power',
    desc: 'Burns hay to make power. Feed the firebox by hand (or by belt with Auto Feed).',
    requiresNode: 'f_generator', cost: 1600, costGrowth: 1.25, footprint: [3, 3], height: 3.2, power: 0,
    ports: [{ kind: 'in', cell: [0, 1], dir: 2, items: HAY, label: 'Fuel in', requiresNode: 'f_autofeed' }],
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: '60 P', manualInput: ['hay'], icon: 'generator', order: 60,
  },
  powerPole: {
    id: 'powerPole', name: 'Power Pole', category: 'power',
    desc: 'Links to nearby poles and powers machines in its radius.',
    requiresNode: 'f_pole', cost: 120, costGrowth: 1, footprint: [1, 1], height: 5, power: 0,
    ports: [],
    levels: [0, 1], needsPlatformOnLevel1: true, removable: true, movable: true,
    throughputLabel: '8 m radius', icon: 'pole', order: 61,
  },

  // ----- Factory construction -----------------------------------------------------------
  platform: {
    id: 'platform', name: 'Platform', category: 'factory',
    desc: 'Elevated floor tile. Build a second level above your lines.',
    requiresNode: 'f_platform', cost: 40, costGrowth: 1, footprint: [1, 1], height: 0.25, power: 0,
    ports: [],
    levels: [1], needsPlatformOnLevel1: false, removable: true, movable: false,
    throughputLabel: '1 m² deck', icon: 'platform', order: 70,
  },
  stairs: {
    id: 'stairs', name: 'Stairs', category: 'factory',
    desc: 'Walk up to your platforms.',
    requiresNode: 'f_platform', cost: 250, costGrowth: 1, footprint: [3, 1], height: 2.5, power: 0,
    ports: [],
    occupancy: [
      { cell: [0, 0], levelOffset: 0 }, { cell: [1, 0], levelOffset: 0 }, { cell: [2, 0], levelOffset: 0 },
      { cell: [2, 0], levelOffset: 1 },
    ],
    levels: [0], needsPlatformOnLevel1: false, removable: true, movable: true,
    throughputLabel: '', icon: 'stairs', order: 71,
  },
};

export const LOGISTICS_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'conveyor', 'conveyorRamp', 'splitter', 'merger', 'uSplitter', 'uMerger', 'beltLift',
]);
