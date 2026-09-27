/**
 * ANIMATION STATE CONTRACT between simulation buildings (writers) and 3D models (readers).
 * Each Building subclass writes these fields into `building.anim` every tick; each model's
 * update() reads them. All fields are plain numbers. Missing fields must be treated as 0.
 *
 * Angles are radians in the building's LOCAL frame (0 = local forward = +X of the model),
 * positive = counter-clockwise seen from above (three.js convention around +Y).
 * Distances are metres in the local frame. Unless stated otherwise, 0..1 values are normalised.
 *
 * Every building that follows a Level-system technology also carries `tier` (1..5, written by the Sim on
 * placement and on every tech change): models show their Lv.3 upgrade kit from tier 3.
 */
export interface AnimFields {
  sellStation: { pulse: number /* 0..1, jumps to 1 on each sale then decays */ };
  hopper: { fill: number; out: number /* 0..1 output activity */ };
  pistonRake: {
    ext: number;     // 0..1 current extension (fraction of `reach`)
    reach: number;   // m: distance the rake head travels this cycle (to the hay it hits)
    width: number;   // m: rake head width (upgrades widen it)
    tray: number;    // 0..1 tray fill
    phase: number;   // 0..1 cycle phase
    industrial: number; // 0/1
  };
  roboticArm: {
    yaw: number;     // claw direction (local)
    dist: number;    // m horizontal distance from base axis to claw
    height: number;  // m claw height above the arm's floor (can be negative when reaching down into a pit? clamp >= 0)
    grip: number;    // 0 open .. 1 closed
    load: number;    // 0..1 amount of hay in the claw (0 = empty)
    mk2: number;     // 0/1
  };
  vacuumCollector: {
    spin: number;       // accumulated fan angle
    nozzleYaw: number;  // local yaw of the suction hose
    nozzleDist: number; // m horizontal distance of nozzle from centre
    suck: number;       // 0..1 intensity
    fill: number;       // 0..1 buffer
    industrial: number; // 0/1
  };
  conveyor: {
    curve: number;   // 0 straight, -1 fed from its local LEFT side (-Z), +1 fed from its local RIGHT side (+Z)
  };
  conveyorRamp: Record<string, never>;
  splitter: { mode: number /* 0 even,1 alternating,2 priority,3 overflow,4 smart */; filter: number /* 0 hay,1 bale,2 wrapped */; flash: number };
  merger: { flash: number };
  uSplitter: { flash: number };
  uMerger: { flash: number };
  beltLift: { phase: number /* 0..1 carriage position */ };
  scannerMk1: { scan: number /* 0..1 beam sweep */; active: number; alarm: number /* 0/1 */; needles: number /* count in tray */; fill: number };
  scannerMk2: { scan: number; active: number; alarm: number; needles: number; fill: number; lanes: number /* 1 or 2 */ };
  compressor: { press: number /* 0..1 ram position */; fill: number; chambers: number /* 1 or 2 */ };
  wrapper: { spin: number; wrap: number /* 0..1 progress of current bale */; premium: number; hasBale: number };
  silo: { fill: number };
  hayGenerator: { fire: number /* 0..1 flame intensity */; fuel: number /* 0..1 firebox */; load: number; industrial: number };
  powerPole: Record<string, never>;
  platform: Record<string, never>;
  stairs: Record<string, never>;
}
