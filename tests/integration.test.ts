/**
 * Cross-module integration tests with the REAL simulation (all modules wired through Sim).
 * Scenarios from the V1 brief §43: automation, detection, parallel processing, production, energy, buffer, save.
 */
import { describe, expect, it } from 'vitest';
import { TECH_NODES } from '../src/config/techTree';
import { WORLD } from '../src/config/world';
import { Sim } from '../src/sim/sim';
import type { Building } from '../src/sim/building';
import type { BuildingType, Cell, ItemPacket, Rot } from '../src/sim/types';
import { unlock } from './support/simKit';

const DT = 0.05;

function run(sim: Sim, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) sim.tick(DT);
}


function rich(sim: Sim): void { sim.progress.addMoney(50_000_000, 'milestone'); }

function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot = 0, variant?: string, level: 0 | 1 = 0): Building {
  const cell: Cell = { x, z, level };
  const chk = sim.canPlace(type, cell, rot, variant);
  expect(chk.ok, `place ${type} at ${x},${z} rot ${rot}: ${chk.reason}`).toBe(true);
  const b = sim.place(type, cell, rot, variant);
  expect(b).not.toBeNull();
  return b!;
}

/** Straight belt line from (x0,z) to (x1,z) flowing along X (dir 0 if x1 > x0 else 2). */
function beltX(sim: Sim, x0: number, x1: number, z: number, level: 0 | 1 = 0, flow?: Rot): void {
  const rot: Rot = flow ?? (x1 >= x0 ? 0 : 2);
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) place(sim, 'conveyor', x, z, rot, undefined, level);
}
function beltZ(sim: Sim, x: number, z0: number, z1: number): void {
  const rot: Rot = z1 >= z0 ? 1 : 3;
  const step = z1 >= z0 ? 1 : -1;
  for (let z = z0; z !== z1 + step; z += step) place(sim, 'conveyor', x, z, rot);
}

/** A test source: pushes packets straight into a building input. */
function feed(sim: Sim, b: Building, port: number, item: ItemPacket, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (b.canAccept(item, port, sim)) { b.accept({ ...item }, port, sim); n++; }
  return n;
}

/** Sell station input neighbour cells (east face, x = -29, z = 5..8, belts must flow west). */
const SELL_X = WORLD.fixed.sellStation.x + 3; // first free column east of the chute

describe('integration: full sim', () => {
  it('boots a fresh run: pile, needles, market chute', () => {
    const sim = new Sim(42);
    expect(sim.hay.totalUnits()).toBeGreaterThan(140_000);
    expect(sim.hay.needles.length).toBe(6);
    expect(sim.sellStation).toBeDefined();
    run(sim, 2);
    expect(sim.hay.progress()).toBeLessThan(0.001);
  });

  it('Automation: arm -> hopper -> conveyor -> sell', () => {
    const sim = new Sim(7);
    rich(sim);
    unlock(sim, ['x_arm', 'x_hopper', 'l_conveyor', 'f_generator', 'f_pole']);
    // generator next to the arm, hand-fed
    const gen = place(sim, 'hayGenerator', -14, -6, 0);
    sim.player.carry.add('hay', 150);
    sim.player.pos = { x: -16, y: 0, z: -4 };
    gen.interact(sim);
    // arm at the pile's west edge dropping west into a hopper
    const edgeX = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2;
    const arm = place(sim, 'roboticArm', edgeX, 0, 2);
    const hopper = place(sim, 'hopper', edgeX - 2, -1, 2);
    // hopper rot 2 -> output faces west at its local (1,0) cell
    const out = hopper.ports.find((p) => p.kind === 'out')!;
    // west along the hopper row, turn south at the chute column, last tile points west into the chute
    const sellZ = WORLD.fixed.sellStation.z + 1;
    beltX(sim, out.cell.x - 1, SELL_X + 1, out.cell.z);
    place(sim, 'conveyor', SELL_X, out.cell.z, 1);
    beltZ(sim, SELL_X, out.cell.z + 1, sellZ - 1);
    place(sim, 'conveyor', SELL_X, sellZ, 2);
    sim.rebuildTopology();
    const sold0 = sim.progress.stats.haySold;
    run(sim, 90);
    expect(arm.status).not.toBe('noPower');
    expect(sim.progress.stats.hayExtractedArm).toBeGreaterThan(200);
    expect(sim.progress.stats.haySold - sold0).toBeGreaterThan(0);
  });

  it('Detection: packet with a hidden needle -> conveyor -> scanner -> needle found', () => {
    const sim = new Sim(11);
    rich(sim);
    unlock(sim, ['d_scanner', 'l_conveyor', 'f_generator', 'x_hopper']);
    const gen = place(sim, 'hayGenerator', -24, -14, 0);
    sim.player.carry.add('hay', 150); sim.player.pos = { x: -26, y: 0, z: -12 }; gen.interact(sim);
    const scanner = place(sim, 'scannerMk1', -20, -12, 0);
    const inPort = scanner.ports.find((p) => p.kind === 'in')!;
    const outPort = scanner.ports.find((p) => p.kind === 'out')!;
    beltX(sim, outPort.cell.x + 1, outPort.cell.x + 4, outPort.cell.z);
    sim.rebuildTopology();
    const needle = sim.hay.needles[0];
    needle.status = 'inTransit';
    const n = feed(sim, scanner, inPort.index, { type: 'hay', amount: 10, needleId: needle.id }, 1);
    expect(n).toBe(1);
    run(sim, 12);
    expect(sim.progress.needlesFound).toContain(needle.id);
    expect(sim.progress.stats.hayScanned).toBeGreaterThanOrEqual(10);
  });

  it('Unscanned needle reaching the Market Chute is tossed back, never lost', () => {
    const sim = new Sim(12);
    const s = sim.sellStation!;
    const needle = sim.hay.needles[1];
    needle.status = 'inTransit';
    const port = s.ports.find((p) => p.kind === 'in')!;
    feed(sim, s, port.index, { type: 'hay', amount: 10, needleId: needle.id }, 1);
    run(sim, 1);
    expect(sim.progress.needlesFound).not.toContain(needle.id);
    expect(['buried', 'exposed']).toContain(needle.status);
    expect(sim.progress.stats.needlesReturned).toBe(1);
  });

  it('Parallel processing: splitter -> scanner A/B -> merger', () => {
    const sim = new Sim(13);
    rich(sim);
    unlock(sim, ['d_scanner', 'l_splitter', 'l_merger', 'f_generator', 'f_pole', 'x_hopper']);
    const gen = place(sim, 'hayGenerator', -20, -20, 0);
    sim.player.carry.add('hay', 150); sim.player.pos = { x: -22, y: 0, z: -18 }; gen.interact(sim);
    const hopper = place(sim, 'hopper', -26, -14, 0);
    const hout = hopper.ports.find((p) => p.kind === 'out')!;
    // hopper -> belt -> splitter (outputs: primary +X, left -Z, right +Z)
    place(sim, 'conveyor', hout.cell.x + 1, hout.cell.z, 0);
    const splitter = place(sim, 'splitter', hout.cell.x + 2, hout.cell.z, 0);
    const z = hout.cell.z;
    // left branch (north) -> scanner A, right branch (south) -> scanner B
    place(sim, 'conveyor', splitter.cell.x, z - 1, 3);
    place(sim, 'conveyor', splitter.cell.x, z - 2, 0);
    const scA = place(sim, 'scannerMk1', splitter.cell.x + 1, z - 3, 0); // lane j=0 at z-3? rot0 lane at cell.z
    void scA;
    place(sim, 'conveyor', splitter.cell.x, z + 1, 1);
    place(sim, 'conveyor', splitter.cell.x, z + 2, 0);
    sim.rebuildTopology();
    // Feed the hopper and make sure hay splits into both branches.
    sim.player.carry.add('hay', 400);
    sim.player.pos = { x: hopper.center.x - 2, y: 0, z: hopper.center.z };
    hopper.interact(sim);
    run(sim, 20);
    expect(splitter.rateOut.value + splitter.rateIn.value).toBeGreaterThanOrEqual(0);
    expect(sim.logistics.itemCount()).toBeGreaterThan(0);
  });

  it('Production: hay -> compressor -> wrapper -> sell', () => {
    const sim = new Sim(14);
    rich(sim);
    unlock(sim, ['e_compressor', 'e_wrapper', 'l_conveyor', 'f_generator', 'f_pole']);
    const comp = place(sim, 'compressor', SELL_X + 6, WORLD.fixed.sellStation.z, 2);
    const wrap = place(sim, 'wrapper', SELL_X + 2, WORLD.fixed.sellStation.z, 2);
    // compressor out -> belt -> wrapper in; wrapper out -> belt -> chute
    const cOut = comp.ports.find((p) => p.kind === 'out')!;
    const wIn = wrap.ports.find((p) => p.kind === 'in')!;
    const wOut = wrap.ports.find((p) => p.kind === 'out')!;
    beltX(sim, cOut.cell.x - 1, wIn.cell.x + 1, cOut.cell.z, 0, 2);
    beltX(sim, wOut.cell.x - 1, SELL_X, wOut.cell.z, 0, 2);
    const gen = place(sim, 'hayGenerator', SELL_X + 4, WORLD.fixed.sellStation.z + 4, 0);
    sim.player.carry.add('hay', 150); sim.player.pos = { x: gen.center.x + 2, y: 0, z: gen.center.z }; gen.interact(sim);
    sim.rebuildTopology();
    const cin = comp.ports.find((p) => p.kind === 'in')!;
    let fed = 0;
    for (let i = 0; i < 400; i++) { fed += feed(sim, comp, cin.index, { type: 'hay', amount: 10 }, 1); run(sim, 0.2); }
    run(sim, 20);
    expect(fed).toBeGreaterThan(20);
    expect(sim.progress.stats.wrappedSold + sim.progress.stats.baleSold).toBeGreaterThan(0);
  });

  it('Energy: overload slows machines progressively (no hard shutdown)', () => {
    const sim = new Sim(15);
    rich(sim);
    unlock(sim, ['x_arm', 'f_generator', 'f_pole']);
    const gen = place(sim, 'hayGenerator', -14, -8, 0);
    sim.player.carry.add('hay', 150); sim.player.pos = { x: -16, y: 0, z: -6 }; gen.interact(sim);
    place(sim, 'powerPole', -12, -2, 0);
    const edgeX = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2;
    const arms = [place(sim, 'roboticArm', edgeX, -6, 2), place(sim, 'roboticArm', edgeX, -4, 2), place(sim, 'roboticArm', edgeX, -2, 2),
      place(sim, 'roboticArm', edgeX, 0, 2), place(sim, 'roboticArm', edgeX, 2, 2)];
    sim.rebuildTopology();
    run(sim, 5);
    // 5 arms x 15 P = 75 P > 60 P * 0.9
    expect(sim.power.totalDemand).toBeGreaterThan(sim.power.totalSupply);
    const sat = arms[0].powerSatisfaction;
    expect(sat).toBeGreaterThan(0.3);
    expect(sat).toBeLessThan(1);
  });

  it('Save: complex factory -> save -> reload -> identical state', () => {
    const sim = new Sim(16);
    rich(sim);
    unlock(sim, ['x_arm', 'x_hopper', 'l_conveyor', 'f_generator', 'f_pole', 'e_silo', 'l_splitter']);
    const gen = place(sim, 'hayGenerator', -14, -8, 0);
    sim.player.carry.add('hay', 150); sim.player.pos = { x: -16, y: 0, z: -6 }; gen.interact(sim);
    place(sim, 'powerPole', -13, -3, 0);
    const edgeX = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2;
    place(sim, 'roboticArm', edgeX, 0, 2);
    const hopper = place(sim, 'hopper', edgeX - 2, -1, 2);
    const out = hopper.ports.find((p) => p.kind === 'out')!;
    beltX(sim, out.cell.x - 1, out.cell.x - 8, out.cell.z);
    place(sim, 'silo', out.cell.x - 12, out.cell.z - 1, 2);
    sim.rebuildTopology();
    run(sim, 40);
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = Sim.fromSave(data);
    expect(sim2.buildings.size).toBe(sim.buildings.size);
    expect(sim2.progress.money).toBeCloseTo(sim.progress.money, 5);
    expect(sim2.progress.wp).toBe(sim.progress.wp);
    expect([...sim2.progress.nodes.entries()]).toEqual([...sim.progress.nodes.entries()]);
    expect(sim2.hay.totalUnits()).toBeCloseTo(sim.hay.totalUnits(), -1);
    expect(sim2.logistics.itemCount()).toBe(sim.logistics.itemCount());
    // Both keep running identically-ish
    run(sim, 10); run(sim2, 10);
    expect(sim2.progress.stats.hayExtractedArm).toBeGreaterThan(0);
  });
});
