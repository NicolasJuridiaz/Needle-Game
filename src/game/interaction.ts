import { WORLD } from '../config/world';
import type { Building } from '../sim/building';
import { rotatedSize } from '../sim/grid';
import type { Sim } from '../sim/sim';
import type { Vec3 } from '../sim/types';

export type AimKind = 'none' | 'building' | 'hay' | 'needle' | 'wheelbarrow';

export interface Aim {
  kind: AimKind;
  distance: number;
  point: Vec3;
  building?: Building;
  needleId?: number;
}

const NONE: Aim = { kind: 'none', distance: Infinity, point: { x: 0, y: 0, z: 0 } };

/** Ray vs AABB (slab test). Returns entry distance or Infinity. */
export function rayBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): number {
  let tmin = 0, tmax = Infinity;
  const axes: [number, number, number, number][] = [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]];
  for (const [o, d, a, b] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return Infinity; continue; }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * Engine-agnostic aiming against the sim: buildings (AABBs), the hay heightfield (ray-march),
 * exposed needles and the wheelbarrow. Used for tool use, prompts and build mode.
 */
export class Interaction {
  constructor(private readonly sim: Sim) {}

  aim(o: Vec3, d: Vec3, maxDist: number, opts: { hay?: boolean; needles?: boolean; buildings?: boolean; barrow?: boolean } = {}): Aim {
    const useHay = opts.hay !== false, useNeedles = opts.needles !== false, useBuildings = opts.buildings !== false, useBarrow = opts.barrow !== false;
    let best: Aim = NONE;
    const sim = this.sim;

    if (useBuildings) {
      const r2 = (maxDist + 6) * (maxDist + 6);
      for (const b of sim.buildings.values()) {
        const c = b.center;
        if ((c.x - o.x) ** 2 + (c.z - o.z) ** 2 > r2) continue;
        const [w, dd] = rotatedSize(b.def, b.rot);
        const y0 = b.cell.level * WORLD.levelHeight;
        const h = b.type === 'platform' ? 0.02 : b.def.height;
        const y0b = b.type === 'platform' ? WORLD.levelHeight - 0.2 : y0;
        const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, b.cell.x, y0b, b.cell.z, b.cell.x + w, y0 + h + (b.type === 'platform' ? 0 : 0), b.cell.z + dd);
        if (t < best.distance && t <= maxDist) {
          best = { kind: 'building', distance: t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, building: b };
        }
      }
    }

    if (useBarrow && sim.player.wheelbarrow && !sim.player.wheelbarrow.held) {
      const p = sim.player.wheelbarrow.pos;
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, p.x - 0.7, p.y, p.z - 0.7, p.x + 0.7, p.y + 0.9, p.z + 0.7);
      if (t < best.distance && t <= maxDist) best = { kind: 'wheelbarrow', distance: t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } };
    }

    if (useNeedles) {
      for (const n of sim.hay.needles) {
        if (n.status !== 'exposed') continue;
        // ray-sphere
        const cx = n.pos.x - o.x, cy = n.pos.y + 0.05 - o.y, cz = n.pos.z - o.z;
        const tca = cx * d.x + cy * d.y + cz * d.z;
        if (tca < 0 || tca > maxDist) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
        if (d2 > 0.45 * 0.45) continue;
        if (tca < best.distance) best = { kind: 'needle', distance: tca, point: { ...n.pos }, needleId: n.id };
      }
    }

    if (useHay) {
      const t = this.rayHay(o, d, Math.min(maxDist, best.distance));
      if (t < best.distance) best = { kind: 'hay', distance: t, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } };
    }
    return best;
  }

  /** Ray-march the heightfield; returns hit distance or Infinity. */
  rayHay(o: Vec3, d: Vec3, maxDist: number): number {
    const hay = this.sim.hay;
    const step = 0.06;
    let prevT = 0;
    let prevAbove = o.y - hay.heightAt(o.x, o.z);
    if (prevAbove < 0) return 0.01;
    for (let t = step; t <= maxDist; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = hay.heightAt(x, z);
      const above = y - h;
      if (above <= 0 && h > 0.03) {
        // refine by linear interpolation
        const k = prevAbove / (prevAbove - above);
        return prevT + (t - prevT) * k;
      }
      prevT = t; prevAbove = above;
    }
    return Infinity;
  }
}
