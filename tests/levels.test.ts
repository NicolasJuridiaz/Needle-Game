/**
 * LEVEL SYSTEM AUDIT (RC2) — for every Level-system technology (tools and machines):
 *   Lv.1 exists, Lv.2..Lv.5 are reachable with the real Progression, there is no Lv.6, every level changes
 *   the stats it names, existing machines follow the technology level and new ones inherit it, and
 *   save -> load keeps it.
 * HAY SELL VALUE — Lv.1..Lv.10 (no Lv.11), exact multipliers, sale values of every product, premium pricing,
 *   processing keeps its margin at every level, save -> load.
 */
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BUILDABLES } from '../src/config/buildables';
import {
  displayLevel, HAY_VALUE_MULTIPLIERS, maxDisplayLevel, TECH_BY_ID, TECH_NODES, type TechNode,
} from '../src/config/techTree';
import { techForBuilding } from '../src/sim/levels';
import { Sim } from '../src/sim/sim';
import type { BuildingType } from '../src/sim/types';
import { findSpot, grantTech, parkPlayer, rich } from './support/simKit';

const LEVELED = TECH_NODES.filter((n) => n.leveled && n.id !== 'e_hay_value');

/** Building types following a technology (the first one is placed in the test). */
function buildingsOf(n: TechNode): BuildingType[] {
  return (Object.keys(BUILDABLES) as BuildingType[]).filter((t) => t !== 'sellStation' && techForBuilding(t)?.id === n.id && BUILDABLES[t].requiresNode !== null && !BUILDABLES[t].requiresNode!.includes('@'));
}

function levelLine(sim: Sim, id: number): string | undefined {
  return sim.buildingInfo(id)?.lines.find((l) => l.label === 'Level')?.value;
}

const statsOf = (n: TechNode, displayed: number): string[] => [...new Set(n.levels[displayed - 1 - (n.levelBase ?? 0)].effects.map((e) => e.stat))];

describe('Level system: every tool and machine technology goes Lv.1 -> Lv.5', () => {
  it('covers every tool and every machine family', () => {
    const ids = LEVELED.map((n) => n.id).sort();
    expect(ids).toEqual([
      'd_scanner', 'e_compressor', 'e_silo', 'e_wrapper', 'f_generator', 'f_pole', 'l_conveyor',
      'p_bucket', 'p_detector', 'p_hands', 'p_pitchfork', 'p_shovel', 'p_vacuum', 'p_wheelbarrow',
      'x_arm', 'x_collector', 'x_hopper', 'x_rake',
    ]);
  });

  for (const n of LEVELED) {
    it(`${n.name}: Lv.1 exists, Lv.2-5 reachable and effective, no Lv.6, machines follow, save/load keeps it`, () => {
      expect(maxDisplayLevel(n), 'five levels').toBe(5);
      const sim = new Sim(31);
      parkPlayer(sim);
      rich(sim);
      const p = sim.progress;
      // Lv.1: the starting level (Hands) or the plans.
      if (n.levelBase) expect(displayLevel(n, p.nodeLevel(n.id))).toBe(1);
      else { grantTech(p, `${n.id}@1`); expect(displayLevel(n, p.nodeLevel(n.id))).toBe(1); }
      sim.rebuildTopology();

      // An existing machine of the family, placed at Lv.1.
      const types = buildingsOf(n);
      const placed: number[] = [];
      if (types.length) {
        const spot = findSpot(sim, types[0], -28, -12, -21, -14);
        expect(spot, `room for ${types[0]}`).not.toBeNull();
        placed.push(sim.place(types[0], spot!.cell, spot!.rot)!.id);
        expect(levelLine(sim, placed[0])).toBe('Lv. 1 / 5');
      }

      for (let lv = 2; lv <= 5; lv++) {
        const stats = statsOf(n, lv);
        const before = stats.map((k) => sim.stat(k));
        grantTech(p, `${n.id}@${lv}`);
        expect(displayLevel(n, p.nodeLevel(n.id)), `${n.id} Lv.${lv}`).toBe(lv);
        expect(p.isUnlocked(`${n.id}@${lv}`)).toBe(true);
        const after = stats.map((k) => sim.stat(k));
        expect(after.some((v, i) => v !== before[i]), `${n.id} Lv.${lv} changes ${stats.join(', ')}`).toBe(true);
        // Existing machines follow the technology level (global per technology, not per unit).
        for (const id of placed) {
          expect(levelLine(sim, id), `existing ${types[0]} at Lv.${lv}`).toBe(`Lv. ${lv} / 5`);
          expect((sim.buildings.get(id)!.anim as Record<string, number>).tier).toBe(lv);
        }
      }
      // No Lv.6.
      expect(p.canUnlock(n.id)).toEqual({ ok: false, reason: 'Maxed' });
      expect(p.unlock(n.id)).toBe(false);
      expect(p.isUnlocked(`${n.id}@6`)).toBe(false);

      // A machine built now inherits Lv.5.
      if (types.length) {
        const spot = findSpot(sim, types[0], -28, -12, -21, -14);
        expect(spot).not.toBeNull();
        const b = sim.place(types[0], spot!.cell, spot!.rot)!;
        placed.push(b.id);
        expect(levelLine(sim, b.id)).toBe('Lv. 5 / 5');
        expect((b.anim as Record<string, number>).tier).toBe(5);
      }

      // Save -> load keeps the level, its stats and what the machines show.
      const allStats = [...new Set(n.levels.flatMap((l) => l.effects.map((e) => e.stat)))];
      const q = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
      expect(q.progress.nodeLevel(n.id)).toBe(p.nodeLevel(n.id));
      for (const k of allStats) expect(q.stat(k), k).toBe(sim.stat(k));
      for (const id of placed) {
        expect(levelLine(q, id)).toBe('Lv. 5 / 5');
        expect((q.buildings.get(id)!.anim as Record<string, number>).tier).toBe(5);
      }
    });
  }

  it('belts, splitters and mergers follow the Conveyor Network level', () => {
    for (const t of ['conveyor', 'splitter', 'merger', 'uSplitter', 'uMerger', 'beltLift', 'conveyorRamp'] as BuildingType[]) {
      expect(techForBuilding(t)?.id, t).toBe('l_conveyor');
    }
    expect(techForBuilding('scannerMk2')?.id).toBe('d_scanner');
  });
});

describe('Hay Sell Value Lv.1 -> Lv.10', () => {
  const node = TECH_BY_ID.e_hay_value;

  it('has ten levels with the documented multipliers, and no Lv.11', () => {
    expect(maxDisplayLevel(node)).toBe(10);
    expect(HAY_VALUE_MULTIPLIERS).toHaveLength(10);
    const sim = new Sim(5);
    rich(sim);
    const p = sim.progress;
    expect(sim.stat('econ.hayMul')).toBe(1);
    for (let lv = 2; lv <= 10; lv++) {
      grantTech(p, `e_hay_value@${lv}`);
      expect(displayLevel(node, p.nodeLevel('e_hay_value'))).toBe(lv);
      expect(sim.stat('econ.hayMul')).toBeCloseTo(HAY_VALUE_MULTIPLIERS[lv - 1], 9);
    }
    expect(sim.stat('econ.hayMul')).toBeCloseTo(2.65, 9);
    expect(p.canUnlock('e_hay_value')).toEqual({ ok: false, reason: 'Maxed' });
    expect(p.isUnlocked('e_hay_value@11')).toBe(false);
  });

  it('multipliers grow every level, strongly but far from 10x', () => {
    for (let i = 1; i < HAY_VALUE_MULTIPLIERS.length; i++) expect(HAY_VALUE_MULTIPLIERS[i]).toBeGreaterThan(HAY_VALUE_MULTIPLIERS[i - 1]);
    expect(HAY_VALUE_MULTIPLIERS[9]).toBeLessThan(3);
  });

  it('every sale is item value x Hay Sell Value x needle sale buff', () => {
    for (const lv of [1, 4, 10]) {
      const sim = new Sim(6);
      rich(sim);
      if (lv > 1) grantTech(sim.progress, `e_hay_value@${lv}`);
      const m = HAY_VALUE_MULTIPLIERS[lv - 1];
      const pos = { x: 0, y: 0, z: 0 };
      expect(sim.progress.recordSale('hay', 10, false, pos)).toBeCloseTo(10 * m, 9);
      expect(sim.progress.recordSale('bale', 2, true, pos)).toBeCloseTo(2 * 60 * m, 9);
      expect(sim.progress.recordSale('wrapped', 1, true, pos)).toBeCloseTo(110 * m, 9);
      for (let k = 0; k < 5; k++) sim.progress.onNeedleFound(k, 'manual', pos); // 5th buff: +20 % sale value
      expect(sim.progress.recordSale('hay', 10, false, pos)).toBeCloseTo(10 * m * 1.2, 9);
    }
  });

  it('costs WP and a lot of Money: 2.5x-4x a normal upgrade of the same tier, rising every level', () => {
    const money = node.levels.map((l) => l.money);
    for (let i = 1; i < money.length; i++) expect(money[i], `Lv.${i + 2}`).toBeGreaterThan(money[i - 1]);
    for (const l of node.levels) expect(l.cost).toBeGreaterThanOrEqual(1);
    // Normal machine upgrades: Lv.2..Lv.5 prices of the machine technologies.
    const normal = LEVELED.filter((n) => n.branch !== 'player').flatMap((n) => n.levels.map((l) => l.money)).filter((v) => v > 0).sort((a, b) => a - b);
    const median = normal[Math.floor(normal.length / 2)];
    expect(money[money.length - 1], 'Lv.10 costs several flagship upgrades').toBeGreaterThanOrEqual(2 * normal[normal.length - 1]);
    expect(money[4], 'Lv.6 costs more than a typical machine upgrade').toBeGreaterThan(median);
  });

  it('processing keeps its margin at every Hay Sell Value level: raw < bale < wrapped per hay used', () => {
    for (let lv = 1; lv <= 10; lv++) {
      for (const comp of [1, 5]) for (const wrap of [1, 5]) {
        const sim = new Sim(8);
        rich(sim);
        if (lv > 1) grantTech(sim.progress, `e_hay_value@${lv}`);
        grantTech(sim.progress, `e_compressor@${comp}`);
        grantTech(sim.progress, `e_wrapper@${wrap}`);
        const value = (item: 'hay' | 'bale' | 'wrapped') => sim.stat(`econ.${item}Value`) * sim.stat('econ.hayMul');
        const hayPerBale = sim.stat('compressor.hayPerBale');
        const raw = value('hay');
        const bale = value('bale') / hayPerBale;
        const wrapped = value('wrapped') / hayPerBale;
        const tag = `Hay Value Lv.${lv}, compressor Lv.${comp}, wrapper Lv.${wrap}`;
        expect(bale / raw, `${tag}: bale margin`).toBeGreaterThanOrEqual(1.4);
        expect(wrapped / bale, `${tag}: wrap margin`).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it('save -> load keeps the Hay Sell Value level and multiplier', () => {
    const sim = new Sim(9);
    rich(sim);
    grantTech(sim.progress, 'e_hay_value@7');
    const q = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    expect(displayLevel(node, q.progress.nodeLevel('e_hay_value'))).toBe(7);
    expect(q.stat('econ.hayMul')).toBeCloseTo(HAY_VALUE_MULTIPLIERS[6], 9);
    expect(BALANCE.hayEquivalent.bale).toBe(40); // bale margin above assumes the documented 40 hay-eq
  });
});
