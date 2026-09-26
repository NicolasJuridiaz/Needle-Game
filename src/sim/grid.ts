import { BUILDABLES, type BuildableDef, type OccupancyDef } from '../config/buildables';
import { GRID, WORLD } from '../config/world';
import type { BuildingType, Cell, Dir, Level, PortDef, Rot, WorldPort } from './types';
import { DIR_DX, DIR_DZ, rotateDir } from './types';

/**
 * Grid math shared by the simulation, build mode and renderer.
 *
 * Rotation convention: rot r turns local +X (forward) to world Dir r.
 *   r=0: +X   r=1: +Z   r=2: -X   r=3: -Z
 * A building's `cell` is the MIN corner of its rotated footprint (at its base level).
 * World centre of a building: (cell.x + w'/2, level*levelHeight, cell.z + d'/2).
 * three.js yaw for a model authored facing +X: rotation.y = -rot * PI/2.
 */

export function rotatedSize(def: Pick<BuildableDef, 'footprint'>, rot: Rot): [number, number] {
  const [w, d] = def.footprint;
  return rot % 2 === 0 ? [w, d] : [d, w];
}

/** Maps a local footprint cell (i along forward, j across) to an offset from the rotated min corner. */
export function localToOffset(i: number, j: number, w: number, d: number, rot: Rot): [number, number] {
  switch (rot) {
    case 0: return [i, j];
    case 1: return [d - 1 - j, i];
    case 2: return [w - 1 - i, d - 1 - j];
    case 3: return [j, w - 1 - i];
  }
}

export function variantOf(def: BuildableDef, variant?: string) {
  if (!def.variants) return undefined;
  return def.variants[variant ?? def.defaultVariant ?? Object.keys(def.variants)[0]];
}

export function portDefsOf(def: BuildableDef, variant?: string): PortDef[] {
  return variantOf(def, variant)?.ports ?? def.ports;
}

export function occupancyDefsOf(def: BuildableDef, variant?: string): OccupancyDef[] {
  const v = variantOf(def, variant);
  if (v?.occupancy) return v.occupancy;
  if (def.occupancy) return def.occupancy;
  const out: OccupancyDef[] = [];
  // Ground buildings taller than one level also block the level above them.
  const tall = def.height > WORLD.levelHeight - 0.05;
  for (let i = 0; i < def.footprint[0]; i++) for (let j = 0; j < def.footprint[1]; j++) {
    out.push({ cell: [i, j], levelOffset: 0 });
    if (tall) out.push({ cell: [i, j], levelOffset: 1 });
  }
  return out;
}

/** All world cells (with levels) a building blocks. */
export function occupiedCells(type: BuildingType, cell: Cell, rot: Rot, variant?: string): Cell[] {
  const def = BUILDABLES[type];
  const [w, d] = def.footprint;
  const out: Cell[] = [];
  for (const o of occupancyDefsOf(def, variant)) {
    const level = cell.level + o.levelOffset;
    if (level > 1) continue; // only two build levels
    const [dx, dz] = localToOffset(o.cell[0], o.cell[1], w, d, rot);
    out.push({ x: cell.x + dx, z: cell.z + dz, level: level as Level });
  }
  return out;
}

/** Footprint cells at the base level only (used for platform checks and hay displacement). */
export function footprintCells(type: BuildingType, cell: Cell, rot: Rot): Cell[] {
  const def = BUILDABLES[type];
  const [w, d] = def.footprint;
  const out: Cell[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const [dx, dz] = localToOffset(i, j, w, d, rot);
    out.push({ x: cell.x + dx, z: cell.z + dz, level: cell.level });
  }
  return out;
}

/** Resolve port definitions to world ports. `isUnlocked` filters ports gated by tech nodes. */
export function resolvePorts(
  type: BuildingType, cell: Cell, rot: Rot, variant: string | undefined, isUnlocked: (node: string) => boolean,
): WorldPort[] {
  const def = BUILDABLES[type];
  const [w, d] = def.footprint;
  const out: WorldPort[] = [];
  portDefsOf(def, variant).forEach((p, index) => {
    if (p.requiresNode && !isUnlocked(p.requiresNode)) return;
    const [dx, dz] = localToOffset(p.cell[0], p.cell[1], w, d, rot);
    out.push({
      index,
      kind: p.kind,
      cell: { x: cell.x + dx, z: cell.z + dz, level: (cell.level + (p.levelOffset ?? 0)) as Level },
      dir: rotateDir(p.dir, rot),
      items: p.items,
      label: p.label,
    });
  });
  return out;
}

export function neighbor(c: Cell, dir: Dir): Cell {
  return { x: c.x + DIR_DX[dir], z: c.z + DIR_DZ[dir], level: c.level };
}

export function buildingCenter(type: BuildingType, cell: Cell, rot: Rot): { x: number; y: number; z: number } {
  const [w, d] = rotatedSize(BUILDABLES[type], rot);
  return { x: cell.x + w / 2, y: cell.level * WORLD.levelHeight, z: cell.z + d / 2 };
}

/** Pack a cell into an integer key (x,z within grid bounds, level 0/1). */
export function cellKey(x: number, z: number, level: number): number {
  return ((level * GRID.depth + (z - GRID.minZ)) * GRID.width + (x - GRID.minX));
}

export function inGridBounds(x: number, z: number): boolean {
  return x >= GRID.minX && x < GRID.maxX && z >= GRID.minZ && z < GRID.maxZ;
}

/** True if the (ground) cell is part of the currently usable floor. */
export function isFloorCell(x: number, z: number, expansionUnlocked: boolean): boolean {
  const I = WORLD.interior;
  if (x >= I.minX && x < I.maxX && z >= I.minZ && z < I.maxZ) return true;
  if (!expansionUnlocked) return false;
  const A = WORLD.annex;
  return x >= A.minX && x < A.maxX && z >= A.minZ && z < A.maxZ;
}

/**
 * Occupancy map: which building (id) blocks each cell at each level. 0 = free.
 * Platforms are tracked separately because they provide floor for level-1 machines.
 */
export class OccupancyGrid {
  readonly cells: Int32Array;
  readonly platforms: Uint8Array;

  constructor() {
    this.cells = new Int32Array(GRID.width * GRID.depth * 2);
    this.platforms = new Uint8Array(GRID.width * GRID.depth);
  }

  get(x: number, z: number, level: number): number {
    if (!inGridBounds(x, z)) return -1;
    return this.cells[cellKey(x, z, level)];
  }

  set(x: number, z: number, level: number, id: number): void {
    if (!inGridBounds(x, z)) return;
    this.cells[cellKey(x, z, level)] = id;
  }

  hasPlatform(x: number, z: number): boolean {
    if (!inGridBounds(x, z)) return false;
    return this.platforms[cellKey(x, z, 0)] === 1;
  }

  setPlatform(x: number, z: number, on: boolean): void {
    if (!inGridBounds(x, z)) return;
    this.platforms[cellKey(x, z, 0)] = on ? 1 : 0;
  }

  clear(): void { this.cells.fill(0); this.platforms.fill(0); }
}
