/**
 * Payback time of the extractors (RC2 economy check): each machine is measured in the real Sim at the pile
 * edge, dropping into a sink (no belt limit), at technology Lv.1 / Lv.3 / Lv.5; income = hay/s x raw hay value
 * x Hay Sell Value. Prints the payback of the 1st and the 10th unit (price growth included).
 *   npx vite-node tools/balance/payback.ts
 */
import { BALANCE } from '../../src/config/balance';
import { HAY_VALUE_MULTIPLIERS, TECH_BY_ID, displayLevel } from '../../src/config/techTree';
import { WORLD } from '../../src/config/world';
import { Building } from '../../src/sim/building';
import { occupiedCells } from '../../src/sim/grid';
import { Sim } from '../../src/sim/sim';
import type { BuildingType, Cell, ItemPacket } from '../../src/sim/types';

class Sink extends Building {
  override inputPortAt(cell: Cell): number { return cell.x === this.cell.x && cell.z === this.cell.z ? 0 : -1; }
  override canAccept(): boolean { return true; }
  override accept(_item: ItemPacket): void { /* swallow */ }
}

function grant(sim: Sim, id: string, displayed: number): void {
  const node = TECH_BY_ID[id];
  const p = sim.progress;
  while (displayLevel(node, p.nodeLevel(id)) < displayed) {
    const owned = p.nodeLevel(id);
    const next = node.levels[owned];
    for (const r of owned === 0 ? [...node.requires, ...(next.req ?? [])] : next.req ?? []) {
      const [rid, rlv] = r.includes('@') ? [r.split('@')[0], Number(r.split('@')[1])] : [r, 1];
      if (!p.isUnlocked(r)) grant(sim, rid, rlv);
    }
    p.addWP(next.cost, 'milestone');
    p.addMoney(next.money, 'milestone');
    if (!p.unlock(id)) throw new Error(`cannot unlock ${id}: ${p.canUnlock(id).reason}`);
  }
}

const EDGE = Math.floor(WORLD.pile.cx - WORLD.pile.rx);
let nextId = 90_000;

/** Hay/s extracted by one machine of `type` at the pile's west flank. */
function rate(type: BuildingType, tech: string, level: number): number {
  const sim = new Sim(7);
  sim.progress.addMoney(1e9, 'milestone');
  sim.player.pos = { x: 25, y: 0, z: 20 };
  grant(sim, 'f_generator', 5);
  grant(sim, tech, level);
  if (type === 'pistonRake') grant(sim, 'x_rake_auto', 1);
  sim.rebuildTopology();
  const gAt = type === 'roboticArm' ? { x: EDGE - 6, z: -2 } : type === 'pistonRake' ? { x: EDGE - 8, z: -5 } : { x: EDGE - 3, z: -5 };
  const g = sim.place('hayGenerator', { ...gAt, level: 0 }, 0)!;
  (g as unknown as { firebox: { add(n: number): void } }).firebox.add(1e6);
  let m: Building | null = null;
  let sinkCell: Cell;
  if (type === 'roboticArm') { m = sim.place(type, { x: EDGE - 1, z: 0, level: 0 }, 2); sinkCell = { x: EDGE - 2, z: 0, level: 0 }; }
  else if (type === 'pistonRake') { m = sim.place(type, { x: EDGE - 2, z: -1, level: 0 }, 0); sinkCell = { x: EDGE - 3, z: 0, level: 0 }; }
  else { m = sim.place(type, { x: EDGE - 3, z: -1, level: 0 }, 0); sinkCell = { x: EDGE - 4, z: 0, level: 0 }; }
  if (!m) throw new Error(`cannot place ${type}`);
  const s = new Sink({ id: nextId++, type: 'platform', cell: sinkCell, rot: 0 });
  sim.buildings.set(s.id, s);
  for (const c of occupiedCells(s.type, s.cell, s.rot)) sim.grid.set(c.x, c.z, c.level, s.id);
  sim.markTopologyDirty();
  sim.rebuildTopology();
  const steps = (t: number) => { for (let i = 0; i < Math.round(t / BALANCE.tickDt); i++) sim.tick(BALANCE.tickDt); };
  steps(10);
  const e0 = sim.progress.stats.hayExtractedMachine;
  steps(60);
  return (sim.progress.stats.hayExtractedMachine - e0) / 60;
}

const rows: string[] = [];
const fmtT = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
for (const [type, tech] of [['pistonRake', 'x_rake'], ['roboticArm', 'x_arm'], ['vacuumCollector', 'x_collector']] as [BuildingType, string][]) {
  const probe = new Sim(1);
  const c1 = probe.progress.buildingCost(type, 0), c10 = probe.progress.buildingCost(type, 9);
  for (const lv of [1, 3, 5]) {
    const r = rate(type, tech, lv);
    for (const hv of [1, 5, 9]) {
      const income = r * HAY_VALUE_MULTIPLIERS[hv - 1];
      rows.push(`${type.padEnd(16)} Lv.${lv}  ${r.toFixed(1).padStart(6)} hay/s  Hay Value Lv.${hv} (x${HAY_VALUE_MULTIPLIERS[hv - 1].toFixed(2)})  $${income.toFixed(0).padStart(4)}/s  payback 1st ($${c1}) ${fmtT(c1 / income).padStart(8)}  10th ($${c10}) ${fmtT(c10 / income).padStart(8)}`);
    }
  }
}
console.log(rows.join('\n'));
