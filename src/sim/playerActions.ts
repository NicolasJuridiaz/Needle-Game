import { pickupStaminaCost, STAMINA } from '../config/stamina';
import { TOOLS } from '../config/tools';
import { WORLD } from '../config/world';
import type { DetectorReading, WheelbarrowState } from './interfaces';
import { Inventory } from './inventory';
import type { Sim } from './sim';
import { TOOL_ORDER, type ToolId } from './types';

/**
 * Player actions: pure sim logic (no three.js / DOM). The FPS layer calls these with raycast hit points.
 * See docs/ARCHITECTURE.md §4.4 "Player actions".
 *
 * Orientation convention (three.js, matches animState.ts): yaw 0 faces +X and positive yaw turns
 * counter-clockwise seen from above, so the forward vector is (cos yaw, -sin yaw) in (x, z).
 */
export interface DigResult {
  /** Hay units extracted by this action (carry + wheelbarrow). */
  amount: number;
  /** True when the carry (and any usable parked wheelbarrow) is full after the action, or was already full. */
  full: boolean;
  /** Id of the first needle found by this action, -1 if none. */
  needleFound: number;
  /** Hay units that went into the parked wheelbarrow. */
  toBarrow: number;
  /** True when the action was refused because the player has not enough stamina. */
  tired?: boolean;
}

/** Distance (m) in front of the player where a newly bought wheelbarrow appears. */
const WHEELBARROW_SPAWN_DISTANCE = 1.5;
/** Max horizontal distance (m) between player and wheelbarrow to grab or release it. */
const WHEELBARROW_GRAB_RANGE = 2.5;
/** Keeps a spawned wheelbarrow this far (m) from the walls. */
const WHEELBARROW_WALL_MARGIN = 0.75;
/** Minimum time (s) between two `player:full` events. */
const FULL_EVENT_INTERVAL = 1;
/**
 * The carry counts as full within this many hay units: digging works on float32 hay heights, so a scoop sized
 * to the free room lands ~1e-5 short of it and a smaller scoop removes nothing (the player would never be told).
 */
const FULL_EPS = 1e-3;

interface DigStatKeys { dig: string; interval: string; radius: string }

/** Stat keys of the hand-held digging tools (tools whose kind is 'dig'). */
const DIG_KEYS = new Map<ToolId, DigStatKeys>(
  TOOL_ORDER.filter((id) => TOOLS[id].kind === 'dig')
    .map((id) => [id, { dig: `tool.${id}.dig`, interval: `tool.${id}.interval`, radius: `tool.${id}.radius` }]),
);

/** Sim time of the last `player:full` event, per simulation. */
const lastFullEventAt = new WeakMap<Sim, number>();
/** Sim time of the last `player:tired` event, per simulation. */
const lastTiredEventAt = new WeakMap<Sim, number>();

function notifyTired(sim: Sim): DigResult {
  const last = lastTiredEventAt.get(sim);
  if (last === undefined || sim.time - last >= FULL_EVENT_INTERVAL || sim.time < last) {
    lastTiredEventAt.set(sim, sim.time);
    sim.events.emit('player:tired', {});
  }
  return { ...noResult(), tired: true };
}

const noResult = (): DigResult => ({ amount: 0, full: false, needleFound: -1, toBarrow: 0 });

const noReading = (): DetectorReading => ({ strength: 0, distance: 0, dirX: 0, dirZ: 0, tooDeep: false, needleId: -1 });

function notifyFull(sim: Sim): void {
  const last = lastFullEventAt.get(sim);
  if (last !== undefined && sim.time - last < FULL_EVENT_INTERVAL && sim.time >= last) return;
  lastFullEventAt.set(sim, sim.time);
  sim.events.emit('player:full', {});
}

/** The parked (not held) wheelbarrow if it is within collect range of the player, else null. */
function overflowBarrow(sim: Sim): WheelbarrowState | null {
  const b = sim.player.wheelbarrow;
  if (!b || b.held) return null;
  const range = sim.stat('wheelbarrow.collectRange');
  const dx = b.pos.x - sim.player.pos.x;
  const dz = b.pos.z - sim.player.pos.z;
  return dx * dx + dz * dz <= range * range ? b : null;
}

/**
 * Shared extraction: fills the carry first, overflowing into a parked wheelbarrow in range.
 * Needles in the removed hay are found immediately (the player sees them).
 */
function extractToPlayer(
  sim: Sim, tool: ToolId, x: number, z: number, radius: number, maxUnits: number, source: 'manual' | 'vacuumTool',
  /** Stamina price: 'grab' = pickupStaminaCost(units) paid per action; a number = drain per second over `dt`. */
  effort: { grab: true } | { perSecond: number; dt: number },
): DigResult {
  const player = sim.player;
  const carryFree = Math.max(0, carryCapacity(sim) - player.carry.weight());
  const barrow = overflowBarrow(sim);
  const barrowFree = barrow ? Math.max(0, sim.stat('wheelbarrow.capacity') - barrow.inv.weight()) : 0;
  const room = carryFree + barrowFree;
  if (room <= FULL_EPS) {
    notifyFull(sim);
    return { amount: 0, full: true, needleFound: -1, toBarrow: 0 };
  }
  if (!(maxUnits > 0)) return noResult();

  // Physical effort: a grab needs the stamina for the hay it would take; suction needs some stamina left.
  const stamina = player.stamina;
  const want = Math.min(maxUnits, room);
  if ('grab' in effort) {
    if (stamina.value + 1e-9 < pickupStaminaCost(want)) return notifyTired(sim);
  } else if (stamina.value <= 0) return notifyTired(sim);

  const ex = sim.hay.extractRadius(x, z, radius, want);
  if (ex.units <= 0 && ex.needles.length === 0) return noResult();

  const units = Math.max(0, ex.units);
  // Pay for what was really taken (a thin spot costs less than a full grab).
  if ('grab' in effort) stamina.trySpend(Math.min(stamina.value, pickupStaminaCost(units)));
  else stamina.drain(effort.perSecond, effort.dt);
  const toCarry = Math.min(units, carryFree);
  const toBarrow = barrow ? units - toCarry : 0;
  if (toCarry > 0) player.carry.add('hay', toCarry);
  if (barrow && toBarrow > 0) barrow.inv.add('hay', toBarrow);

  let needleFound = -1;
  for (const id of ex.needles) {
    sim.foundNeedle(id, 'manual', ex.pos);
    if (needleFound < 0) needleFound = id;
  }

  sim.creditExtraction(units, source, ex.pos);
  const full = room - units <= FULL_EPS;
  sim.events.emit('player:dig', { tool, amount: units, pos: { x: ex.pos.x, y: ex.pos.y, z: ex.pos.z }, full });
  return { amount: units, full, needleFound, toBarrow };
}

/**
 * One tool action (hands/shovel/bucket/pitchfork) at the aimed hay point. Respects the tool cooldown,
 * the carry capacity and wheelbarrow overflow. The vacuum uses playerVacuum; the detector never digs.
 */
export function playerDig(sim: Sim, tool: ToolId, x: number, _y: number, z: number): DigResult {
  const keys = DIG_KEYS.get(tool);
  if (!keys || !sim.progress.ownedTools.has(tool) || sim.player.cooldown > 0) return noResult();
  const result = extractToPlayer(sim, tool, x, z, sim.stat(keys.radius), sim.stat(keys.dig), 'manual', { grab: true });
  if (!result.tired && (!result.full || result.amount > 0)) sim.player.cooldown = sim.stat(keys.interval);
  return result;
}

/** Continuous vacuum tool suction for dt seconds at the aimed point. */
export function playerVacuum(sim: Sim, dt: number, x: number, _y: number, z: number): DigResult {
  if (!sim.progress.ownedTools.has('vacuum') || !(dt > 0)) return noResult();
  return extractToPlayer(sim, 'vacuum', x, z, sim.stat('tool.vacuum.radius'), sim.stat('tool.vacuum.rate') * dt, 'vacuumTool',
    { perSecond: STAMINA.vacuumPerSecond, dt });
}

/** Metal detector reading at the player's position (zero signal if the detector is not owned). */
export function detectorReading(sim: Sim): DetectorReading {
  if (!sim.progress.ownedTools.has('detector')) return noReading();
  const precision = Math.min(1, Math.max(0, sim.stat('tool.detector.precision')));
  const p = sim.player.pos;
  return sim.hay.detectorReading(p.x, p.z, sim.stat('tool.detector.range'), sim.stat('tool.detector.depth'), 1 - precision);
}

/** Pick up an exposed needle lying on the hay surface within interact range. */
export function pickupNeedle(sim: Sim, needleId: number): boolean {
  const needle = sim.hay.needles.find((n) => n.id === needleId);
  if (!needle || needle.status !== 'exposed') return false;
  const range = sim.stat('player.interactRange');
  const p = sim.player.pos;
  const dx = needle.pos.x - p.x;
  const dz = needle.pos.z - p.z;
  if (dx * dx + dz * dz > range * range || Math.abs(needle.pos.y - p.y) > range) return false;
  const by = sim.player.equipped === 'detector' && sim.progress.ownedTools.has('detector') ? 'detector' : 'manual';
  sim.foundNeedle(needleId, by, { x: needle.pos.x, y: needle.pos.y, z: needle.pos.z });
  return true;
}

/**
 * Grab / release the wheelbarrow (must be within grab range). While held, the game layer positions it
 * in front of the player every frame and applies `wheelbarrow.speedMul`. Released barrows rest on the surface.
 */
export function toggleWheelbarrow(sim: Sim): boolean {
  const b = sim.player.wheelbarrow;
  if (!b) return false;
  const dx = b.pos.x - sim.player.pos.x;
  const dz = b.pos.z - sim.player.pos.z;
  if (dx * dx + dz * dz > WHEELBARROW_GRAB_RANGE * WHEELBARROW_GRAB_RANGE) return false;
  b.held = !b.held;
  if (!b.held) b.pos.y = sim.hay.heightAt(b.pos.x, b.pos.z);
  return true;
}

/**
 * Place the bought wheelbarrow in front of the player, on the floor / hay surface, kept inside the
 * usable warehouse floor. No-op if it is not owned or already exists.
 */
export function spawnWheelbarrow(sim: Sim): void {
  const player = sim.player;
  if (!sim.progress.hasWheelbarrow || player.wheelbarrow) return;
  const I = WORLD.interior;
  const maxZ = sim.stat('global.warehouseExpansion') >= 1 ? WORLD.annex.maxZ : I.maxZ;
  const m = WHEELBARROW_WALL_MARGIN;
  const x = Math.min(I.maxX - m, Math.max(I.minX + m, player.pos.x + Math.cos(player.yaw) * WHEELBARROW_SPAWN_DISTANCE));
  const z = Math.min(maxZ - m, Math.max(I.minZ + m, player.pos.z - Math.sin(player.yaw) * WHEELBARROW_SPAWN_DISTANCE));
  player.wheelbarrow = { pos: { x, y: sim.hay.heightAt(x, z), z }, yaw: player.yaw, held: false, inv: new Inventory() };
}

/** Player carry capacity right now (stats + bucket bonus once the bucket is owned). */
export function carryCapacity(sim: Sim): number {
  const bonus = sim.progress.ownedTools.has('bucket') ? sim.stat('tool.bucket.carryBonus') : 0;
  return sim.stat('player.carry') + bonus;
}

/** Point on the floor next to the Market intake belt where the player stands to drop hay (bot, hints). */
export function intakeDropPoint(): { x: number; z: number } {
  const i = WORLD.intake;
  return { x: i.dropPadX1 + 0.8, z: (i.z0 + i.z1) / 2 }; // 0.8 m in front of the drop pad, like the old chute stop
}

/**
 * Drops everything the player carries (carry + held wheelbarrow) on the Market intake belt; the chute sells it when
 * it arrives. The only way to sell carried items. Returns false when there was nothing to drop.
 */
export function depositToIntake(sim: Sim): boolean {
  // Structural access (no import of the machine class: playerTransfer already imports this module).
  const chute = sim.sellStation as unknown as { depositIntake?: (ctx: Sim) => number } | undefined;
  return !!chute?.depositIntake && chute.depositIntake(sim) > 0;
}
