/**
 * STAMINA + HAND LEVELS (config/stamina.ts). Only direct player actions spend stamina: sprint (FPS controller) and
 * manual digging (playerDig / playerVacuum). Automation never does (see the machines / logistics tests too).
 */
import { describe, expect, it } from 'vitest';
import { HAND_LEVEL_PICKUP, handPickupAt, pickupStaminaCost, STAMINA } from '../src/config/stamina';
import { WORLD } from '../src/config/world';
import { PlayerController } from '../src/game/playerController';
import type { Input } from '../src/game/input';
import { playerDig } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import { grantTech, rich, run } from './support/simKit';

const handsLevel = (sim: Sim) => sim.progress.nodeLevel('p_hands') + 1; // levelBase 1: Lv.1 owns 0 purchases

/** A spot on the pile's west flank with plenty of hay, and the player standing next to it. */
function atPile(sim: Sim): { x: number; z: number } {
  const t = sim.hay.findTarget(WORLD.pile.cx - WORLD.pile.rx * 0.6, WORLD.pile.cz, 6, 'densest')!;
  sim.player.pos = { x: t.x - 1.5, y: 0, z: t.z };
  return { x: t.x, z: t.z };
}

/** Fake keyboard: the given keys are held. */
function keys(...down: string[]): Input {
  const set = new Set(down);
  return { isDown: (c: string) => set.has(c), wasPressed: () => false } as unknown as Input;
}

describe('Hand levels: how much hay one grab takes', () => {
  it('a new game starts at Hands Lv.1 and a grab takes exactly 1 hay', () => {
    const sim = new Sim(1);
    expect(handsLevel(sim)).toBe(1);
    expect(sim.stat('tool.hands.dig')).toBe(1);
    const p = atPile(sim);
    const r = playerDig(sim, 'hands', p.x, 0, p.z);
    expect(r.amount).toBeCloseTo(1, 4); // float32 heightfield
    expect(sim.player.carry.hay).toBeCloseTo(1, 4);
  });

  it('the table is Lv.1 = 1 ... Lv.5 = 20, strictly increasing, and every upgrade applies it', () => {
    expect(HAND_LEVEL_PICKUP[0]).toBe(1);
    expect(HAND_LEVEL_PICKUP[4]).toBe(20);
    for (let i = 1; i < HAND_LEVEL_PICKUP.length; i++) expect(HAND_LEVEL_PICKUP[i]).toBeGreaterThan(HAND_LEVEL_PICKUP[i - 1]);
    const sim = new Sim(2);
    rich(sim);
    for (let lv = 2; lv <= 5; lv++) {
      grantTech(sim.progress, `p_hands@${lv}`);
      expect(handsLevel(sim)).toBe(lv);
      expect(sim.stat('tool.hands.dig')).toBe(handPickupAt(lv));
      // and the grab really takes that much
      sim.player.carry.clear(); sim.player.cooldown = 0; sim.player.stamina.reset();
      const p = atPile(sim);
      expect(playerDig(sim, 'hands', p.x, 0, p.z).amount).toBeCloseTo(handPickupAt(lv), 4);
    }
  });

  it('bigger grabs cost more stamina but much less per hay (upgrades are real upgrades)', () => {
    const c1 = pickupStaminaCost(HAND_LEVEL_PICKUP[0]), c5 = pickupStaminaCost(HAND_LEVEL_PICKUP[4]);
    expect(c5).toBeGreaterThan(c1);
    expect(c5 / 20).toBeLessThan((c1 / 1) / 3);
  });

  it('the Hands level survives save / load', () => {
    const sim = new Sim(3);
    rich(sim);
    grantTech(sim.progress, 'p_hands@4');
    const b = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    expect(handsLevel(b)).toBe(4);
    expect(b.stat('tool.hands.dig')).toBe(HAND_LEVEL_PICKUP[3]);
  });
});

describe('Stamina', () => {
  it('manual digging spends stamina; each grab costs pickupStaminaCost of what it took', () => {
    const sim = new Sim(4);
    const p = atPile(sim);
    const r = playerDig(sim, 'hands', p.x, 0, p.z);
    expect(sim.player.stamina.value).toBeCloseTo(STAMINA.max - pickupStaminaCost(r.amount), 6);
  });

  it('with too little stamina a grab does not start: nothing taken, no cooldown, a tired event; it works again after resting', () => {
    const sim = new Sim(5);
    const p = atPile(sim);
    let tired = 0;
    sim.events.on('player:tired', () => { tired++; });
    sim.player.stamina.value = pickupStaminaCost(1) * 0.5;
    const hay0 = sim.hay.totalUnits();
    const r = playerDig(sim, 'hands', p.x, 0, p.z);
    expect(r.tired).toBe(true);
    expect(r.amount).toBe(0);
    expect(sim.player.carry.isEmpty()).toBe(true);
    expect(sim.hay.totalUnits()).toBe(hay0);
    expect(sim.player.cooldown).toBe(0);
    expect(tired).toBe(1);
    run(sim, STAMINA.regenDelay + 1);
    expect(playerDig(sim, 'hands', p.x, 0, p.z).amount).toBeGreaterThan(0);
  });

  it('holding the grab until empty never breaks the carry or the pile (consistent state at zero)', () => {
    const sim = new Sim(6);
    const p = atPile(sim);
    let taken = 0;
    for (let i = 0; i < 400; i++) {
      sim.player.cooldown = 0;
      taken += playerDig(sim, 'hands', p.x, 0, p.z).amount;
      if (sim.player.carry.weight() >= 19.999) sim.player.carry.clear();
    }
    expect(sim.player.stamina.value).toBeGreaterThanOrEqual(0);
    expect(taken).toBeLessThanOrEqual(STAMINA.max / pickupStaminaCost(1) + 1e-6);
    expect(sim.player.stamina.value).toBeLessThan(pickupStaminaCost(1));
  });

  it('regenerates after a short delay once the player stops', () => {
    const sim = new Sim(7);
    sim.player.stamina.drain(50, 1);
    const v = sim.player.stamina.value;
    run(sim, STAMINA.regenDelay * 0.5);
    expect(sim.player.stamina.value).toBe(v); // still in the delay
    run(sim, STAMINA.regenDelay + 1);
    expect(sim.player.stamina.value).toBeGreaterThan(v);
    run(sim, 30);
    expect(sim.player.stamina.value).toBe(STAMINA.max);
  });

  it('sprinting drains stamina, walking does not; at zero sprint stops until the bar refills', () => {
    const sim = new Sim(8);
    sim.player.pos = { x: WORLD.spawn.x, y: 0, z: WORLD.spawn.z };
    const pc = new PlayerController(sim);
    pc.x = WORLD.spawn.x; pc.z = WORLD.spawn.z; pc.yaw = Math.PI / 2; // walk along -Z (open floor)
    const st = sim.player.stamina;
    for (let i = 0; i < 20; i++) pc.update(0.05, keys('KeyW'), 1);
    expect(st.value).toBe(STAMINA.max);
    expect(pc.sprinting).toBe(false);
    for (let i = 0; i < 20; i++) { pc.yaw = i % 2 ? Math.PI / 2 : -Math.PI / 2; pc.update(0.05, keys('KeyW', 'ShiftLeft'), 1); }
    expect(st.value).toBeCloseTo(STAMINA.max - STAMINA.sprintPerSecond * 1, 3);
    // Shift held while standing still costs nothing
    const v = st.value;
    pc.update(0.05, keys('ShiftLeft'), 1);
    expect(st.value).toBe(v);
    // run it dry
    st.value = 0.1;
    pc.update(0.05, keys('KeyW', 'ShiftLeft'), 1);
    expect(st.value).toBe(0);
    pc.update(0.05, keys('KeyW', 'ShiftLeft'), 1);
    expect(pc.sprinting).toBe(false);
    st.value = STAMINA.sprintResumeAt - 1; st.tick(0);
    pc.update(0.05, keys('KeyW', 'ShiftLeft'), 1);
    expect(pc.sprinting).toBe(false); // still exhausted
    st.value = STAMINA.sprintResumeAt + 1; st.tick(0);
    pc.update(0.05, keys('KeyW', 'ShiftLeft'), 1);
    expect(pc.sprinting).toBe(true);
  });

  it('is not saved: a loaded game is rested, and the save has no stamina field', () => {
    const sim = new Sim(9);
    sim.player.stamina.value = 12;
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    expect(JSON.stringify(data)).not.toMatch(/stamina/i);
    const b = Sim.fromSave(data);
    expect(b.player.stamina.value).toBe(STAMINA.max);
    expect(b.player.stamina.exhausted).toBe(false);
  });
});
