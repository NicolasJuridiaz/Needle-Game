import { HAND_LEVEL_PICKUP } from '../src/config/stamina';
import { describe, expect, it } from 'vitest';
import { BASE_STATS } from '../src/config/stats';
import { WORLD } from '../src/config/world';
import type { GameEvents } from '../src/core/events';
import type { DetectorReading, HayExtraction } from '../src/sim/interfaces';
import { Inventory } from '../src/sim/inventory';
import {
  carryCapacity, detectorReading, pickupNeedle, playerDig, playerVacuum, spawnWheelbarrow, toggleWheelbarrow,
} from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import type { NeedleState, ToolId } from '../src/sim/types';
import { grantTech } from './support/simKit';

// ---------------------------------------------------------------------------------------------
// Fake hay field (HayField is implemented in parallel): a pile with a finite amount of hay,
// optional needles handed out by the next extraction, and a recorder of calls.
// ---------------------------------------------------------------------------------------------

interface ExtractCall { x: number; z: number; radius: number; maxUnits: number }

function setup(opts: { hay?: number } = {}) {
  const sim = new Sim(1, { generate: false });
  const fake = {
    remaining: opts.hay ?? 10_000,
    nextNeedles: [] as number[],
    calls: [] as ExtractCall[],
    detectorCalls: [] as number[][],
    marked: [] as number[],
    surface: 0.4,
  };
  Object.assign(sim.hay, {
    extractRadius(x: number, z: number, radius: number, maxUnits: number): HayExtraction {
      fake.calls.push({ x, z, radius, maxUnits });
      const units = Math.min(maxUnits, fake.remaining);
      fake.remaining -= units;
      const needles = fake.nextNeedles.splice(0);
      return { units, needles, pos: { x, y: 1.2, z } };
    },
    markFound(id: number) { fake.marked.push(id); },
    heightAt: () => fake.surface,
    detectorReading(x: number, z: number, range: number, depth: number, noise: number): DetectorReading {
      fake.detectorCalls.push([x, z, range, depth, noise]);
      return { strength: 0.5, distance: 2, dirX: 1, dirZ: 0, tooDeep: false, needleId: 3 };
    },
  });
  const needle = (id: number, status: NeedleState['status'], pos = { x: 0, y: 0, z: 0 }): NeedleState => {
    const n: NeedleState = { id, band: [0, 1], pos, status, returns: 0 };
    sim.hay.needles.push(n);
    return n;
  };
  const events: { type: keyof GameEvents; payload: unknown }[] = [];
  for (const t of ['player:dig', 'player:full', 'needle:found', 'hay:extracted'] as (keyof GameEvents)[]) {
    sim.events.on(t, (payload) => events.push({ type: t, payload }));
  }
  const of = <K extends keyof GameEvents>(t: K) => events.filter((e) => e.type === t).map((e) => e.payload as GameEvents[K]);
  const own = (...tools: ToolId[]) => { for (const t of tools) sim.progress.ownedTools.add(t); };
  return { sim, fake, needle, of, own };
}

const at = (sim: Sim, x: number, z: number, yaw = 0) => { sim.player.pos = { x, y: 0, z }; sim.player.yaw = yaw; };
const parkBarrow = (sim: Sim, x: number, z: number, held = false) => {
  sim.player.wheelbarrow = { pos: { x, y: 0, z }, yaw: 0, held, inv: new Inventory() };
  return sim.player.wheelbarrow;
};

// ---------------------------------------------------------------------------------------------

/** Hands grab at Lv.1 (config/stamina.ts HAND_LEVEL_PICKUP). */
const G = HAND_LEVEL_PICKUP[0];

describe('carryCapacity', () => {
  it('is the carry stat plus the bucket bonus once the bucket is owned', () => {
    const { sim, own } = setup();
    expect(carryCapacity(sim)).toBe(BASE_STATS['player.carry']);
    own('bucket');
    expect(carryCapacity(sim)).toBe(BASE_STATS['player.carry'] + BASE_STATS['tool.bucket.carryBonus']);
    sim.progress.addWP(1, 'milestone');
    sim.progress.unlock('p_carry');
    expect(carryCapacity(sim)).toBe(BASE_STATS['player.carry'] + 15 + BASE_STATS['tool.bucket.carryBonus']);
  });
});

describe('playerDig', () => {
  it('extracts the tool amount at its radius, credits it and starts the cooldown', () => {
    const { sim, fake, of } = setup();
    const r = playerDig(sim, 'hands', 3, 1, 4);
    expect(r).toEqual({ amount: G, full: false, needleFound: -1, toBarrow: 0 });
    expect(fake.calls).toEqual([{ x: 3, z: 4, radius: BASE_STATS['tool.hands.radius'], maxUnits: G }]);
    expect(sim.player.carry.hay).toBe(G);
    expect(sim.player.cooldown).toBe(BASE_STATS['tool.hands.interval']);
    expect(sim.progress.stats.hayExtractedManual).toBe(G);
    expect(of('hay:extracted')).toEqual([{ amount: G, pos: { x: 3, y: 1.2, z: 4 }, source: 'manual' }]);
    expect(of('player:dig')).toEqual([{ tool: 'hands', amount: G, pos: { x: 3, y: 1.2, z: 4 }, full: false }]);
  });

  it('respects the cooldown', () => {
    const { sim, fake } = setup();
    playerDig(sim, 'hands', 0, 0, 0);
    expect(playerDig(sim, 'hands', 0, 0, 0).amount).toBe(0);
    expect(fake.calls).toHaveLength(1);
    sim.player.cooldown = 0;
    expect(playerDig(sim, 'hands', 0, 0, 0).amount).toBe(G);
    expect(fake.calls).toHaveLength(2);
  });

  it('uses the stats of the tool (upgrades included)', () => {
    const { sim, fake, own } = setup();
    own('shovel');
    grantTech(sim.progress, 'p_shovel@2');
    const r = playerDig(sim, 'shovel', 0, 0, 0);
    expect(r.amount).toBeCloseTo(6 * 1.6, 9);
    expect(fake.calls[0].radius).toBeCloseTo(0.5 * 1.4, 9);
    expect(sim.player.cooldown).toBe(BASE_STATS['tool.shovel.interval']);
  });

  it('only digs with owned hand tools', () => {
    const { sim, fake, own } = setup();
    expect(playerDig(sim, 'pitchfork', 0, 0, 0).amount).toBe(0);
    own('vacuum', 'detector');
    expect(playerDig(sim, 'vacuum', 0, 0, 0).amount).toBe(0);
    expect(playerDig(sim, 'detector', 0, 0, 0).amount).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(sim.player.cooldown).toBe(0);
  });

  it('never exceeds the carry capacity and reports full (throttled)', () => {
    const { sim, fake, of } = setup();
    sim.player.carry.add('hay', 19);
    const r = playerDig(sim, 'hands', 0, 0, 0);
    expect(r).toEqual({ amount: 1, full: true, needleFound: -1, toBarrow: 0 });
    expect(fake.calls[0].maxUnits).toBe(1);
    expect(sim.player.carry.weight()).toBe(20);
    expect(of('player:dig')[0].full).toBe(true);

    sim.player.cooldown = 0;
    expect(playerDig(sim, 'hands', 0, 0, 0)).toEqual({ amount: 0, full: true, needleFound: -1, toBarrow: 0 });
    expect(fake.calls).toHaveLength(1); // no extraction when full
    expect(sim.player.cooldown).toBe(0);
    playerDig(sim, 'hands', 0, 0, 0);
    sim.time = 0.5;
    playerDig(sim, 'hands', 0, 0, 0);
    expect(of('player:full')).toHaveLength(1);
    sim.time = 1.2;
    playerDig(sim, 'hands', 0, 0, 0);
    expect(of('player:full')).toHaveLength(2);
  });

  it('counts carried bales by weight', () => {
    const { sim } = setup();
    sim.player.carry.add('bale', 1); // 20 hay-eq = the whole base capacity
    expect(playerDig(sim, 'hands', 0, 0, 0).full).toBe(true);
  });

  it('does nothing on bare floor', () => {
    const { sim, of } = setup({ hay: 0 });
    expect(playerDig(sim, 'hands', 0, 0, 0)).toEqual({ amount: 0, full: false, needleFound: -1, toBarrow: 0 });
    expect(of('player:dig')).toHaveLength(0);
    expect(sim.progress.stats.hayExtractedManual).toBe(0);
  });
});

describe('wheelbarrow overflow', () => {
  it('digs into a parked barrow in range once the carry is full', () => {
    const { sim } = setup();
    at(sim, 0, 0);
    const barrow = parkBarrow(sim, 3, 4); // 5 m away, collect range 6 m
    sim.player.carry.add('hay', 20);
    const r = playerDig(sim, 'hands', 1, 1, 1);
    expect(r).toEqual({ amount: G, full: false, needleFound: -1, toBarrow: G });
    expect(barrow.inv.hay).toBe(G);
    expect(sim.player.carry.hay).toBe(20);
  });

  it('splits a dig between the carry and the barrow', () => {
    const { sim, own } = setup();
    own('shovel');
    const barrow = parkBarrow(sim, sim.player.pos.x + 1, sim.player.pos.z);
    sim.player.carry.add('hay', 19);
    const r = playerDig(sim, 'shovel', 0, 0, 0);
    expect(r).toEqual({ amount: 6, full: false, needleFound: -1, toBarrow: 5 });
    expect(sim.player.carry.hay).toBe(20);
    expect(barrow.inv.hay).toBe(5);
  });

  it('fills the barrow up to its capacity, then reports full', () => {
    const { sim, own } = setup();
    own('pitchfork');
    const barrow = parkBarrow(sim, sim.player.pos.x, sim.player.pos.z + 1);
    sim.player.carry.add('hay', 20);
    barrow.inv.add('hay', BASE_STATS['wheelbarrow.capacity'] - 4);
    const r = playerDig(sim, 'pitchfork', 0, 0, 0);
    expect(r).toEqual({ amount: 4, full: true, needleFound: -1, toBarrow: 4 });
    sim.player.cooldown = 0;
    expect(playerDig(sim, 'pitchfork', 0, 0, 0).full).toBe(true);
    expect(barrow.inv.weight()).toBe(BASE_STATS['wheelbarrow.capacity']);
  });

  it('ignores a held or distant barrow', () => {
    const { sim } = setup();
    at(sim, 0, 0);
    sim.player.carry.add('hay', 20);
    parkBarrow(sim, 1, 0, true);
    expect(playerDig(sim, 'hands', 0, 0, 0).full).toBe(true);
    parkBarrow(sim, 6.1, 0);
    expect(playerDig(sim, 'hands', 0, 0, 0).full).toBe(true);
    expect(sim.player.wheelbarrow?.inv.hay).toBe(0);
  });
});

describe('manual needle find', () => {
  it('finds a needle in the dug hay', () => {
    const { sim, fake, needle, of } = setup();
    const n = needle(2, 'inTransit');
    fake.nextNeedles = [2];
    const r = playerDig(sim, 'hands', 5, 0, 6);
    expect(r.needleFound).toBe(2);
    expect(sim.progress.needlesFound).toEqual([2]);
    expect(n.status).toBe('found');
    expect(n.foundBy).toBe('manual');
    expect(fake.marked).toEqual([2]);
    expect(of('needle:found')[0]).toMatchObject({ id: 2, index: 0, by: 'manual', pos: { x: 5, y: 1.2, z: 6 } });
  });

  it('finds needles vacuumed by the vacuum tool', () => {
    const { sim, fake, needle, own } = setup();
    own('vacuum');
    needle(4, 'inTransit');
    fake.nextNeedles = [4];
    expect(playerVacuum(sim, 0.1, 0, 0, 0).needleFound).toBe(4);
    expect(sim.progress.needlesFound).toEqual([4]);
  });
});

describe('playerVacuum', () => {
  it('sucks rate x dt continuously and credits the vacuum tool', () => {
    const { sim, fake, own, of } = setup();
    expect(playerVacuum(sim, 0.5, 0, 0, 0).amount).toBe(0); // not owned
    own('vacuum');
    const r = playerVacuum(sim, 0.25, 2, 0, 3);
    expect(r.amount).toBe(BASE_STATS['tool.vacuum.rate'] * 0.25);
    expect(fake.calls[0]).toEqual({ x: 2, z: 3, radius: BASE_STATS['tool.vacuum.radius'], maxUnits: 8 });
    expect(sim.player.cooldown).toBe(0);
    expect(of('hay:extracted')[0].source).toBe('vacuumTool');
    expect(of('player:dig')[0].tool).toBe('vacuum');
    expect(sim.progress.stats.hayExtractedManual).toBe(8);
    // Capacity applies: 12 left of 20.
    const r2 = playerVacuum(sim, 1, 2, 0, 3);
    expect(r2).toEqual({ amount: 12, full: true, needleFound: -1, toBarrow: 0 });
    expect(playerVacuum(sim, 0, 2, 0, 3).amount).toBe(0);
  });
});

describe('detectorReading', () => {
  it('queries the hay field at the player position with detector stats', () => {
    const { sim, fake, own } = setup();
    expect(detectorReading(sim)).toEqual({ strength: 0, distance: 0, dirX: 0, dirZ: 0, tooDeep: false, needleId: -1 });
    expect(fake.detectorCalls).toHaveLength(0);
    own('detector');
    at(sim, 4, -2);
    expect(detectorReading(sim).needleId).toBe(3);
    expect(fake.detectorCalls[0]).toEqual([4, -2, BASE_STATS['tool.detector.range'], BASE_STATS['tool.detector.depth'], 1]);
    grantTech(sim.progress, 'p_detector@3');
    detectorReading(sim);
    expect(fake.detectorCalls[1][4]).toBe(0);
  });
});

describe('pickupNeedle', () => {
  it('picks up an exposed needle within interact range', () => {
    const { sim, needle, own, of } = setup();
    at(sim, 0, 0);
    const n = needle(1, 'exposed', { x: 2, y: 1.5, z: 1 });
    expect(pickupNeedle(sim, 1)).toBe(true);
    expect(n.status).toBe('found');
    expect(of('needle:found')[0]).toMatchObject({ id: 1, by: 'manual' });
    own('detector');
    sim.player.equipped = 'detector';
    needle(5, 'exposed', { x: -1, y: 0.2, z: 0 });
    expect(pickupNeedle(sim, 5)).toBe(true);
    expect(of('needle:found')[1]).toMatchObject({ id: 5, by: 'detector', index: 1 });
  });

  it('rejects buried, far away, unknown or already found needles', () => {
    const { sim, needle } = setup();
    at(sim, 0, 0);
    needle(0, 'buried', { x: 1, y: 0, z: 0 });
    needle(1, 'exposed', { x: 3.3, y: 0, z: 0 });
    needle(2, 'exposed', { x: 0, y: 4, z: 0 });
    needle(3, 'found', { x: 0, y: 0, z: 0 });
    for (const id of [0, 1, 2, 3, 9]) expect(pickupNeedle(sim, id)).toBe(false);
    expect(sim.progress.needlesFound).toEqual([]);
  });
});

describe('wheelbarrow placement', () => {
  it('spawns once, 1.5 m in front of the player on the surface', () => {
    const { sim, fake } = setup();
    at(sim, 0, 0, 0);
    spawnWheelbarrow(sim);
    expect(sim.player.wheelbarrow).toBeNull(); // not owned
    sim.progress.hasWheelbarrow = true;
    spawnWheelbarrow(sim);
    const b = sim.player.wheelbarrow!;
    expect(b.pos.x).toBeCloseTo(1.5, 9);
    expect(b.pos.z).toBeCloseTo(0, 9);
    expect(b.pos.y).toBe(fake.surface);
    expect(b.held).toBe(false);
    expect(b.inv.isEmpty()).toBe(true);
    spawnWheelbarrow(sim);
    expect(sim.player.wheelbarrow).toBe(b);
  });

  it('uses the three.js yaw convention (positive yaw turns towards -Z) and stays inside the walls', () => {
    const { sim } = setup();
    sim.progress.hasWheelbarrow = true;
    at(sim, 0, 0, Math.PI / 2);
    spawnWheelbarrow(sim);
    expect(sim.player.wheelbarrow!.pos.x).toBeCloseTo(0, 9);
    expect(sim.player.wheelbarrow!.pos.z).toBeCloseTo(-1.5, 9);
    sim.player.wheelbarrow = null;
    at(sim, WORLD.interior.minX + 0.5, 0, Math.PI); // facing the west wall
    spawnWheelbarrow(sim);
    expect(sim.player.wheelbarrow!.pos.x).toBeGreaterThan(WORLD.interior.minX);
  });

  it('toggles held within grab range and rests on the surface when released', () => {
    const { sim, fake } = setup();
    at(sim, 0, 0);
    expect(toggleWheelbarrow(sim)).toBe(false); // none
    const b = parkBarrow(sim, 2, 1);
    expect(toggleWheelbarrow(sim)).toBe(true);
    expect(b.held).toBe(true);
    b.pos = { x: 1, y: 3, z: 0 };
    fake.surface = 0.9;
    expect(toggleWheelbarrow(sim)).toBe(true);
    expect(b.held).toBe(false);
    expect(b.pos.y).toBe(0.9);
    at(sim, 10, 10);
    expect(toggleWheelbarrow(sim)).toBe(false);
    expect(b.held).toBe(false);
  });
});
