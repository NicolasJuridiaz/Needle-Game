/**
 * BASE STATS — the single source of truth for every tunable number that upgrades can modify.
 * Tech nodes (config/techTree.ts) and needle buffs (config/needles.ts) apply Effects to these keys.
 * Read them at runtime through Progression.stat(key) — never hardcode these numbers elsewhere.
 *
 * Units: hay = hay units, s = seconds, m = metres, P = power units.
 */
export const BASE_STATS = {
  // ----- Player -------------------------------------------------------------
  'player.carry': 20,            // hay units the player can carry (hands)
  'player.moveSpeed': 4.6,       // m/s walking
  'player.sprintMul': 1.5,       // sprint multiplier (Shift)
  'player.buildRange': 12,       // m, max distance to place/remove buildings
  'player.interactRange': 3.2,   // m

  // ----- Tools (manual) ---------------------------------------------------------
  'tool.hands.dig': 2,           // hay per grab
  'tool.hands.interval': 0.3,    // s between grabs
  'tool.hands.reach': 2.6,       // m
  'tool.hands.radius': 0.35,     // m dig radius

  'tool.shovel.dig': 6,
  'tool.shovel.interval': 0.5,
  'tool.shovel.reach': 3.0,
  'tool.shovel.radius': 0.5,

  'tool.bucket.dig': 9,
  'tool.bucket.interval': 0.65,
  'tool.bucket.reach': 2.8,
  'tool.bucket.radius': 0.5,
  'tool.bucket.carryBonus': 40,  // passive carry bonus once the bucket is owned
  'tool.bucket.quickDump': 0,    // 1 = deposit instantly from dumpRange
  'tool.bucket.dumpRange': 6,

  'tool.pitchfork.dig': 14,
  'tool.pitchfork.interval': 0.55,
  'tool.pitchfork.reach': 3.4,
  'tool.pitchfork.radius': 0.7,

  'tool.vacuum.rate': 32,        // hay/s continuous suction
  'tool.vacuum.reach': 5,
  'tool.vacuum.radius': 0.8,

  'tool.detector.range': 7,      // m horizontal detection range
  'tool.detector.depth': 0.8,    // m below current surface it can sense
  'tool.detector.precision': 0,  // 0..1, reduces signal noise
  'tool.detector.directional': 0,// 1 = shows direction arrow + distance

  'wheelbarrow.capacity': 200,
  'wheelbarrow.speedMul': 0.72,  // movement multiplier while pushing
  'wheelbarrow.collectRange': 6, // m: dug hay overflows into a parked barrow within range

  // ----- Hopper -------------------------------------------------------------------
  'hopper.capacity': 400,
  'hopper.outputRate': 40,       // hay/s per output port
  'hopper.dualOutput': 0,

  // ----- Piston Rake --------------------------------------------------------------
  'rake.cycleTime': 2.0,         // s per push/pull cycle
  'rake.push': 30,               // hay removed per cycle (max)
  'rake.width': 1.5,             // m width of the raked strip
  'rake.reach': 7,               // m max extension into the pile
  'rake.trayCapacity': 150,
  'rake.trayOutputRate': 20,     // hay/s from tray to output port
  'rake.autoOutput': 0,          // 1 = direct feed: tray output x3, feeds any adjacent input
  'rake.industrial': 0,          // 1 = Industrial Rake visuals

  // ----- Robotic Arm --------------------------------------------------------------
  'arm.speed': 1,                // multiplier on grab/lift/release timings
  'arm.rotSpeed': 180,           // deg/s
  'arm.grab': 20,                // hay per grab
  'arm.reach': 4.5,              // m radius
  'arm.smart': 0,                // 1 = densest-cell targeting
  'arm.mk2': 0,                  // 1 = MK2 visuals
  'arm.throughputMul': 1,        // global multiplier (MK2)

  // ----- Vacuum Collector ---------------------------------------------------------
  'collector.rate': 50,          // hay/s suction
  'collector.radius': 6,
  'collector.buffer': 300,
  'collector.outputRate': 60,    // hay/s to output port
  'collector.powerMul': 1,
  'collector.industrial': 0,

  // ----- Belts --------------------------------------------------------------------
  'belt.speed': 1.667,           // tiles/s
  'belt.spacing': 0.333,         // min item spacing in tiles (1/spacing items per tile)

  // ----- Scanners -----------------------------------------------------------------
  'scanner.batch': 30,           // hay per scan cycle
  'scanner.cycle': 0.5,          // s  -> 60 hay/s
  'scanner.buffer': 60,          // hay input buffer
  'scanner.autoEject': 0,        // 1 = no stop on needle detection
  'scanner.alarmTime': 5,        // s stopped after a detection (without auto eject)
  'scanner2.batch': 60,
  'scanner2.cycle': 0.333,       // -> 180 hay/s per lane
  'scanner2.buffer': 180,
  'scanner2.dualLane': 0,        // 1 = second lane ports active
  'scanner2.speedMul': 1,

  // ----- Processing ---------------------------------------------------------------
  'compressor.hayPerBale': 40,
  'compressor.cycle': 0.667,     // s per bale -> 60 hay/s
  'compressor.chambers': 1,      // Double Chamber -> 2
  'compressor.buffer': 160,
  'wrapper.cycle': 1.0,          // s per wrapped bale
  'wrapper.buffer': 6,           // bales
  'wrapper.premium': 0,          // 1 = premium (gold) wrap visuals

  // ----- Storage ------------------------------------------------------------------
  'silo.capacity': 2500,         // hay-equivalent units (bale = econ.baleWeight)
  'silo.inputRate': 60,          // hay-eq/s
  'silo.outputRate': 40,         // hay-eq/s per output
  'silo.dualOutput': 0,

  // ----- Power --------------------------------------------------------------------
  'generator.output': 60,        // P at full fuel
  'generator.burnRate': 2,       // hay/s at full load
  'generator.firebox': 150,      // hay fuel capacity
  'generator.autoFeed': 0,       // 1 = belt input port active
  'generator.industrial': 0,
  'pole.range': 8,               // m link + supply radius
  'pole.connections': 6,         // max consumers per pole
  'power.loss': 0.1,             // fraction of generated power lost in transmission
  'power.useMul': 1,             // global consumption multiplier (needle buff)

  // ----- Economy ------------------------------------------------------------------
  'econ.hayValue': 1,            // $ per hay unit sold
  'econ.baleValue': 60,          // $ per bale
  'econ.wrappedValue': 110,      // $ per wrapped bale
  'econ.saleMul': 1,             // global sale multiplier (needle buff)
  'econ.orderRewardMul': 1,

  // ----- Global -------------------------------------------------------------------
  'global.machineSpeed': 1,      // multiplies machine processing speed (needle buff)
  'global.warehouseExpansion': 0,
  'global.platforms': 0,
  'global.autoRoute': 0,
} as const;

export type BaseStatKey = keyof typeof BASE_STATS;
