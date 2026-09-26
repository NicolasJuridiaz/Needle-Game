/**
 * MACHINE UPGRADES — per machine family:
 *  1. table-driven from TECH_NODES: every node touching the family (stat effects, plans, gated ports,
 *     splitter modes) is unlocked level by level; every touched stat must change and equal the value the
 *     effect implies (set -> value, mul -> before x value, add -> before + value); plans must open the shop
 *     entry, gated ports must appear, mode nodes must add a splitter mode;
 *  2. behaviour with the REAL Sim (before/after, with and without the node) for at least one upgrade per
 *     family that tests/upgrades.test.ts does not already cover.
 * Nodes are unlocked with granted WP (costs are irrelevant here and may be re-tuned freely).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import { TECH_NODES, type TechNode } from '../src/config/techTree';
import { WORLD } from '../src/config/world';
import { EventBus } from '../src/core/events';
import { Building, type BuildingInit } from '../src/sim/building';
import { occupiedCells, resolvePorts } from '../src/sim/grid';
import type { SimContext } from '../src/sim/interfaces';
import { Splitter } from '../src/sim/logistics/index';
import { Progression } from '../src/sim/progression';
import { Sim } from '../src/sim/sim';
import type { BuildingType, Cell, Effect, ItemPacket, PortDef, Rot, SplitterMode } from '../src/sim/types';

const DT = BALANCE.tickDt;
const BY_ID = new Map<string, TechNode>(TECH_NODES.map((n) => [n.id, n]));

// =====================================================================================================
// 1. Table-driven stat checks
// =====================================================================================================

interface Family { name: string; types: BuildingType[]; stats: string[] }

/** `stats` entries ending with '.' are prefixes; others are exact stat keys. */
const FAMILIES: Family[] = [
  { name: 'Hopper', types: ['hopper'], stats: ['hopper.'] },
  { name: 'Piston Rake', types: ['pistonRake'], stats: ['rake.'] },
  { name: 'Robotic Arm', types: ['roboticArm'], stats: ['arm.'] },
  { name: 'Vacuum Collector', types: ['vacuumCollector'], stats: ['collector.'] },
  { name: 'Conveyor', types: ['conveyor', 'conveyorRamp', 'beltLift'], stats: ['belt.', 'global.autoRoute'] },
  { name: 'Splitters', types: ['splitter', 'uSplitter', 'merger', 'uMerger'], stats: [] },
  { name: 'Scanner MK1', types: ['scannerMk1'], stats: ['scanner.'] },
  { name: 'Scanner MK2', types: ['scannerMk2'], stats: ['scanner2.'] },
  { name: 'Silo', types: ['silo'], stats: ['silo.'] },
  { name: 'Compressor', types: ['compressor'], stats: ['compressor.', 'econ.baleValue'] },
  { name: 'Wrapper', types: ['wrapper'], stats: ['wrapper.', 'econ.wrappedValue'] },
  { name: 'Generator', types: ['hayGenerator'], stats: ['generator.'] },
  { name: 'Power Poles', types: ['powerPole'], stats: ['pole.', 'power.loss'] },
];

/** Known, accepted defects: none (Industrial Generator fixed). Rows listed here would run as `it.fails`. */
const KNOWN_DEFECTS = new Set<string>();

const matches = (stat: string, keys: string[]) => keys.some((k) => (k.endsWith('.') ? stat.startsWith(k) : stat === k));

function fresh(): Progression {
  const p = new Progression(new EventBus());
  p.addWP(1e9, 'milestone');
  p.addMoney(1e12, 'milestone');
  return p;
}

/** Unlocks the prerequisites of `id` (recursively, level 1 each — the minimum the tree asks for). */
function unlockRequires(p: Progression, id: string): boolean {
  for (const r of BY_ID.get(id)!.requires) {
    if (p.isUnlocked(r)) continue;
    if (!unlockRequires(p, r) || !p.unlock(r)) return false;
  }
  return true;
}

/** Value of `stat`'s effect in `nodeId` level `level` (so behaviour expectations follow the tree). */
function effectValue(nodeId: string, stat: string, level = 1): number {
  const e = BY_ID.get(nodeId)!.levels[level - 1].effects.find((x) => x.stat === stat);
  if (!e) throw new Error(`${nodeId} L${level} has no effect on ${stat}`);
  return e.value;
}

const splitterModes = (p: Progression): SplitterMode[] =>
  new Splitter({ id: 1, type: 'splitter', cell: { x: 0, z: 0, level: 0 }, rot: 0 }).availableModes({ progress: p } as unknown as SimContext);

const portDefs = (t: BuildingType): PortDef[] => [BUILDABLES[t].ports, ...Object.values(BUILDABLES[t].variants ?? {}).map((v) => v.ports)].flat();
const portCount = (p: Progression, t: BuildingType) => resolvePorts(t, { x: 0, z: 0, level: 0 }, 0, undefined, (n) => p.isUnlocked(n)).length;

/** Nodes that add a splitter mode (derived, not hardcoded). */
const MODE_NODES = new Map<string, SplitterMode>();
for (const n of TECH_NODES) {
  if (n.levels.some((l) => l.effects.length)) continue;
  const p = fresh();
  unlockRequires(p, n.id);
  const before = splitterModes(p);
  p.unlock(n.id);
  const added = splitterModes(p).filter((m) => !before.includes(m));
  if (added.length) MODE_NODES.set(n.id, added[0]);
}

function familyNodes(f: Family): TechNode[] {
  return TECH_NODES.filter((n) =>
    n.levels.some((l) => l.effects.some((e) => matches(e.stat, f.stats)))
    || (n.unlocks?.building ?? []).some((t) => f.types.includes(t))
    || f.types.some((t) => portDefs(t).some((pd) => pd.requiresNode === n.id))
    || (f.name === 'Splitters' && MODE_NODES.has(n.id)));
}

/** Natural meaning of an effect on top of `before` (stats compose as (base + adds) x muls; set replaces). */
function expectedAfter(p: Progression, e: Effect, before: number): number {
  if (e.op === 'set') return e.value;
  if (e.op === 'mul') return before * e.value;
  let mul = 1;
  for (const n of TECH_NODES) {
    n.levels.slice(0, p.nodeLevel(n.id)).forEach((lv) => { for (const x of lv.effects) if (x.stat === e.stat && x.op === 'mul') mul *= x.value; });
  }
  return before + e.value * mul;
}

function checkLevel(f: Family, node: TechNode, li: number): void {
  const p = fresh();
  expect(unlockRequires(p, node.id), `prerequisites of ${node.id}`).toBe(true);
  for (let k = 0; k < li; k++) expect(p.unlock(node.id)).toBe(true);
  const effects = node.levels[li].effects;
  const stats = [...new Set(effects.map((e) => e.stat))];
  const before = new Map(stats.map((s) => [s, p.stat(s)]));
  const shop = f.types.map((t) => p.buildingUnlocked(t));
  const ports = f.types.map((t) => portCount(p, t));
  const modes = splitterModes(p).length;

  expect(p.unlock(node.id), `unlock ${node.id} L${li + 1}`).toBe(true);
  let checks = 0;

  // Every stat the level touches changes, to exactly the value its effects imply.
  const expected = new Map(before);
  for (const e of effects) expected.set(e.stat, expectedAfter(p, e, expected.get(e.stat)!));
  for (const s of stats) {
    const b = before.get(s)!, a = p.stat(s), x = expected.get(s)!;
    expect(a, `${s}: before ${b}, after ${a}`).not.toBe(b);
    expect(a, `${s}: ${b} -> ${a}, the effect implies ${x}`).toBeCloseTo(x, 6);
    checks++;
  }
  // Plans open the shop entry of this family's buildings.
  for (const [i, t] of f.types.entries()) {
    if (!(node.unlocks?.building ?? []).includes(t) || li > 0) continue;
    expect(shop[i], `${t} purchasable before ${node.id}`).toBe(false);
    expect(p.buildingUnlocked(t), `${t} purchasable after ${node.id}`).toBe(true);
    checks++;
  }
  // Gated ports appear.
  for (const [i, t] of f.types.entries()) {
    if (!portDefs(t).some((pd) => pd.requiresNode === node.id)) continue;
    expect(portCount(p, t), `${t} ports after ${node.id}`).toBeGreaterThan(ports[i]);
    checks++;
  }
  // Mode nodes add a splitter mode.
  if (MODE_NODES.has(node.id)) {
    expect(splitterModes(p).length).toBe(modes + 1);
    expect(splitterModes(p)).toContain(MODE_NODES.get(node.id));
    checks++;
  }
  expect(checks, `${node.id} L${li + 1} checked nothing`).toBeGreaterThan(0);
}

describe('machine upgrades: every node of every family (table-driven from TECH_NODES)', () => {
  for (const f of FAMILIES) {
    describe(f.name, () => {
      const nodes = familyNodes(f);
      it('has at least one upgrade besides its plans', () => {
        expect(nodes.filter((n) => !(n.unlocks?.building ?? []).some((t) => f.types.includes(t))).length).toBeGreaterThan(0);
        // Every building of the family has a plan node in the list.
        for (const t of f.types) expect(nodes.some((n) => n.unlocks?.building?.includes(t)), `${t} plan`).toBe(true);
      });
      for (const n of nodes) {
        n.levels.forEach((lv, li) => {
          const key = `${n.id} L${li + 1}`;
          const test = KNOWN_DEFECTS.has(key) ? it.fails : it;
          test(`${KNOWN_DEFECTS.has(key) ? 'KNOWN DEFECT ' : ''}${key}: ${lv.desc}`, () => checkLevel(f, n, li));
        });
      }
    });
  }
});

// =====================================================================================================
// 2. Behaviour (real Sim)
// =====================================================================================================

let nextId = 70_000;

/** Pushes packets out of its front (port 0) as fast as the receiver accepts them. */
class Flood extends Building {
  make: (i: number) => ItemPacket = () => ({ type: 'hay', amount: 10 });
  sent = 0;
  override tick(_dt: number, ctx: SimContext): void {
    for (let k = 0; k < 8; k++) {
      if (!ctx.logistics.pushOut(this, 0, this.make(this.sent))) break;
      this.sent++;
    }
  }
}

/** Swallows anything from any side while `open`; counts hay-equivalent and items. Plays no power role. */
class Sink extends Building {
  open = true;
  got = 0;
  items: ItemPacket[] = [];
  override inputPortAt(cell: Cell): number { return cell.x === this.cell.x && cell.z === this.cell.z && cell.level === this.cell.level ? 0 : -1; }
  override canAccept(): boolean { return this.open; }
  override accept(item: ItemPacket): void { this.items.push(item); this.got += item.amount * BALANCE.hayEquivalent[item.type]; }
  count(type: ItemPacket['type']): number { return this.items.filter((i) => i.type === type).length; }
}

/** A consumer with a fixed power draw (no grid occupancy; the power network only needs its centre). */
class FixedLoad extends Building {
  constructor(init: BuildingInit, public draw: number) { super(init); }
  override powerDraw(): number { return this.draw; }
}

function insert(sim: Sim, b: Building): void {
  sim.buildings.set(b.id, b);
  for (const c of occupiedCells(b.type, b.cell, b.rot, b.variant)) sim.grid.set(c.x, c.z, c.level, b.id);
  b.refreshPorts((n) => sim.progress.isUnlocked(n));
  sim.markTopologyDirty();
}
function flood(sim: Sim, x: number, z: number, rot: Rot): Flood {
  const b = new Flood({ id: nextId++, type: 'roboticArm', cell: { x, z, level: 0 }, rot });
  insert(sim, b);
  return b;
}
function sink(sim: Sim, x: number, z: number): Sink {
  const b = new Sink({ id: nextId++, type: 'platform', cell: { x, z, level: 0 }, rot: 0 });
  insert(sim, b);
  return b;
}

type NodeSpec = string | [string, number];

/** Unlocks `id` up to `level` (prerequisites at level 1 first), with granted WP. */
function unlock(sim: Sim, id: string, level = 1): void {
  sim.progress.addWP(1e6, 'milestone');
  for (const r of BY_ID.get(id)!.requires) if (!sim.progress.isUnlocked(r)) unlock(sim, r, 1);
  while (sim.progress.nodeLevel(id) < level) expect(sim.progress.unlock(id), `unlock ${id}`).toBe(true);
}
function unlockAll(sim: Sim, nodes: NodeSpec[]): void {
  for (const n of nodes) typeof n === 'string' ? unlock(sim, n) : unlock(sim, n[0], n[1]);
}

function newSim(nodes: NodeSpec[] = []): Sim {
  const sim = new Sim(7);
  sim.progress.addMoney(1e8, 'milestone');
  sim.player.pos = { x: 0, y: 50, z: 0 }; // out of the way of placement checks
  unlockAll(sim, nodes);
  sim.rebuildTopology();
  return sim;
}

function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot = 0): Building {
  const cell: Cell = { x, z, level: 0 };
  const chk = sim.canPlace(type, cell, rot);
  expect(chk.ok, `place ${type} at ${x},${z} rot ${rot}: ${chk.reason}`).toBe(true);
  return sim.place(type, cell, rot)!;
}

function run(sim: Sim, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) { each?.(); sim.tick(DT); }
}

/** Generator with plenty of fuel. */
function generator(sim: Sim, x: number, z: number): Building {
  const g = place(sim, 'hayGenerator', x, z, 0);
  (g as unknown as { firebox: { add(n: number): void } }).firebox.add(5000);
  return g;
}

/** Pushes packets straight into an input port while it accepts them. */
function fill(sim: Sim, b: Building, port: number, make: () => ItemPacket, max = 64): number {
  let n = 0;
  while (n < max && b.canAccept(make(), port, sim)) { b.accept(make(), port, sim); n++; }
  return n;
}

/** Rate of `metric` (per second) after a warm-up, in a scenario built with base nodes and with base + upgrade. */
function compare(base: NodeSpec[], upgrade: NodeSpec[], build: (sim: Sim) => { metric: () => number; each?: () => void }, warm = 5, seconds = 30): [number, number] {
  const out: number[] = [];
  for (const nodes of [base, [...base, ...upgrade]]) {
    const sim = newSim(nodes);
    const { metric, each } = build(sim);
    sim.rebuildTopology();
    run(sim, warm, each);
    const m0 = metric();
    run(sim, seconds, each);
    out.push((metric() - m0) / seconds);
  }
  return [out[0], out[1]];
}

/** Smallest distance (0.1 m steps) at which the hay field offers an arm/collector target around (x, z). */
function nearestHay(sim: Sim, x: number, z: number, mode: 'nearest' | 'densest', minR: number): number {
  for (let r = minR + 0.1; r < 20; r += 0.1) if (sim.hay.findTarget(x, z, r, mode, minR)) return r;
  return Infinity;
}

const EDGE = Math.floor(WORLD.pile.cx - WORLD.pile.rx); // first column of the pile's west flank
const QZ = -18; // quiet floor strip north of the pile

describe('machine upgrades: behaviour (real Sim)', () => {
  // ----- Hopper ------------------------------------------------------------------------------------
  it('Hopper Capacity: an existing hopper holds exactly hopper.capacity after the upgrade', () => {
    const sim = newSim(['x_hopper']);
    const h = place(sim, 'hopper', -20, QZ);
    sim.player.carry.add('hay', 5000);
    expect(h.interact(sim)).toBe(true);
    const base = h.contents().hay;
    expect(base).toBeCloseTo(sim.stat('hopper.capacity'), 6);
    unlock(sim, 'x_hopper_cap');
    expect(h.interact(sim)).toBe(true);
    expect(h.contents().hay).toBeCloseTo(sim.stat('hopper.capacity'), 6);
    expect(h.contents().hay).toBeGreaterThan(base);
  });

  it('Dual Hopper Output: the second port appears on an existing hopper and carries items', () => {
    const sim = newSim(['x_hopper', 'x_hopper_out']);
    flood(sim, -21, QZ, 0);
    const h = place(sim, 'hopper', -20, QZ);
    const a = sink(sim, -18, QZ);
    const b = sink(sim, -18, QZ + 1);
    sim.rebuildTopology();
    run(sim, 10);
    expect(h.outPorts()).toHaveLength(1);
    expect(b.got).toBe(0);
    const single = a.got / 10;
    expect(single).toBeGreaterThan(sim.stat('hopper.outputRate') * 0.85);
    unlock(sim, 'x_hopper_dual');
    run(sim, 1);
    expect(h.outPorts()).toHaveLength(2);
    const a0 = a.got, b0 = b.got;
    run(sim, 10);
    expect(b.got - b0).toBeGreaterThan(single * 10 * 0.8);
    expect((a.got - a0 + b.got - b0) / 10).toBeGreaterThan(single * 1.7);
  });

  // ----- Piston Rake -------------------------------------------------------------------------------
  it('Rake Auto Output: the tray feeds an adjacent hopper input without any chute link', () => {
    const sim = newSim(['x_rake', 'x_hopper']);
    generator(sim, EDGE - 7, -2);
    const rake = place(sim, 'pistonRake', EDGE - 2, -1, 0);
    const hopper = place(sim, 'hopper', EDGE - 2, -3, 0); // south inputs face the rake's north row
    run(sim, 20);
    expect(sim.logistics.isLinked(rake, rake.outPorts()[0].index)).toBe(false);
    expect(sim.progress.stats.hayExtractedMachine).toBeGreaterThan(100);
    expect(hopper.contents().hay).toBe(0);
    unlock(sim, 'x_rake_auto');
    run(sim, 20);
    expect(hopper.contents().hay).toBeGreaterThan(100);
  });

  it('Rake Width raises the hay raked per cycle', () => {
    const [a, b] = compare(['x_rake', 'x_rake_auto'], [['x_rake_width', 2]], (sim) => {
      generator(sim, EDGE - 8, -5);
      place(sim, 'pistonRake', EDGE - 2, -1, 0);
      sink(sim, EDGE - 3, 0); // chute
      return { metric: () => sim.progress.stats.hayExtractedMachine };
    }, 5, 60);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a * 1.25);
  });

  // ----- Robotic Arm -------------------------------------------------------------------------------
  /** Arm at the pile's west flank dropping into a sink (linked: it never dumps on the floor). */
  function armRig(sim: Sim) {
    generator(sim, EDGE - 6, -2);
    place(sim, 'roboticArm', EDGE - 1, 0, 2);
    const s = sink(sim, EDGE - 2, 0);
    return { metric: () => s.got };
  }

  it('Faster Servos raise robotic arm throughput', () => {
    const [a, b] = compare(['x_arm'], [['x_arm_speed', 2]], armRig, 5, 60);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a * 1.15);
  });

  it('Extended Arm: hay just beyond the base reach becomes reachable', () => {
    const probe = newSim([]);
    const reach0 = probe.stat('arm.reach');
    let x = -20;
    for (; x < EDGE; x++) {
      const d = nearestHay(probe, x + 0.5, 0.5, 'nearest', 0.8);
      if (d > reach0 + 0.3 && d < reach0 + 1.2) break;
    }
    expect(x, 'found a spot between the two reaches').toBeLessThan(EDGE);
    const extracted = (nodes: NodeSpec[]): number => {
      const sim = newSim(nodes);
      generator(sim, x - 7, -1);
      place(sim, 'roboticArm', x, 0, 2);
      sink(sim, x - 1, 0); // drop point
      run(sim, 20);
      return sim.progress.stats.hayExtractedArm;
    };
    expect(extracted(['x_arm'])).toBe(0);
    expect(extracted(['x_arm', 'x_arm_reach'])).toBeGreaterThan(0);
  });

  it('Robotic Arm MK2 raises arm throughput', () => {
    const [a, b] = compare(['x_arm', 'x_arm_speed', 'x_arm_grab'], ['x_arm_mk2'], armRig, 5, 60);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a * 1.2);
  });

  /**
   * With nothing linked at the drop point the arm dumps its claw on the floor in front. It must never re-grab that
   * heap: every re-grab would be credited again as extraction (orders "extractArm" / "extractMachine" would inflate
   * while the pile does not shrink). Big claw (MK2) and a long run so the heap has time to spread.
   */
  it('an unlinked arm never re-grabs the hay it dumped on the floor (MK2 claw)', () => {
    const sim = newSim(['x_arm', 'x_arm_speed', 'x_arm_grab', 'x_arm_mk2']);
    generator(sim, EDGE - 6, -2);
    const arm = place(sim, 'roboticArm', EDGE - 1, 0, 2); // drops west, the pile is east
    const cx = arm.center.x;
    let own = 0, pile = 0;
    sim.events.on('hay:extracted', (e) => { if (e.source === 'arm') { if (e.pos.x < cx) own++; else pile++; } });
    run(sim, 300);
    expect(pile).toBeGreaterThan(40);
    expect(own, `${own} grabs from its own heap vs ${pile} from the pile`).toBe(0);
  });

  // ----- Vacuum Collector --------------------------------------------------------------------------
  it('Collector Suction raises hay sucked per second', () => {
    const [a, b] = compare(['x_collector'], ['x_col_suction'], (sim) => {
      generator(sim, EDGE - 3, -5);
      place(sim, 'vacuumCollector', EDGE - 3, -1, 0);
      sink(sim, EDGE - 4, 0);
      return { metric: () => sim.progress.stats.hayExtractedMachine };
    }, 1, 8);
    expect(a).toBeGreaterThan(40);
    expect(Math.abs(b / a / effectValue('x_col_suction', 'collector.rate') - 1)).toBeLessThan(0.1);
  });

  it('Collector Radius: hay beyond the base radius gets collected', () => {
    const probe = newSim([]);
    const r0 = probe.stat('collector.radius');
    let x = -24;
    for (; x < EDGE; x++) {
      const d = nearestHay(probe, x + 1.5, 0.5, 'densest', 1.5);
      if (d > r0 + 0.5 && d < r0 + 2) break;
    }
    expect(x).toBeLessThan(EDGE);
    const collected = (nodes: NodeSpec[]): number => {
      const sim = newSim(nodes);
      generator(sim, x, -5);
      place(sim, 'vacuumCollector', x, -1, 0);
      sink(sim, x - 1, 0);
      run(sim, 10);
      return sim.progress.stats.hayExtractedMachine;
    };
    expect(collected(['x_collector'])).toBe(0);
    expect(collected(['x_collector', 'x_col_radius'])).toBeGreaterThan(50);
  });

  // ----- Conveyor ----------------------------------------------------------------------------------
  /** Machine -> 8 belts -> machine: delivered hay/s after a warm-up, and the nominal belt rate from the stats. */
  function beltLine(nodes: NodeSpec[]): { rate: number; nominal: number } {
    const sim = newSim(nodes);
    flood(sim, -28, QZ, 0);
    for (let x = -27; x <= -20; x++) place(sim, 'conveyor', x, QZ, 0);
    const s = sink(sim, -19, QZ);
    sim.rebuildTopology();
    run(sim, 10);
    const g0 = s.got;
    run(sim, 30);
    return { rate: (s.got - g0) / 30, nominal: (sim.stat('belt.speed') / sim.stat('belt.spacing')) * BALANCE.hayPacketSize };
  }

  it('Belt Capacity raises the throughput of a machine-fed line (at Belt Speed I)', () => {
    const a = beltLine([['l_speed', 1]]).rate;
    const b = beltLine([['l_speed', 1], 'l_capacity']).rate;
    expect(a).toBeGreaterThan(60);
    expect(b).toBeGreaterThan(a * 1.2);
  });

  /** Base, every Belt Speed level, and Belt Capacity on top of each (derived from the tree). */
  const BELT_CONFIGS: NodeSpec[][] = [['l_conveyor']];
  for (let l = 1; l <= BY_ID.get('l_speed')!.levels.length; l++) BELT_CONFIGS.push([['l_speed', l]], [['l_speed', l], 'l_capacity']);

  /**
   * Belt ends are not quantized to whole ticks: a machine may push a packet onto a belt as soon as the last item
   * will be a full spacing in by the end of the tick, and a packet handed from a belt into a machine keeps its
   * overshoot. (Before the fix Belt Speed I gave 66.7 instead of 75 hay/s and Belt Capacity I added nothing at
   * Belt Speed II.)
   */
  it('belt lines into machines deliver speed / spacing x packet at every belt level', () => {
    for (const nodes of BELT_CONFIGS) {
      const r = beltLine(nodes);
      expect(r.rate / r.nominal, `${JSON.stringify(nodes)}: ${r.rate.toFixed(1)} hay/s delivered, nominal ${r.nominal.toFixed(1)}`).toBeCloseTo(1, 1);
    }
  });

  // ----- Splitters ---------------------------------------------------------------------------------
  describe('splitter modes: selectable only after their node, then distribute as described', () => {
    const Z = -16;
    function rig(sim: Sim) {
      const src = flood(sim, -27, Z, 0);
      place(sim, 'conveyor', -26, Z, 0);
      place(sim, 'conveyor', -25, Z, 0);
      const sp = place(sim, 'splitter', -24, Z, 0) as Splitter;
      place(sim, 'conveyor', -23, Z, 0);
      const primary = sink(sim, -22, Z);
      place(sim, 'conveyor', -24, Z - 1, 3);
      const left = sink(sim, -24, Z - 2);
      place(sim, 'conveyor', -24, Z + 1, 1);
      const right = sink(sim, -24, Z + 2);
      sim.rebuildTopology();
      return { src, sp, primary, left, right };
    }

    it('only Even without mode nodes', () => {
      const sim = newSim(['l_splitter']);
      const { sp } = rig(sim);
      expect(sp.availableModes(sim)).toEqual(['even']);
      expect(sp.interact(sim)).toBe(false);
      expect(sp.mode).toBe('even');
      expect(MODE_NODES.size).toBeGreaterThanOrEqual(3);
    });

    for (const [nodeId, mode] of MODE_NODES) {
      it(`${nodeId} -> ${mode}`, () => {
        const sim = newSim(['l_splitter']);
        const r = rig(sim);
        if (mode === 'smart') r.src.make = (i) => (i % 2 === 0 ? { type: 'hay', amount: 10 } : { type: 'bale', amount: 1 });
        // Not reachable by the player before the node (its prerequisites already unlocked).
        for (const req of BY_ID.get(nodeId)!.requires) unlock(sim, req);
        expect(r.sp.availableModes(sim)).not.toContain(mode);
        const seen: string[] = [];
        for (let i = 0; i < 12; i++) { r.sp.interact(sim); seen.push(r.sp.mode); }
        expect(seen, `${mode} selectable before ${nodeId}`).not.toContain(mode);
        r.sp.setMode('even');
        // After: reachable with E, never through a locked mode.
        unlock(sim, nodeId);
        const avail = r.sp.availableModes(sim);
        expect(avail).toContain(mode);
        for (let i = 0; i < 12 && r.sp.mode !== mode; i++) { expect(r.sp.interact(sim)).toBe(true); expect(avail).toContain(r.sp.mode); }
        expect(r.sp.mode).toBe(mode);
        const filter = r.sp.filter;
        run(sim, 30);
        const p = r.primary.got, l = r.left.got, rt = r.right.got, total = p + l + rt;
        expect(total).toBeGreaterThan(1000);
        switch (mode) {
          case 'alternating': // strict 1:1 (:1)
            for (const v of [p, l, rt]) expect(v / total).toBeCloseTo(1 / 3, 1);
            break;
          case 'priority': // primary gets 2 of every 3 items
            expect(p / (l + rt)).toBeGreaterThan(1.8);
            expect(p / (l + rt)).toBeLessThan(2.2);
            break;
          case 'overflow': { // sides only when the primary is blocked
            expect(l + rt).toBe(0);
            r.primary.open = false;
            run(sim, 10);
            expect(r.left.got + r.right.got).toBeGreaterThan(200);
            break;
          }
          case 'smart': { // the filtered type goes to the primary, the rest to the sides
            const want = (['hay', 'bale', 'wrapped'] as const)[filter];
            expect(r.primary.items.length).toBeGreaterThan(10);
            expect(r.primary.items.every((it) => it.type === want)).toBe(true);
            expect([...r.left.items, ...r.right.items].every((it) => it.type !== want)).toBe(true);
            break;
          }
          default: throw new Error(`no expectation for mode ${mode}`);
        }
      });
    }
  });

  // ----- Scanners ----------------------------------------------------------------------------------
  it('Auto Needle Eject: the MK1 scanner keeps scanning through a needle instead of stopping', () => {
    const scanned = (nodes: NodeSpec[]): { hay: number; alarms: number } => {
      const sim = newSim(['d_scanner', 'f_generator', ...nodes]);
      generator(sim, -22, -21);
      const sc = place(sim, 'scannerMk1', -22, -16, 0);
      sink(sim, -19, -16);
      sim.rebuildTopology();
      const needle = sim.hay.needles[0];
      needle.status = 'inTransit';
      let alarms = 0;
      sim.events.on('scanner:alarm', () => alarms++);
      sc.accept({ type: 'hay', amount: 10, needleId: needle.id }, 0, sim);
      run(sim, 4, () => fill(sim, sc, 0, () => ({ type: 'hay', amount: 10 })));
      expect(sim.progress.needlesFound).toContain(needle.id);
      return { hay: sim.progress.stats.hayScanned, alarms };
    };
    const off = scanned([]);
    const on = scanned(['d_eject']);
    expect(off.alarms).toBe(1);
    expect(on.alarms).toBe(0);
    expect(on.hay).toBeGreaterThan(off.hay * 2);
  });

  function mk2Rig(sim: Sim) {
    generator(sim, -24, -22);
    const sc = place(sim, 'scannerMk2', -24, QZ, 0);
    const a = sink(sim, -20, QZ);
    const b = sink(sim, -20, QZ + 1);
    sim.rebuildTopology();
    const hay = () => ({ type: 'hay' as const, amount: 10 });
    const each = () => { fill(sim, sc, 0, hay); fill(sim, sc, 2, hay); };
    return { sc, a, b, each };
  }

  it('Scanner MK2 Speed raises MK2 throughput by its multiplier', () => {
    const [a, b] = compare(['d_mk2', 'f_generator'], ['d_mk2_speed'], (sim) => {
      const r = mk2Rig(sim);
      return { metric: () => sim.progress.stats.hayScanned, each: r.each };
    }, 2, 20);
    expect(a).toBeGreaterThan(150);
    expect(Math.abs(b / a / effectValue('d_mk2_speed', 'scanner2.speedMul') - 1)).toBeLessThan(0.07);
  });

  it('Dual Lane Scan: lane B ports appear on an existing MK2 and double its throughput', () => {
    const sim = newSim(['d_mk2', 'f_generator']);
    const r = mk2Rig(sim);
    expect(r.sc.ports).toHaveLength(2);
    expect(r.sc.canAccept({ type: 'hay', amount: 10 }, 2, sim)).toBe(false);
    run(sim, 2, r.each);
    let s0 = sim.progress.stats.hayScanned;
    run(sim, 10, r.each);
    const single = (sim.progress.stats.hayScanned - s0) / 10;
    expect(r.b.got).toBe(0);
    unlock(sim, 'd_dual_lane');
    run(sim, 2, r.each);
    expect(r.sc.ports).toHaveLength(4);
    s0 = sim.progress.stats.hayScanned;
    const b0 = r.b.got;
    run(sim, 10, r.each);
    const dual = (sim.progress.stats.hayScanned - s0) / 10;
    expect(r.b.got - b0).toBeGreaterThan(single * 10 * 0.8);
    expect(dual / single).toBeGreaterThan(1.8);
    expect(dual / single).toBeLessThan(2.2);
  });

  // ----- Silo --------------------------------------------------------------------------------------
  it('Silo Capacity: an existing silo holds exactly silo.capacity at every level', () => {
    const sim = newSim(['e_silo']);
    const silo = place(sim, 'silo', -24, QZ, 0);
    const stored: number[] = [];
    const deposit = () => {
      sim.player.carry.add('hay', 20_000);
      silo.interact(sim);
      sim.player.carry.clear();
      stored.push(silo.contents().weight());
      expect(stored[stored.length - 1], `level ${stored.length - 1}`).toBeCloseTo(sim.stat('silo.capacity'), 6);
    };
    deposit();
    for (let l = 1; l <= BY_ID.get('e_silo_cap')!.levels.length; l++) { unlock(sim, 'e_silo_cap', l); deposit(); }
    for (let i = 1; i < stored.length; i++) expect(stored[i], `level ${i}`).toBeGreaterThan(stored[i - 1]);
  });

  it('Silo Output multiplies the unload rate', () => {
    const [a, b] = compare(['e_silo'], ['e_silo_out'], (sim) => {
      const silo = place(sim, 'silo', -24, QZ, 0);
      const s = sink(sim, -21, QZ + 1);
      sim.player.carry.add('hay', 2000);
      expect(silo.interact(sim)).toBe(true);
      return { metric: () => s.got };
    }, 2, 10);
    expect(a).toBeGreaterThan(30);
    expect(Math.abs(b / a / effectValue('e_silo_out', 'silo.outputRate') - 1)).toBeLessThan(0.1);
  });

  // ----- Compressor & Wrapper ----------------------------------------------------------------------
  it('Double Chamber multiplies compressor bale output by its chamber count', () => {
    const [a, b] = compare(['e_compressor', 'e_comp_speed', 'f_generator'], ['e_double_chamber'], (sim) => {
      generator(sim, -22, -21);
      const c = place(sim, 'compressor', -22, -16, 0);
      const s = sink(sim, -19, -16);
      return { metric: () => s.count('bale'), each: () => { fill(sim, c, 0, () => ({ type: 'hay', amount: 10 })); } };
    }, 3, 20);
    expect(a).toBeGreaterThan(1);
    expect(Math.abs(b / a / effectValue('e_double_chamber', 'compressor.chambers') - 1)).toBeLessThan(0.1);
  });

  it('Wrap Speed raises wrapped bales per second by its cycle multiplier', () => {
    const [a, b] = compare(['e_wrapper', 'f_generator'], ['e_wrap_speed'], (sim) => {
      generator(sim, -22, -21);
      const w = place(sim, 'wrapper', -22, -16, 0);
      const s = sink(sim, -19, -16);
      return { metric: () => s.count('wrapped'), each: () => { fill(sim, w, 0, () => ({ type: 'bale', amount: 1 })); } };
    }, 3, 40);
    expect(a).toBeGreaterThan(0.8);
    expect(Math.abs(b / a / (1 / effectValue('e_wrap_speed', 'wrapper.cycle')) - 1)).toBeLessThan(0.07);
  });

  /** Measured output per second of a machine kept saturated (fed directly, output into a sink). */
  function processRate(type: 'compressor' | 'wrapper' | 'scannerMk1', nodes: NodeSpec[]): { measured: number; nominal: number } {
    const sim = newSim(['f_generator', ...nodes]);
    generator(sim, -22, -21);
    const m = place(sim, type, -22, -16, 0);
    const s = sink(sim, -19, -16);
    sim.rebuildTopology();
    const item = (): ItemPacket => (type === 'wrapper' ? { type: 'bale', amount: 1 } : { type: 'hay', amount: 10 });
    const metric = () => (type === 'scannerMk1' ? sim.progress.stats.hayScanned : s.items.length);
    run(sim, 3, () => fill(sim, m, 0, item));
    const m0 = metric();
    run(sim, 60, () => fill(sim, m, 0, item));
    const st = (k: string) => sim.stat(k);
    const nominal = type === 'compressor' ? st('compressor.chambers') / st('compressor.cycle')
      : type === 'wrapper' ? 1 / st('wrapper.cycle') : st('scanner.batch') / st('scanner.cycle');
    return { measured: (metric() - m0) / 60, nominal };
  }
  const levelsOf = (base: string, node: string): NodeSpec[][] =>
    [[base], ...BY_ID.get(node)!.levels.map((_, i): NodeSpec[] => [base, [node, i + 1]])];

  it('Scan Speed: the MK1 scanner delivers exactly batch / cycle at every level', () => {
    for (const nodes of levelsOf('d_scanner', 'd_speed')) {
      const r = processRate('scannerMk1', nodes);
      expect(r.measured / r.nominal, `${JSON.stringify(nodes)}: ${r.measured} vs ${r.nominal}`).toBeCloseTo(1, 2);
    }
  });

  /**
   * Compressor chambers and the Wrapper carry the sub-tick remainder of each cycle (they used to reset it to 0,
   * rounding every cycle up to whole 50 ms ticks: base compressor 57.3 instead of 60 hay/s, Wrap Speed I +25%
   * instead of +30%). Output is counted in whole items over a 60 s window, so the bound is one item per window.
   */
  it('Compressor and Wrapper deliver their nominal rate at every speed level', () => {
    for (const [type, nodes] of [
      ...levelsOf('e_compressor', 'e_comp_speed').map((n) => ['compressor', n] as const),
      ...levelsOf('e_wrapper', 'e_wrap_speed').map((n) => ['wrapper', n] as const),
    ]) {
      const r = processRate(type, nodes);
      const itemsOff = Math.abs(r.measured - r.nominal) * 60;
      expect(itemsOff, `${type} ${JSON.stringify(nodes)}: ${r.measured.toFixed(3)}/s vs nominal ${r.nominal.toFixed(3)}/s`).toBeLessThanOrEqual(1.001);
    }
  });

  // ----- Generator ---------------------------------------------------------------------------------
  /** Generator + a fixed 30 P consumer; returns [hay burned per s, supply]. */
  function generatorRun(nodes: NodeSpec[]): [number, number] {
    const sim = newSim(nodes);
    const g = generator(sim, -24, QZ);
    const c = g.center;
    const load = new FixedLoad({ id: nextId++, type: 'wrapper', cell: { x: Math.floor(c.x) + 3, z: Math.floor(c.z), level: 0 }, rot: 0 }, 30);
    sim.buildings.set(load.id, load);
    sim.markTopologyDirty();
    run(sim, 1);
    const h0 = sim.progress.stats.hayBurned;
    run(sim, 20);
    expect(load.network).toBe(g.network);
    expect(load.powerSatisfaction).toBe(1);
    return [(sim.progress.stats.hayBurned - h0) / 20, sim.power.totalSupply];
  }

  it('Fuel Efficiency: less hay burned for the same load and the same power', () => {
    const [burnA, supplyA] = generatorRun(['f_firebox']);
    const [burnB, supplyB] = generatorRun(['f_firebox', 'f_fuel_eff']);
    const mul = effectValue('f_fuel_eff', 'generator.burnRate');
    expect(burnA).toBeGreaterThan(0.2);
    expect(burnB / burnA).toBeCloseTo(mul, 2);
    expect(supplyB).toBeCloseTo(supplyA, 6);
  });

  it('Industrial Generator: generators make 2x power (on top of Generator Output)', () => {
    const [, supplyA] = generatorRun(['f_gen_output', 'f_fuel_eff']);
    const [, supplyB] = generatorRun(['f_gen_output', 'f_fuel_eff', 'f_industrial_gen']);
    expect(supplyB / supplyA).toBeCloseTo(effectValue('f_industrial_gen', 'generator.output'), 2);
  });

  // ----- Power Poles -------------------------------------------------------------------------------
  it('Pole Range: a consumer out of the base pole range gets powered after the upgrade', () => {
    const sim = newSim(['f_pole', 'e_compressor']);
    const g = generator(sim, -28, -20);
    const pole = place(sim, 'powerPole', -21, -19, 0);
    const comp = place(sim, 'compressor', -12, -19, 0);
    const d = Math.hypot(comp.center.x - pole.center.x, comp.center.z - pole.center.z);
    expect(d).toBeGreaterThan(sim.stat('pole.range'));
    run(sim, 0.5);
    expect(pole.network).toBe(g.network);
    expect(comp.network).toBe(-1);
    expect(comp.status).toBe('noPower');
    unlock(sim, 'f_pole_range');
    expect(d).toBeLessThanOrEqual(sim.stat('pole.range'));
    run(sim, 0.5);
    expect(comp.network).toBe(g.network);
    expect(comp.status).not.toBe('noPower');
    expect(sim.power.feeds.some((f) => f.from === pole.id && f.to === comp.id)).toBe(true);
  });

  it('Connection Limit: the 7th machine on a pole gets powered after the upgrade', () => {
    const sim = newSim(['f_pole', 'x_arm']);
    const g = generator(sim, -28, -20);
    const pole = place(sim, 'powerPole', -20, -19, 0);
    const base = sim.stat('pole.connections');
    const spots: [number, number][] = [[-18, -21], [-17, -21], [-16, -21], [-15, -21], [-18, -16], [-17, -16], [-16, -16], [-15, -16]];
    const arms = spots.slice(0, base + 1).map(([x, z]) => place(sim, 'roboticArm', x, z, 0));
    run(sim, 0.5);
    const fed = () => arms.filter((a) => a.network === g.network).length;
    expect(fed()).toBe(base);
    expect(arms[arms.length - 1].network).toBe(-1);
    unlock(sim, 'f_pole_conn');
    run(sim, 0.5);
    expect(fed()).toBe(arms.length);
    expect(sim.power.feeds.filter((f) => f.from === pole.id).length).toBe(arms.length);
  });

  it('Power Loss Reduction raises delivered supply accordingly', () => {
    const supply = (nodes: NodeSpec[]): number => {
      const sim = newSim(['f_pole', ...nodes]);
      generator(sim, -24, QZ);
      run(sim, 1);
      return sim.power.totalSupply;
    };
    const a = supply(['f_pole_range']);
    const b = supply(['f_pole_range', 'f_power_loss']);
    const lossAfter = effectValue('f_power_loss', 'power.loss');
    expect(b / a).toBeCloseTo((1 - lossAfter) / (1 - newSim([]).stat('power.loss')), 4);
  });
});
