/**
 * SOFTLOCK / RECOVERABILITY AUDIT with the real Sim: the player can always earn money by hand, rebuild power,
 * sell a full carry, clean up bad belt layouts, never lose a needle, always has an order to work on, and can
 * load saves taken in awkward states.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import { MILESTONES } from '../src/config/milestones';
import { NEEDLE_COUNT } from '../src/config/needles';
import { MAX_ACTIVE_ORDERS, ORDERS, type OrderDef } from '../src/config/orders';
import { TECH_BY_ID, TECH_NODES } from '../src/config/techTree';
import { TOOLS, WHEELBARROW } from '../src/config/tools';
import { WORLD } from '../src/config/world';
import { Rng } from '../src/core/rng';
import type { Building } from '../src/sim/building';
import { neighbor } from '../src/sim/grid';
import { Inventory } from '../src/sim/inventory';
import { Progression } from '../src/sim/progression';
import { carryCapacity, playerDig } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import { EventBus } from '../src/core/events';
import { oppositeDir, type BuildingType, type Rot } from '../src/sim/types';
import { Bot } from '../tools/balance/bot';
import {
  DT, expectNeedleInvariant, feed, inPorts, outPorts, parkPlayer, place, refuel, rich, run, tally, unlock,
} from './support/simKit';

const CHUTE = { x: -28, z: 6 };

/** One hand trip: dig at the pile until the carry is full, walk to the chute and sell. Returns sim seconds spent. */
function handTrip(sim: Sim, tool: 'hands' | 'shovel' = 'hands'): number {
  const t0 = sim.time;
  const target = sim.hay.findTarget(-8, 0, 30, 'nearest') ?? sim.hay.findTarget(5, 0, 40, 'densest');
  expect(target, 'hay left to dig').not.toBeNull();
  sim.player.pos = { x: target!.x - 1, y: 0, z: target!.z };
  run(sim, 6); // walking there
  for (let guard = 0; guard < 400; guard++) {
    if (sim.player.cooldown > 0) { sim.tick(DT); continue; }
    const r = playerDig(sim, tool, target!.x, target!.height, target!.z);
    if (r.full) break;
    if (r.amount <= 0) {
      const t = sim.hay.findTarget(sim.player.pos.x, sim.player.pos.z, 6, 'nearest');
      if (!t) break;
      target!.x = t.x; target!.z = t.z; target!.height = t.height;
    }
    sim.tick(DT);
  }
  sim.player.pos = { x: CHUTE.x, y: 0, z: CHUTE.z };
  run(sim, 6); // walking back
  sim.sellStation!.interact(sim);
  parkPlayer(sim);
  return sim.time - t0;
}

// =====================================================================================================
// Money / power recovery
// =====================================================================================================

describe('softlock: money and power recovery', () => {
  it('with $0 and bare hands the player still earns money by digging and selling', () => {
    const sim = new Sim(600);
    expect(sim.progress.money).toBe(0);
    expect([...sim.progress.ownedTools]).toEqual(['hands']);
    for (let i = 0; i < 5; i++) handTrip(sim);
    expect(sim.progress.money).toBeGreaterThan(0);
    expect(sim.progress.stats.haySold).toBeGreaterThan(50);
    // Broke again late in a run (everything spent): hands still work.
    sim.progress.spendMoney(sim.progress.money);
    expect(sim.progress.money).toBe(0);
    const m = sim.progress.money;
    handTrip(sim);
    expect(sim.progress.money).toBeGreaterThan(m);
  });

  it('with every generator removed machines report noPower, and hand income buys a new generator', () => {
    const sim = new Sim(601);
    parkPlayer(sim);
    unlock(sim, ['f_generator', 'x_rake', 'x_arm', 'f_pole']);
    rich(sim, 1_000_000);
    const gen = place(sim, 'hayGenerator', -16, -8, 0);
    refuel(sim, gen);
    const edgeX = -12;
    const arm = place(sim, 'roboticArm', edgeX, -5, 2);
    sim.rebuildTopology();
    run(sim, 3);
    expect(arm.status).not.toBe('noPower');
    expect(sim.remove(gen.id)).toBe(true);
    run(sim, 1);
    expect(arm.status).toBe('noPower');
    expect(arm.info(sim).statusText).toMatch(/No power/);
    // Broke: spend everything, then earn the generator back by hand.
    sim.progress.spendMoney(sim.progress.money);
    const tBroke = sim.time;
    const cost = sim.nextCost('hayGenerator');
    expect(cost).toBe(BUILDABLES.hayGenerator.cost); // owned count dropped back to 0
    let trips = 0;
    while (sim.progress.money < cost && trips < 400) { handTrip(sim); trips++; }
    expect(sim.progress.money, `hand income after ${trips} trips (${Math.round(sim.time / 60)} min)`).toBeGreaterThanOrEqual(cost);
    console.info(`[power recovery] $0 + bare hands -> generator ($${cost}) after ${trips} hand trips, ${((sim.time - tBroke) / 60).toFixed(1)} min`);
    const g2 = sim.place('hayGenerator', { x: -16, z: -8, level: 0 }, 0);
    expect(g2).not.toBeNull();
    // Fuel it with dug hay (no free hay).
    handTripTo(sim, g2!);
    sim.rebuildTopology();
    run(sim, 2);
    expect(arm.status).not.toBe('noPower');
  }, 120_000);

  it('filling the carry is always signalled (float32 hay heights), digging when full is refused cleanly', () => {
    for (let seed = 602; seed < 612; seed++) {
      const sim = new Sim(seed);
      const ev = tally(sim, ['player:full']);
      const cap = carryCapacity(sim);
      const t = sim.hay.findTarget(5, 0, 20, 'densest')!;
      let fullAt = -1;
      for (let i = 0; i < 40 && fullAt < 0; i++) {
        sim.player.cooldown = 0;
        sim.tick(DT);
        if (playerDig(sim, 'hands', t.x, t.height, t.z).full) fullAt = i;
      }
      expect(fullAt, `seed ${seed}: the dig that fills the carry reports full`).toBeGreaterThanOrEqual(0);
      expect(sim.player.carry.weight()).toBeCloseTo(cap, 2);
      const before = sim.hay.totalUnits();
      run(sim, 1.1);
      sim.player.cooldown = 0;
      const r = playerDig(sim, 'hands', t.x, t.height, t.z);
      expect(r).toMatchObject({ amount: 0, full: true });
      expect(sim.hay.totalUnits()).toBe(before);
      expect(ev['player:full'].length, `seed ${seed}: HUD "carry full" event`).toBeGreaterThan(0);
    }
  });

  it('a full carry can always be sold (carry + held wheelbarrow)', () => {
    const sim = new Sim(602);
    const cap = carryCapacity(sim);
    const t = sim.hay.findTarget(5, 0, 20, 'densest')!;
    for (let i = 0; i < 200; i++) { sim.player.cooldown = 0; if (playerDig(sim, 'hands', t.x, t.height, t.z).full) break; }
    expect(sim.player.carry.weight()).toBeCloseTo(cap, 2);
    expect(sim.sellStation!.interaction(sim)?.enabled).toBe(true);
    expect(sim.sellStation!.interact(sim)).toBe(true);
    expect(sim.player.carry.isEmpty()).toBe(true);
    expect(sim.progress.money).toBeCloseTo(cap * sim.stat('econ.hayValue') * sim.stat('econ.saleMul'), 2);
    // Full carry + full held wheelbarrow of mixed items.
    sim.progress.hasWheelbarrow = true;
    const inv = new Inventory();
    inv.add('hay', sim.stat('wheelbarrow.capacity') - 40);
    inv.add('bale', 2);
    sim.player.wheelbarrow = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, held: true, inv };
    sim.player.carry.add('hay', cap);
    const m0 = sim.progress.money;
    expect(sim.sellStation!.interact(sim)).toBe(true);
    expect(sim.player.carry.isEmpty()).toBe(true);
    expect(sim.player.wheelbarrow.inv.isEmpty()).toBe(true);
    expect(sim.progress.money).toBeGreaterThan(m0);
  });
});

describe('softlock: a full extractor says so', () => {
  it('a vacuum collector / piston rake with a full buffer and no output reports outputBlocked (not running / noHay)', () => {
    let filled = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Sim(seed);
      parkPlayer(sim);
      unlock(sim, ['x_rake', 'f_generator', 'x_collector']);
      rich(sim);
      const edgeX = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 4;
      const put = (type: BuildingType, z: number): Building => {
        for (let x = edgeX; x < edgeX + 8; x++) {
          const c = { x, z, level: 0 as const };
          if (sim.canPlace(type, c, 0).ok) return sim.place(type, c, 0)!;
        }
        throw new Error(`no spot for ${type}`);
      };
      const col = put('vacuumCollector', -3);
      const rake = put('pistonRake', -9);
      const gen = place(sim, 'hayGenerator', col.cell.x - 4, col.cell.z, 0);
      refuel(sim, gen);
      sim.rebuildTopology();
      run(sim, 150, (s) => { if (Math.round(s.time / DT) % 400 === 0) refuel(s, gen); });
      for (const [b, cap] of [[col, sim.stat('collector.buffer')], [rake, sim.stat('rake.trayCapacity')]] as [Building, number][]) {
        const hay = b.contents().hay;
        if (Math.abs(hay - cap) < 0.01) { filled++; expect(b.status, `seed ${seed} ${b.type} full`).toBe('outputBlocked'); }
        else expect(b.status, `seed ${seed} ${b.type} not full (${hay})`).not.toBe('outputBlocked');
      }
    }
    expect(filled).toBeGreaterThanOrEqual(6);
  });
});

/** Dig a carry of hay and hand-feed it to `gen`. */
function handTripTo(sim: Sim, gen: Building): void {
  const t = sim.hay.findTarget(-8, 0, 30, 'nearest')!;
  for (let i = 0; i < 400; i++) {
    sim.player.cooldown = 0;
    if (playerDig(sim, 'hands', t.x, t.height, t.z).full) break;
    const nt = sim.hay.findTarget(t.x, t.z, 6, 'nearest');
    if (nt) { t.x = nt.x; t.z = nt.z; t.height = nt.height; }
  }
  expect(sim.player.carry.hay).toBeGreaterThan(0);
  expect(gen.interact(sim)).toBe(true);
}

// =====================================================================================================
// Bad belt layouts
// =====================================================================================================

describe('softlock: badly placed belts', () => {
  it('head-on belts, dead ends, loops (plain / through a splitter) and belts into walls never crash and can be removed', () => {
    const sim = new Sim(700);
    parkPlayer(sim);
    unlock(sim, ['l_conveyor', 'l_splitter', 'l_merger']);
    rich(sim);
    const belts: Building[] = [];
    // Head-on pair.
    belts.push(place(sim, 'conveyor', -20, -20, 0), place(sim, 'conveyor', -19, -20, 2));
    // Dead end (3 tiles into nothing) and a belt pointing into the west wall.
    for (let x = -26; x <= -24; x++) belts.push(place(sim, 'conveyor', x, -18, 0));
    belts.push(place(sim, 'conveyor', -32, -16, 2));
    // Square loop.
    belts.push(place(sim, 'conveyor', -20, -16, 0), place(sim, 'conveyor', -19, -16, 1), place(sim, 'conveyor', -19, -15, 2), place(sim, 'conveyor', -20, -15, 3));
    // Splitter whose outputs loop back into its own input through a merger.
    const sp = place(sim, 'splitter', -14, -16, 0);
    belts.push(sp);
    belts.push(place(sim, 'conveyor', -13, -16, 0), place(sim, 'conveyor', -12, -16, 3), place(sim, 'conveyor', -12, -17, 2),
      place(sim, 'conveyor', -13, -17, 2), place(sim, 'conveyor', -14, -17, 2));
    const mg = place(sim, 'merger', -15, -17, 1);
    belts.push(mg);
    belts.push(place(sim, 'conveyor', -15, -16, 0));
    // Belt feeding head-on into a splitter's output side.
    belts.push(place(sim, 'conveyor', -14, -14, 3));
    sim.rebuildTopology();
    expect(sim.logistics.isLinked(belts[0], 1)).toBe(false); // head-on: never linked
    let sent = 0;
    for (const b of belts) sent += feed(sim, b, 0, { type: 'hay', amount: 10 }, 3) * 10;
    expect(sent).toBeGreaterThan(0);
    const hay0 = sim.hay.totalUnits();
    const count = () => { let n = 0; for (const b of belts) n += b.contents().hay; return n; };
    run(sim, 60, () => expect(count()).toBeCloseTo(sent, 9));
    expect(sim.logistics.itemCount()).toBeGreaterThan(0);
    const m0 = sim.progress.money;
    for (const b of belts) expect(sim.remove(b.id), `remove ${b.type}#${b.id}`).toBe(true);
    expect(sim.logistics.itemCount()).toBe(0);
    expect(sim.hay.totalUnits() - hay0).toBeCloseTo(sent, 1);
    expect(sim.progress.money).toBeGreaterThan(m0); // logistics refunds
    run(sim, 2);
  });
});

// =====================================================================================================
// Needles are never lost
// =====================================================================================================

describe('softlock: needles are never lost', () => {
  it('removing or moving any holder of a hidden needle puts it back in the world', () => {
    const sim = new Sim(800);
    parkPlayer(sim);
    unlock(sim, TECH_NODES.map((n) => n.id));
    rich(sim);
    // A belt line -> splitter -> silo, plus a loaded belt lift; hidden needles ride in packets.
    const needleAt = (id: number): number => { sim.hay.needles[id].status = 'inTransit'; return id; };
    const line: Building[] = [];
    for (let x = -12; x >= -20; x--) line.push(place(sim, 'conveyor', x, -18, 2));
    const split = place(sim, 'splitter', -21, -18, 2);
    const silo = place(sim, 'silo', -24, -19, 2);
    const lift = place(sim, 'beltLift', -20, -16, 1);
    sim.rebuildTopology();
    feed(sim, line[0], 0, { type: 'hay', amount: 10, needleId: needleAt(0) });
    run(sim, 1);
    feed(sim, line[0], 0, { type: 'hay', amount: 10, needleId: needleAt(1) });
    feed(sim, lift, 0, { type: 'hay', amount: 10, needleId: needleAt(2) });
    expectNeedleInvariant(sim, 'loaded');
    // Remove a belt tile holding a needle.
    const holder = line.find((b) => b.contents().needles.length > 0)!;
    expect(holder).toBeDefined();
    const id = holder.contents().needles[0];
    expect(sim.remove(holder.id)).toBe(true);
    expect(sim.hay.needles[id].status).toBe('exposed');
    expectNeedleInvariant(sim, 'belt removed');
    // Move the lift holding a needle (kept), then remove it (spilled).
    expect(sim.move(lift.id, { x: -26, z: -12, level: 0 }, 0)).toBe(true);
    expect(lift.contents().needles).toEqual([2]);
    expectNeedleInvariant(sim, 'lift moved');
    expect(sim.remove(lift.id)).toBe(true);
    expect(sim.hay.needles[2].status).toBe('exposed');
    // Let the rest pass the splitter into the silo, then demolish everything.
    run(sim, 20);
    expectNeedleInvariant(sim, 'flowing');
    expect(silo.contents().needles.length, 'a needle reached the silo').toBeGreaterThan(0);
    expect(split.contents().needles).toEqual([]);
    for (const b of [...sim.buildings.values()]) if (b.type !== 'sellStation') expect(sim.remove(b.id)).toBe(true);
    expectNeedleInvariant(sim, 'all removed');
    for (const n of sim.hay.needles) expect(['buried', 'exposed']).toContain(n.status);
  });

  it('during a full bot run (build, move, demolish, scan, slip) every needle is always found, in the world, or held exactly once', () => {
    const bot = new Bot({ seed: 4242, maxMinutes: 45, humanFactor: 1.15, verbose: false });
    const sim = bot.sim;
    const tick = sim.tick.bind(sim);
    let k = 0;
    let checks = 0;
    sim.tick = (dt: number) => {
      tick(dt);
      if (++k % 97 === 0) { expectNeedleInvariant(sim, `t=${sim.time.toFixed(1)}`); checks++; }
    };
    const ev = tally(sim, ['building:removed', 'building:moved', 'needle:returned', 'needle:found']);
    bot.run();
    expectNeedleInvariant(sim, 'end');
    expect(checks).toBeGreaterThan(100);
    console.info(`[needle invariant] ${checks} checks over ${Math.round(sim.time / 60)} min; moved ${ev['building:moved'].length}, `
      + `removed ${ev['building:removed'].length}, needles found ${ev['needle:found'].length}, slipped back ${ev['needle:returned'].length}`);
  }, 120_000);
});

// =====================================================================================================
// Orders / Work Points
// =====================================================================================================

/** Plan nodes a player needs to make progress on an order's metric at all. */
function plansFor(o: OrderDef): string[] {
  switch (o.metric) {
    case 'sell': return o.item === 'bale' ? ['e_compressor'] : o.item === 'wrapped' ? ['e_wrapper'] : [];
    case 'extractManual': case 'needles': case 'pileProgress': return [];
    case 'burn': case 'powerGen': return ['f_generator'];
    case 'extractMachine': return ['x_rake'];
    case 'extractArm': return ['x_arm'];
    case 'sellViaBelt': case 'stableRate': return ['x_hopper', 'l_conveyor'];
    case 'poweredMachines': return ['f_generator', 'x_rake'];
    case 'scan': return ['d_scanner'];
    case 'siloStored': return ['e_silo'];
  }
}

/** WP cost of the first level of `ids` and all their prerequisites. */
function planCost(ids: string[]): number {
  const seen = new Set<string>();
  const go = (id: string): void => {
    if (seen.has(id)) return;
    const n = TECH_BY_ID[id];
    expect(n, `tech node ${id}`).toBeDefined();
    seen.add(id);
    n.requires.forEach(go);
  };
  ids.forEach(go);
  let c = 0;
  for (const id of seen) c += TECH_BY_ID[id].levels[0].cost;
  return c;
}

describe('softlock: orders and Work Points', () => {
  it('the order DAG is well formed: known predecessors, no cycles, sane targets', () => {
    const ids = new Set(ORDERS.map((o) => o.id));
    expect(ids.size).toBe(ORDERS.length);
    for (const o of ORDERS) {
      for (const a of o.after) expect(ids.has(a), `${o.id} after ${a}`).toBe(true);
      expect(o.target, o.id).toBeGreaterThan(0);
      expect(o.reward.wp, o.id).toBeGreaterThan(0);
      if (o.metric === 'needles') expect(o.target).toBeLessThanOrEqual(NEEDLE_COUNT);
      if (o.metric === 'pileProgress') expect(o.target).toBeLessThan(1);
      for (const p of plansFor(o)) expect(TECH_BY_ID[p], `${o.id} needs ${p}`).toBeDefined();
    }
    // Topological order exists (no cycles).
    const done = new Set<string>();
    for (let pass = 0; pass < ORDERS.length && done.size < ORDERS.length; pass++) {
      for (const o of ORDERS) if (!done.has(o.id) && o.after.every((a) => done.has(a))) done.add(o.id);
    }
    expect(done.size, 'every order is reachable (no cycle, no dangling predecessor)').toBe(ORDERS.length);
  });

  it('whatever order the player completes orders in, there is always an active order until all are done', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed);
      const p = new Progression(new EventBus());
      const priv = p as unknown as { completeOrder(i: number): void; fillActiveOrders(emit: boolean): void };
      let completed = 0;
      while (completed < ORDERS.length) {
        const active = p.activeOrders();
        expect(active.length, `seed ${seed}: no active order after ${completed} completions`).toBeGreaterThan(0);
        expect(active.length).toBeLessThanOrEqual(MAX_ACTIVE_ORDERS);
        const pick = active[rng.int(0, active.length - 1)];
        priv.completeOrder(ORDERS.findIndex((o) => o.id === pick.id));
        priv.fillActiveOrders(true);
        completed++;
      }
      expect(p.orders.every((o) => o.completed)).toBe(true);
      expect(p.activeOrders().length).toBe(0);
    }
  });

  it('Work Point budget: hand-only sources unlock the first machines; every plan is affordable; (report) tree exhaustion', () => {
    const needleWP = NEEDLE_COUNT * BALANCE.needleWP;
    const orderWP = ORDERS.reduce((a, o) => a + o.reward.wp, 0);
    const msWP = MILESTONES.reduce((a, m) => a + m.reward.wp, 0);
    const total = BALANCE.startWP + orderWP + msWP + needleWP;
    // Hand-only: orders needing no plan (with hand-only predecessors), hand-reachable milestones, needles.
    const handOrders = new Set<string>();
    for (let pass = 0; pass < ORDERS.length; pass++) {
      for (const o of ORDERS) if (plansFor(o).length === 0 && o.after.every((a) => handOrders.has(a))) handOrders.add(o.id);
    }
    const handMs = MILESTONES.filter((m) => ['firstSale', 'haySoldTotal', 'moneyEarnedTotal', 'pileProgress'].includes(m.metric));
    const handWP = BALANCE.startWP + ORDERS.filter((o) => handOrders.has(o.id)).reduce((a, o) => a + o.reward.wp, 0)
      + handMs.reduce((a, m) => a + m.reward.wp, 0) + needleWP;
    // The first tech-gated orders on the board after the hand-only ones.
    const gated = ORDERS.filter((o) => !handOrders.has(o.id) && o.after.every((a) => handOrders.has(a)));
    expect(gated.length).toBeGreaterThan(0);
    const gateCost = Math.min(...gated.map((o) => planCost(plansFor(o))));
    expect(handWP, 'a player who never builds still earns the WP for the first machine plans').toBeGreaterThanOrEqual(gateCost);
    // Every building plan / tool plan together is affordable with the WP the game hands out.
    const planNodes = new Set<string>();
    for (const t of Object.values(BUILDABLES)) if (t.requiresNode) planNodes.add(t.requiresNode);
    for (const t of Object.values(TOOLS)) if (t.requiresNode) planNodes.add(t.requiresNode);
    if (WHEELBARROW.requiresNode) planNodes.add(WHEELBARROW.requiresNode);
    const allPlans = planCost([...planNodes]);
    expect(total, 'all buildings + tools can be unlocked').toBeGreaterThanOrEqual(allPlans);
    // Report (not an assertion): can the whole tree be bought?
    const tree = TECH_NODES.reduce((a, n) => a + n.levels.reduce((b, l) => b + l.cost, 0), 0);
    console.info(`[WP budget] obtainable ${total} (orders ${orderWP}, milestones ${msWP}, needles ${needleWP}); `
      + `all plans ${allPlans}; full tree ${tree}; hand-only ${handWP} vs first gate ${gateCost}`);
  });
});

// =====================================================================================================
// Loading awkward saves
// =====================================================================================================

describe('softlock: saves taken in awkward states load and recover', () => {
  it('scanner mid-alarm + empty generator + backed-up belt in one save: loads exactly and recovers', () => {
    const sim = new Sim(900);
    parkPlayer(sim);
    unlock(sim, ['d_scanner', 'l_conveyor', 'f_generator', 'x_hopper', 'l_splitter', 'x_rake', 'x_arm']);
    expect(sim.stat('scanner.autoEject')).toBe(0);
    rich(sim);
    const gen = place(sim, 'hayGenerator', -20, -21, 0);
    refuel(sim, gen, 60);
    const scanner = place(sim, 'scannerMk1', -20, -17, 2);
    const sin = inPorts(scanner)[0];
    const src = neighbor(sin.cell, sin.dir);
    const feedBelt = place(sim, 'conveyor', src.x, src.z, oppositeDir(sin.dir) as Rot);
    const sout = outPorts(scanner)[0];
    const dead: Building[] = [];
    for (let i = 1; i <= 4; i++) dead.push(place(sim, 'conveyor', sout.cell.x - i, sout.cell.z, 2));
    // A second, never fuelled generator powering an arm on its own.
    const genEmpty = place(sim, 'hayGenerator', -28, -12, 0);
    const arm = place(sim, 'roboticArm', -24, -11, 0);
    sim.rebuildTopology();
    run(sim, 1);
    expect(genEmpty.status).toBe('noFuel');
    expect(arm.status).toBe('noPower');
    // Back the dead end up completely.
    for (let k = 0; k < 20; k++) { for (const b of dead) feed(sim, b, 0, { type: 'hay', amount: 10 }); run(sim, 0.2); }
    for (const b of dead) expect(b.contents().hay).toBeGreaterThan(0);
    // Needle packet -> alarm (save right in the middle of it).
    sim.hay.needles[0].status = 'inTransit';
    expect(feed(sim, feedBelt, 0, { type: 'hay', amount: 10, needleId: 0 })).toBe(1);
    let guard = 0;
    while (scanner.status !== 'needleAlarm' && guard++ < 400) sim.tick(DT);
    expect(scanner.status).toBe('needleAlarm');
    run(sim, 1);
    const alarmLeft = (scanner.saveState() as { alarm: number }).alarm;
    expect(alarmLeft).toBeGreaterThan(0);
    const itemsBefore = sim.logistics.itemCount();
    const deadBefore = dead.map((b) => b.contents().hay);

    const s2 = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    const sc2 = s2.buildings.get(scanner.id)!;
    const genE2 = s2.buildings.get(genEmpty.id)!;
    const arm2 = s2.buildings.get(arm.id)!;
    expect(s2.logistics.itemCount()).toBe(itemsBefore);
    expect(dead.map((b) => s2.buildings.get(b.id)!.contents().hay)).toEqual(deadBefore);
    expect((sc2.saveState() as { alarm: number }).alarm).toBeCloseTo(alarmLeft, 9);
    expect(s2.progress.needlesFound).toEqual([0]);
    s2.tick(DT);
    expect(sc2.status).toBe('needleAlarm');
    expect(genE2.status).toBe('noFuel');
    expect(arm2.status).toBe('noPower');
    expect(arm2.info(s2).statusText).toMatch(/feed them hay|No power/);
    // Recover: feed the empty generator by hand, clear the jam, the alarm runs out and scanning resumes.
    parkPlayer(s2);
    refuel(s2, genE2, 100);
    for (const b of dead) expect(s2.remove(b.id)).toBe(true);
    const scanned0 = s2.progress.stats.hayScanned;
    run(s2, BALANCE.tickDt * 10 + alarmLeft + 3, () => { feed(s2, s2.buildings.get(feedBelt.id)!, 0, { type: 'hay', amount: 10 }); });
    expect(arm2.status).not.toBe('noPower');
    expect(sc2.status).not.toBe('needleAlarm');
    expect(s2.progress.stats.hayScanned).toBeGreaterThan(scanned0);
    expectNeedleInvariant(s2, 'after awkward load');
  });

  it('a starved, jammed bot factory saves and loads with every item, and the player can still make money', () => {
    const bot = new Bot({ seed: 31337, maxMinutes: 25, humanFactor: 1.15, verbose: false });
    bot.run();
    const sim = bot.sim;
    for (const b of sim.buildings.values()) if (b.type === 'hayGenerator') b.loadState({ firebox: { hay: 0 }, load: 0 });
    run(sim, 30);
    const s2 = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    expect(s2.logistics.itemCount()).toBe(sim.logistics.itemCount());
    for (const b of sim.buildings.values()) expect(s2.buildings.get(b.id)!.contents().toJSON(), `${b.type}#${b.id}`).toEqual(b.contents().toJSON());
    const m0 = s2.progress.money;
    handTrip(s2);
    expect(s2.progress.money).toBeGreaterThan(m0);
    expectNeedleInvariant(s2, 'bot save');
  }, 120_000);
});
