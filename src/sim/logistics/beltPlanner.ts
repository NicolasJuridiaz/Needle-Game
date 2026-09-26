import type { Building } from '../building';
import { inGridBounds, neighbor } from '../grid';
import type { BeltPlan, BeltPlanStep } from '../interfaces';
import type { Sim } from '../sim';
import { oppositeDir, type BuildingType, type Cell, type Dir, type Level, type Rot } from '../types';

export interface BeltPlanOptions {
  /** 'auto' = A* around obstacles (needs Auto Route / Snap+), 'xFirst'/'zFirst' = L-shaped route. */
  mode: 'auto' | 'xFirst' | 'zFirst';
  /** Allow ramps/lifts to change level (needs the Belt Lift node). */
  allowLevelChange: boolean;
}

/** Max tiles in one planned belt. */
export const MAX_BELT_TILES = 60;
/** A* node expansion budget. */
const ASTAR_MAX_NODES = 1500;
/** Extra A* cost for a turn (prefers straight runs). */
const TURN_PENALTY = 0.4;

type DirOrNone = Dir | -1;

function same(a: Cell, b: Cell): boolean { return a.x === b.x && a.z === b.z && a.level === b.level; }

function dirBetween(a: { x: number; z: number }, b: { x: number; z: number }): Dir {
  if (b.x > a.x) return 0;
  if (b.z > a.z) return 1;
  if (b.x < a.x) return 2;
  return 3;
}

function at(sim: Sim, c: Cell): Building | undefined { return sim.buildingAtCell(c.x, c.z, c.level); }

/** Placement validity ignoring money (money is checked when the plan is placed). Returns a reason or null. */
function checkCell(sim: Sim, type: BuildingType, cell: Cell, rot: Rot, variant?: string): string | null {
  const chk = sim.canPlace(type, cell, rot, variant);
  if (chk.ok) return null;
  const reason = chk.reason ?? 'Blocked';
  if (reason.startsWith('Need $')) return null;
  if (reason === 'Space is occupied' && chk.badCells.length) {
    const c = chk.badCells[0];
    const b = sim.buildingAtCell(c.x, c.z, c.level);
    if (b) return `Blocked by ${b.def.name}`;
  }
  return reason;
}

/** Flow direction (into `c`) of an out-port facing cell `c`, or -1. */
function feederInto(sim: Sim, c: Cell): DirOrNone {
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    const n = neighbor(c, d);
    const b = at(sim, n);
    if (!b) continue;
    for (const p of b.ports) {
      if (p.kind === 'out' && same(p.cell, n) && p.dir === oppositeDir(d)) return oppositeDir(d);
    }
  }
  return -1;
}

/** Direction for the last tile at `e` so it points into an adjacent input port (arrival direction first). */
function snapEnd(sim: Sim, e: Cell, arrival: DirOrNone): { dir: DirOrNone; connects: boolean } {
  const accepts = (d: Dir, allowBelts: boolean): boolean => {
    const n = neighbor(e, d);
    const b = at(sim, n);
    if (!b || (!allowBelts && b.type === 'conveyor')) return false;
    return b.inputPortAt(n, oppositeDir(d)) >= 0;
  };
  if (arrival !== -1 && accepts(arrival, true)) return { dir: arrival, connects: true };
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (d === arrival || (arrival !== -1 && d === oppositeDir(arrival))) continue;
    if (accepts(d, false)) return { dir: d, connects: true };
  }
  return { dir: arrival, connects: false };
}

function lRoute(s: Cell, e: Cell, xFirst: boolean): Cell[] {
  const out: Cell[] = [{ ...s }];
  let x = s.x, z = s.z;
  const sx = Math.sign(e.x - s.x), sz = Math.sign(e.z - s.z);
  const guard = Math.abs(e.x - s.x) + Math.abs(e.z - s.z) + 1;
  if (guard > MAX_BELT_TILES * 4) return out.concat([{ ...e }]); // absurd request: fails the length check
  const goX = () => { while (x !== e.x) { x += sx; out.push({ x, z, level: s.level }); } };
  const goZ = () => { while (z !== e.z) { z += sz; out.push({ x, z, level: s.level }); } };
  if (xFirst) { goX(); goZ(); } else { goZ(); goX(); }
  return out;
}

/** A* over free cells (4-neighbour, turn penalty). Returns the cell list S..E or null. */
function aStar(sim: Sim, s: Cell, e: Cell, levels: Level[]): Cell[] | null {
  const passCache = new Map<number, boolean>();
  const key = (x: number, z: number) => (x + 4096) * 8192 + (z + 4096);
  const passable = (x: number, z: number): boolean => {
    if (x === e.x && z === e.z) return true;
    if (!inGridBounds(x, z)) return false;
    const k = key(x, z);
    let v = passCache.get(k);
    if (v === undefined) {
      v = levels.every((lv) => checkCell(sim, 'conveyor', { x, z, level: lv }, 0) === null);
      passCache.set(k, v);
    }
    return v;
  };
  interface Node { x: number; z: number; g: number; f: number; dir: DirOrNone; parent: Node | null; closed: boolean }
  const nodes = new Map<number, Node>();
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): Node => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (x: number, z: number) => Math.abs(x - e.x) + Math.abs(z - e.z);
  const start: Node = { x: s.x, z: s.z, g: 0, f: h(s.x, s.z), dir: -1, parent: null, closed: false };
  nodes.set(key(s.x, s.z), start);
  push(start);
  let expanded = 0;
  while (heap.length) {
    const cur = pop();
    if (cur.closed) continue;
    cur.closed = true;
    if (cur.x === e.x && cur.z === e.z) {
      const path: Cell[] = [];
      for (let n: Node | null = cur; n; n = n.parent) path.push({ x: n.x, z: n.z, level: s.level });
      path.reverse();
      return path;
    }
    if (++expanded > ASTAR_MAX_NODES) return null;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const nx = cur.x + (d === 0 ? 1 : d === 2 ? -1 : 0);
      const nz = cur.z + (d === 1 ? 1 : d === 3 ? -1 : 0);
      if (!passable(nx, nz)) continue;
      const g = cur.g + 1 + (cur.dir !== -1 && cur.dir !== d ? TURN_PENALTY : 0);
      if (g > MAX_BELT_TILES * 2) continue;
      const k = key(nx, nz);
      let n = nodes.get(k);
      if (n && (n.closed || n.g <= g)) continue;
      if (!n) { n = { x: nx, z: nz, g, f: g + h(nx, nz), dir: d, parent: cur, closed: false }; nodes.set(k, n); }
      else { n.g = g; n.f = g + h(nx, nz); n.dir = d; n.parent = cur; }
      push(n);
    }
  }
  return null;
}

/**
 * Plans a belt path from `start` to `end` (inclusive cells). See ARCHITECTURE §4.2:
 * - snaps to an adjacent machine output at the start (connectsStart) and points the last tile into an adjacent
 *   input at the end (connectsEnd);
 * - starting on an existing conveyor extends it (the path begins in front of it);
 * - ending on an existing conveyor joins into it (if it accepts from that side);
 * - existing conveyors on the path with the same direction are reused (`existing`);
 * - level changes insert a Belt Lift (when allowed);
 * - `ok=false` + reason when blocked; money is NOT checked here.
 */
export function planBeltPath(sim: Sim, start: Cell, end: Cell, opts: BeltPlanOptions): BeltPlan {
  const steps: BeltPlanStep[] = [];
  let connectsStart = false;
  let connectsEnd = false;
  let reason: string | undefined;
  const fail = (r: string): BeltPlan => ({ ok: false, reason: r, steps, cost: 0, connectsStart, connectsEnd });

  // ----- start
  let s: Cell = { x: start.x, z: start.z, level: start.level };
  let feedDir: DirOrNone = -1;
  const sOcc = at(sim, s);
  if (sOcc) {
    if (sOcc.type !== 'conveyor') return fail(`Blocked by ${sOcc.def.name}`);
    steps.push({ type: 'conveyor', cell: { ...sOcc.cell }, rot: sOcc.rot, existing: sOcc.id });
    if (same(sOcc.cell, end)) return fail('Drag to where the belt should go');
    feedDir = sOcc.rot as Dir;
    connectsStart = true;
    s = neighbor(sOcc.cell, sOcc.rot as Dir);
  } else {
    feedDir = feederInto(sim, s);
    connectsStart = feedDir !== -1;
  }

  // ----- end
  const e: Cell = { x: end.x, z: end.z, level: end.level };
  const eOcc = at(sim, e);
  if (eOcc && eOcc.type !== 'conveyor') return fail(`Blocked by ${eOcc.def.name}`);
  const endExisting = eOcc; // an existing belt at the end is joined

  const levelChange = s.level !== e.level;
  if (levelChange && !opts.allowLevelChange) reason = 'Different levels - unlock the Belt Lift';

  // ----- route (2D)
  let mode = opts.mode;
  if (mode === 'auto' && sim.stat('global.autoRoute') < 1) mode = 'xFirst';
  let route: Cell[];
  if (same({ ...s, level: 0 }, { ...e, level: 0 })) route = [{ ...s }];
  else if (mode === 'auto') {
    const levels: Level[] = levelChange ? [s.level, e.level] : [s.level];
    const r = aStar(sim, s, e, levels);
    if (!r) return fail('No route found');
    route = r;
  } else route = lRoute(s, e, mode === 'xFirst');
  const n = route.length;
  if (n > MAX_BELT_TILES) return fail(`Path too long (max ${MAX_BELT_TILES} tiles)`);

  const out: Dir[] = [];
  for (let i = 0; i < n - 1; i++) out.push(dirBetween(route[i], route[i + 1]));
  const arrival: DirOrNone = n >= 2 ? out[n - 2] : feedDir;

  // ----- end direction / join
  let endRot: DirOrNone = -1;
  if (endExisting) {
    if (arrival === -1) reason ??= 'Drag to where the belt should go';
    else if (endExisting.inputPortAt({ ...e }, oppositeDir(arrival)) >= 0) connectsEnd = true;
    else reason ??= arrival === oppositeDir(endExisting.rot as Dir) ? 'Belts cannot feed head-on' : 'That belt is already fed - use a Merger';
  } else {
    const snap = snapEnd(sim, e, arrival);
    endRot = snap.dir;
    connectsEnd = snap.connects;
    if (endRot === -1) endRot = 0;
  }

  // ----- level change: find a straight spot for a lift
  let liftIdx = -1;
  const liftVariant = s.level < e.level ? 'up' : 'down';
  if (levelChange && opts.allowLevelChange) {
    for (let k = 0; k < n; k++) {
      if (k === n - 1 && endExisting) continue;
      const outD: DirOrNone = k < n - 1 ? out[k] : endRot;
      let inD: DirOrNone = k > 0 ? out[k - 1] : feedDir;
      if (inD === -1) inD = outD;
      if (inD !== outD || outD === -1) continue;
      if (checkCell(sim, 'beltLift', { x: route[k].x, z: route[k].z, level: 0 }, outD as Rot, liftVariant) === null) { liftIdx = k; break; }
    }
    if (liftIdx < 0) reason ??= 'No straight spot for a Belt Lift on this path';
  }

  // ----- steps + validation
  for (let i = 0; i < n; i++) {
    const level: Level = liftIdx < 0 ? s.level : i < liftIdx ? s.level : e.level;
    const cell: Cell = { x: route[i].x, z: route[i].z, level };
    const rot = (i < n - 1 ? out[i] : endRot === -1 ? 0 : endRot) as Rot;
    if (i === liftIdx) {
      steps.push({ type: 'beltLift', cell: { x: cell.x, z: cell.z, level: 0 }, rot, variant: liftVariant });
      continue;
    }
    if (i === n - 1 && endExisting) {
      steps.push({ type: 'conveyor', cell: { ...endExisting.cell }, rot: endExisting.rot, existing: endExisting.id });
      continue;
    }
    const occ = at(sim, cell);
    if (occ) {
      if (occ.type === 'conveyor' && occ.rot === rot) { steps.push({ type: 'conveyor', cell: { ...occ.cell }, rot, existing: occ.id }); continue; }
      reason ??= `Blocked by ${occ.def.name}`;
      steps.push({ type: 'conveyor', cell, rot });
      continue;
    }
    const r = checkCell(sim, 'conveyor', cell, rot);
    if (r) reason ??= r;
    steps.push({ type: 'conveyor', cell, rot });
  }

  // ----- cost
  let newBelts = 0, newLifts = 0, cost = 0;
  const ownedBelts = sim.ownedCount('conveyor'), ownedLifts = sim.ownedCount('beltLift');
  for (const st of steps) {
    if (st.existing) continue;
    if (st.type === 'beltLift') cost += sim.progress.buildingCost('beltLift', ownedLifts + newLifts++);
    else cost += sim.progress.buildingCost(st.type, ownedBelts + newBelts++);
  }
  if (newBelts + newLifts === 0) reason ??= 'Already connected';

  return { ok: !reason, reason, steps, cost, connectsStart, connectsEnd };
}
