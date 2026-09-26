/**
 * Refresh-rate independence: the simulation, the economy and player movement must give the same results at
 * 60, 120, 144 and 165 Hz (and degrade gracefully, never speed up, at low frame rates).
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { TECH_NODES } from '../src/config/techTree';
import { WORLD } from '../src/config/world';
import { advanceFixed } from '../src/game/fixedStep';
import type { Input } from '../src/game/input';
import { PlayerController } from '../src/game/playerController';
import { Sim } from '../src/sim/sim';

const RATES = [60, 120, 144, 165];

/** Drives `seconds` of wall time at `hz` through the fixed-step accumulator. */
function drive(hz: number, seconds: number, tick: (dt: number) => void, perFrame?: (dt: number) => void): number {
  const state = { accumulator: 0 };
  let ticks = 0;
  const frames = Math.round(seconds * hz);
  for (let f = 0; f < frames; f++) {
    const dt = 1 / hz;
    advanceFixed(state, dt, BALANCE.tickDt, 5, (step) => { ticks++; tick(step); });
    perFrame?.(dt);
  }
  return ticks;
}

function factorySim(): Sim {
  const sim = new Sim(99);
  sim.progress.addMoney(1e6, 'milestone');
  sim.progress.addWP(1000, 'milestone');
  const byId = new Map(TECH_NODES.map((n) => [n.id, n]));
  const want = new Set<string>();
  const add = (id: string) => { if (want.has(id)) return; want.add(id); byId.get(id)!.requires.forEach(add); };
  ['x_arm', 'x_rake', 'l_conveyor', 'f_generator', 'x_rake_auto'].forEach(add);
  for (let k = 0; k < 10; k++) for (const id of want) while (sim.progress.canUnlock(id).ok) sim.progress.unlock(id);
  sim.player.pos = { x: 25, y: 0, z: 18 };
  const edge = Math.floor(WORLD.pile.cx - WORLD.pile.rx) - 2;
  const gen = sim.place('hayGenerator', { x: edge - 6, z: -5, level: 0 }, 0)!;
  sim.player.carry.add('hay', 150);
  sim.player.pos = { x: gen.center.x, y: 0, z: gen.center.z + 2.5 };
  gen.interact(sim);
  sim.player.pos = { x: 25, y: 0, z: 18 };
  sim.place('pistonRake', { x: edge, z: -1, level: 0 }, 0);
  for (let x = edge - 1; x > -29; x--) sim.place('conveyor', { x, z: 0, level: 0 }, 2);
  sim.place('roboticArm', { x: edge - 1, z: 1, level: 0 }, 3);
  sim.rebuildTopology();
  return sim;
}

describe('refresh-rate independence', () => {
  it('runs the same number of 20 Hz sim ticks at 60/120/144/165 Hz', () => {
    const expected = Math.round(10 / BALANCE.tickDt);
    for (const hz of RATES) {
      const ticks = drive(hz, 10, () => {});
      expect(Math.abs(ticks - expected), `${hz} Hz -> ${ticks} ticks`).toBeLessThanOrEqual(1);
    }
  });

  it('never runs faster than real time when frames stall (catch-up is capped)', () => {
    const state = { accumulator: 0 };
    let ticks = 0;
    advanceFixed(state, 2, BALANCE.tickDt, 5, () => ticks++); // a 2 s hitch
    expect(ticks).toBe(5);
    expect(state.accumulator).toBe(0);
  });

  it('produces identical factory output and money at every refresh rate', () => {
    const results = RATES.map((hz) => {
      const sim = factorySim();
      drive(hz, 45, (step) => sim.tick(step));
      const s = sim.progress.stats;
      return { extracted: Math.round(s.hayExtractedMachine), arm: Math.round(s.hayExtractedArm), money: Math.round(sim.progress.money), burned: Math.round(s.hayBurned) };
    });
    expect(results[0].extracted).toBeGreaterThan(100);
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it('walks the same distance at every refresh rate', () => {
    const input = { isDown: (c: string) => c === 'KeyW', wasPressed: () => false } as unknown as Input;
    const dist = RATES.map((hz) => {
      const sim = new Sim(5);
      const pc = new PlayerController(sim);
      pc.x = -24; pc.z = -16; pc.yaw = 0; // open floor, walking +X
      const x0 = pc.x;
      for (let f = 0; f < 2 * hz; f++) pc.update(1 / hz, input, 1);
      return pc.x - x0;
    });
    expect(dist[0]).toBeGreaterThan(5);
    for (const d of dist) expect(Math.abs(d - dist[0]) / dist[0]).toBeLessThan(0.02);
  });
});
