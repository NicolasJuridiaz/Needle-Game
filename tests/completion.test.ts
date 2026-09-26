/**
 * COMPLETION: finding needles 1..6 (by hand, with the detector, and through a scanner) while a powered
 * scanner -> compressor -> wrapper line is mid-cycle. Buffs apply in discovery order, completion fires exactly
 * once, the sim keeps running as a sandbox afterwards, and a save taken after completion stays completed.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { NEEDLE_BUFFS, NEEDLE_COUNT } from '../src/config/needles';
import { TECH_NODES } from '../src/config/techTree';
import type { Building } from '../src/sim/building';
import { pickupNeedle } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import type { Effect } from '../src/sim/types';
import {
  DT, expectNeedleInvariant, feed, parkPlayer, place, rich, run, tally, unlock,
} from './support/simKit';

const BUFF_STATS = [...new Set(NEEDLE_BUFFS.flatMap((b) => b.effects.map((e) => e.stat)))];

function applyEffect(v: number, e: Effect): number {
  return e.op === 'add' ? v + e.value : e.op === 'mul' ? v * e.value : e.value;
}

interface Line { source: Building; scanner: Building; compressor: Building; wrapper: Building; gens: Building[] }

/** source belt -> scanner MK1 -> compressor -> wrapper -> Market Chute, row z = -17 flowing west. */
function buildLine(sim: Sim): Line {
  const source = place(sim, 'conveyor', -4, -17, 2);
  const scanner = place(sim, 'scannerMk1', -7, -18, 2);
  place(sim, 'conveyor', -8, -17, 2);
  const compressor = place(sim, 'compressor', -11, -18, 2);
  place(sim, 'conveyor', -12, -17, 2);
  const wrapper = place(sim, 'wrapper', -15, -18, 2);
  for (let x = -16; x >= -28; x--) place(sim, 'conveyor', x, -17, 2);
  for (let z = -17; z <= 4; z++) place(sim, 'conveyor', -29, z, 1);
  place(sim, 'conveyor', -29, 5, 2);
  const gens = [place(sim, 'hayGenerator', -12, -22, 0), place(sim, 'hayGenerator', -8, -22, 0)];
  sim.rebuildTopology();
  for (const b of [scanner, compressor, wrapper]) expect(sim.logistics.isLinked(b, b.ports.find((p) => p.kind === 'out')!.index), b.type).toBe(true);
  return { source, scanner, compressor, wrapper, gens };
}

/** Keeps the line fed and fuelled (same actions a player / feeder belt would do). */
function service(sim: Sim, line: Line): void {
  feed(sim, sim.buildings.get(line.source.id)!, 0, { type: 'hay', amount: 10 });
  if (Math.round(sim.time / DT) % 200 === 0) {
    for (const g of line.gens) { sim.player.carry.add('hay', 300); sim.buildings.get(g.id)!.interact(sim); sim.player.carry.clear(); }
  }
}

function setup(seed: number): { sim: Sim; line: Line } {
  const sim = new Sim(seed);
  parkPlayer(sim);
  unlock(sim, TECH_NODES.map((n) => n.id));
  rich(sim);
  const line = buildLine(sim);
  run(sim, 25, (s) => service(s, line));
  // Mid-cycle everywhere: material in the scanner, compressor chambers, wrapper and on the belts.
  expect(line.scanner.contents().hay).toBeGreaterThan(0);
  expect(line.compressor.contents().hay).toBeGreaterThan(0);
  expect(sim.progress.stats.wrappedSold).toBeGreaterThan(0);
  expect(sim.logistics.itemCount()).toBeGreaterThan(5);
  for (const b of [line.scanner, line.compressor, line.wrapper]) expect(b.status, b.type).not.toBe('noPower');
  return { sim, line };
}

describe('completion: six needles found while the factory runs', () => {
  it('buffs apply in discovery order, completion fires once, the sandbox keeps running, and it survives save/load', () => {
    const { sim, line } = setup(4711);
    const ev = tally(sim, ['needle:found', 'game:completed']);
    const p = sim.progress;
    const order = [3, 0, 5, 1, 4, 2]; // discovery order (ids); the last one goes through the scanner
    const baseline = BUFF_STATS.map((k) => sim.stat(k));
    const expected = new Map(BUFF_STATS.map((k, i) => [k, baseline[i]]));

    for (let k = 0; k < NEEDLE_COUNT; k++) {
      const id = order[k];
      const n = sim.hay.needles.find((q) => q.id === id)!;
      const wp0 = p.wp;
      const m0 = p.money;
      if (k < 3) {
        sim.foundNeedle(id, 'manual', n.pos);
      } else if (k < 5) {
        // Exposed on the surface and picked up with the detector equipped.
        p.ownedTools.add('detector');
        sim.player.equipped = 'detector';
        n.status = 'exposed';
        n.pos.y = sim.hay.heightAt(n.pos.x, n.pos.z);
        sim.player.pos = { x: n.pos.x, y: n.pos.y, z: n.pos.z };
        expect(pickupNeedle(sim, id)).toBe(true);
        parkPlayer(sim);
      } else {
        // Hidden in a packet on the running line: the scanner finds it.
        n.status = 'inTransit';
        let fed = 0;
        for (let t = 0; t < 400 && !fed; t++) { fed = feed(sim, sim.buildings.get(line.source.id)!, 0, { type: 'hay', amount: 10, needleId: id }); if (!fed) sim.tick(DT); }
        expect(fed).toBe(1);
        let guard = 0;
        const isFound = (): boolean => sim.hay.needles[id].status === 'found';
        while (!isFound() && guard++ < 2000) { sim.tick(DT); service(sim, line); }
        expect(n.status).toBe('found');
        expect(n.foundBy).toBe('scanner');
      }
      expect(p.needlesFound.length).toBe(k + 1);
      expect(p.needlesFound[k]).toBe(id);
      const e = ev['needle:found'].at(-1) as { id: number; index: number; buffName: string; money: number; wp: number };
      expect(e).toMatchObject({ id, index: k, buffName: NEEDLE_BUFFS[k].name, money: NEEDLE_BUFFS[k].money, wp: BALANCE.needleWP });
      expect(p.wp - wp0).toBe(BALANCE.needleWP);
      if (k < 5) expect(p.money - m0).toBeCloseTo(NEEDLE_BUFFS[k].money, 6); // (the scanner case also earns sales meanwhile)
      // Buff k (and only buff k) was applied on top of the previous ones.
      for (const eff of NEEDLE_BUFFS[k].effects) expected.set(eff.stat, applyEffect(expected.get(eff.stat)!, eff));
      for (const key of BUFF_STATS) expect(sim.stat(key), `${key} after needle #${k + 1}`).toBeCloseTo(expected.get(key)!, 9);
      expectNeedleInvariant(sim, `needle #${k + 1}`);
      if (k < NEEDLE_COUNT - 1) {
        expect(sim.completed).toBe(false);
        expect(ev['game:completed'].length).toBe(0);
        run(sim, 3, (s) => service(s, line)); // machines keep cycling between finds
      }
    }

    // Completed exactly once, at the moment of the 6th find.
    expect(sim.completed).toBe(true);
    expect(ev['game:completed'].length).toBe(1);
    const doneAt = (ev['game:completed'][0] as { time: number }).time;
    expect(p.stats.completedAt).toBe(doneAt);
    expect(doneAt).toBeCloseTo(sim.time, 6);
    expect(new Set(p.needlesFound).size).toBe(NEEDLE_COUNT);
    expect(sim.hay.needles.every((n) => n.status === 'found')).toBe(true);

    // Sandbox: keeps ticking, machines keep working, nothing re-fires.
    const st0 = { ...p.stats };
    for (const id of order) sim.foundNeedle(id, 'manual', { x: 0, y: 0, z: 0 });
    run(sim, 90, (s) => service(s, line));
    expect(ev['game:completed'].length).toBe(1);
    expect(ev['needle:found'].length).toBe(NEEDLE_COUNT);
    expect(p.stats.completedAt).toBe(doneAt);
    expect(p.stats.hayScanned).toBeGreaterThan(st0.hayScanned);
    expect(p.stats.baleSold + p.stats.wrappedSold).toBeGreaterThan(st0.baleSold + st0.wrappedSold);
    expect(p.stats.playTime).toBeGreaterThan(st0.playTime);
    for (const b of [line.scanner, line.compressor, line.wrapper]) expect(['noPower', 'disabled', 'needleAlarm'], b.type).not.toContain(b.status);
    for (const v of Object.values(p.stats)) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(p.money)).toBe(true);

    // Save after completion -> load: still completed, not re-emitted, stats and buffs intact, still running.
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    expect(data.completed).toBe(true);
    const s2 = Sim.fromSave(data);
    const ev2 = tally(s2, ['game:completed', 'needle:found']);
    expect(s2.completed).toBe(true);
    expect(s2.progress.stats).toEqual(p.stats);
    expect(s2.progress.needlesFound).toEqual(p.needlesFound);
    for (const key of BUFF_STATS) expect(s2.stat(key)).toBeCloseTo(sim.stat(key), 12);
    for (const id of order) s2.foundNeedle(id, 'scanner', { x: 0, y: 0, z: 0 });
    const line2: Line = { ...line, source: s2.buildings.get(line.source.id)!, gens: line.gens.map((g) => s2.buildings.get(g.id)!) };
    const sold2 = s2.progress.stats.wrappedSold;
    run(s2, 60, (s) => service(s, line2));
    expect(ev2['game:completed'].length).toBe(0);
    expect(ev2['needle:found'].length).toBe(0);
    expect(s2.progress.stats.completedAt).toBe(doneAt);
    expect(s2.progress.stats.wrappedSold).toBeGreaterThan(sold2);
    expectNeedleInvariant(s2, 'after completion + load');
  });

  it('two needles found by the same scanner batch still complete the game exactly once', () => {
    const { sim, line } = setup(4712);
    const ev = tally(sim, ['game:completed', 'needle:found']);
    for (const id of [0, 1, 2, 3]) sim.foundNeedle(id, 'manual', sim.hay.needles[id].pos);
    expect(sim.completed).toBe(false);
    // Both remaining needles ride in consecutive packets and are scanned in one batch (straight into the scanner buffer).
    const scanner = sim.buildings.get(line.scanner.id)!;
    scanner.clearContents();
    for (const id of [4, 5]) {
      sim.hay.needles[id].status = 'inTransit';
      expect(feed(sim, scanner, 0, { type: 'hay', amount: 10, needleId: id })).toBe(1);
    }
    let guard = 0;
    while (!sim.completed && guard++ < 400) sim.tick(DT);
    expect(sim.completed).toBe(true);
    expect(ev['needle:found'].length).toBe(6);
    expect(ev['game:completed'].length).toBe(1);
    run(sim, 10, (s) => service(s, line));
    expect(ev['game:completed'].length).toBe(1);
    expectNeedleInvariant(sim, 'double find');
  });
});
