/**
 * MARKET INTAKE (manual sell loop): carried hay is sold ONLY by dropping it on the fixed intake belt; the chute sells
 * it on arrival through the same sale call as before (manual, not "via belt"). Real Sim, no shortcuts except
 * granting money / techs where named.
 */
import { describe, expect, it } from 'vitest';
import { HAY_VALUE_MULTIPLIERS } from '../src/config/techTree';
import { isReservedCell, WORLD } from '../src/config/world';
import type { IntakeLoad } from '../src/sim/machines/sellStation';
import { depositToIntake } from '../src/sim/playerActions';
import { Inventory } from '../src/sim/inventory';
import { Sim } from '../src/sim/sim';
import { expectNeedleInvariant, feed, grantTech, inPorts, rich, run, sellCarry } from './support/simKit';

const T = WORLD.intake.transitSeconds;
const loads = (sim: Sim) => (sim.sellStation as unknown as { intakeLoads(): readonly IntakeLoad[] }).intakeLoads();
const value = (sim: Sim, type: 'hay' | 'bale' | 'wrapped', n: number) =>
  n * sim.stat(`econ.${type}Value`) * sim.stat('econ.hayMul') * sim.stat('econ.saleMul');

describe('Market intake: the only way to sell what the player carries', () => {
  it('pressing E on the chute while carrying sells nothing and keeps the carry', () => {
    const sim = new Sim(901);
    sim.player.carry.add('hay', 40);
    const chute = sim.sellStation!;
    expect(chute.interaction(sim)).toMatchObject({ enabled: false, reason: expect.stringContaining('intake belt') });
    expect(chute.interact(sim)).toBe(false);
    run(sim, 5);
    expect(sim.progress.money).toBe(0);
    expect(sim.player.carry.hay).toBe(40);
  });

  it('a drop keeps the exact logical amount on the belt, sells it after the transit, with the regular price', () => {
    const sim = new Sim(902);
    sim.player.carry.add('hay', 37.25);
    expect(depositToIntake(sim)).toBe(true);
    expect(sim.player.carry.isEmpty()).toBe(true);
    expect(loads(sim)).toEqual([{ hay: 37.25, bale: 0, wrapped: 0, t: 0 }]);
    run(sim, T * 0.5);
    expect(sim.progress.money).toBe(0); // still on the belt
    run(sim, T * 0.5 + 0.1);
    expect(loads(sim)).toHaveLength(0);
    expect(sim.progress.money).toBeCloseTo(value(sim, 'hay', 37.25), 9);
    expect(sim.progress.stats.haySold).toBeCloseTo(37.25, 9);
    expect(sim.progress.stats.hayViaBelt).toBe(0); // manual sale: belt-only Orders are not fed by the intake
    const m = sim.progress.money;
    run(sim, 30);
    expect(sim.progress.money).toBe(m); // sold once: no duplicate, nothing left behind
    expect(T).toBeGreaterThanOrEqual(1);
    expect(T).toBeLessThanOrEqual(3);
  });

  it('Hay Sell Value applies to intake sales', () => {
    const sim = new Sim(903);
    rich(sim, 1e7);
    grantTech(sim.progress, 'e_hay_value@6');
    const m0 = sim.progress.money;
    sim.player.carry.add('hay', 50);
    sellCarry(sim);
    expect(sim.progress.money - m0).toBeCloseTo(50 * sim.stat('econ.hayValue') * HAY_VALUE_MULTIPLIERS[5] * sim.stat('econ.saleMul'), 9);
  });

  it('several drops in a row ride together and all sell; mixed items and the held wheelbarrow go too', () => {
    const sim = new Sim(904);
    let sold = 0;
    sim.events.on('sale', (e) => { sold += e.value; expect(e.viaBelt).toBe(false); });
    let expected = 0;
    for (const n of [10, 25, 7]) {
      sim.player.carry.add('hay', n);
      expected += value(sim, 'hay', n);
      expect(depositToIntake(sim)).toBe(true);
      run(sim, 0.3);
    }
    expect(loads(sim)).toHaveLength(3);
    sim.progress.hasWheelbarrow = true;
    const inv = new Inventory();
    inv.add('hay', 60);
    inv.add('bale', 2);
    sim.player.wheelbarrow = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, held: true, inv };
    sim.player.carry.add('wrapped', 1);
    expected += value(sim, 'hay', 60) + value(sim, 'bale', 2) + value(sim, 'wrapped', 1);
    expect(depositToIntake(sim)).toBe(true);
    expect(inv.isEmpty()).toBe(true);
    expect(depositToIntake(sim)).toBe(false); // nothing left to drop
    run(sim, T + 0.2);
    expect(loads(sim)).toHaveLength(0);
    expect(sold).toBeCloseTo(expected, 6);
    // Any extra money is Order / milestone rewards triggered by these sales (e.g. First Delivery), never a second sale.
    const rewards = sim.progress.money - sold;
    expect(rewards).toBeGreaterThanOrEqual(0);
    expect(sim.progress.stats.moneyEarned).toBeCloseTo(sim.progress.money, 6);
  });

  it('automation still sells instantly through the chute ports (via belt)', () => {
    const sim = new Sim(905);
    const chute = sim.sellStation!;
    const port = inPorts(chute)[0];
    const n = feed(sim, chute, port.index, { type: 'hay', amount: 20 }, 3);
    expect(n).toBe(3);
    expect(sim.progress.money).toBeCloseTo(value(sim, 'hay', 60), 9);
    expect(sim.progress.stats.hayViaBelt).toBeCloseTo(60, 9);
  });

  it('a hidden needle in dropped hay is never sold or lost: it slips back to the pile, as with the old direct sale', () => {
    const sim = new Sim(906);
    const n = sim.hay.needles[0];
    n.status = 'inTransit';
    sim.player.carry.add('hay', 20, [n.id]);
    expectNeedleInvariant(sim, 'before');
    const found = sim.progress.needlesFound.length;
    expect(depositToIntake(sim)).toBe(true);
    run(sim, T + 0.5);
    expect(sim.hay.needles.find((x) => x.id === n.id)!.status).not.toBe('inTransit');
    expect(sim.progress.needlesFound.length).toBe(found);
    expectNeedleInvariant(sim, 'after');
    expect(sim.progress.money).toBeCloseTo(value(sim, 'hay', 20), 9);
  });

  it('save/load in the middle of the transit keeps the loads and ends with the same money', () => {
    const a = new Sim(907);
    a.player.carry.add('hay', 33);
    depositToIntake(a);
    run(a, T * 0.4);
    const data = JSON.parse(JSON.stringify(a.serialize()));
    const b = Sim.fromSave(data);
    expect(loads(b)).toHaveLength(1);
    expect(loads(b)[0].hay).toBe(33);
    run(a, T);
    run(b, T);
    expect(b.progress.money).toBeCloseTo(a.progress.money, 9);
    expect(a.progress.money).toBeCloseTo(value(a, 'hay', 33), 9);
    // A save without intake data (RC1/RC2/P0.1) loads with an empty belt.
    const old = JSON.parse(JSON.stringify(new Sim(908).serialize()));
    const chuteSave = old.buildings.find((x: { type: string }) => x.type === 'sellStation');
    chuteSave.state = { earned: 12 };
    expect(loads(Sim.fromSave(old))).toHaveLength(0);
  });

  it('the intake and Store cells are reserved: nothing can be built on them', () => {
    const sim = new Sim(909);
    rich(sim);
    grantTech(sim.progress, 'l_conveyor@1');
    const i = WORLD.intake;
    for (let z = i.z0; z < i.z1; z++) {
      expect(isReservedCell(i.x, z)).toBe(true);
      expect(sim.canPlace('conveyor', { x: i.x, z, level: 0 }, 0).reason).toContain('Reserved');
    }
    for (let z = WORLD.store.z0; z < WORLD.store.z1; z++) expect(sim.canPlace('conveyor', { x: WORLD.store.x, z, level: 0 }, 0).ok).toBe(false);
    expect(isReservedCell(i.x + 1, i.z0)).toBe(false);
    expect(isReservedCell(i.x, i.z1)).toBe(false); // the chute itself starts there
  });

  it('only hay (and hay products) is ever sold: other types are refused at the chute and never paid', () => {
    const sim = new Sim(910);
    const chute = sim.sellStation!;
    const port = inPorts(chute)[0].index;
    const m0 = sim.progress.money;
    let sales = 0;
    sim.events.on('sale', () => { sales++; });
    for (const bogus of ['needle', 'tool', 'shovel', 'conveyor', 'money', ''] as const) {
      const pkt = { type: bogus as unknown as 'hay', amount: 10 };
      expect(chute.canAccept(pkt, port, sim)).toBe(false);
      chute.accept(pkt, port, sim); // even if someone skips canAccept
      expect(sim.progress.recordSale(bogus as unknown as 'hay', 10, true, { x: 0, y: 0, z: 0 })).toBe(0);
    }
    expect(sim.progress.money).toBe(m0);
    expect(sales).toBe(0);
    // the real hay products still sell
    for (const t of ['hay', 'bale', 'wrapped'] as const) expect(chute.canAccept({ type: t, amount: 1 }, port, sim)).toBe(true);
  });
});
