import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import { MILESTONES } from '../src/config/milestones';
import { NEEDLE_BUFFS } from '../src/config/needles';
import { MAX_ACTIVE_ORDERS, ORDERS, ORDER_BY_ID } from '../src/config/orders';
import { BASE_STATS } from '../src/config/stats';
import { TECH_BY_ID, TECH_NODES } from '../src/config/techTree';
import { TOOLS, WHEELBARROW } from '../src/config/tools';
import { EventBus, type GameEvents } from '../src/core/events';
import type { Building } from '../src/sim/building';
import type { SimContext } from '../src/sim/interfaces';
import { Inventory } from '../src/sim/inventory';
import { Progression } from '../src/sim/progression';
import type { BuildingType, MachineStatus } from '../src/sim/types';

// ---------------------------------------------------------------------------------------------
// Small fakes (other modules are developed in parallel)
// ---------------------------------------------------------------------------------------------

interface FakeWorld { supply: number; pile: number; buildings: Map<number, Building> }

function fakeCtx(p: Progression, events: EventBus, world: FakeWorld): SimContext {
  return {
    time: 0,
    events,
    hay: { progress: () => world.pile },
    power: { get totalSupply() { return world.supply; } },
    buildings: world.buildings,
    progress: p,
    stat: (k: string) => p.stat(k),
  } as unknown as SimContext;
}

let nextFakeId = 1;
function fakeBuilding(type: BuildingType, o: { network?: number; satisfaction?: number; status?: MachineStatus; stored?: number } = {}): Building {
  const inv = new Inventory();
  inv.add('hay', o.stored ?? 0);
  return {
    id: nextFakeId++, type, def: BUILDABLES[type],
    network: o.network ?? -1, powerSatisfaction: o.satisfaction ?? 1, status: o.status ?? 'idle',
    contents: () => inv,
  } as unknown as Building;
}

function addBuildings(world: FakeWorld, list: Building[]): void {
  for (const b of list) world.buildings.set(b.id, b);
}

/** Records every event of the given types. */
function recorder(events: EventBus, types: (keyof GameEvents)[]) {
  const log: { type: keyof GameEvents; payload: unknown }[] = [];
  for (const t of types) events.on(t, (payload) => log.push({ type: t, payload }));
  return {
    log,
    of<K extends keyof GameEvents>(t: K): GameEvents[K][] { return log.filter((e) => e.type === t).map((e) => e.payload as GameEvents[K]); },
    clear() { log.length = 0; },
  };
}

function setup() {
  const events = new EventBus();
  const p = new Progression(events);
  const world: FakeWorld = { supply: 0, pile: 0, buildings: new Map() };
  const ctx = fakeCtx(p, events, world);
  return { events, p, world, ctx };
}

/** Unlock nodes (and their requirements, depth first) granting exactly the WP needed. */
function unlockWithWP(p: Progression, id: string, level = 1): void {
  const node = TECH_BY_ID[id];
  for (const r of node.requires) if (!p.isUnlocked(r)) unlockWithWP(p, r);
  while (p.nodeLevel(id) < level) {
    const cost = node.levels[p.nodeLevel(id)].cost;
    p.addWP(cost, 'milestone');
    expect(p.unlock(id)).toBe(true);
  }
}

const TICK = BALANCE.tickDt;
const ORIGIN = { x: 0, y: 0, z: 0 };
const activeIds = (p: Progression) => p.activeOrders().map((o) => o.id);

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------
// Config integrity (Progression relies on these cross references)
// ---------------------------------------------------------------------------------------------

describe('config integrity', () => {
  it('every tech/needle effect targets a known stat and every reference resolves', () => {
    for (const n of TECH_NODES) {
      for (const lv of n.levels) for (const e of lv.effects) expect(BASE_STATS, `${n.id} -> ${e.stat}`).toHaveProperty([e.stat]);
      for (const r of n.requires) expect(TECH_BY_ID[r], `${n.id} requires ${r}`).toBeDefined();
    }
    for (const b of NEEDLE_BUFFS) for (const e of b.effects) expect(BASE_STATS).toHaveProperty([e.stat]);
    for (const o of ORDERS) for (const a of o.after) expect(ORDER_BY_ID[a], `${o.id} after ${a}`).toBeDefined();
    for (const t of Object.values(TOOLS)) if (t.requiresNode) expect(TECH_BY_ID[t.requiresNode]).toBeDefined();
    expect(TECH_BY_ID[WHEELBARROW.requiresNode]).toBeDefined();
    for (const b of Object.values(BUILDABLES)) if (b.requiresNode) expect(TECH_BY_ID[b.requiresNode], b.id).toBeDefined();
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
  });
});

// ---------------------------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------------------------

describe('initial state', () => {
  it('starts empty with hands owned and the first order active', () => {
    const { p } = setup();
    expect(p.money).toBe(0);
    expect(p.wp).toBe(0);
    expect([...p.ownedTools]).toEqual(['hands']);
    expect(p.hasWheelbarrow).toBe(false);
    for (const [k, v] of Object.entries(p.stats)) {
      if (k === 'firstSaleAt' || k === 'completedAt') expect(v).toBe(-1);
      else expect(v, k).toBe(0);
    }
    expect(p.orders.map((o) => o.id)).toEqual(ORDERS.map((o) => o.id));
    expect(activeIds(p)).toEqual(['o_first']);
  });
});

// ---------------------------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------------------------

describe('stat folding', () => {
  it('returns base values', () => {
    const { p } = setup();
    for (const [k, v] of Object.entries(BASE_STATS)) expect(p.stat(k), k).toBe(v);
  });

  it('applies tech adds per level and needle buffs after tech effects', () => {
    const { p } = setup();
    expect(p.stat('player.carry')).toBe(20);
    unlockWithWP(p, 'p_carry', 1);
    expect(p.stat('player.carry')).toBe(35);
    unlockWithWP(p, 'p_carry', 2);
    expect(p.stat('player.carry')).toBe(65);
    p.onNeedleFound(3, 'manual', ORIGIN); // first needle found -> buff 0 (+15% carry)
    expect(p.stat('player.carry')).toBeCloseTo(65 * 1.15, 9);
    // The buff multiplies the upgraded value, including added tech capacity.
    unlockWithWP(p, 'p_barrow_cap');
    expect(p.stat('wheelbarrow.capacity')).toBeCloseTo((200 + 200) * 1.15, 9);
  });

  it('multiplies tech muls across levels', () => {
    const { p } = setup();
    unlockWithWP(p, 'l_speed', 2);
    expect(p.stat('belt.speed')).toBeCloseTo(1.667 * 1.5 * (4 / 3), 9);
  });

  it('lets the last tech set win over base/adds/muls, then applies needle buffs', () => {
    const { p } = setup();
    unlockWithWP(p, 'x_arm_grab', 1);
    expect(p.stat('arm.grab')).toBe(30);
    unlockWithWP(p, 'x_arm_grab', 2);
    expect(p.stat('arm.grab')).toBe(40);
    for (let i = 0; i < 6; i++) p.onNeedleFound(i, 'scanner', ORIGIN);
    expect(p.stat('arm.grab')).toBeCloseTo(40 * 1.2, 9); // 6th buff: +20% claw
    unlockWithWP(p, 'p_det_range');
    expect(p.stat('tool.detector.range')).toBe(13);
  });

  it('invalidates the cache on unlock and on needle found', () => {
    const { p } = setup();
    expect(p.stat('tool.hands.dig')).toBe(2);
    unlockWithWP(p, 'p_grab');
    expect(p.stat('tool.hands.dig')).toBe(4);
    expect(p.stat('belt.speed')).toBe(1.667);
    p.onNeedleFound(0, 'manual', ORIGIN);
    p.onNeedleFound(1, 'manual', ORIGIN);
    expect(p.stat('belt.speed')).toBeCloseTo(1.667 * 1.15, 9);
  });

  it('reports an unknown stat once and returns 0', () => {
    const { p } = setup();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(p.stat('nope.missing')).toBe(0);
    expect(p.stat('nope.missing')).toBe(0);
    unlockWithWP(p, 'p_grab'); // cache cleared: still reported only once
    expect(p.stat('nope.missing')).toBe(0);
    expect(err).toHaveBeenCalledTimes(1);
    expect(p.stat('toString')).toBe(0); // prototype keys are not stats
    expect(err).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Work Tree
// ---------------------------------------------------------------------------------------------

describe('unlock rules', () => {
  it('checks requirements, WP and max level with player-facing reasons', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['node:unlocked', 'wp:changed']);
    const hook = vi.fn();
    p.onUnlocked = hook;

    expect(p.canUnlock('does_not_exist').ok).toBe(false);
    expect(p.canUnlock('p_shovel')).toEqual({ ok: false, reason: 'Requires Bigger Grab', cost: 1 });
    expect(p.canUnlock('p_grab')).toEqual({ ok: false, reason: 'Need 1 more WP', cost: 1 });
    expect(p.unlock('p_grab')).toBe(false);

    p.addWP(1, 'milestone');
    rec.clear();
    expect(p.canUnlock('p_grab')).toEqual({ ok: true, cost: 1 });
    expect(p.unlock('p_grab')).toBe(true);
    expect(p.wp).toBe(0);
    expect(p.nodeLevel('p_grab')).toBe(1);
    expect(p.isUnlocked('p_grab')).toBe(true);
    expect(rec.of('wp:changed')).toEqual([{ wp: 0, delta: -1 }]);
    expect(rec.of('node:unlocked')).toEqual([{ id: 'p_grab', level: 1 }]);
    expect(hook).toHaveBeenCalledWith('p_grab');
    expect(p.canUnlock('p_grab')).toEqual({ ok: false, reason: 'Maxed' });

    p.addWP(1, 'milestone');
    expect(p.canUnlock('p_shovel').ok).toBe(true);
    expect(p.canUnlock('p_wheelbarrow')).toEqual({ ok: false, reason: 'Requires Bucket Plans', cost: 2 });
  });

  it('unlocks multi-level nodes one level at a time with per-level cost', () => {
    const { p } = setup();
    p.addWP(1, 'milestone');
    expect(p.unlock('p_carry')).toBe(true);
    expect(p.canUnlock('p_carry')).toEqual({ ok: false, reason: 'Need 2 more WP', cost: 2 });
    p.addWP(5, 'milestone');
    expect(p.unlock('p_carry')).toBe(true);
    expect(p.nodeLevel('p_carry')).toBe(2);
    expect(p.wp).toBe(3);
    expect(p.unlock('p_carry')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------------------------

describe('shop', () => {
  it('plan unlock makes a building purchasable but does not grant or charge anything', () => {
    const { p } = setup();
    expect(p.buildingUnlocked('sellStation')).toBe(true);
    expect(p.buildingUnlocked('hopper')).toBe(false);
    p.money = 1000;
    unlockWithWP(p, 'x_hopper');
    expect(p.buildingUnlocked('hopper')).toBe(true);
    expect(p.money).toBe(1000);
    const { cost, costGrowth } = BUILDABLES.hopper;
    expect(p.buildingCost('hopper', 0)).toBe(cost);
    expect(p.buildingCost('hopper', 1)).toBe(Math.round(cost * costGrowth));
    expect(p.buildingCost('hopper', 3)).toBe(Math.round(cost * costGrowth ** 3));
    expect(p.buildingCost('conveyor', 50)).toBe(12);
  });

  it('buys tools only when the plan is unlocked, not owned and affordable', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['tool:bought', 'money:changed']);
    expect(p.canBuyTool('hands')).toEqual({ ok: false, reason: 'Already owned', cost: 0 });
    expect(p.canBuyTool('shovel')).toEqual({ ok: false, reason: 'Unlock Shovel Plans in the Work Tree', cost: 40 });
    unlockWithWP(p, 'p_shovel');
    expect(p.canBuyTool('shovel')).toEqual({ ok: false, reason: 'Need $40 more', cost: 40 });
    expect(p.buyTool('shovel')).toBe(false);
    p.addMoney(50, 'sale');
    rec.clear();
    expect(p.buyTool('shovel')).toBe(true);
    expect(p.money).toBe(10);
    expect(p.ownedTools.has('shovel')).toBe(true);
    expect(rec.of('tool:bought')).toEqual([{ tool: 'shovel' }]);
    expect(rec.of('money:changed')).toEqual([{ money: 10, delta: -40 }]);
    expect(p.buyTool('shovel')).toBe(false);
  });

  it('buys the wheelbarrow', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['tool:bought']);
    unlockWithWP(p, 'p_wheelbarrow');
    p.addMoney(WHEELBARROW.cost, 'sale');
    expect(p.buyTool('wheelbarrow')).toBe(true);
    expect(p.hasWheelbarrow).toBe(true);
    expect(p.money).toBe(0);
    expect(rec.of('tool:bought')).toEqual([{ tool: 'wheelbarrow' }]);
    expect(p.canBuyTool('wheelbarrow').reason).toBe('Already owned');
  });
});

// ---------------------------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------------------------

describe('economy', () => {
  it('never lets money go negative', () => {
    const { p } = setup();
    p.addMoney(10, 'sale');
    expect(p.spendMoney(11)).toBe(false);
    expect(p.money).toBe(10);
    expect(p.spendMoney(-5)).toBe(false);
    expect(p.spendMoney(Number.NaN)).toBe(false);
    expect(p.spendMoney(10)).toBe(true);
    expect(p.money).toBe(0);
    expect(p.spendMoney(0)).toBe(true);
    p.addMoney(-50, 'sale');
    expect(p.money).toBe(0);
  });

  it('tracks money earned except refunds and WP earned', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['money:changed', 'wp:changed']);
    p.addMoney(100, 'sale');
    p.addMoney(30, 'refund');
    p.addWP(3, 'order');
    expect(p.money).toBe(130);
    expect(p.stats.moneyEarned).toBe(100);
    expect(p.stats.wpEarned).toBe(3);
    expect(rec.of('money:changed')).toEqual([{ money: 100, delta: 100 }, { money: 130, delta: 30 }]);
    expect(rec.of('wp:changed')).toEqual([{ wp: 3, delta: 3 }]);
  });

  it('records sales with stat-driven values and run stats', () => {
    const { p, events, ctx } = setup();
    const rec = recorder(events, ['sale']);
    for (let i = 0; i < 10; i++) p.tick(TICK, ctx);
    p.stats.playTime = 12.5;
    const pos = { x: 1, y: 2, z: 3 };
    expect(p.recordSale('hay', 10, false, pos)).toBe(10);
    expect(p.stats.firstSaleAt).toBe(12.5);
    expect(p.stats.hayViaBelt).toBe(0);

    unlockWithWP(p, 'e_hay_value');
    expect(p.recordSale('hay', 10, true, pos)).toBeCloseTo(12.5, 9);
    expect(p.recordSale('bale', 2, true, pos)).toBe(120);
    expect(p.recordSale('wrapped', 1, false, pos)).toBe(110);
    expect(p.stats.haySold).toBe(20);
    expect(p.stats.baleSold).toBe(2);
    expect(p.stats.wrappedSold).toBe(1);
    expect(p.stats.hayViaBelt).toBe(10 + 2 * BALANCE.hayEquivalent.bale);
    expect(p.stats.firstSaleAt).toBe(12.5);
    expect(p.money).toBeCloseTo(10 + 12.5 + 120 + 110, 9);

    for (let i = 0; i < 5; i++) p.onNeedleFound(i, 'manual', ORIGIN); // 5th buff: +20% sale value
    expect(p.recordSale('bale', 1, true, pos)).toBeCloseTo(60 * 1.2, 9);
    expect(p.recordSale('hay', 0, true, pos)).toBe(0);

    const sales = rec.of('sale');
    expect(sales[0]).toEqual({ item: 'hay', amount: 10, value: 10, pos, viaBelt: false });
    expect(sales[0].pos).not.toBe(pos);
    expect(sales).toHaveLength(5);
  });

  it('measures the stable delivery rate over the sliding window and tracks the peak', () => {
    const { p, ctx } = setup();
    const perTick = 40 * TICK; // 40 hay/s
    const ticksPerWindow = Math.round(BALANCE.stableWindow / TICK);
    for (let i = 0; i < ticksPerWindow / 2; i++) { p.recordSale('hay', perTick, false, ORIGIN); p.tick(TICK, ctx); }
    expect(p.stableRate()).toBeCloseTo(20, 0); // half a window of 40 hay/s
    for (let i = 0; i < ticksPerWindow / 2; i++) { p.recordSale('hay', perTick, true, ORIGIN); p.tick(TICK, ctx); }
    expect(p.stableRate()).toBeGreaterThan(39.5);
    expect(p.stableRate()).toBeLessThan(40.5);
    for (let i = 0; i < ticksPerWindow; i++) { p.recordSale('bale', 1, true, ORIGIN); p.tick(TICK, ctx); }
    // 1 bale (40 hay-eq) per tick = 800 hay-eq/s.
    expect(p.stableRate()).toBeGreaterThan(790);
    expect(p.stats.peakThroughput).toBeGreaterThan(790);
    for (let i = 0; i < ticksPerWindow + 30; i++) p.tick(TICK, ctx);
    expect(p.stableRate()).toBeCloseTo(0, 6);
    expect(p.stats.peakThroughput).toBeGreaterThan(790);
  });

  it('forgets the window after a long gap', () => {
    const { p, ctx } = setup();
    p.recordSale('hay', 600, false, ORIGIN);
    p.tick(TICK, ctx);
    expect(p.stableRate()).toBeCloseTo(600 / BALANCE.stableWindow, 6);
    p.tick(BALANCE.stableWindow * 3, ctx);
    expect(p.stableRate()).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Needles
// ---------------------------------------------------------------------------------------------

describe('needle buffs', () => {
  it('grants buffs in discovery order with WP + money and an event', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['needle:found']);
    expect(p.onNeedleFound(4, 'detector', { x: 1, y: 2, z: 3 })).toBe(0);
    expect(p.onNeedleFound(1, 'scanner', ORIGIN)).toBe(1);
    expect(p.needlesFound).toEqual([4, 1]);
    expect(p.wp).toBe(2 * BALANCE.needleWP);
    expect(p.money).toBe(NEEDLE_BUFFS[0].money + NEEDLE_BUFFS[1].money);
    const found = rec.of('needle:found');
    expect(found[0]).toEqual({
      id: 4, index: 0, pos: { x: 1, y: 2, z: 3 }, by: 'detector',
      buffName: NEEDLE_BUFFS[0].name, buffDesc: NEEDLE_BUFFS[0].desc, wp: BALANCE.needleWP, money: NEEDLE_BUFFS[0].money,
    });
    expect(found[1].buffName).toBe(NEEDLE_BUFFS[1].name);
    // Needle 4 was found first: the carry buff applies, the second buff (belt speed) as well.
    expect(p.stat('player.carry')).toBeCloseTo(20 * 1.15, 9);
    expect(p.stat('belt.speed')).toBeCloseTo(1.667 * 1.15, 9);
    expect(p.stat('global.machineSpeed')).toBe(1);
  });

  it('ignores a needle that was already found', () => {
    const { p, events } = setup();
    const rec = recorder(events, ['needle:found']);
    p.onNeedleFound(2, 'manual', ORIGIN);
    expect(p.onNeedleFound(2, 'manual', ORIGIN)).toBe(0);
    expect(p.needlesFound).toEqual([2]);
    expect(p.wp).toBe(BALANCE.needleWP);
    expect(rec.of('needle:found')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------

/** Push an active cumulative order's counter by `amount`. */
function bump(p: Progression, orderId: string, amount: number): void {
  const def = ORDER_BY_ID[orderId];
  const s = p.stats;
  switch (def.metric) {
    case 'sell': if (def.item === 'bale') s.baleSold += amount; else if (def.item === 'wrapped') s.wrappedSold += amount; else s.haySold += amount; break;
    case 'sellViaBelt': s.hayViaBelt += amount; break;
    case 'extractManual': s.hayExtractedManual += amount; break;
    case 'extractMachine': s.hayExtractedMachine += amount; break;
    case 'extractArm': s.hayExtractedArm += amount; break;
    case 'burn': s.hayBurned += amount; break;
    case 'scan': s.hayScanned += amount; break;
    default: throw new Error(`${orderId} is not cumulative`);
  }
}
const finish = (p: Progression, id: string) => bump(p, id, ORDER_BY_ID[id].target);

describe('orders', () => {
  it('completes the first order, pays rewards and activates the next ones in the same tick', () => {
    const { p, events, ctx } = setup();
    const rec = recorder(events, ['order:completed', 'order:available', 'order:progress']);
    p.recordSale('hay', 70, false, ORIGIN);
    const moneyBefore = p.money;
    p.tick(TICK, ctx);
    expect(rec.of('order:completed')).toEqual([{ id: 'o_first', money: 30, wp: 1 }]);
    expect(p.money).toBe(moneyBefore + 30);
    expect(p.wp).toBe(1 + 1); // order + "First Sale!" milestone
    expect(p.orders[0]).toMatchObject({ id: 'o_first', completed: true, progress: 60 });
    expect(rec.of('order:progress').at(-1)).toEqual({ id: 'o_first', progress: 60, target: 60 });
    expect(rec.of('order:available')).toEqual([{ id: 'o_cleanup' }, { id: 'o_dig' }]);
    expect(activeIds(p)).toEqual(['o_cleanup', 'o_dig']);
    // Cumulative base = counter at activation: the 10 extra hay do not count for the next order.
    const cleanup = p.activeOrders()[0];
    expect(cleanup.base).toBe(70);
    p.recordSale('hay', 25, false, ORIGIN);
    p.tick(TICK, ctx);
    expect(cleanup.progress).toBe(25);
  });

  it('scales order money by econ.orderRewardMul', () => {
    const { p, events, ctx } = setup();
    const rec = recorder(events, ['order:completed']);
    unlockWithWP(p, 'e_order_reward');
    p.recordSale('hay', 60, false, ORIGIN);
    p.tick(TICK, ctx);
    expect(rec.of('order:completed')).toEqual([{ id: 'o_first', money: 45, wp: 1 }]);
    expect(p.orderReward(ORDER_BY_ID.o_feed)).toEqual({ money: 750, wp: 3 });
  });

  it('completes several orders in one tick and activates their successors', () => {
    const { p, events, ctx } = setup();
    finish(p, 'o_first');
    p.tick(TICK, ctx);
    const rec = recorder(events, ['order:completed', 'order:available']);
    finish(p, 'o_cleanup');
    finish(p, 'o_dig');
    p.tick(TICK, ctx);
    expect(rec.of('order:completed').map((e) => e.id)).toEqual(['o_cleanup', 'o_dig']);
    expect(rec.of('order:available').map((e) => e.id)).toEqual(['o_feed', 'o_shiny']);
    expect(activeIds(p)).toEqual(['o_feed', 'o_shiny']);
    expect(rec.of('order:completed')).toEqual([{ id: 'o_cleanup', money: 120, wp: 2 }, { id: 'o_dig', money: 200, wp: 2 }]);
  });

  it('evaluates instant metrics from the context', () => {
    const { p, events, ctx, world } = setup();
    const rec = recorder(events, ['order:completed']);
    for (const id of ['o_first', 'o_cleanup', 'o_dig']) { finish(p, id); p.tick(TICK, ctx); }
    expect(activeIds(p)).toContain('o_shiny');
    p.tick(TICK, ctx);
    expect(p.orders.find((o) => o.id === 'o_shiny')?.completed).toBe(false);
    p.onNeedleFound(0, 'detector', ORIGIN);
    p.tick(TICK, ctx);
    expect(rec.of('order:completed').map((e) => e.id)).toContain('o_shiny');

    // Drive to the power grid order (poweredMachines >= 3).
    for (const id of ['o_feed', 'o_stoke', 'o_iron']) { finish(p, id); p.tick(TICK, ctx); }
    expect(activeIds(p)).toContain('o_powered');
    addBuildings(world, [
      fakeBuilding('pistonRake', { network: 0, status: 'running' }),
      fakeBuilding('roboticArm', { network: 0, status: 'processing' }),
      fakeBuilding('roboticArm', { network: 0, status: 'noHay' }),        // not working
      fakeBuilding('roboticArm', { network: -1, status: 'running' }),     // not connected
      fakeBuilding('scannerMk1', { network: 1, satisfaction: 0, status: 'lowPower' }), // no supply
      fakeBuilding('hopper', { status: 'running' }),                      // unpowered type
    ]);
    p.tick(TICK, ctx);
    const powered = p.orders.find((o) => o.id === 'o_powered')!;
    expect(powered.completed).toBe(false);
    expect(powered.progress).toBe(2);
    addBuildings(world, [fakeBuilding('compressor', { network: 1, satisfaction: 0.5, status: 'lowPower' })]);
    p.tick(TICK, ctx);
    expect(powered.completed).toBe(true);
  });

  it('keeps at most MAX_ACTIVE_ORDERS visible and never displaces a visible order', () => {
    const { p, events, ctx, world } = setup();
    for (const id of ['o_first', 'o_cleanup', 'o_dig', 'o_feed', 'o_stoke']) { finish(p, id); p.tick(TICK, ctx); }
    expect(activeIds(p)).toEqual(['o_shiny', 'o_truck', 'o_iron']);
    finish(p, 'o_iron');
    p.tick(TICK, ctx);
    // o_handsoff and o_powered both became available but only one slot was free.
    expect(activeIds(p)).toEqual(['o_shiny', 'o_truck', 'o_handsoff']);
    expect(p.activeOrders().length).toBeLessThanOrEqual(MAX_ACTIVE_ORDERS);
    finish(p, 'o_truck');
    p.tick(TICK, ctx);
    expect(activeIds(p)).toEqual(['o_shiny', 'o_handsoff', 'o_powered']);

    addBuildings(world, [0, 1, 2].map(() => fakeBuilding('roboticArm', { network: 0, status: 'running' })));
    p.tick(TICK, ctx); // o_powered completes -> o_quality appears
    expect(activeIds(p)).toEqual(['o_shiny', 'o_handsoff', 'o_quality']);

    const rec = recorder(events, ['order:available']);
    finish(p, 'o_handsoff'); // unlocks o_wholesale and o_robots (both listed before o_quality)
    p.tick(TICK, ctx);
    expect(activeIds(p)).toEqual(['o_shiny', 'o_wholesale', 'o_quality']);
    expect(rec.of('order:available')).toEqual([{ id: 'o_wholesale' }]);
  });

  it('throttles progress events to about 4 per second per order', () => {
    const { p, events, ctx } = setup();
    const rec = recorder(events, ['order:progress']);
    for (let i = 0; i < 20; i++) { p.recordSale('hay', 1, false, ORIGIN); p.tick(TICK, ctx); } // 1 s
    const n = rec.of('order:progress').length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    // Once progress stops changing, the latest value is still delivered.
    for (let i = 0; i < 10; i++) p.tick(TICK, ctx);
    expect(rec.of('order:progress').at(-1)).toEqual({ id: 'o_first', progress: 20, target: 60 });
    const settled = rec.of('order:progress').length;
    for (let i = 0; i < 20; i++) p.tick(TICK, ctx);
    expect(rec.of('order:progress')).toHaveLength(settled);
  });

  it('completes stable-rate, silo, power and pile orders from their instant metrics', () => {
    const { p, ctx, world } = setup();
    const order = (id: string) => p.orders.find((o) => o.id === id)!;
    // Reach o_steady (stableRate 40) through its prerequisites.
    for (const id of ['o_first', 'o_cleanup', 'o_dig', 'o_feed', 'o_stoke', 'o_iron', 'o_truck', 'o_handsoff']) { finish(p, id); p.tick(TICK, ctx); }
    p.onNeedleFound(0, 'manual', ORIGIN);
    p.tick(TICK, ctx);
    addBuildings(world, [0, 1, 2].map(() => fakeBuilding('roboticArm', { network: 0, status: 'running' })));
    p.tick(TICK, ctx);
    finish(p, 'o_robots');
    p.tick(TICK, ctx);
    expect(activeIds(p)).toContain('o_steady');
    const ticks = Math.round(BALANCE.stableWindow / TICK);
    // Delivering 9/8 of the target reaches the target window average after 8/9 of the window.
    const rate = ORDER_BY_ID.o_steady.target * 9 / 8;
    for (let i = 0; i < Math.floor(ticks * 0.85); i++) { p.recordSale('hay', rate * TICK, true, ORIGIN); p.tick(TICK, ctx); }
    expect(order('o_steady').completed).toBe(false);
    for (let i = 0; i < Math.ceil(ticks * 0.1); i++) { p.recordSale('hay', rate * TICK, true, ORIGIN); p.tick(TICK, ctx); }
    expect(order('o_steady').completed).toBe(true);

    // Silo stock and power supply.
    for (const id of ['o_wholesale', 'o_bales']) { finish(p, id); p.tick(TICK, ctx); }
    expect(activeIds(p)).toContain('o_stockpile');
    // Stock is summed over every silo: 75 % + 20 % of the target is not enough, +5 % more completes it.
    const stockTarget = ORDER_BY_ID.o_stockpile.target;
    addBuildings(world, [fakeBuilding('silo', { stored: stockTarget * 0.75 }), fakeBuilding('silo', { stored: stockTarget * 0.2 })]);
    p.tick(TICK, ctx);
    expect(order('o_stockpile').progress).toBeCloseTo(stockTarget * 0.95, 6);
    addBuildings(world, [fakeBuilding('silo', { stored: stockTarget * 0.05 })]);
    p.tick(TICK, ctx);
    expect(order('o_stockpile').completed).toBe(true);

    for (const id of ['o_quality', 'o_bigscan']) { finish(p, id); p.tick(TICK, ctx); }
    expect(activeIds(p)).toContain('o_industrial');
    world.supply = ORDER_BY_ID.o_industrial.target - 1;
    p.tick(TICK, ctx);
    expect(order('o_industrial').completed).toBe(false);
    world.supply = ORDER_BY_ID.o_industrial.target;
    p.tick(TICK, ctx);
    expect(order('o_industrial').completed).toBe(true);

    for (let i = 0; i < ticks + 20; i++) { p.recordSale('hay', 160 * TICK, true, ORIGIN); p.tick(TICK, ctx); }
    expect(order('o_throttle').completed).toBe(true);
    expect(activeIds(p)).toContain('o_sweep');
    world.pile = 0.84;
    p.tick(TICK, ctx);
    expect(order('o_sweep').completed).toBe(false);
    world.pile = 0.85;
    p.tick(TICK, ctx);
    expect(order('o_sweep').completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------------------------

describe('milestones', () => {
  it('rewards each milestone once when its metric reaches the target', () => {
    const { p, events, ctx, world } = setup();
    const rec = recorder(events, ['milestone']);
    p.tick(TICK, ctx);
    expect(rec.log).toHaveLength(0);

    p.recordSale('hay', 5, false, ORIGIN);
    p.tick(TICK, ctx);
    expect(rec.of('milestone')).toEqual([{ id: 'm_first_sale', name: 'First Sale!', wp: 1, money: 0 }]);
    expect(p.milestonesDone.has('m_first_sale')).toBe(true);
    p.recordSale('hay', 5, false, ORIGIN);
    p.tick(TICK, ctx);
    expect(rec.of('milestone')).toHaveLength(1);

    world.pile = 0.021;
    p.tick(TICK, ctx);
    expect(rec.of('milestone').map((m) => m.id)).toContain('m_pile_2');
  });

  it('counts machines (excluding logistics, market, platforms, stairs, poles) and conveyors', () => {
    const { p, events, ctx, world } = setup();
    const rec = recorder(events, ['milestone']);
    addBuildings(world, [
      fakeBuilding('sellStation'), fakeBuilding('platform'), fakeBuilding('stairs'), fakeBuilding('powerPole'),
      fakeBuilding('splitter'), fakeBuilding('merger'), fakeBuilding('beltLift'),
      ...Array.from({ length: 24 }, () => fakeBuilding('conveyor')),
    ]);
    p.tick(TICK, ctx);
    expect(rec.log).toHaveLength(0);
    addBuildings(world, [fakeBuilding('hopper'), fakeBuilding('conveyor')]);
    p.tick(TICK, ctx);
    expect(rec.of('milestone').map((m) => m.id).sort()).toEqual(['m_belts_25', 'm_machines_1']);
    addBuildings(world, Array.from({ length: 6 }, () => fakeBuilding('hayGenerator')));
    p.tick(TICK, ctx);
    expect(rec.of('milestone').map((m) => m.id)).not.toContain('m_machines_8');
    addBuildings(world, [fakeBuilding('silo')]);
    p.tick(TICK, ctx);
    expect(rec.of('milestone').map((m) => m.id)).toContain('m_machines_8');
  });

  it('awards WP from milestones', () => {
    const { p, ctx } = setup();
    p.recordSale('hay', 200, false, ORIGIN);
    p.tick(TICK, ctx);
    // First sale (1) + Hay Hauler (1) + o_first order (1).
    expect(p.wp).toBe(3);
    expect(p.stats.wpEarned).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Flags & save
// ---------------------------------------------------------------------------------------------

describe('flags', () => {
  it('sets one-shot flags', () => {
    const { p } = setup();
    expect(p.hasFlag('first_sale')).toBe(false);
    expect(p.setFlag('first_sale')).toBe(true);
    expect(p.setFlag('first_sale')).toBe(false);
    expect(p.hasFlag('first_sale')).toBe(true);
  });
});

describe('serialization', () => {
  function richState() {
    const s = setup();
    const { p, ctx, world } = s;
    unlockWithWP(p, 'p_carry', 2);
    unlockWithWP(p, 'p_wheelbarrow');
    unlockWithWP(p, 'x_hopper_dual');
    p.addMoney(5000, 'sale');
    expect(p.buyTool('bucket')).toBe(true);
    expect(p.buyTool('wheelbarrow')).toBe(true);
    for (const id of ['o_first', 'o_cleanup', 'o_dig', 'o_feed', 'o_stoke']) { finish(p, id); p.tick(TICK, ctx); }
    bump(p, 'o_iron', 700);
    p.recordSale('hay', 123.5, true, ORIGIN);
    p.onNeedleFound(5, 'manual', ORIGIN);
    world.pile = 0.03;
    p.tick(TICK, ctx);
    p.setFlag('hint_dig');
    p.stats.playTime = 321;
    p.stats.completedAt = 999;
    return s;
  }

  it('round-trips through JSON', () => {
    const { p } = richState();
    const saved = p.serialize();
    const json = JSON.parse(JSON.stringify(saved));
    const q = new Progression(new EventBus());
    q.deserialize(json);
    expect(q.serialize()).toEqual(saved);
    expect(q.money).toBe(p.money);
    expect(q.wp).toBe(p.wp);
    expect([...q.nodes]).toEqual([...p.nodes]);
    expect(q.stats).toEqual(p.stats);
    expect(q.needlesFound).toEqual([5]);
    expect([...q.ownedTools].sort()).toEqual(['bucket', 'hands']);
    expect(q.hasWheelbarrow).toBe(true);
    expect(activeIds(q)).toEqual(activeIds(p));
    expect([...q.milestonesDone].sort()).toEqual([...p.milestonesDone].sort());
    expect(q.hasFlag('hint_dig')).toBe(true);
    for (const key of ['player.carry', 'hopper.dualOutput', 'wheelbarrow.capacity', 'belt.speed']) expect(q.stat(key)).toBe(p.stat(key));
  });

  it('continues cumulative orders from their saved base', () => {
    const { p, ctx: ctxP } = richState();
    const q = new Progression(new EventBus());
    q.deserialize(JSON.parse(JSON.stringify(p.serialize())));
    const ctxQ = fakeCtx(q, new EventBus(), { supply: 0, pile: 0.03, buildings: new Map() });
    const rest = ORDER_BY_ID.o_iron.target - 700;
    bump(q, 'o_iron', rest);
    q.tick(TICK, ctxQ);
    expect(q.orders.find((o) => o.id === 'o_iron')?.completed).toBe(true);
    bump(p, 'o_iron', rest - 1);
    p.tick(TICK, ctxP);
    expect(p.orders.find((o) => o.id === 'o_iron')?.completed).toBe(false);
  });

  it('sanitises unknown or invalid saved data', () => {
    const { p } = setup();
    const save = p.serialize();
    save.money = -50;
    save.wp = Number.NaN;
    save.nodes = [['p_carry', 99], ['gone_node', 1], ['p_grab', 0]];
    save.ownedTools = ['shovel', 'laser' as never];
    save.orders = [{ id: 'o_removed', base: 1, progress: 1, completed: true }, { id: 'o_first', base: 0, progress: 0, completed: true }];
    save.milestones = ['m_first_sale', 'm_unknown'];
    const q = new Progression(new EventBus());
    q.deserialize(save);
    expect(q.money).toBe(0);
    expect(q.wp).toBe(0);
    expect([...q.nodes]).toEqual([['p_carry', 2]]);
    expect([...q.ownedTools].sort()).toEqual(['hands', 'shovel']);
    expect(q.orders.find((o) => o.id === 'o_first')?.completed).toBe(true);
    // Orders missing an `active` flag are re-activated from the completion state.
    expect(activeIds(q)).toEqual(['o_cleanup', 'o_dig']);
    expect([...q.milestonesDone]).toEqual(['m_first_sale']);
  });
});
