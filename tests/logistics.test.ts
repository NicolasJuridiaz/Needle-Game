/**
 * Logistics module tests (ARCHITECTURE §4.2) with the REAL Sim.
 * Test sources/sinks are tiny Building subclasses inserted straight into the Sim so these tests do not depend on
 * the machine implementations.
 */
import { describe, expect, it } from 'vitest';
import { TECH_NODES } from '../src/config/techTree';
import { Building, type BuildingInit } from '../src/sim/building';
import { occupiedCells } from '../src/sim/grid';
import type { SimContext } from '../src/sim/interfaces';
import { Conveyor, Splitter } from '../src/sim/logistics/index';
import { Sim } from '../src/sim/sim';
import type { BuildingType, Cell, Dir, ItemPacket, Level, Rot } from '../src/sim/types';

const DT = 0.05;

function run(sim: Sim, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) sim.tick(DT);
}

function unlock(sim: Sim, ids: string[]): void {
  sim.progress.addWP(100_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const want = new Set<string>();
  const add = (id: string) => { if (want.has(id)) return; want.add(id); for (const r of byId.get(id)!.requires) add(r); };
  ids.forEach(add);
  for (let pass = 0; pass < 20; pass++) for (const id of want) while (sim.progress.canUnlock(id).ok) sim.progress.unlock(id);
  for (const id of ids) expect(sim.progress.isUnlocked(id), `unlock ${id}`).toBe(true);
  sim.rebuildTopology();
}

/** Unlock only the given nodes' FIRST level (plus prerequisites) - keeps belt speed at base. */
function unlockFirst(sim: Sim, ids: string[]): void {
  sim.progress.addWP(100_000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const done = new Set<string>();
  const go = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    for (const r of byId.get(id)!.requires) go(r);
    if (!sim.progress.isUnlocked(id)) expect(sim.progress.unlock(id), `unlock ${id}`).toBe(true);
  };
  ids.forEach(go);
  sim.rebuildTopology();
}

function newSim(seed = 1): Sim {
  const sim = new Sim(seed);
  sim.progress.addMoney(10_000_000, 'milestone');
  sim.player.pos = { x: 0, y: 50, z: 0 }; // out of the way of placement checks
  unlockFirst(sim, ['l_conveyor']);
  return sim;
}

function place(sim: Sim, type: BuildingType, x: number, z: number, rot: Rot = 0, variant?: string, level: Level = 0): Building {
  const cell: Cell = { x, z, level };
  const chk = sim.canPlace(type, cell, rot, variant);
  expect(chk.ok, `place ${type} at ${x},${z},${level} rot ${rot}: ${chk.reason}`).toBe(true);
  const b = sim.place(type, cell, rot, variant);
  expect(b).not.toBeNull();
  return b!;
}

/** Row of belts along X from x0 to x1 inclusive (flow +X or -X). */
function beltX(sim: Sim, x0: number, x1: number, z: number, level: Level = 0): Building[] {
  const rot: Rot = x1 >= x0 ? 0 : 2;
  const step = x1 >= x0 ? 1 : -1;
  const out: Building[] = [];
  for (let x = x0; x !== x1 + step; x += step) out.push(place(sim, 'conveyor', x, z, rot, undefined, level));
  return out;
}

let nextTestId = 90_000;

function insert(sim: Sim, b: Building): void {
  sim.buildings.set(b.id, b);
  for (const c of occupiedCells(b.type, b.cell, b.rot, b.variant)) sim.grid.set(c.x, c.z, c.level, b.id);
  b.refreshPorts((n) => sim.progress.isUnlocked(n));
  sim.markTopologyDirty();
}

/** Pushes packets out of its single out-port (local front) as fast as the belt accepts them. */
class TestSource extends Building {
  sent = 0;
  sentHay = 0;
  limit = Infinity;
  /** Packet factory (default: 10 hay). */
  make: (i: number) => ItemPacket = () => ({ type: 'hay', amount: 10 });
  override tick(_dt: number, ctx: SimContext): void {
    for (let k = 0; k < 4 && this.sent < this.limit; k++) {
      const p = this.make(this.sent);
      if (!ctx.logistics.pushOut(this, 0, p)) break;
      this.sent++;
      this.sentHay += p.amount;
    }
  }
}

function source(sim: Sim, x: number, z: number, rot: Rot, level: Level = 0): TestSource {
  const b = new TestSource({ id: nextTestId++, type: 'roboticArm', cell: { x, z, level }, rot } as BuildingInit);
  insert(sim, b);
  return b;
}

/** Accepts anything from any side while `open`. */
class TestSink extends Building {
  open = true;
  hay = 0;
  items: ItemPacket[] = [];
  override inputPortAt(cell: Cell, _dir: Dir): number {
    return cell.x === this.cell.x && cell.z === this.cell.z && cell.level === this.cell.level ? 0 : -1;
  }
  override canAccept(): boolean { return this.open; }
  override accept(item: ItemPacket): void { this.items.push(item); if (item.type === 'hay') this.hay += item.amount; }
}

function sink(sim: Sim, x: number, z: number, level: Level = 0): TestSink {
  const b = new TestSink({ id: nextTestId++, type: 'powerPole', cell: { x, z, level }, rot: 0 } as BuildingInit);
  insert(sim, b);
  return b;
}

const Z = -15;

describe('logistics: belts', () => {
  it('straight line carries 50 hay/s (5 packets/s of 10 hay) +-5%', () => {
    const sim = newSim();
    source(sim, -28, Z, 0);
    const belts = beltX(sim, -27, -18, Z);
    const out = sink(sim, -17, Z);
    run(sim, 10);
    const h0 = out.hay;
    run(sim, 20);
    const rate = (out.hay - h0) / 20;
    expect(rate).toBeGreaterThan(47.5);
    expect(rate).toBeLessThan(52.5);
    expect(belts[0].status).toBe('running');
    expect(sim.logistics.isLinked(belts[belts.length - 1], 1)).toBe(true);
  });

  it('machines side-load onto a running belt without curving it, sharing its capacity', () => {
    const sim = newSim();
    // A slow back feeder (1 packet/s) and three side feeders facing the belt from the north/south.
    source(sim, -28, Z, 0);
    const belts = beltX(sim, -27, -18, Z) as Conveyor[];
    const sides = [source(sim, -25, Z - 1, 1), source(sim, -23, Z + 1, 3), source(sim, -21, Z - 1, 1)];
    const out = sink(sim, -17, Z);
    sim.rebuildTopology();
    for (const s of sides) expect(sim.logistics.isLinked(s, 0)).toBe(true);
    expect(belts.every((b) => b.curve === 0)).toBe(true);
    run(sim, 10);
    const h0 = out.hay;
    run(sim, 20);
    const rate = (out.hay - h0) / 20;
    // The line is saturated: total delivery is the belt capacity, and every side feeder got items on.
    expect(rate).toBeGreaterThan(45);
    expect(rate).toBeLessThan(52.5);
    for (const s of sides) expect(s.sent).toBeGreaterThan(5);
  });

  it('side-loading waits for a gap (no overlap) and a lone side-loader feeds an empty belt', () => {
    const sim = newSim();
    const belts = beltX(sim, -27, -24, Z) as Conveyor[];
    const side = source(sim, -26, Z - 1, 1);
    const out = sink(sim, -23, Z);
    run(sim, 20);
    expect(side.sent).toBeGreaterThan(60);
    expect(out.hay).toBeGreaterThan(500);
    // spacing is kept everywhere
    for (const b of belts) {
      const items = b.lane.items;
      for (let i = 1; i < items.length; i++) expect(items[i - 1].s - items[i].s).toBeGreaterThan(sim.stat('belt.spacing') - 1e-3);
    }
  });

  it('backs up when the end is blocked and resumes', () => {
    const sim = newSim();
    const src = source(sim, -28, Z, 0);
    const belts = beltX(sim, -27, -18, Z);
    const out = sink(sim, -17, Z);
    out.open = false;
    run(sim, 20);
    const count = sim.logistics.itemCount();
    // 10 tiles, 1 item per 0.333 tiles -> ~30 items, then the source is refused.
    expect(count).toBeGreaterThanOrEqual(28);
    expect(count).toBeLessThanOrEqual(31);
    const sent = src.sent;
    run(sim, 2);
    expect(src.sent).toBe(sent);
    expect(belts[belts.length - 1].status).toBe('outputBlocked');
    expect(belts[belts.length - 1].info(sim).statusText).toMatch(/blocked/i);
    out.open = true;
    run(sim, 10);
    expect(out.hay).toBeGreaterThan(400);
    expect(src.sent).toBeGreaterThan(sent);
    expect(belts[belts.length - 1].status).toBe('running');
  });

  it('automatic curve: side feeding links when the back is free, anim.curve set, items flow', () => {
    const sim = newSim();
    source(sim, -28, Z, 0);
    const a = place(sim, 'conveyor', -27, Z, 0);
    const b = place(sim, 'conveyor', -26, Z, 1) as Conveyor; // flows +Z, fed from its -X side
    const c = place(sim, 'conveyor', -26, Z + 1, 1);
    const out = sink(sim, -26, Z + 2);
    run(sim, 10);
    expect(sim.logistics.isLinked(a, 1)).toBe(true);
    expect(b.curve).not.toBe(0);
    // rot 1: local right (+Z local) is world -X -> fed from the right
    expect(b.anim.curve).toBe(1);
    expect(sim.logistics.isLinked(c, 1)).toBe(true);
    expect(out.hay).toBeGreaterThan(200);
    // Items on the curve follow an arc: somewhere strictly inside the tile corner region
    let seen = 0;
    sim.logistics.forEachItem(1, (v) => {
      if (v.x > -26 && v.x < -25 && v.z > Z && v.z < Z + 1) { seen++; expect(v.y).toBeCloseTo(0.45, 2); }
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('side feeding is refused when something already feeds the back', () => {
    const sim = newSim();
    const back = place(sim, 'conveyor', -26, Z - 1, 1); // feeds the back of `b`
    const side = place(sim, 'conveyor', -27, Z, 0);
    const b = place(sim, 'conveyor', -26, Z, 1) as Conveyor;
    sim.rebuildTopology();
    expect(sim.logistics.isLinked(back, 1)).toBe(true);
    expect(sim.logistics.isLinked(side, 1)).toBe(false);
    expect(b.curve).toBe(0);
  });

  it('a dead-end belt never turns on its own: it backs up until the player rotates the corner', () => {
    const sim = newSim();
    source(sim, -28, Z, 0);
    const [, corner] = beltX(sim, -27, -26, Z); // corner at -26 faces +X into nothing
    place(sim, 'conveyor', -26, Z + 1, 1); // its back faces the corner, but the corner points elsewhere
    const out = sink(sim, -26, Z + 2);
    run(sim, 10);
    expect(sim.logistics.isLinked(corner, 1)).toBe(false);
    expect(corner.status).toBe('outputBlocked');
    expect(out.hay).toBe(0);
    // Rotating the corner (what the belt planner does) connects the line.
    sim.remove(corner.id);
    place(sim, 'conveyor', -26, Z, 1);
    sim.rebuildTopology();
    run(sim, 10);
    expect(out.hay).toBeGreaterThan(200);
  });

  it('belts facing each other head-on are not linked', () => {
    const sim = newSim();
    const a = place(sim, 'conveyor', -27, Z, 0);
    const b = place(sim, 'conveyor', -26, Z, 2);
    sim.rebuildTopology();
    expect(sim.logistics.isLinked(a, 1)).toBe(false);
    expect(sim.logistics.isLinked(b, 1)).toBe(false);
  });

  it('keeps item uids stable across tiles and interpolates positions', () => {
    const sim = newSim();
    const belts = beltX(sim, -27, -24, Z);
    sim.rebuildTopology();
    belts[0].accept({ type: 'hay', amount: 10 }, 0, sim);
    let uid = 0;
    sim.logistics.forEachItem(0, (v) => { uid = v.uid; });
    expect(uid).toBeGreaterThan(0);
    run(sim, 1.2);
    const seen: { uid: number; x: number }[] = [];
    sim.logistics.forEachItem(0.5, (v) => seen.push({ uid: v.uid, x: v.x }));
    expect(seen.length).toBe(1);
    expect(seen[0].uid).toBe(uid);
    expect(seen[0].x).toBeGreaterThan(-26); // moved ~2 tiles from x=-27
  });

  it('a closed loop of belts keeps circulating (cycles are handled)', () => {
    const sim = newSim();
    const ring = [
      place(sim, 'conveyor', -26, Z, 0), place(sim, 'conveyor', -25, Z, 1),
      place(sim, 'conveyor', -25, Z + 1, 2), place(sim, 'conveyor', -26, Z + 1, 3),
    ];
    sim.rebuildTopology();
    for (const b of ring) expect(sim.logistics.isLinked(b, 1)).toBe(true);
    ring[0].accept({ type: 'hay', amount: 10 }, 0, sim);
    ring[2].accept({ type: 'bale', amount: 1 }, 0, sim);
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) { run(sim, 0.25); sim.logistics.forEachItem(1, (v) => { if (v.type === 'hay') xs.push(v.x); }); }
    expect(sim.logistics.itemCount()).toBe(2);
    expect(Math.min(...xs)).toBeLessThan(-25.4);
    expect(Math.max(...xs)).toBeGreaterThan(-24.6);
  });

  it('a long full line (downstream-first order, no deep recursion) stays fast', () => {
    const sim = newSim();
    // serpentine of ~170 belts
    for (let r = 0; r < 9; r++) {
      const z = -20 + r;
      const east = r % 2 === 0;
      for (let i = 0; i < 19; i++) place(sim, 'conveyor', east ? -30 + i : -12 - i, z, i === 18 && r < 8 ? 1 : east ? 0 : 2);
    }
    source(sim, -31, -20, 0);
    run(sim, 2);
    const t0 = performance.now();
    run(sim, 60);
    const ms = performance.now() - t0;
    expect(sim.logistics.itemCount()).toBeGreaterThan(300);
    expect(ms).toBeLessThan(3000);
  });

  it('relinks after removal', () => {
    const sim = newSim();
    const [a, b, c] = beltX(sim, -27, -25, Z);
    sim.rebuildTopology();
    expect(sim.logistics.isLinked(a, 1)).toBe(true);
    expect(sim.remove(b.id)).toBe(true);
    run(sim, DT);
    expect(sim.logistics.isLinked(a, 1)).toBe(false);
    const b2 = place(sim, 'conveyor', -26, Z, 0);
    run(sim, DT);
    expect(sim.logistics.isLinked(a, 1)).toBe(true);
    expect(sim.logistics.isLinked(b2, 1)).toBe(true);
    expect(a.links[1]!.target).toBe(b2);
    expect(b2.links[1]!.target).toBe(c);
  });

  it('removing a belt spills its hay (and hidden needles) onto the floor', () => {
    const sim = newSim();
    const [a] = beltX(sim, -27, -26, Z);
    const needle = sim.hay.needles[0];
    needle.status = 'inTransit';
    a.accept({ type: 'hay', amount: 10, needleId: needle.id }, 0, sim);
    a.accept({ type: 'hay', amount: 10 }, 0, sim); // refused by spacing -> forced in anyway (never lost)
    expect(a.contents().hay).toBe(20);
    expect(a.contents().needles).toEqual([needle.id]);
    const before = sim.hay.totalUnits();
    expect(sim.remove(a.id)).toBe(true);
    expect(sim.hay.totalUnits() - before).toBeCloseTo(20, 3);
    expect(['exposed', 'buried']).toContain(needle.status);
    expect(sim.logistics.itemCount()).toBe(0);
  });

  it('saves and restores items on belts', () => {
    const sim = newSim();
    const belts = beltX(sim, -27, -22, Z);
    for (let i = 0; i < 6; i++) { if (belts[0].canAccept({ type: 'hay', amount: 10 }, 0, sim)) belts[0].accept({ type: 'hay', amount: 10 }, 0, sim); run(sim, 0.25); }
    const n = sim.logistics.itemCount();
    expect(n).toBeGreaterThan(3);
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    const sim2 = Sim.fromSave(data);
    expect(sim2.logistics.itemCount()).toBe(n);
    const pos1: number[] = [], pos2: number[] = [];
    sim.logistics.forEachItem(1, (v) => pos1.push(v.x));
    sim2.logistics.forEachItem(1, (v) => pos2.push(v.x));
    pos1.sort((a, b) => a - b); pos2.sort((a, b) => a - b);
    for (let i = 0; i < n; i++) expect(pos2[i]).toBeCloseTo(pos1[i], 4);
  });
});

describe('logistics: splitters & mergers', () => {
  /** source -> belt -> splitter(-24) -> primary/left/right belts -> sinks */
  function splitterRig(sim: Sim) {
    source(sim, -27, Z, 0);
    beltX(sim, -26, -25, Z);
    const sp = place(sim, 'splitter', -24, Z, 0) as Splitter;
    place(sim, 'conveyor', -23, Z, 0);
    const primary = sink(sim, -22, Z);
    place(sim, 'conveyor', -24, Z - 1, 3);
    const left = sink(sim, -24, Z - 2);
    place(sim, 'conveyor', -24, Z + 1, 1);
    const right = sink(sim, -24, Z + 2);
    sim.rebuildTopology();
    return { sp, primary, left, right };
  }

  it('even mode distributes 1:1:1', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_splitter']);
    const { sp, primary, left, right } = splitterRig(sim);
    run(sim, 30);
    const total = primary.hay + left.hay + right.hay;
    expect(total).toBeGreaterThan(1200);
    for (const s of [primary, left, right]) expect(s.hay / total).toBeCloseTo(1 / 3, 1);
    expect(Math.abs(primary.hay - left.hay)).toBeLessThanOrEqual(20);
    expect(sp.info(sim).lines.some((l) => l.label === 'Mode' && l.value === 'Even')).toBe(true);
  });

  it('priority mode sends 2:1 to the primary', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_priority']);
    const { sp, primary, left, right } = splitterRig(sim);
    sp.setMode('priority');
    run(sim, 30);
    const ratio = primary.hay / (left.hay + right.hay);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  it('overflow mode spills to the sides only when the primary is blocked', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_overflow']);
    const { sp, primary, left, right } = splitterRig(sim);
    sp.setMode('overflow');
    run(sim, 15);
    expect(primary.hay).toBeGreaterThan(500);
    expect(left.hay + right.hay).toBe(0);
    primary.open = false;
    run(sim, 10);
    expect(left.hay + right.hay).toBeGreaterThan(300);
    const sides = left.hay + right.hay;
    primary.open = true;
    run(sim, 3); // flush
    const p0 = primary.hay, s0 = left.hay + right.hay;
    run(sim, 10);
    expect(primary.hay - p0).toBeGreaterThan(400);
    expect(left.hay + right.hay - s0).toBe(0);
    expect(sides).toBeGreaterThan(0);
  });

  it('alternating mode waits for the blocked output; even mode does not', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_alternating']);
    const { sp, primary, left, right } = splitterRig(sim);
    sp.setMode('alternating');
    right.open = false;
    run(sim, 20);
    const alt = primary.hay + left.hay;
    sp.setMode('even');
    const e0 = primary.hay + left.hay;
    run(sim, 20);
    const even = primary.hay + left.hay - e0;
    expect(even).toBeGreaterThan(alt * 3);
  });

  it('smart mode sends the filtered type to the primary and the rest to the sides', () => {
    const sim = newSim();
    unlock(sim, ['l_smart']);
    // unlock() raises belt speed too; that's fine here
    const src = source(sim, -27, Z, 0);
    src.make = (i) => (i % 2 === 0 ? { type: 'hay', amount: 10 } : { type: 'bale', amount: 1 });
    beltX(sim, -26, -25, Z);
    const sp = place(sim, 'splitter', -24, Z, 0) as Splitter;
    place(sim, 'conveyor', -23, Z, 0);
    const primary = sink(sim, -22, Z);
    place(sim, 'conveyor', -24, Z - 1, 3);
    const left = sink(sim, -24, Z - 2);
    sim.rebuildTopology();
    sp.setMode('smart', 1); // bales -> primary
    run(sim, 20);
    expect(primary.items.length).toBeGreaterThan(10);
    expect(primary.items.every((p) => p.type === 'bale')).toBe(true);
    expect(left.items.length).toBeGreaterThan(10);
    expect(left.items.every((p) => p.type === 'hay')).toBe(true);
    expect(sp.anim.mode).toBe(4);
    expect(sp.anim.filter).toBe(1);
  });

  it('E cycles through unlocked modes (and the smart filter)', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_splitter']);
    const sp = place(sim, 'splitter', -24, Z, 0) as Splitter;
    expect(sp.interaction(sim)?.enabled).toBe(false);
    expect(sp.interact(sim)).toBe(false);
    unlock(sim, ['l_smart', 'l_alternating']);
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) { expect(sp.interact(sim)).toBe(true); seen.push(`${sp.mode}:${sp.filter}`); }
    expect(seen.slice(0, 7)).toEqual(['alternating:0', 'priority:0', 'overflow:0', 'smart:0', 'smart:1', 'smart:2', 'even:2']);
    // mode is saved
    sp.setMode('priority');
    const st = JSON.parse(JSON.stringify(sp.saveState()));
    const sp2 = new Splitter({ id: 1, type: 'splitter', cell: { x: 0, z: 0, level: 0 }, rot: 0 });
    sp2.loadState(st);
    expect(sp2.mode).toBe('priority');
  });

  it('merger serves its inputs fairly', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_merger']);
    const mx = -22;
    const sBack = source(sim, mx - 2, Z, 0);
    place(sim, 'conveyor', mx - 1, Z, 0);
    const sLeft = source(sim, mx, Z - 2, 1);
    place(sim, 'conveyor', mx, Z - 1, 1);
    const sRight = source(sim, mx, Z + 2, 3);
    place(sim, 'conveyor', mx, Z + 1, 3);
    place(sim, 'merger', mx, Z, 0);
    place(sim, 'conveyor', mx + 1, Z, 0);
    const out = sink(sim, mx + 2, Z);
    run(sim, 10);
    const b0 = [sBack.sent, sLeft.sent, sRight.sent];
    const o0 = out.hay;
    run(sim, 30);
    const d = [sBack.sent - b0[0], sLeft.sent - b0[1], sRight.sent - b0[2]];
    const total = d[0] + d[1] + d[2];
    for (const x of d) expect(x / total).toBeCloseTo(1 / 3, 1);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(3);
    expect((out.hay - o0) / 30).toBeGreaterThan(47.5);
  });

  it('U-splitter alternates lanes, U-merger joins them', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_usplitter', 'l_umerger']);
    source(sim, -28, Z, 0);
    place(sim, 'conveyor', -27, Z, 0);
    place(sim, 'uSplitter', -26, Z, 0); // lanes at z = Z and Z+1
    place(sim, 'conveyor', -25, Z, 0);
    place(sim, 'conveyor', -25, Z + 1, 0);
    place(sim, 'uMerger', -24, Z, 0);
    place(sim, 'conveyor', -23, Z, 0);
    const out = sink(sim, -22, Z);
    run(sim, 30);
    expect(out.hay / 30).toBeGreaterThan(40);
  });
});

describe('logistics: levels', () => {
  it('belt lift moves items up to the elevated level', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_lift']);
    source(sim, -28, Z, 0);
    place(sim, 'conveyor', -27, Z, 0);
    const lift = place(sim, 'beltLift', -26, Z, 0, 'up');
    place(sim, 'conveyor', -25, Z, 0, undefined, 1);
    const out = sink(sim, -24, Z, 1);
    run(sim, 20);
    expect(sim.logistics.isLinked(lift, 1)).toBe(true);
    expect(out.hay / 20).toBeGreaterThan(40);
    let high = 0;
    sim.logistics.forEachItem(1, (v) => { if (v.y > 2.5) high++; });
    expect(high).toBeGreaterThan(0);
  });

  it('ramp carries items down', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_lift']);
    source(sim, -28, Z, 0, 1);
    place(sim, 'conveyor', -27, Z, 0, undefined, 1);
    place(sim, 'conveyorRamp', -26, Z, 0, 'down');
    place(sim, 'conveyor', -23, Z, 0);
    const out = sink(sim, -22, Z);
    run(sim, 20);
    expect(out.hay / 20).toBeGreaterThan(40);
  });
});

describe('logistics: belt planner', () => {
  it('L-route snaps into a machine input and from a machine output', () => {
    const sim = newSim();
    unlockFirst(sim, ['d_scanner']);
    const sc = place(sim, 'scannerMk1', -20, Z, 0);
    const inPort = sc.ports.find((p) => p.kind === 'in')!;
    const outPort = sc.ports.find((p) => p.kind === 'out')!;
    const endCell = { x: inPort.cell.x - 1, z: inPort.cell.z, level: 0 as Level };
    const plan = sim.planBelt({ x: endCell.x - 5, z: endCell.z - 3, level: 0 }, endCell, { mode: 'xFirst', allowLevelChange: false });
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.connectsEnd).toBe(true);
    expect(plan.steps.length).toBe(9);
    // x first: the first 5 steps go +X, then +Z, the last one turns into the scanner (+X)
    expect(plan.steps[0].rot).toBe(0);
    expect(plan.steps[5].rot).toBe(1);
    expect(plan.steps[8].cell).toEqual(endCell);
    expect(plan.steps[8].rot).toBe(0);
    expect(plan.cost).toBe(9 * sim.nextCost('conveyor'));
    expect(sim.placeBelt(plan)).toBe(true);
    sim.rebuildTopology();
    const last = sim.buildingAtCell(endCell.x, endCell.z, 0)!;
    expect(sim.logistics.isLinked(last, 1)).toBe(true);
    expect(last.links[1]!.target).toBe(sc);

    // From the scanner output
    const s2 = { x: outPort.cell.x + 1, z: outPort.cell.z, level: 0 as Level };
    const plan2 = sim.planBelt(s2, { x: s2.x + 3, z: s2.z + 2, level: 0 }, { mode: 'zFirst', allowLevelChange: false });
    expect(plan2.ok, plan2.reason).toBe(true);
    expect(plan2.connectsStart).toBe(true);
    expect(plan2.steps[0].rot).toBe(1);
  });

  it('extends an existing belt and joins into an existing belt', () => {
    const sim = newSim();
    const a = place(sim, 'conveyor', -27, Z, 0);
    const plan = sim.planBelt({ ...a.cell }, { x: -22, z: Z, level: 0 }, { mode: 'xFirst', allowLevelChange: false });
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.steps[0].existing).toBe(a.id);
    expect(plan.steps.filter((s) => !s.existing).length).toBe(5);
    expect(plan.steps[1].cell).toEqual({ x: -26, z: Z, level: 0 });
    // join: end on an existing belt's back
    const b = place(sim, 'conveyor', -20, Z + 3, 0);
    const plan2 = sim.planBelt({ x: -24, z: Z + 3, level: 0 }, { ...b.cell }, { mode: 'xFirst', allowLevelChange: false });
    expect(plan2.ok, plan2.reason).toBe(true);
    expect(plan2.connectsEnd).toBe(true);
    expect(plan2.steps[plan2.steps.length - 1].existing).toBe(b.id);
    // head-on join refused
    const plan3 = sim.planBelt({ x: -16, z: Z + 3, level: 0 }, { ...b.cell }, { mode: 'xFirst', allowLevelChange: false });
    expect(plan3.ok).toBe(false);
  });

  it('A* (auto route) avoids an obstacle; L-route reports it', () => {
    const sim = newSim();
    unlockFirst(sim, ['l_autoroute']);
    for (let z = Z - 3; z <= Z + 3; z++) place(sim, 'conveyor', -22, z, 1);
    const s = { x: -26, z: Z, level: 0 as Level }, e = { x: -18, z: Z, level: 0 as Level };
    const l = sim.planBelt(s, e, { mode: 'xFirst', allowLevelChange: false });
    expect(l.ok).toBe(false);
    expect(l.reason).toMatch(/Blocked by Conveyor/);
    const auto = sim.planBelt(s, e, { mode: 'auto', allowLevelChange: false });
    expect(auto.ok, auto.reason).toBe(true);
    expect(auto.steps.some((st) => st.cell.x === -22)).toBe(true); // crosses the column above/below the wall
    for (const st of auto.steps) if (st.cell.x === -22) expect(Math.abs(st.cell.z - Z)).toBeGreaterThan(3);
    expect(auto.steps[auto.steps.length - 1].cell).toEqual(e);
    // consecutive cells are adjacent
    for (let i = 1; i < auto.steps.length; i++) {
      const a = auto.steps[i - 1].cell, b = auto.steps[i].cell;
      expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBe(1);
    }
    // without the node, auto falls back to an L route
    const sim2 = newSim();
    for (let z = Z - 3; z <= Z + 3; z++) place(sim2, 'conveyor', -22, z, 1);
    expect(sim2.planBelt(s, e, { mode: 'auto', allowLevelChange: false }).ok).toBe(false);
  });

  it('rejects too long paths and level changes without lifts; inserts a lift when allowed', () => {
    const sim = newSim();
    const long = sim.planBelt({ x: -30, z: -20, level: 0 }, { x: 30, z: -18, level: 0 }, { mode: 'xFirst', allowLevelChange: false });
    expect(long.ok).toBe(false);
    expect(long.reason).toMatch(/too long/i);
    const s = { x: -28, z: Z, level: 0 as Level }, e = { x: -22, z: Z, level: 1 as Level };
    expect(sim.planBelt(s, e, { mode: 'xFirst', allowLevelChange: false }).ok).toBe(false);
    unlockFirst(sim, ['l_lift']);
    const plan = sim.planBelt(s, e, { mode: 'xFirst', allowLevelChange: true });
    expect(plan.ok, plan.reason).toBe(true);
    const liftStep = plan.steps.find((st) => st.type === 'beltLift')!;
    expect(liftStep.variant).toBe('up');
    const li = plan.steps.indexOf(liftStep);
    expect(plan.steps.slice(li + 1).every((st) => st.cell.level === 1)).toBe(true);
    expect(plan.steps.slice(0, li).every((st) => st.cell.level === 0)).toBe(true);
    expect(sim.placeBelt(plan)).toBe(true);
    // run items through it
    source(sim, -29, Z, 0);
    const out = sink(sim, -21, Z, 1);
    run(sim, 15);
    expect(out.hay).toBeGreaterThan(200);
  });
});
