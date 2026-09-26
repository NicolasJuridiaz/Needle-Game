/**
 * ECONOMY / EXPLOIT AUDIT with the real Sim: no build/demolish/move loop, logistics path, machine, save/load or
 * sale can create money, items, Work Points or needles out of nothing.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES, LOGISTICS_TYPES } from '../src/config/buildables';
import { ITEMS } from '../src/config/items';
import { MILESTONES } from '../src/config/milestones';
import { NEEDLE_BUFFS } from '../src/config/needles';
import { ORDER_BY_ID } from '../src/config/orders';
import { TECH_BY_ID, TECH_NODES } from '../src/config/techTree';
import { Rng } from '../src/core/rng';
import type { Building } from '../src/sim/building';
import { neighbor } from '../src/sim/grid';
import { LogisticsBuilding } from '../src/sim/logistics/base';
import { Splitter, SPLITTER_MODES } from '../src/sim/logistics/index';
import { playerDig } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import { oppositeDir, type BuildingType, type Cell, type ItemPacket, type ItemType, type Rot, type SplitterMode } from '../src/sim/types';
import { Bot } from '../tools/balance/bot';
import {
  allContents, beltRun, expectNeedleInvariant, feed, findSpot, inPorts, logisticsContents, outPorts, parkPlayer, place,
  refuel, rich, run, tally, unlock,
} from './support/simKit';

const ALL_NODES = TECH_NODES.map((n) => n.id);

function fullSim(seed: number): Sim {
  const sim = new Sim(seed);
  parkPlayer(sim);
  unlock(sim, ALL_NODES);
  rich(sim);
  return sim;
}

const saleValue = (sim: Sim, item: ItemType, amount: number): number => amount * sim.stat(ITEMS[item].valueStat) * sim.stat('econ.saleMul');

interface Snap { hay: number; bale: number; wrapped: number; needles: number[] }
function snap(b: Building): Snap {
  const inv = b.contents();
  return { hay: inv.hay, bale: inv.bale, wrapped: inv.wrapped, needles: [...inv.needles].sort((a, c) => a - c) };
}

/** Marks a needle as picked up (test setup: it is about to be put inside a holder). */
function takeNeedle(sim: Sim, id: number): number {
  const n = sim.hay.needles.find((q) => q.id === id)!;
  n.status = 'inTransit';
  return id;
}

// =====================================================================================================
// Build / demolish / move
// =====================================================================================================

describe('economy: build, demolish and move', () => {
  const REMOVABLE = (Object.keys(BUILDABLES) as BuildingType[]).filter((t) => BUILDABLES[t].removable);

  it('a refund never exceeds what was paid and place -> remove never makes money (every removable type)', () => {
    const sim = fullSim(101);
    const ev = tally(sim, ['building:removed']);
    for (const type of REMOVABLE) {
      const level = BUILDABLES[type].levels.includes(0) ? 0 : 1;
      for (let cycle = 0; cycle < 3; cycle++) {
        const spot = findSpot(sim, type, -27, -12, -21, -14, level);
        expect(spot, `spot for ${type}`).not.toBeNull();
        const m0 = sim.progress.money;
        const cost = sim.nextCost(type);
        const b = sim.place(type, spot!.cell, spot!.rot);
        expect(b, type).not.toBeNull();
        const paid = m0 - sim.progress.money;
        expect(paid).toBeCloseTo(cost, 9);
        expect(paid).toBeGreaterThanOrEqual(0);
        expect(sim.remove(b!.id)).toBe(true);
        const refund = (ev['building:removed'].at(-1) as { refund: number }).refund;
        expect(refund, `${type} refund`).toBeLessThanOrEqual(paid + 1e-9);
        expect(refund).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(sim.progress.money)).toBe(true);
        expect(sim.progress.money, `${type} cycle ${cycle}`).toBeLessThanOrEqual(m0 + 1e-9);
      }
    }
  });

  it('buy-high / refund / rebuy-low loops with cost growth cannot make money', () => {
    const sim = fullSim(102);
    const growing = (Object.keys(BUILDABLES) as BuildingType[]).filter((t) => BUILDABLES[t].removable && BUILDABLES[t].costGrowth > 1);
    expect(growing.length).toBeGreaterThan(0);
    for (const type of growing) {
      const level = BUILDABLES[type].levels.includes(0) ? 0 : 1;
      const owned: Building[] = [];
      for (let i = 0; i < 3; i++) {
        const s = findSpot(sim, type, -28, -10, -21, -13, level)!;
        owned.push(sim.place(type, s.cell, s.rot)!);
      }
      for (let loop = 0; loop < 4; loop++) {
        const m0 = sim.progress.money;
        // Remove the CHEAPEST unit (lowers the next price), rebuy, then remove the most expensive one.
        expect(sim.remove(owned.shift()!.id)).toBe(true);
        const s = findSpot(sim, type, -28, -10, -21, -13, level)!;
        const b = sim.place(type, s.cell, s.rot)!;
        expect(b).not.toBeNull();
        owned.push(b);
        expect(sim.progress.money, `${type} loop ${loop}`).toBeLessThanOrEqual(m0 + 1e-9);
      }
      for (const b of owned) sim.remove(b.id);
      expect(sim.ownedCount(type)).toBe(0);
    }
  });

  it('a random place / remove sequence never ends with more money than it started with', () => {
    const sim = fullSim(103);
    const rng = new Rng(7);
    const types: BuildingType[] = ['hopper', 'silo', 'hayGenerator', 'conveyor', 'splitter', 'roboticArm', 'compressor', 'wrapper', 'scannerMk1', 'powerPole', 'merger'];
    const m0 = sim.progress.money;
    let paidTotal = 0;
    let refundTotal = 0;
    const ev = tally(sim, ['building:removed']);
    const mine: number[] = [];
    for (let op = 0; op < 200; op++) {
      if (mine.length && rng.next() < 0.45) {
        const id = mine.splice(rng.int(0, mine.length - 1), 1)[0];
        expect(sim.remove(id)).toBe(true);
        refundTotal += (ev['building:removed'].at(-1) as { refund: number }).refund;
      } else {
        const type = rng.pick(types);
        const s = findSpot(sim, type, -28, -10, -21, -13, 0);
        if (!s) continue;
        const before = sim.progress.money;
        const b = sim.place(type, s.cell, s.rot);
        if (!b) continue;
        paidTotal += before - sim.progress.money;
        mine.push(b.id);
      }
      expect(sim.progress.money).toBeLessThanOrEqual(m0 + 1e-6);
    }
    for (const id of mine) { sim.remove(id); refundTotal += (ev['building:removed'].at(-1) as { refund: number }).refund; }
    expect(refundTotal).toBeLessThanOrEqual(paidTotal + 1e-6);
    expect(sim.progress.money).toBeCloseTo(m0 - paidTotal + refundTotal, 6);
    expect(sim.progress.money).toBeLessThanOrEqual(m0);
    expect(sim.progress.stats.moneyEarned).toBe(50_000_000); // refunds are not "earned"
  });

  /** Builds one of each container type holding items (and a hidden needle where it can hold one). */
  function stockedFactory(sim: Sim): Building[] {
    const out: Building[] = [];
    const at = (type: BuildingType): Building => {
      const s = findSpot(sim, type, -28, -12, -21, -13, 0)!;
      const b = sim.place(type, s.cell, s.rot)!;
      out.push(b);
      return b;
    };
    const hopper = at('hopper');
    sim.player.carry.add('hay', 250, [takeNeedle(sim, 0)]);
    expect(hopper.interact(sim)).toBe(true);
    const silo = at('silo');
    sim.player.carry.add('hay', 300, [takeNeedle(sim, 1)]);
    sim.player.carry.add('bale', 5);
    sim.player.carry.add('wrapped', 2);
    expect(silo.interact(sim)).toBe(true);
    expect(sim.player.carry.isEmpty()).toBe(true);
    const comp = at('compressor');
    comp.loadState({ buffer: { hay: 70, needles: [[takeNeedle(sim, 2), 30]] }, chambers: [[40, 0.5]], out: 3 });
    const wrap = at('wrapper');
    wrap.loadState({ inBales: 4, hasBale: true, t: 0.3, out: 2 });
    const gen = at('hayGenerator');
    sim.player.carry.add('hay', 100, [takeNeedle(sim, 3)]);
    expect(gen.interact(sim)).toBe(true);
    const scanner = at('scannerMk1');
    sim.player.carry.add('hay', 45, [takeNeedle(sim, 4)]);
    expect(scanner.interact(sim)).toBe(true);
    const rake = at('pistonRake');
    rake.loadState({ tray: { hay: 55, needles: [takeNeedle(sim, 5)] } });
    const arm = at('roboticArm');
    arm.loadState({ load: { hay: 18 } });
    const col = at('vacuumCollector');
    col.loadState({ buffer: { hay: 90 } });
    const split = at('splitter');
    sim.rebuildTopology();
    feed(sim, split, 0, { type: 'hay', amount: 10 }, 1);
    const lift = at('beltLift');
    sim.rebuildTopology();
    feed(sim, lift, 0, { type: 'bale', amount: 1 }, 1);
    sim.rebuildTopology();
    return out;
  }

  it('move keeps contents exactly (no duplication, no loss) and is free', () => {
    const sim = fullSim(104);
    const list = stockedFactory(sim);
    expectNeedleInvariant(sim, 'stocked');
    const hay0 = sim.hay.totalUnits();
    for (const b of list) {
      const before = snap(b);
      expect(before.hay + before.bale + before.wrapped, `${b.type} is stocked`).toBeGreaterThan(0);
      const m0 = sim.progress.money;
      const s = findSpot(sim, b.type, -27, -10, 12, 20, 0);
      expect(s, `move spot for ${b.type}`).not.toBeNull();
      expect(sim.move(b.id, s!.cell, s!.rot), `move ${b.type}`).toBe(true);
      sim.rebuildTopology();
      expect(snap(b), `${b.type} contents after move`).toEqual(before);
      expect(sim.progress.money).toBe(m0);
    }
    expect(sim.hay.totalUnits()).toBeCloseTo(hay0, 6);
    expectNeedleInvariant(sim, 'after moves');
    // Flipping a loaded lift up <-> down in place is free and keeps its load.
    const lift = list.find((b) => b.type === 'beltLift')!;
    const load = snap(lift);
    const m0 = sim.progress.money;
    for (const v of ['down', 'up', 'down']) {
      expect(sim.setVariant(lift.id, v)).toBe(true);
      sim.rebuildTopology();
      expect(snap(lift)).toEqual(load);
    }
    expect(sim.progress.money).toBe(m0);
  });

  it('remove spills contents exactly once: hay (+needles) to the floor, bales / wrapped sold once', () => {
    const sim = fullSim(105);
    const list = stockedFactory(sim);
    const ev = tally(sim, ['sale', 'building:removed']);
    for (const b of list) {
      const c = snap(b);
      const hay0 = sim.hay.totalUnits();
      const m0 = sim.progress.money;
      const st0 = { ...sim.progress.stats };
      const sales0 = ev.sale.length;
      const exp = saleValue(sim, 'bale', c.bale) + saleValue(sim, 'wrapped', c.wrapped);
      expect(sim.remove(b.id)).toBe(true);
      const refund = (ev['building:removed'].at(-1) as { refund: number }).refund;
      expect(sim.hay.totalUnits() - hay0, `${b.type} hay spilled`).toBeCloseTo(c.hay, 2);
      expect(sim.progress.money - m0, `${b.type} money`).toBeCloseTo(refund + exp, 6);
      expect(sim.progress.stats.baleSold - st0.baleSold).toBe(c.bale);
      expect(sim.progress.stats.wrappedSold - st0.wrappedSold).toBe(c.wrapped);
      expect(ev.sale.length - sales0).toBe((c.bale > 0 ? 1 : 0) + (c.wrapped > 0 ? 1 : 0));
      for (const id of c.needles) expect(sim.hay.needles[id].status, `needle ${id} spilled from ${b.type}`).toBe('exposed');
      expectNeedleInvariant(sim, `after removing ${b.type}`);
      expect(sim.buildings.has(b.id)).toBe(false);
      expect(sim.remove(b.id)).toBe(false); // a second demolish is refused (no second refund / spill)
    }
    // Nothing else is sold or conjured afterwards.
    const m1 = sim.progress.money;
    const hay1 = sim.hay.totalUnits();
    const sales1 = ev.sale.length;
    run(sim, 5);
    expect(ev.sale.length).toBe(sales1);
    expect(sim.progress.money).toBe(m1);
    expect(sim.hay.totalUnits()).toBeCloseTo(hay1, 2);
  });
});

// =====================================================================================================
// Item conservation through logistics
// =====================================================================================================

const CHUTE_COL = -29;

/** Belts from the cell west of `from` (an out port facing west on row z <= 4) to the Market Chute's east input. */
function routeToChute(sim: Sim, from: Cell): void {
  const z = from.z;
  expect(z).toBeLessThanOrEqual(4);
  for (let x = from.x - 1; x > CHUTE_COL; x--) place(sim, 'conveyor', x, z, 2);
  for (let zz = z; zz <= 4; zz++) place(sim, 'conveyor', CHUTE_COL, zz, 1);
  place(sim, 'conveyor', CHUTE_COL, 5, 2);
}

/**
 * Injector -> belt -> splitter (3 branches) -> merger -> U-splitter -> 2 lanes -> U-merger -> belt lift (up) ->
 * elevated belts -> ramp (down) -> belts -> Market Chute. Row z = -17 flowing west.
 */
function buildNetwork(sim: Sim): { source: Building; splitter: Splitter } {
  const Z = -17;
  const source = place(sim, 'conveyor', -6, Z, 2);
  place(sim, 'conveyor', -7, Z, 2);
  const splitter = place(sim, 'splitter', -8, Z, 2) as Splitter;
  place(sim, 'conveyor', -9, Z, 2);                                   // primary
  place(sim, 'conveyor', -8, Z + 1, 1); beltRun(sim, { x: -8, z: Z + 2, level: 0 }, 2, 2);  // south branch
  place(sim, 'conveyor', -10, Z + 2, 3); place(sim, 'conveyor', -10, Z + 1, 3);
  place(sim, 'conveyor', -8, Z - 1, 3); beltRun(sim, { x: -8, z: Z - 2, level: 0 }, 2, 2);  // north branch
  place(sim, 'conveyor', -10, Z - 2, 1); place(sim, 'conveyor', -10, Z - 1, 1);
  place(sim, 'merger', -10, Z, 2);
  place(sim, 'conveyor', -11, Z, 2);
  place(sim, 'uSplitter', -12, Z - 1, 2);
  beltRun(sim, { x: -13, z: Z, level: 0 }, 2, 2);
  beltRun(sim, { x: -13, z: Z - 1, level: 0 }, 2, 2);
  place(sim, 'uMerger', -15, Z - 1, 2);
  place(sim, 'conveyor', -16, Z, 2);
  place(sim, 'beltLift', -17, Z, 2, 'up');
  beltRun(sim, { x: -18, z: Z, level: 1 }, 2, 2);
  place(sim, 'conveyorRamp', -22, Z, 2, 'down');
  routeToChute(sim, { x: -22, z: Z, level: 0 });
  sim.rebuildTopology();
  // Every logistics out port of the network is linked (the layout is what we think it is).
  for (const b of sim.buildings.values()) {
    if (!(b instanceof LogisticsBuilding)) continue;
    for (const p of outPorts(b)) expect(sim.logistics.isLinked(b, p.index), `${b.type}#${b.id} port ${p.index} linked`).toBe(true);
  }
  return { source, splitter };
}

describe('economy: item conservation through logistics', () => {
  const PATTERN: ItemPacket[] = [
    { type: 'hay', amount: 10 }, { type: 'hay', amount: 10 }, { type: 'bale', amount: 1 },
    { type: 'hay', amount: 7.5 }, { type: 'wrapped', amount: 1 },
  ];

  for (const mode of SPLITTER_MODES) {
    it(`every packet arrives exactly once through splitter (${mode}) / merger / U-lanes / lift / ramp`, () => {
      const sim = fullSim(200);
      const { source, splitter } = buildNetwork(sim);
      splitter.setMode(mode as SplitterMode, 0);
      const needle = 2;
      const ev = tally(sim, ['sale', 'order:completed', 'milestone']);
      const sent: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
      let packets = 0;
      const N = 150;
      const m0 = sim.progress.money;
      const check = (): void => {
        const sold: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
        for (const e of ev.sale as { item: ItemType; amount: number }[]) sold[e.item] += e.amount;
        const onBelts = logisticsContents(sim);
        for (const t of ['hay', 'bale', 'wrapped'] as ItemType[]) expect(sold[t] + onBelts[t], `${mode} ${t}`).toBeCloseTo(sent[t], 9);
        expect(ev.sale.length + sim.logistics.itemCount(), `${mode} packets`).toBe(packets);
      };
      for (let tick = 0; tick < 20 * 150; tick++) {
        if (packets < N) {
          const p: ItemPacket = { ...PATTERN[packets % PATTERN.length] };
          if (packets === 40) p.needleId = needle;
          if (source.canAccept(p, 0, sim)) {
            if (p.needleId !== undefined) takeNeedle(sim, needle);
            feed(sim, source, 0, p);
            sent[p.type] += p.amount;
            packets++;
          }
        }
        sim.tick(BALANCE.tickDt);
        if (tick % 10 === 0) { check(); expectNeedleInvariant(sim, mode); }
      }
      check();
      expect(packets).toBe(N);
      expect(sim.logistics.itemCount(), `${mode}: nothing stuck`).toBe(0);
      // Every output of the splitter was used (all three are linked).
      if (mode !== 'overflow') for (const c of splitter.counts) expect(c).toBeGreaterThan(0);
      // Sales paid exactly the stat value of what was sold (orders completed by the sales pay on top).
      let value = 0;
      for (const t of ['hay', 'bale', 'wrapped'] as ItemType[]) value += saleValue(sim, t, sent[t]);
      const paid = (ev.sale as { item: ItemType; amount: number; value: number }[]).reduce((a, e) => {
        expect(e.value).toBeCloseTo(saleValue(sim, e.item, e.amount), 9);
        return a + e.value;
      }, 0);
      expect(paid).toBeCloseTo(value, 6);
      const orderMoney = (ev['order:completed'] as { money: number }[]).reduce((a, e) => a + e.money, 0);
      const msMoney = (ev.milestone as { money: number }[]).reduce((a, e) => a + e.money, 0);
      expect(sim.progress.money - m0).toBeCloseTo(value + orderMoney + msMoney, 6);
      // The unscanned needle slipped through the chute exactly once and went back to the pile.
      expect(sim.progress.stats.needlesReturned).toBe(1);
      expect(['buried', 'exposed']).toContain(sim.hay.needles[needle].status);
      expectNeedleInvariant(sim, `${mode} end`);
    });
  }
});

// =====================================================================================================
// Machines: hopper / silo / scanner / compressor / wrapper / generator
// =====================================================================================================

/** Items inside every building except generators (their firebox fuel is not part of the line). */
function lineContents(sim: Sim): Record<ItemType, number> {
  const out: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
  for (const b of sim.buildings.values()) {
    if (b.type === 'hayGenerator') continue;
    const inv = b.contents();
    out.hay += inv.hay; out.bale += inv.bale; out.wrapped += inv.wrapped;
  }
  return out;
}

/** Machine at row z facing west (rot 2), injector belt on its first input, output belts to the chute. */
function machineLine(sim: Sim, type: BuildingType, x: number, z: number, withPower: boolean): { m: Building; source: Building; gen?: Building } {
  const m = place(sim, type, x, z, 2);
  const inp = inPorts(m).find((p) => p.dir === 0) ?? inPorts(m)[0];
  const srcCell = neighbor(inp.cell, inp.dir);
  const source = place(sim, 'conveyor', srcCell.x, srcCell.z, oppositeDir(inp.dir) as Rot);
  const out = outPorts(m)[0];
  expect(out.dir).toBe(2);
  routeToChute(sim, out.cell);
  let gen: Building | undefined;
  if (withPower) {
    gen = place(sim, 'hayGenerator', x, z - 4, 0);
    refuel(sim, gen);
  }
  sim.rebuildTopology();
  if (withPower) { run(sim, 0.1); expect(m.network).toBeGreaterThanOrEqual(0); }
  return { m, source, gen };
}

describe('economy: machines conserve items', () => {
  it('hopper and silo pass every item through (mixed types, FIFO), nothing duplicated', () => {
    for (const type of ['hopper', 'silo'] as BuildingType[]) {
      const sim = fullSim(300);
      const { m, source } = machineLine(sim, type, -14, -17, false);
      const ev = tally(sim, ['sale']);
      const sent: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
      const needle = 1;
      let k = 0;
      run(sim, 90, () => {
        if (k < 120) {
          const p: ItemPacket = k % 4 === 3 ? { type: k % 8 === 3 ? 'bale' : 'wrapped', amount: 1 } : { type: 'hay', amount: 10 };
          if (k === 10) p.needleId = needle;
          if (source.canAccept(p, 0, sim)) {
            if (p.needleId !== undefined) takeNeedle(sim, needle);
            feed(sim, source, 0, p);
            sent[p.type] += p.amount;
            k++;
          }
        }
        const sold: Record<ItemType, number> = { hay: 0, bale: 0, wrapped: 0 };
        for (const e of ev.sale as { item: ItemType; amount: number }[]) sold[e.item] += e.amount;
        const inside = allContents(sim);
        for (const t of ['hay', 'bale', 'wrapped'] as ItemType[]) expect(sold[t] + inside[t], `${type} ${t}`).toBeCloseTo(sent[t], 6);
      });
      expect(k).toBe(120);
      expect(m.contents().isEmpty(), `${type} drained`).toBe(true);
      expect(sim.logistics.itemCount()).toBe(0);
      expect(sim.progress.stats.needlesReturned).toBe(1);
      expectNeedleInvariant(sim, type);
    }
  });

  it('player deposit / take on a silo and an unlinked hopper conserves units', () => {
    const sim = fullSim(301);
    const cap = () => sim.stat('player.carry') + (sim.progress.ownedTools.has('bucket') ? sim.stat('tool.bucket.carryBonus') : 0);
    for (const type of ['silo', 'hopper'] as BuildingType[]) {
      const s = findSpot(sim, type, -28, -12, -21, -13, 0)!;
      const b = sim.place(type, s.cell, s.rot)!;
      sim.rebuildTopology();
      sim.player.carry.add('hay', 17.25);
      expect(b.interact(sim)).toBe(true);
      expect(sim.player.carry.hay).toBe(0);
      expect(b.contents().hay).toBeCloseTo(17.25, 9);
      expect(b.interact(sim)).toBe(true); // take back
      expect(sim.player.carry.hay + b.contents().hay).toBeCloseTo(17.25, 9);
      expect(sim.player.carry.hay).toBeLessThanOrEqual(cap() + 1e-9);
      // Take more than the carry can hold: the rest stays in the store.
      sim.player.carry.clear();
      sim.player.carry.add('hay', 500);
      b.interact(sim);
      const stored = b.contents().hay;
      sim.player.carry.clear();
      b.interact(sim);
      expect(sim.player.carry.hay).toBeCloseTo(Math.min(stored, cap()), 9);
      expect(sim.player.carry.hay + b.contents().hay).toBeCloseTo(stored, 9);
      sim.player.carry.clear();
    }
    // Bales in a silo are taken whole.
    const silo = sim.buildingsOfType('silo')[0];
    silo.clearContents();
    sim.player.carry.add('bale', 3);
    expect(silo.interact(sim)).toBe(true);
    expect(silo.contents().bale).toBe(3);
    expect(silo.interact(sim)).toBe(true);
    expect(sim.player.carry.bale + silo.contents().bale).toBe(3);
    expect(Number.isInteger(sim.player.carry.bale)).toBe(true);
  });

  it('scanner passes hay 1:1, scans each unit once and detects the hidden needle exactly once', () => {
    const sim = fullSim(302);
    const { m, source, gen } = machineLine(sim, 'scannerMk1', -14, -17, true);
    const ev = tally(sim, ['sale', 'needle:found', 'scanner:alarm']);
    const needle = 0;
    let sent = 0;
    let k = 0;
    const scanned0 = sim.progress.stats.hayScanned;
    run(sim, 120, (s) => {
      if (Math.round(s.time / BALANCE.tickDt) % 400 === 0) refuel(s, gen!);
      if (k < 80) {
        const p: ItemPacket = { type: 'hay', amount: k % 3 === 0 ? 10 : 6.5 };
        if (k === 20) p.needleId = needle;
        if (source.canAccept(p, 0, sim)) {
          if (p.needleId !== undefined) takeNeedle(sim, needle);
          feed(sim, source, 0, p);
          sent += p.amount;
          k++;
        }
      }
      const sold = (ev.sale as { amount: number }[]).reduce((a, e) => a + e.amount, 0);
      expect(sold + lineContents(sim).hay).toBeCloseTo(sent, 6);
    });
    expect(k).toBe(80);
    const sold = (ev.sale as { amount: number }[]).reduce((a, e) => a + e.amount, 0);
    expect(sold).toBeCloseTo(sent, 6);
    expect(sim.progress.stats.hayScanned - scanned0).toBeCloseTo(sent, 6);
    expect(ev['needle:found'].length).toBe(1);
    expect((ev['needle:found'][0] as { by: string }).by).toBe('scanner');
    expect(ev['scanner:alarm'].length).toBe(sim.stat('scanner.autoEject') >= 1 ? 0 : 1);
    expect(sim.progress.stats.needlesReturned).toBe(0);
    expect(m.contents().isEmpty()).toBe(true);
    expectNeedleInvariant(sim, 'scanner');
  });

  it(`compressor turns exactly hayPerBale hay into one bale; a hidden needle slips back to the pile`, () => {
    const sim = fullSim(303);
    const { m, source, gen } = machineLine(sim, 'compressor', -14, -17, true);
    const per = sim.stat('compressor.hayPerBale');
    const ev = tally(sim, ['sale']);
    const needle = 3;
    const bales = 12;
    const extra = 7;
    const total = bales * per + extra;
    let sent = 0;
    run(sim, 150, (s) => {
      if (Math.round(s.time / BALANCE.tickDt) % 400 === 0) refuel(s, gen!);
      const left = total - sent;
      if (left > 0) {
        const p: ItemPacket = { type: 'hay', amount: Math.min(10, left) };
        if (sent === 0) p.needleId = needle;
        if (source.canAccept(p, 0, sim)) {
          if (p.needleId !== undefined) takeNeedle(sim, needle);
          feed(sim, source, 0, p);
          sent += p.amount;
        }
      }
      const baleSold = (ev.sale as { item: string; amount: number }[]).filter((e) => e.item === 'bale').reduce((a, e) => a + e.amount, 0);
      const c = lineContents(sim);
      // hay in = pressed bales x ratio + hay still inside (buffer, chambers, belts)
      expect(baleSold * per + (c.bale) * per + c.hay).toBeCloseTo(sent, 6);
    });
    expect(sent).toBe(total);
    expect(sim.progress.stats.baleSold).toBe(bales);
    expect((ev.sale as { item: string }[]).every((e) => e.item === 'bale')).toBe(true);
    expect(m.contents().hay).toBeCloseTo(extra, 6);
    expect(sim.progress.stats.needlesReturned).toBe(1);
    expectNeedleInvariant(sim, 'compressor');
  });

  it('wrapper turns bales into wrapped bales 1:1', () => {
    const sim = fullSim(304);
    const { m, source, gen } = machineLine(sim, 'wrapper', -14, -17, true);
    const ev = tally(sim, ['sale']);
    let sent = 0;
    run(sim, 90, (s) => {
      if (Math.round(s.time / BALANCE.tickDt) % 400 === 0) refuel(s, gen!);
      if (sent < 25 && feed(sim, source, 0, { type: 'bale', amount: 1 }) === 1) sent++;
      const wrapped = (ev.sale as { item: string; amount: number }[]).reduce((a, e) => a + e.amount, 0);
      const c = lineContents(sim);
      expect(wrapped + c.wrapped + c.bale).toBe(sent);
    });
    expect(sent).toBe(25);
    expect(sim.progress.stats.wrappedSold).toBe(25);
    expect(sim.progress.stats.baleSold).toBe(0);
    expect(m.contents().isEmpty()).toBe(true);
  });

  it('generator burns what it was fed, never more (hand feed + belt auto-feed); a needle in the fuel is returned', () => {
    const sim = fullSim(305);
    const gen = place(sim, 'hayGenerator', -20, -19, 2);
    const inp = inPorts(gen)[0];
    const c = neighbor(inp.cell, inp.dir);
    const belt = place(sim, 'conveyor', c.x, c.z, oppositeDir(inp.dir) as Rot);
    const arm = place(sim, 'roboticArm', -20, -15, 0); // a consumer so the generator has load
    sim.rebuildTopology();
    const needle = takeNeedle(sim, 4);
    let fed = 0;
    const burned0 = sim.progress.stats.hayBurned;
    sim.player.carry.add('hay', 60, [needle]);
    expect(gen.interact(sim)).toBe(true);
    fed += 60;
    run(sim, 120, (s) => {
      if (feed(s, belt, 0, { type: 'hay', amount: 10 }) === 1) fed += 10;
      const inside = gen.contents().hay + belt.contents().hay;
      expect(s.progress.stats.hayBurned - burned0 + inside).toBeCloseTo(fed, 6);
    });
    expect(sim.progress.stats.hayBurned - burned0).toBeGreaterThan(0);
    expect(sim.progress.stats.needlesReturned).toBe(1);
    expect(arm.network).toBeGreaterThanOrEqual(0);
    expectNeedleInvariant(sim, 'generator');
  });
});

// =====================================================================================================
// Selling
// =====================================================================================================

describe('economy: selling', () => {
  it('each item sells for exactly its stat value; invalid amounts mint nothing', () => {
    const sim = new Sim(400);
    const p = sim.progress;
    for (const t of ['hay', 'bale', 'wrapped'] as ItemType[]) {
      const m0 = p.money;
      const v = p.recordSale(t, 3, true, { x: 0, y: 0, z: 0 });
      expect(v).toBeCloseTo(3 * sim.stat(ITEMS[t].valueStat) * sim.stat('econ.saleMul'), 9);
      expect(p.money - m0).toBeCloseTo(v, 9);
      expect(v).toBeGreaterThan(0);
    }
    const snapStats = JSON.stringify(p.stats);
    const m0 = p.money;
    for (const bad of [0, -5, NaN, Infinity, -Infinity]) {
      expect(p.recordSale('hay', bad, false, { x: 0, y: 0, z: 0 })).toBe(0);
      expect(p.recordSale('bale', bad, true, { x: 0, y: 0, z: 0 })).toBe(0);
    }
    p.addMoney(NaN, 'sale'); p.addMoney(-10, 'order'); p.addMoney(Infinity, 'refund');
    expect(p.spendMoney(NaN)).toBe(false);
    expect(p.spendMoney(-50)).toBe(false);
    expect(p.money).toBe(m0);
    expect(JSON.stringify(p.stats)).toBe(snapStats);
  });

  it('the chute sells the whole carry once; zero / fractional carry cannot mint money', () => {
    const sim = new Sim(401);
    const chute = sim.sellStation!;
    const p = sim.progress;
    expect(chute.interact(sim)).toBe(false); // nothing carried
    expect(p.money).toBe(0);
    sim.player.carry.add('hay', 0.4);
    expect(chute.interact(sim)).toBe(true);
    expect(p.money).toBeCloseTo(saleValue(sim, 'hay', 0.4), 9);
    expect(sim.player.carry.isEmpty()).toBe(true);
    expect(chute.interact(sim)).toBe(false);
    const m1 = p.money;
    // A fractional bale (corrupt state) cannot be sold as a whole one.
    sim.player.carry.bale = 0.5;
    chute.interact(sim);
    expect(p.money).toBe(m1);
    expect(p.stats.baleSold).toBe(0);
    sim.player.carry.bale = 0;
    // Negative carry (hand-edited save) sells nothing.
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    data.player.carry = { hay: -50, bale: -2, wrapped: 0, needles: [] };
    const sim2 = Sim.fromSave(data);
    const m2 = sim2.progress.money;
    sim2.sellStation!.interact(sim2);
    expect(sim2.progress.money).toBe(m2);
    expect(sim2.progress.money).toBeGreaterThanOrEqual(0);
    // Mixed carry sells for the sum of the parts.
    sim.player.carry.add('hay', 12);
    sim.player.carry.add('bale', 2);
    sim.player.carry.add('wrapped', 1);
    const m3 = p.money;
    expect(chute.interact(sim)).toBe(true);
    expect(p.money - m3).toBeCloseTo(saleValue(sim, 'hay', 12) + saleValue(sim, 'bale', 2) + saleValue(sim, 'wrapped', 1), 9);
    expect(sim.player.carry.isEmpty()).toBe(true);
  });
});

// =====================================================================================================
// Orders / milestones / needles / Work Points: one-off, save/load safe, only from intended sources
// =====================================================================================================

describe('economy: rewards are one-off and only come from intended sources', () => {
  it('a needle cannot be found twice (direct, toss-back + re-find, save/load)', () => {
    const sim = new Sim(500);
    const ev = tally(sim, ['needle:found']);
    const p = sim.progress;
    const n0 = sim.hay.needles[0];
    sim.foundNeedle(0, 'manual', n0.pos);
    const wp1 = p.wp;
    const m1 = p.money;
    sim.foundNeedle(0, 'manual', n0.pos);
    sim.foundNeedle(0, 'scanner', n0.pos);
    expect(p.needlesFound).toEqual([0]);
    expect(ev['needle:found'].length).toBe(1);
    expect(p.wp).toBe(wp1);
    expect(p.money).toBe(m1);
    expect(p.wp).toBe(BALANCE.startWP + BALANCE.needleWP);
    expect(p.money).toBe(BALANCE.startMoney + NEEDLE_BUFFS[0].money);

    // Needle 1 slips through the chute (tossed back), then is dug up by hand: found once.
    const n1 = sim.hay.needles[1];
    n1.status = 'inTransit';
    const chute = sim.sellStation!;
    feed(sim, chute, inPorts(chute)[0].index, { type: 'hay', amount: 10, needleId: 1 });
    expect(p.stats.needlesReturned).toBe(1);
    expect(n1.status).toBe('buried');
    expectNeedleInvariant(sim, 'tossed');
    sim.player.pos = { x: n1.pos.x, y: n1.pos.y, z: n1.pos.z };
    sim.player.carry.clear();
    let guard = 0;
    const found1 = (): boolean => sim.hay.needles[1].status === 'found';
    while (!found1() && guard++ < 400) {
      sim.player.cooldown = 0;
      sim.player.carry.clear();
      playerDig(sim, 'hands', n1.pos.x, n1.pos.y, n1.pos.z);
      sim.tick(BALANCE.tickDt);
    }
    expect(n1.status).toBe('found');
    expect(p.needlesFound).toEqual([0, 1]);
    expect(ev['needle:found'].length).toBe(2);

    // Save / load: still found, never re-awarded.
    const sim2 = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    const ev2 = tally(sim2, ['needle:found']);
    const wp2 = sim2.progress.wp;
    sim2.foundNeedle(0, 'manual', n0.pos);
    sim2.foundNeedle(1, 'detector', n0.pos);
    run(sim2, 2);
    expect(ev2['needle:found'].length).toBe(0);
    expect(sim2.progress.needlesFound).toEqual([0, 1]);
    expect(sim2.progress.wp).toBe(wp2);
    expect(sim2.hay.needles[0].status).toBe('found');
    expect(sim2.hay.needles[1].status).toBe('found');
    // Buffs applied exactly twice (not re-applied on load).
    expect(sim2.stat('player.carry')).toBeCloseTo(sim.stat('player.carry'), 9);
    expect(sim2.stat('belt.speed')).toBeCloseTo(sim.stat('belt.speed'), 9);
  });

  it('a full bot run: orders / milestones complete once, WP and money ledgers balance, and survive save/load', () => {
    const bot = new Bot({ seed: 777, maxMinutes: 30, humanFactor: 1.15, verbose: false });
    const sim = bot.sim;
    const ev = tally(sim, ['order:completed', 'milestone', 'needle:found', 'wp:changed', 'money:changed', 'sale', 'building:removed', 'node:unlocked']);
    bot.run();
    const p = sim.progress;

    // One-off.
    const orderIds = (ev['order:completed'] as { id: string }[]).map((e) => e.id);
    expect(new Set(orderIds).size).toBe(orderIds.length);
    expect(orderIds.length).toBeGreaterThan(3);
    const msIds = (ev.milestone as { id: string }[]).map((e) => e.id);
    expect(new Set(msIds).size).toBe(msIds.length);
    expect(msIds.length).toBeGreaterThan(3);

    // WP ledger: earned only from orders + milestones + needles; spent only on unlocks.
    const wpOrders = orderIds.reduce((a, id) => a + ORDER_BY_ID[id].reward.wp, 0);
    const wpMs = msIds.reduce((a, id) => a + MILESTONES.find((m) => m.id === id)!.reward.wp, 0);
    const wpNeedles = p.needlesFound.length * BALANCE.needleWP;
    expect(p.stats.wpEarned).toBe(wpOrders + wpMs + wpNeedles);
    const wpDeltas = ev['wp:changed'] as { delta: number }[];
    expect(wpDeltas.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0)).toBe(p.stats.wpEarned);
    const spentWP = (ev['node:unlocked'] as { id: string; level: number }[]).reduce((a, e) => a + TECH_BY_ID[e.id].levels[e.level - 1].cost, 0);
    expect(-wpDeltas.filter((e) => e.delta < 0).reduce((a, e) => a + e.delta, 0)).toBe(spentWP);
    expect(p.wp).toBe(BALANCE.startWP + p.stats.wpEarned - spentWP);

    // Money ledger: every income is a sale, an order, a needle, a milestone or a refund.
    const sales = (ev.sale as { value: number }[]).reduce((a, e) => a + e.value, 0);
    const orders = (ev['order:completed'] as { money: number }[]).reduce((a, e) => a + e.money, 0);
    const needles = (ev['needle:found'] as { money: number }[]).reduce((a, e) => a + e.money, 0);
    const milestones = (ev.milestone as { money: number }[]).reduce((a, e) => a + e.money, 0);
    const refunds = (ev['building:removed'] as { refund: number }[]).reduce((a, e) => a + e.refund, 0);
    const deltas = ev['money:changed'] as { delta: number }[];
    const income = deltas.filter((e) => e.delta > 0).reduce((a, e) => a + e.delta, 0);
    const spent = -deltas.filter((e) => e.delta < 0).reduce((a, e) => a + e.delta, 0);
    expect(income).toBeCloseTo(sales + orders + needles + milestones + refunds, 3);
    expect(p.stats.moneyEarned).toBeCloseTo(sales + orders + needles + milestones, 3);
    expect(p.money).toBeCloseTo(BALANCE.startMoney + income - spent, 3);
    expect(p.money).toBeGreaterThanOrEqual(0);

    // Save / load: nothing completes again, nothing is re-awarded.
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = Sim.fromSave(data);
    const ev2 = tally(sim2, ['order:completed', 'milestone', 'needle:found']);
    const done = new Set(orderIds);
    run(sim2, 60);
    for (const e of ev2['order:completed'] as { id: string }[]) expect(done.has(e.id), `order ${e.id} completed twice`).toBe(false);
    for (const e of ev2.milestone as { id: string }[]) expect(msIds.includes(e.id), `milestone ${e.id} twice`).toBe(false);
    for (const e of ev2['needle:found'] as { id: number }[]) expect(p.needlesFound.includes(e.id)).toBe(false);
    for (const rt of sim2.progress.orders) if (done.has(rt.id)) { expect(rt.completed).toBe(true); expect(rt.active).toBe(false); }

    // A tampered save that marks a completed order active does not pay it again.
    const tampered = JSON.parse(JSON.stringify(data));
    for (const o of tampered.progress.orders) if (o.completed) o.active = true;
    const sim3 = Sim.fromSave(tampered);
    const ev3 = tally(sim3, ['order:completed']);
    run(sim3, 5);
    for (const e of ev3['order:completed'] as { id: string }[]) expect(done.has(e.id)).toBe(false);
    for (const rt of sim3.progress.activeOrders()) expect(rt.completed).toBe(false);
  }, 120_000);
});
