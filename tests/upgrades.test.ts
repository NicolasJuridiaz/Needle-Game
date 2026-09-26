/**
 * Upgrade audit: every Work Tree level must change something real, every important object must have
 * upgrades, and the core upgrades must measurably change the running factory (real Sim, real machines).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import { ITEMS } from '../src/config/items';
import { NEEDLE_BUFFS } from '../src/config/needles';
import { BASE_STATS } from '../src/config/stats';
import { TECH_NODES } from '../src/config/techTree';
import { WORLD } from '../src/config/world';
import { EventBus } from '../src/core/events';
import { Building, type BuildingInit } from '../src/sim/building';
import { occupiedCells } from '../src/sim/grid';
import type { SimContext } from '../src/sim/interfaces';
import { Progression } from '../src/sim/progression';
import { Sim } from '../src/sim/sim';
import type { BuildingType, Cell, ItemPacket, Rot } from '../src/sim/types';

const DT = BALANCE.tickDt;

function srcCode(): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!p.endsWith('config')) walk(p); } else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(__dirname, '../src'));
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

describe('upgrade audit (data)', () => {
  it('every level of every node changes at least one stat, unlocks a plan, or gates a feature in code', () => {
    const code = srcCode();
    for (const node of TECH_NODES) {
      const p = new Progression(new EventBus());
      p.addWP(10_000, 'milestone');
      // Satisfy prerequisites (recursively).
      const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
      const need = (id: string) => { for (const r of byId.get(id)!.requires) { need(r); while (p.canUnlock(r).ok) p.unlock(r); } };
      need(node.id);
      for (let lvl = 0; lvl < node.levels.length; lvl++) {
        const effects = node.levels[lvl].effects;
        const before = effects.map((e) => p.stat(e.stat));
        expect(p.unlock(node.id), `${node.id} L${lvl + 1}`).toBe(true);
        const after = effects.map((e) => p.stat(e.stat));
        const changed = after.some((v, i) => v !== before[i]);
        const isPlan = lvl === 0 && (node.kind === 'plan' || !!node.unlocks);
        // Feature nodes (splitter modes...) are checked by id where the feature lives.
        const isGate = effects.length === 0 && code.includes(`'${node.id}'`);
        expect(changed || isPlan || isGate, `${node.id} L${lvl + 1} changes nothing`).toBe(true);
      }
    }
  });

  it('every effect targets a real stat that the simulation reads', () => {
    const code = srcCode();
    const dynamicTool = /^tool\.(hands|shovel|bucket|pitchfork)\.(dig|interval|reach|radius)$/;
    const itemValues = new Set(Object.values(ITEMS).map((i) => i.valueStat));
    // Stats whose only job is to mirror a port / plan gate (the gate itself is the node id).
    const gateMirrors = new Set(['silo.dualOutput', 'hopper.dualOutput', 'global.platforms']);
    const effects = [...TECH_NODES.flatMap((n) => n.levels.flatMap((l) => l.effects)), ...NEEDLE_BUFFS.flatMap((b) => b.effects)];
    for (const e of effects) {
      expect(e.stat in BASE_STATS, `${e.stat} missing from BASE_STATS`).toBe(true);
      const read = code.includes(`'${e.stat}'`) || dynamicTool.test(e.stat) || itemValues.has(e.stat) || gateMirrors.has(e.stat);
      expect(read, `${e.stat} is never read by the simulation`).toBe(true);
    }
    // The gate mirrors really are gated by a node on a port.
    expect(BUILDABLES.silo.ports.some((p) => p.requiresNode === 'e_silo_dual')).toBe(true);
    expect(BUILDABLES.hopper.ports.some((p) => p.requiresNode === 'x_hopper_dual')).toBe(true);
  });

  it('every important tool and machine has meaningful upgrades', () => {
    const prefixes: Record<string, string[]> = {
      Shovel: ['tool.shovel.'], Pitchfork: ['tool.pitchfork.'], 'Vacuum Tool': ['tool.vacuum.'], 'Metal Detector': ['tool.detector.'],
      Wheelbarrow: ['wheelbarrow.'], Hopper: ['hopper.'], 'Piston Rake': ['rake.'], 'Robotic Arm': ['arm.'], 'Vacuum Collector': ['collector.'],
      Conveyors: ['belt.'], Scanner: ['scanner.', 'scanner2.'], Silo: ['silo.'], Compressor: ['compressor.'], Wrapper: ['wrapper.'],
      Generator: ['generator.'], 'Power Pole': ['pole.', 'power.'],
    };
    for (const [name, pre] of Object.entries(prefixes)) {
      const nodes = TECH_NODES.filter((n) => n.levels.some((l) => l.effects.some((e) => pre.some((p) => e.stat.startsWith(p)))));
      const levels = nodes.reduce((s, n) => s + n.levels.length, 0);
      expect(levels, `${name} has ${levels} upgrade levels`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Behaviour: real Sim, measured before/after.
// ---------------------------------------------------------------------------------------------

let nextId = 80_000;

/** Pushes 10-hay packets out of its front as fast as the receiver accepts them. */
class Flood extends Building {
  make: () => ItemPacket = () => ({ type: 'hay', amount: 10 });
  override tick(_dt: number, ctx: SimContext): void {
    for (let k = 0; k < 8; k++) if (!ctx.logistics.pushOut(this, 0, this.make())) break;
  }
}
/** Swallows anything from any side and counts hay-equivalent. */
class Sink extends Building {
  got = 0;
  override inputPortAt(cell: Cell): number { return cell.x === this.cell.x && cell.z === this.cell.z ? 0 : -1; }
  override canAccept(): boolean { return true; }
  override accept(item: ItemPacket): void { this.got += item.amount * BALANCE.hayEquivalent[item.type]; }
}

function insert(sim: Sim, b: Building): void {
  sim.buildings.set(b.id, b);
  for (const c of occupiedCells(b.type, b.cell, b.rot, b.variant)) sim.grid.set(c.x, c.z, c.level, b.id);
  b.refreshPorts((n) => sim.progress.isUnlocked(n));
  sim.markTopologyDirty();
}
const flood = (sim: Sim, x: number, z: number, rot: Rot) => {
  const b = new Flood({ id: nextId++, type: 'roboticArm', cell: { x, z, level: 0 }, rot } as BuildingInit);
  insert(sim, b);
  return b;
};
const sink = (sim: Sim, x: number, z: number) => {
  const b = new Sink({ id: nextId++, type: 'powerPole', cell: { x, z, level: 0 }, rot: 0 } as BuildingInit);
  insert(sim, b);
  return b;
};

function newSim(nodes: string[]): Sim {
  const sim = new Sim(7);
  sim.progress.addMoney(10_000_000, 'milestone');
  sim.progress.addWP(10_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const want = new Set<string>();
  const add = (id: string) => { if (want.has(id)) return; want.add(id); byId.get(id)!.requires.forEach(add); };
  nodes.forEach(add);
  for (let pass = 0; pass < 10; pass++) for (const id of want) while (sim.progress.canUnlock(id).ok) sim.progress.unlock(id);
  sim.player.pos = { x: 25, y: 0, z: 18 };
  sim.rebuildTopology();
  return sim;
}
function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot): Building {
  const b = sim.place(type, { x, z, level: 0 }, rot);
  expect(b, `place ${type} at ${x},${z}: ${sim.canPlace(type, { x, z, level: 0 }, rot).reason}`).not.toBeNull();
  return b!;
}
function run(sim: Sim, s: number): void { for (let i = 0; i < Math.round(s / DT); i++) sim.tick(DT); }
/** Generator with plenty of fuel whose footprint is within the direct-power radius of (x, z). */
function power(sim: Sim, x: number, z: number): void {
  const g = place(sim, 'hayGenerator', x, z, 0);
  (g as unknown as { firebox: { add(n: number): void } }).firebox.add(5000);
}

/** Measure `metric` after `seconds` in a scenario built with and without `upgrade` (plus `base` nodes). */
function compare(base: string[], upgrade: string[], build: (sim: Sim) => () => number, warm = 10, seconds = 40): [number, number] {
  const out: number[] = [];
  for (const nodes of [base, [...base, ...upgrade]]) {
    const sim = newSim(nodes);
    const metric = build(sim);
    sim.rebuildTopology();
    run(sim, warm);
    const m0 = metric();
    run(sim, seconds);
    out.push((metric() - m0) / seconds);
  }
  return [out[0], out[1]];
}

const Z = -18; // quiet floor strip north of the pile

describe('upgrade audit (behaviour)', () => {
  it('Belt Speed raises conveyor throughput', () => {
    const [a, b] = compare(['l_conveyor'], ['l_speed'], (sim) => {
      flood(sim, -28, Z, 0);
      for (let x = -27; x <= -20; x++) place(sim, 'conveyor', x, Z, 0);
      const s = sink(sim, -19, Z);
      return () => s.got;
    });
    expect(a).toBeGreaterThan(45);
    expect(b).toBeGreaterThan(a * 1.4);
  });

  it('Scan Speed raises scanner throughput', () => {
    const [a, b] = compare(['d_scanner', 'l_conveyor', 'l_speed', 'f_generator'], ['d_speed'], (sim) => {
      power(sim, -24, Z + 2);
      flood(sim, -29, Z, 0);
      place(sim, 'conveyor', -28, Z, 0);
      const sc = place(sim, 'scannerMk1', -27, Z, 0);
      place(sim, 'conveyor', -24, Z, 0);
      sink(sim, -23, Z);
      return () => sim.progress.stats.hayScanned + 0 * sc.id;
    });
    expect(a).toBeGreaterThan(40);
    expect(b).toBeGreaterThan(a * 1.1);
  });

  it('Compression Speed raises bale output', () => {
    const [a, b] = compare(['e_compressor', 'l_conveyor', 'l_speed', 'f_generator'], ['e_comp_speed'], (sim) => {
      power(sim, -24, Z + 2);
      flood(sim, -29, Z, 0);
      place(sim, 'conveyor', -28, Z, 0);
      place(sim, 'compressor', -27, Z, 0);
      place(sim, 'conveyor', -24, Z, 0);
      const s = sink(sim, -23, Z);
      return () => s.got;
    });
    expect(a).toBeGreaterThan(30);
    expect(b).toBeGreaterThan(a * 1.15);
  });

  it('Bigger Claw raises robotic arm extraction', () => {
    const edge = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 1;
    const [a, b] = compare(['x_arm', 'f_generator'], ['x_arm_grab'], (sim) => {
      power(sim, edge - 5, -2);
      place(sim, 'roboticArm', edge, 0, 2);
      return () => sim.progress.stats.hayExtractedArm;
    }, 5, 60);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a * 1.2);
  });

  it('Rake Speed raises piston rake extraction', () => {
    const edge = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2;
    const [a, b] = compare(['x_rake', 'f_generator', 'x_rake_auto', 'l_conveyor'], ['x_rake_speed'], (sim) => {
      power(sim, edge - 6, -5);
      place(sim, 'pistonRake', edge, -1, 0);
      sink(sim, edge - 1, 0);
      return () => sim.progress.stats.hayExtractedMachine;
    }, 5, 60);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a * 1.15);
  });

  it('Generator Output raises power supply', () => {
    const [a, b] = compare(['f_generator'], ['f_gen_output'], (sim) => {
      power(sim, -24, Z);
      return () => sim.power.totalSupply * sim.time;
    }, 1, 10);
    expect(b).toBeGreaterThan(a * 1.4);
  });

  it('Hopper Output raises hopper throughput', () => {
    const [a, b] = compare(['x_hopper', 'l_conveyor', 'l_speed'], ['x_hopper_out'], (sim) => {
      flood(sim, -29, Z, 0);
      const h = place(sim, 'hopper', -28, Z, 0);
      const out = h.ports.find((p) => p.kind === 'out')!;
      for (let x = out.cell.x + 1; x <= out.cell.x + 4; x++) place(sim, 'conveyor', x, out.cell.z, 0);
      const s = sink(sim, out.cell.x + 5, out.cell.z);
      return () => s.got;
    });
    expect(a).toBeGreaterThan(30);
    expect(b).toBeGreaterThan(a * 1.3);
  });
});
