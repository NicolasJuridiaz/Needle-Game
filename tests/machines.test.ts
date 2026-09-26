/**
 * Machines & Power (docs/ARCHITECTURE.md §4.3) with the real Sim / HayField / Progression.
 * Belts are not needed: a tiny direct-link logistics (port-to-port links per §4.2 "Linking", no
 * conveyors) is installed on the Sim so machine outputs can feed an adjacent machine input.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BASE_STATS } from '../src/config/stats';
import { TECH_NODES } from '../src/config/techTree';
import { WORLD } from '../src/config/world';
import type { GameEvents } from '../src/core/events';
import { Building, type BuildingInit } from '../src/sim/building';
import { neighbor, resolvePorts } from '../src/sim/grid';
import type { SimContext } from '../src/sim/interfaces';
import { MACHINE_CLASSES } from '../src/sim/machines/index';
import { Sim } from '../src/sim/sim';
import { oppositeDir, type BuildingType, type Cell, type ItemPacket, type Rot, type WorldPort } from '../src/sim/types';

const DT = BALANCE.tickDt;

function run(sim: Sim, seconds: number, each?: () => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) { sim.tick(DT); each?.(); }
}

/** Port-to-port logistics without belts (the real Logistics may still be a stub). */
function installDirectLinks(sim: Sim): void {
  const lg = sim.logistics as unknown as Record<string, unknown>;
  lg.relink = () => {
    for (const b of sim.buildings.values()) b.links.fill(null);
    const taken = new Set<string>();
    const sorted = [...sim.buildings.values()].sort((a, b) => a.id - b.id);
    for (const b of sorted) {
      for (const p of b.ports) {
        if (p.kind !== 'out') continue;
        const n = neighbor(p.cell, p.dir);
        const t = sim.buildingAtCell(n.x, n.z, n.level);
        if (!t || t === b) continue;
        const idx = t.inputPortAt(n, oppositeDir(p.dir));
        if (idx < 0 || taken.has(`${t.id}:${idx}`)) continue;
        taken.add(`${t.id}:${idx}`);
        b.links[p.index] = { target: t, port: idx };
      }
    }
  };
  const canPush = (from: Building, port: number, item: ItemPacket) => {
    const l = from.links[port];
    return !!l && l.target.canAccept(item, l.port, sim);
  };
  lg.isLinked = (from: Building, port: number) => !!from.links[port];
  lg.canPushOut = canPush;
  lg.pushOut = (from: Building, port: number, item: ItemPacket) => {
    if (!canPush(from, port, item)) return false;
    const l = from.links[port]!;
    l.target.accept(item, l.port, sim);
    return true;
  };
}

function unlock(sim: Sim, ids: string[]): void {
  sim.progress.addWP(10_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const want = new Set<string>();
  const add = (id: string) => { if (want.has(id)) return; want.add(id); for (const r of byId.get(id)!.requires) add(r); };
  ids.forEach(add);
  for (let pass = 0; pass < 20; pass++) for (const id of want) while (sim.progress.canUnlock(id).ok) sim.progress.unlock(id);
  for (const id of ids) expect(sim.progress.isUnlocked(id), `unlock ${id}`).toBe(true);
  sim.rebuildTopology();
}

function newSim(seed: number, nodes: string[]): Sim {
  const sim = new Sim(seed);
  installDirectLinks(sim);
  sim.progress.addMoney(50_000_000, 'milestone');
  sim.player.pos = { x: -28, y: 0, z: -18 };
  unlock(sim, nodes);
  return sim;
}

function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot = 0): Building {
  const cell: Cell = { x, z, level: 0 };
  const chk = sim.canPlace(type, cell, rot);
  expect(chk.ok, `place ${type} at ${x},${z} rot ${rot}: ${chk.reason}`).toBe(true);
  const b = sim.place(type, cell, rot)!;
  expect(b).not.toBeNull();
  sim.rebuildTopology();
  return b;
}

/** Places `type` so that one of its input ports receives from `out` (first valid cell/rotation). */
function placeAt(sim: Sim, type: BuildingType, out: WorldPort): Building {
  const target = neighbor(out.cell, out.dir);
  const face = oppositeDir(out.dir);
  for (let rot = 0 as Rot; rot < 4; rot = (rot + 1) as Rot) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        const cell: Cell = { x: target.x + dx, z: target.z + dz, level: 0 };
        const ports = resolvePorts(type, cell, rot, undefined, (n) => sim.progress.isUnlocked(n));
        if (!ports.some((p) => p.kind === 'in' && p.dir === face && p.cell.x === target.x && p.cell.z === target.z)) continue;
        if (!sim.canPlace(type, cell, rot).ok) continue;
        return place(sim, type, cell.x, cell.z, rot);
      }
    }
  }
  throw new Error(`no placement for ${type}`);
}

/** Hand-feeds a generator (player carry). */
function fuel(sim: Sim, gen: Building, hay = 150): void {
  sim.player.carry.add('hay', hay);
  expect(gen.interact(sim)).toBe(true);
}

/** Pushes packets straight into an input port. Returns how many were accepted. */
function feed(sim: Sim, b: Building, port: number, item: ItemPacket, count: number): number {
  let n = 0;
  for (let i = 0; i < count; i++) if (b.canAccept(item, port, sim)) { b.accept({ ...item }, port, sim); n++; }
  return n;
}

function inPort(b: Building): number { return b.ports.find((p) => p.kind === 'in')!.index; }

/** A consumer with a fixed power draw, inserted without grid occupancy (power tests). */
class FixedLoad extends Building {
  constructor(init: BuildingInit, public draw: number) { super(init); }
  override powerDraw(_ctx: SimContext): number { return this.draw; }
}

function addLoad(sim: Sim, id: number, x: number, z: number, draw: number): FixedLoad {
  const b = new FixedLoad({ id, type: 'wrapper', cell: { x, z, level: 0 }, rot: 0 }, draw);
  sim.buildings.set(id, b);
  sim.power.rebuild();
  return b;
}

const EDGE_X = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2; // just west of the pile

describe('machine registry', () => {
  it('registers every behaviour class', () => {
    for (const t of ['sellStation', 'hopper', 'pistonRake', 'roboticArm', 'vacuumCollector', 'scannerMk1', 'scannerMk2',
      'compressor', 'wrapper', 'silo', 'hayGenerator'] as BuildingType[]) {
      expect(MACHINE_CLASSES[t], t).toBeDefined();
    }
  });
});

describe('extraction', () => {
  it('piston rake fills its tray and unloads into a linked hopper', () => {
    const sim = newSim(3, ['x_rake', 'x_hopper', 'f_generator']);
    const gen = place(sim, 'hayGenerator', EDGE_X - 3, -4, 0);
    fuel(sim, gen);
    const rake = place(sim, 'pistonRake', EDGE_X - 1, 0, 0);
    const hopper = placeAt(sim, 'hopper', rake.outPorts()[0]);
    expect(sim.logistics.isLinked(rake, rake.outPorts()[0].index)).toBe(true);
    const cycles: number[] = [];
    sim.events.on('machine:cycle', (e) => { if (e.id === rake.id) cycles.push(e.id); });
    run(sim, 12);
    expect(rake.status).not.toBe('noPower');
    expect(rake.network).toBeGreaterThanOrEqual(0);
    expect(sim.progress.stats.hayExtractedMachine).toBeGreaterThan(50);
    expect(hopper.contents().hay).toBeGreaterThan(30);
    expect(cycles.length).toBeGreaterThan(2);
    expect(rake.anim.width).toBeCloseTo(sim.stat('rake.width'));
    const info = rake.info(sim);
    expect(info.lines.length).toBeGreaterThanOrEqual(3);
    expect(info.lines.some((l) => l.label === 'Power')).toBe(true);
  });

  it('robotic arm moves ~10 hay/s (within 25%)', () => {
    const sim = newSim(5, ['x_arm', 'x_hopper', 'f_generator']);
    const gen = place(sim, 'hayGenerator', EDGE_X - 4, -5, 0);
    fuel(sim, gen, 150);
    const arm = place(sim, 'roboticArm', EDGE_X, 0, 3); // drops north, pile to the east
    const hopper = placeAt(sim, 'hopper', arm.outPorts()[0]);
    run(sim, 5, () => hopper.clearContents());
    const a0 = sim.progress.stats.hayExtractedArm;
    run(sim, 60, () => { if (hopper.contents().hay > 300) hopper.clearContents(); if (gen.contents().hay < 20) fuel(sim, gen, 100); });
    const rate = (sim.progress.stats.hayExtractedArm - a0) / 60;
    expect(arm.powerSatisfaction).toBe(1);
    expect(rate).toBeGreaterThan(7.5);
    expect(rate).toBeLessThan(12.5);
  });
});

describe('detection', () => {
  it('scanner MK1 detects a hidden needle deterministically and stops without auto-eject', () => {
    const sim = newSim(11, ['d_scanner', 'f_generator']);
    const gen = place(sim, 'hayGenerator', -24, -14, 0);
    fuel(sim, gen);
    const sc = place(sim, 'scannerMk1', -22, -10, 0);
    const needle = sim.hay.needles[0];
    needle.status = 'inTransit';
    const alarms: GameEvents['scanner:alarm'][] = [];
    sim.events.on('scanner:alarm', (e) => alarms.push(e));
    const port = inPort(sc);
    expect(feed(sim, sc, port, { type: 'hay', amount: 10 }, 1)).toBe(1);
    expect(feed(sim, sc, port, { type: 'hay', amount: 10, needleId: needle.id }, 1)).toBe(1);
    expect(feed(sim, sc, port, { type: 'hay', amount: 10 }, 3)).toBe(3);
    run(sim, 1);
    expect(sim.progress.needlesFound).toContain(needle.id);
    expect(needle.foundBy).toBe('scanner');
    expect(alarms.length).toBe(1);
    expect(sc.status).toBe('needleAlarm');
    expect(sc.anim.alarm).toBe(1);
    const scanned = sim.progress.stats.hayScanned;
    run(sim, sim.stat('scanner.alarmTime') - 1.5);
    expect(sc.status).toBe('needleAlarm');
    expect(sim.progress.stats.hayScanned).toBe(scanned); // stopped
    run(sim, 3);
    expect(sc.status).not.toBe('needleAlarm');
    expect(sim.progress.stats.hayScanned).toBe(50);
  });

  it('an unscanned needle reaching the Market Chute slips through and is tossed back', () => {
    const sim = newSim(12, []);
    const s = sim.sellStation!;
    const needle = sim.hay.needles[1];
    needle.status = 'inTransit';
    const returned: number[] = [];
    sim.events.on('needle:returned', (e) => returned.push(e.id));
    feed(sim, s, inPort(s), { type: 'hay', amount: 10, needleId: needle.id }, 1);
    expect(returned).toEqual([needle.id]);
    expect(sim.progress.needlesFound).not.toContain(needle.id);
    expect(['buried', 'exposed']).toContain(needle.status);
    expect(sim.progress.stats.haySold).toBeCloseTo(10);
  });
});

describe('processing', () => {
  it('compressor presses 40 hay into 1 bale; unscanned needles slip through', () => {
    const sim = newSim(14, ['e_compressor', 'f_generator']);
    const gen = place(sim, 'hayGenerator', -24, -14, 0);
    fuel(sim, gen);
    const comp = place(sim, 'compressor', -22, -10, 0);
    const needle = sim.hay.needles[2];
    needle.status = 'inTransit';
    const port = inPort(comp);
    let fed = 0;
    fed += 10 * feed(sim, comp, port, { type: 'hay', amount: 10, needleId: needle.id }, 1);
    for (let i = 0; i < 300 && fed < 440; i++) {
      fed += 10 * feed(sim, comp, port, { type: 'hay', amount: 10 }, 1);
      run(sim, 0.1);
    }
    expect(fed).toBe(440);
    run(sim, 5);
    // 440 hay -> 11 bales: 10 wait in the output queue, the 11th is stuck in the chamber.
    const inv = comp.contents();
    expect(inv.bale).toBe(10);
    expect(inv.hay).toBeCloseTo(40, 5);
    expect(sim.progress.stats.needlesReturned).toBe(1);
    // Output not connected: bales wait (max 10) and the player can take them.
    expect(comp.status).toBe('outputBlocked');
    expect(comp.interaction(sim)?.kind).toBe('take');
    expect(comp.interact(sim)).toBe(true);
    expect(sim.player.carry.bale).toBeGreaterThanOrEqual(1);
  });

  it('compressor bales flow into a linked wrapper; wrapped bales can be taken by hand', () => {
    const sim = newSim(15, ['e_compressor', 'e_wrapper', 'f_generator']);
    const gen = place(sim, 'hayGenerator', -22, -16, 0);
    fuel(sim, gen);
    const comp = place(sim, 'compressor', -22, -12, 0);
    const wrap = placeAt(sim, 'wrapper', comp.outPorts()[0]);
    expect(sim.logistics.isLinked(comp, comp.outPorts()[0].index)).toBe(true);
    const port = inPort(comp);
    for (let i = 0; i < 300; i++) { feed(sim, comp, port, { type: 'hay', amount: 10 }, 1); run(sim, 0.1); }
    run(sim, 5);
    const w = wrap.contents();
    expect(w.wrapped).toBeGreaterThan(0);
    expect(wrap.anim.premium).toBe(0);
    // Take wrapped bales by hand.
    const before = sim.player.carry.wrapped;
    expect(wrap.interact(sim)).toBe(true);
    expect(sim.player.carry.wrapped).toBeGreaterThan(before);
  });

  it('save/load keeps processing and generator state', () => {
    const sim = newSim(16, ['e_compressor', 'e_wrapper', 'f_generator']);
    const gen = place(sim, 'hayGenerator', -24, -16, 0);
    fuel(sim, gen, 120);
    const comp = place(sim, 'compressor', -22, -12, 0);
    feed(sim, comp, inPort(comp), { type: 'hay', amount: 10 }, 12);
    run(sim, 1.2);
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = Sim.fromSave(data);
    const comp2 = sim2.buildings.get(comp.id)!;
    const gen2 = sim2.buildings.get(gen.id)!;
    expect(comp2.contents().counts()).toEqual(comp.contents().counts());
    expect(gen2.contents().hay).toBeCloseTo(gen.contents().hay, 6);
  });
});

describe('power', () => {
  it('generator burns fuel proportionally to its load', () => {
    const burnt = (draw: number): number => {
      const sim = newSim(20, ['f_generator']);
      const gen = place(sim, 'hayGenerator', -24, -14, 0);
      fuel(sim, gen, 150);
      const c = gen.center;
      addLoad(sim, 9001, Math.floor(c.x) + 3, Math.floor(c.z), draw);
      run(sim, 0.1);
      const h0 = sim.progress.stats.hayBurned;
      run(sim, 10);
      return sim.progress.stats.hayBurned - h0;
    };
    const out = sim0Output();
    const half = burnt(out * 0.25);
    const full = burnt(out * 0.5);
    const rate = (x: number) => x / 10;
    expect(rate(half)).toBeCloseTo(2 * 0.25, 1); // burnRate 2 hay/s x load 0.25
    expect(full / half).toBeCloseTo(2, 1);
  });

  it('idle generator (no demand) only burns its pilot flame; empty firebox -> noFuel; feeding emits generator:fed', () => {
    const sim = newSim(21, ['f_generator']);
    const gen = place(sim, 'hayGenerator', -24, -14, 0);
    run(sim, 0.2);
    expect(gen.status).toBe('noFuel');
    const fed: number[] = [];
    sim.events.on('generator:fed', (e) => fed.push(e.amount));
    fuel(sim, gen, 50);
    expect(fed).toEqual([50]);
    run(sim, 5);
    expect(gen.status).toBe('idle');
    // pilot flame: burnRate (2 hay/s) x generatorPilotBurn (0.25) x 5 s = 2.5 hay
    expect(gen.contents().hay).toBeCloseTo(50 - 2 * 0.25 * 5, 1);
    expect(sim.progress.stats.hayBurned).toBeCloseTo(2.5, 1);
    expect(sim.power.totalSupply).toBeCloseTo(60 * 0.9);
  });

  it('overload -> satisfaction < 1 and machines slow down proportionally (no shutdown)', () => {
    const produced = (extraDraw: number): { bales: number; sat: number } => {
      const sim = newSim(22, ['e_compressor', 'f_generator', 'f_firebox']);
      const gen = place(sim, 'hayGenerator', -24, -16, 0);
      fuel(sim, gen, 500);
      const comp = place(sim, 'compressor', -22, -12, 0);
      if (extraDraw > 0) addLoad(sim, 9002, -21, -17, extraDraw);
      const sink = placeAt(sim, 'hopper', comp.outPorts()[0]);
      const port = inPort(comp);
      let bales = 0;
      sim.events.on('machine:cycle', (e) => { if (e.id === comp.id) bales++; });
      run(sim, 20, () => {
        feed(sim, comp, port, { type: 'hay', amount: 10 }, 16);
        sink.clearContents();
      });
      return { bales, sat: comp.powerSatisfaction };
    };
    const full = produced(0);
    // supply 54 P; compressor 25 P + 83 P extra = 108 P -> 50 %
    const half = produced(83);
    expect(full.sat).toBe(1);
    expect(half.sat).toBeGreaterThan(0.45);
    expect(half.sat).toBeLessThan(0.55);
    expect(half.bales / full.bales).toBeGreaterThan(0.4);
    expect(half.bales / full.bales).toBeLessThan(0.6);
  });

  it('disconnected machines report noPower; poles extend the network', () => {
    const sim = newSim(23, ['e_compressor', 'f_generator', 'f_pole']);
    const comp = place(sim, 'compressor', -12, -16, 0);
    run(sim, 0.5);
    expect(comp.network).toBe(-1);
    expect(comp.status).toBe('noPower');
    expect(comp.info(sim).statusText).toMatch(/No power/);
    const gen = place(sim, 'hayGenerator', -26, -16, 0);
    fuel(sim, gen);
    run(sim, 0.5);
    expect(comp.status).toBe('noPower'); // too far for a direct connection
    const g = gen.center, c = comp.center;
    // A pole line from the generator towards the compressor.
    const p1 = place(sim, 'powerPole', Math.floor(g.x) + 4, Math.floor(g.z) + 2, 0);
    expect(sim.power.networkAt(c.x, c.z)).toBe(-1);
    const p2 = place(sim, 'powerPole', Math.floor(c.x) - 3, Math.floor(c.z) + 2, 0);
    run(sim, 0.5);
    expect(sim.power.wires.some((w) => (w.a === p1.id && w.b === p2.id) || (w.a === p2.id && w.b === p1.id))).toBe(true);
    expect(sim.power.wires.some((w) => w.a === gen.id || w.b === gen.id)).toBe(true);
    expect(sim.power.feeds.some((f) => f.from === p2.id && f.to === comp.id)).toBe(true);
    expect(comp.network).toBe(gen.network);
    expect(comp.status).not.toBe('noPower');
    expect(sim.power.networkAt(c.x, c.z)).toBe(gen.network);
    // Removing the middle link cuts the power.
    expect(sim.remove(p1.id)).toBe(true);
    run(sim, 0.5);
    expect(comp.status).toBe('noPower');
    expect(comp.info(sim).statusText).toMatch(/Hay Generator/);
  });

  it('pole connection limit and pole range upgrades rebuild the network', () => {
    const sim = newSim(24, ['f_generator', 'f_pole']);
    const gen = place(sim, 'hayGenerator', -26, -18, 0);
    fuel(sim, gen);
    const g = gen.center;
    const pole = place(sim, 'powerPole', Math.floor(g.x) + 12, Math.floor(g.z), 0);
    run(sim, 0.1);
    // 10 m apart: out of the 8 m base range.
    expect(pole.network).not.toBe(gen.network);
    unlock(sim, ['f_pole_range']);
    run(sim, 0.1);
    expect(pole.network).toBe(gen.network);
    // Connection limit: 6 consumers per pole, the 7th is not attached (too far from the generator).
    const pc = pole.center;
    for (let i = 0; i < 7; i++) addLoad(sim, 9100 + i, Math.floor(pc.x) + 2, Math.floor(pc.z) - 3 + i, 5);
    run(sim, 0.1);
    const attached = sim.power.feeds.filter((f) => f.from === pole.id).length;
    expect(attached).toBe(sim.stat('pole.connections'));
    expect(sim.buildings.get(9106)!.network).toBe(-1);
  });
});

function sim0Output(): number { return BASE_STATS['generator.output']; }
