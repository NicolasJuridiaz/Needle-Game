/**
 * Shared simulation types. This file is the contract between all modules.
 * The simulation layer (src/sim, src/config, src/core) MUST NOT import three.js or touch the DOM,
 * so it can run headless in Node for balance simulations and unit tests.
 */

// ---------------------------------------------------------------------------
// Geometry / grid
// ---------------------------------------------------------------------------

/** Cardinal direction on the build grid. 0=+X (east), 1=+Z (south), 2=-X (west), 3=-Z (north). */
export type Dir = 0 | 1 | 2 | 3;
/** Rotation in quarter turns (clockwise when seen from above, matching Dir order). */
export type Rot = 0 | 1 | 2 | 3;
/** Build level. 0 = ground floor, 1 = elevated (platforms / elevated belts). */
export type Level = 0 | 1;

export interface Vec3 { x: number; y: number; z: number }
export interface Vec2 { x: number; z: number }

/** Integer build-grid cell (1 m cells) at a level. */
export interface Cell { x: number; z: number; level: Level }

export const DIR_DX: readonly number[] = [1, 0, -1, 0];
export const DIR_DZ: readonly number[] = [0, 1, 0, -1];
export const oppositeDir = (d: Dir): Dir => (((d + 2) & 3) as Dir);
export const rotateDir = (d: Dir, r: Rot): Dir => (((d + r) & 3) as Dir);

// ---------------------------------------------------------------------------
// Items / resources
// ---------------------------------------------------------------------------

export type ItemType = 'hay' | 'bale' | 'wrapped';
export const ITEM_TYPES: readonly ItemType[] = ['hay', 'bale', 'wrapped'];

/**
 * A discrete packet moving through the factory (belts, machine ports).
 * - hay: amount = hay units (usually config.balance.hayPacketSize, e.g. 10)
 * - bale / wrapped: amount = 1
 * A raw hay packet may secretly contain a needle (needleId) until it is scanned.
 */
export interface ItemPacket {
  type: ItemType;
  amount: number;
  /** Hidden needle carried inside this hay packet (unscanned). */
  needleId?: number;
  /** True once the packet passed a scanner. */
  scanned?: boolean;
}

/** Aggregate item counts. Hay counted in units, bales/wrapped in items. */
export type ItemCounts = Record<ItemType, number>;

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export type BuildingType =
  | 'sellStation'
  | 'hopper'
  | 'pistonRake'
  | 'roboticArm'
  | 'vacuumCollector'
  | 'conveyor'
  | 'conveyorRamp'
  | 'splitter'
  | 'merger'
  | 'uSplitter'
  | 'uMerger'
  | 'beltLift'
  | 'scannerMk1'
  | 'scannerMk2'
  | 'compressor'
  | 'wrapper'
  | 'silo'
  | 'hayGenerator'
  | 'powerPole'
  | 'platform'
  | 'stairs';

export type BuildCategory = 'extraction' | 'logistics' | 'detection' | 'processing' | 'storage' | 'power' | 'factory' | 'tools';

export type PortKind = 'in' | 'out';

/** Port definition in a building's LOCAL frame (rotation 0, forward = +X). */
export interface PortDef {
  kind: PortKind;
  /** Local cell offset inside the footprint (0..w-1, 0..d-1). */
  cell: [number, number];
  /** Local direction the port faces (outwards from the building). */
  dir: Dir;
  /** Accepted (in) or produced (out) item types. Undefined = any. */
  items?: ItemType[];
  /** Level offset relative to the building's base level (belt lift top port = 1). */
  levelOffset?: 0 | 1;
  /** Optional: port only exists when a tech node is unlocked (e.g. hopper dual output). */
  requiresNode?: string;
  /** Human label for tooltips. */
  label?: string;
}

/** A port resolved to world grid coordinates. */
export interface WorldPort {
  index: number;
  kind: PortKind;
  cell: Cell;
  dir: Dir;
  items?: ItemType[];
  label?: string;
}

/**
 * Machine status shown to the player (tooltip, status lamp, world icon).
 * The player must always understand WHY something does not work.
 */
export type MachineStatus =
  | 'running'       // working normally
  | 'processing'    // mid-cycle on a batch (working)
  | 'idle'          // nothing to do but fine (e.g. storage)
  | 'noInput'       // starved: waiting for items
  | 'noHay'         // extractor: no hay in reach
  | 'outputBlocked' // output port blocked / not connected and internal buffer full
  | 'full'          // storage full
  | 'noPower'       // not connected to a powered network
  | 'lowPower'      // network overloaded -> running slower
  | 'noFuel'        // generator without fuel
  | 'disabled'      // switched off by the player
  | 'needleAlarm';  // scanner stopped because it found a needle

export type ToolId = 'hands' | 'shovel' | 'bucket' | 'pitchfork' | 'vacuum' | 'detector';
export const TOOL_ORDER: readonly ToolId[] = ['hands', 'shovel', 'bucket', 'pitchfork', 'vacuum', 'detector'];

export type BranchId = 'player' | 'extraction' | 'logistics' | 'detection' | 'processing' | 'power';

/** Splitter behaviour modes (cycled on a placed splitter with the interact key). */
export type SplitterMode = 'even' | 'alternating' | 'priority' | 'overflow' | 'smart';

// ---------------------------------------------------------------------------
// Stats / modifiers
// ---------------------------------------------------------------------------

/**
 * Every tunable gameplay stat has a string key (see config/stats.ts BASE_STATS).
 * Tech nodes and needle buffs modify stats with effects.
 */
export type StatKey = string;

export interface Effect {
  stat: StatKey;
  /** add: base + v ; mul: x * v ; set: = v (booleans as 0/1) */
  op: 'add' | 'mul' | 'set';
  value: number;
}

// ---------------------------------------------------------------------------
// Needles
// ---------------------------------------------------------------------------

export type NeedleStatus = 'buried' | 'exposed' | 'inTransit' | 'found';

export interface NeedleState {
  id: number;
  /** Depth/progress band [from, to] (0..1) used for placement. */
  band: [number, number];
  /** Current world position (x,z = column centre, y = height). Valid when buried/exposed. */
  pos: Vec3;
  status: NeedleStatus;
  foundAt?: number;           // play time (s)
  foundBy?: 'manual' | 'scanner' | 'detector';
  /** Times it slipped through unscanned and was thrown back on the pile. */
  returns: number;
}
