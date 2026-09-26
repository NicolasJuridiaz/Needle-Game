/**
 * Shared helpers for the robustness audits (economy / softlock / save fuzz / completion).
 * Everything drives the REAL Sim through its public API; test-only shortcuts (granted WP/money,
 * packet injection into an input port) are named explicitly.
 */
import { expect } from 'vitest';
import { BALANCE } from '../../src/config/balance';
import { TECH_NODES } from '../../src/config/techTree';
import type { Building } from '../../src/sim/building';
import { neighbor, resolvePorts } from '../../src/sim/grid';
import { LogisticsBuilding } from '../../src/sim/logistics/base';
import type { Sim } from '../../src/sim/sim';
import {
  oppositeDir, type BuildingType, type Cell, type ItemPacket, type ItemType, type Level, type Rot, type WorldPort,
} from '../../src/sim/types';

export const DT = BALANCE.tickDt;

/** Advance `seconds` of sim time in fixed steps; `each` runs after every tick. */
export function run(sim: Sim, seconds: number, each?: (sim: Sim) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { sim.tick(DT); each?.(sim); }
}

/** Unlock every level of the given nodes (and their prerequisites) with granted WP. */
export function unlock(sim: Sim, ids: string[]): void {
  sim.progress.addWP(100_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const want = new Set<string>();
  const add = (id: string): void => {
    if (want.has(id)) return;
    const node = byId.get(id);
    expect(node, `tech node ${id}`).toBeDefined();
    want.add(id);
    for (const r of node!.requires) add(r);
  };
  ids.forEach(add);
  for (let pass = 0; pass < 20; pass++) for (const id of want) while (sim.progress.canUnlock(id).ok) sim.progress.unlock(id);
  for (const id of ids) expect(sim.progress.isUnlocked(id), `unlock ${id}`).toBe(true);
  sim.rebuildTopology();
}

/** Unlock the FIRST level of the given nodes (and prerequisites) - keeps upgrade stats at base. */
export function unlockFirst(sim: Sim, ids: string[]): void {
  sim.progress.addWP(100_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const done = new Set<string>();
  const go = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    for (const r of byId.get(id)!.requires) go(r);
    if (!sim.progress.isUnlocked(id)) expect(sim.progress.unlock(id), `unlock ${id}`).toBe(true);
  };
  ids.forEach(go);
  sim.rebuildTopology();
}

export function rich(sim: Sim, amount = 50_000_000): void { sim.progress.addMoney(amount, 'milestone'); }

/** Keeps the player out of every placement footprint (far corner, hay-free floor). */
export function parkPlayer(sim: Sim): void { sim.player.pos = { x: 30, y: 0, z: 20 }; }

export function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot = 0, variant?: string, level: Level = 0): Building {
  const cell: Cell = { x, z, level };
  const chk = sim.canPlace(type, cell, rot, variant);
  expect(chk.ok, `place ${type} at ${x},${z},${level} rot ${rot}: ${chk.reason}`).toBe(true);
  const b = sim.place(type, cell, rot, variant);
  expect(b).not.toBeNull();
  return b!;
}

export function outPorts(b: Building): WorldPort[] { return b.ports.filter((p) => p.kind === 'out'); }
export function inPorts(b: Building): WorldPort[] { return b.ports.filter((p) => p.kind === 'in'); }

/**
 * Place `type` so that one of its input ports receives from `from` (an out port). Searches rotations and
 * offsets around the target cell; `prefRot` is tried first. Returns the building.
 */
export function placeFedBy(sim: Sim, type: BuildingType, from: WorldPort, prefRot?: Rot, variant?: string): Building {
  const target = neighbor(from.cell, from.dir);
  const face = oppositeDir(from.dir);
  const rots: Rot[] = prefRot === undefined ? [0, 1, 2, 3] : [prefRot, ...([0, 1, 2, 3] as Rot[]).filter((r) => r !== prefRot)];
  for (const rot of rots) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        for (const base of [0, 1] as Level[]) {
          const cell: Cell = { x: target.x + dx, z: target.z + dz, level: base };
          const ports = resolvePorts(type, cell, rot, variant, (n) => sim.progress.isUnlocked(n));
          const ok = ports.some((p) => p.kind === 'in' && p.dir === face && p.cell.x === target.x && p.cell.z === target.z && p.cell.level === target.level);
          if (!ok || !sim.canPlace(type, cell, rot, variant).ok) continue;
          return place(sim, type, cell.x, cell.z, rot, variant, base);
        }
      }
    }
  }
  throw new Error(`no placement for ${type} fed from ${JSON.stringify(from)}`);
}

/** Conveyor tiles from `start` (inclusive) going `n` cells in direction `rot`, each flowing `rot`. Returns the last tile. */
export function beltRun(sim: Sim, start: Cell, rot: Rot, n: number): Building {
  let c = { ...start };
  let last: Building | null = null;
  for (let i = 0; i < n; i++) {
    last = place(sim, 'conveyor', c.x, c.z, rot, undefined, c.level);
    c = neighbor(c, rot);
  }
  return last!;
}

/** Pushes packets straight into an input port (test source). Returns how many were accepted. */
export function feed(sim: Sim, b: Building, port: number, item: ItemPacket, count = 1): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (b.canAccept(item, port, sim)) { b.accept({ ...item }, port, sim); n++; }
  return n;
}

/** Items of each type currently on logistics buildings (belts, junctions, lifts, ramps). */
export function logisticsContents(sim: Sim): Record<ItemType, number> {
  const out: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
  for (const b of sim.buildings.values()) {
    if (!(b instanceof LogisticsBuilding)) continue;
    const inv = b.contents();
    out.hay += inv.hay; out.bale += inv.bale; out.wrapped += inv.wrapped;
  }
  return out;
}

/** Items of each type inside every building (machines + logistics). */
export function allContents(sim: Sim): Record<ItemType, number> {
  const out: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
  for (const b of sim.buildings.values()) {
    const inv = b.contents();
    out.hay += inv.hay; out.bale += inv.bale; out.wrapped += inv.wrapped;
  }
  return out;
}

/** Tallies of emitted events by name (subscribe BEFORE the action). */
export function tally<K extends string>(sim: Sim, names: K[]): Record<K, unknown[]> {
  const out = {} as Record<K, unknown[]>;
  for (const n of names) {
    out[n] = [];
    (sim.events as unknown as { on(t: string, f: (p: unknown) => void): void }).on(n, (p) => out[n].push(p));
  }
  return out;
}

/** Every place that can hold a needle in transit, with the ids it holds (duplicates kept). */
export function needleHolders(sim: Sim): { where: string; id: number }[] {
  const out: { where: string; id: number }[] = [];
  for (const b of sim.buildings.values()) for (const id of b.contents().needles) out.push({ where: `${b.type}#${b.id}`, id });
  for (const id of sim.player.carry.needles) out.push({ where: 'carry', id });
  const wb = sim.player.wheelbarrow;
  if (wb) for (const id of wb.inv.needles) out.push({ where: 'wheelbarrow', id });
  return out;
}

/**
 * Needle invariant: every needle is found | buried | exposed, or inTransit and held by EXACTLY one holder.
 * Buried / exposed needles are never held by anything, and found needles are exactly the progression's list.
 * Found needles are never held either, unless `staleFoundOk`: the balance bot calls `sim.foundNeedle()` on a
 * needle it saw exposed 0.5 s earlier, so a machine may have scooped it meanwhile (a bot bug, reported); such a
 * stale id must stay harmless (the needle stays found - see Sim.needleSlipped).
 */
export function expectNeedleInvariant(sim: Sim, label = '', opts: { staleFoundOk?: boolean } = {}): void {
  const holders = needleHolders(sim);
  const count = new Map<number, string[]>();
  for (const h of holders) { const l = count.get(h.id) ?? []; l.push(h.where); count.set(h.id, l); }
  for (const n of sim.hay.needles) {
    const held = count.get(n.id) ?? [];
    if (n.status === 'inTransit') {
      expect(held.length, `${label} needle ${n.id} inTransit must be held exactly once (held by: ${held.join(', ') || 'nobody'})`).toBe(1);
    } else if (!(n.status === 'found' && opts.staleFoundOk)) {
      expect(held, `${label} needle ${n.id} is ${n.status} but still held`).toEqual([]);
    }
    expect(n.status === 'found', `${label} needle ${n.id} found flag vs progression`).toBe(sim.progress.needlesFound.includes(n.id));
  }
  for (const id of count.keys()) expect(sim.hay.needles.some((n) => n.id === id), `${label} unknown needle id ${id} held`).toBe(true);
  expect(new Set(sim.progress.needlesFound).size).toBe(sim.progress.needlesFound.length);
}

/** Finds a free spot for `type` in [x0,x1] x [z0,z1] (any rotation unless given). */
export function findSpot(sim: Sim, type: BuildingType, x0: number, x1: number, z0: number, z1: number, level: Level = 0, rots: Rot[] = [0, 1, 2, 3], variant?: string): { cell: Cell; rot: Rot } | null {
  for (const rot of rots) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const cell: Cell = { x, z, level };
        if (sim.canPlace(type, cell, rot, variant).ok) return { cell, rot };
      }
    }
  }
  return null;
}

/** Hand-feeds a generator from the player's carry (tops it up). */
export function refuel(sim: Sim, gen: Building, hay = 150): void {
  sim.player.carry.add('hay', hay);
  gen.interact(sim);
  sim.player.carry.clear();
}
