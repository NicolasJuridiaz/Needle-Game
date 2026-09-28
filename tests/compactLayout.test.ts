/**
 * Compact warehouse (east wall at x = 24, pile centre moved 6 m west): old saves (wider hay grid, buildings anywhere
 * in the old hall) still load, and the manual sell loop is shorter.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config/world';
import { depositToIntake, intakeDropPoint } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import { run } from './support/simKit';

const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

describe('compact layout', () => {
  it('the RC1 late save (old 128-column hay grid) loads with every building and all of its hay', () => {
    const raw = JSON.parse(readFileSync('tests/fixtures/rc1-late-save.json', 'utf8'));
    const hb = fromB64(raw.sim.hay.heights);
    const q = new Uint16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2);
    let sum = 0;
    for (const v of q) sum += v / 1000;
    const sim = Sim.fromSave(raw.sim);
    expect(sim.buildings.size).toBe(raw.sim.buildings.length);
    expect(sim.hay.cols).toBe((WORLD.interior.maxX - WORLD.interior.minX) / WORLD.hayCell);
    const upm = raw.sim.hay.unitsPerMeter ?? sim.hay.unitsPerMeter;
    expect(sim.hay.totalUnits()).toBeCloseTo(sum * upm, -1); // nothing lost in the re-layout
    // and it re-saves in the new grid, identically
    const again = Sim.fromSave(JSON.parse(JSON.stringify(sim.serialize())));
    expect(again.hay.totalUnits()).toBeCloseTo(sim.hay.totalUnits(), 3);
    expect(again.buildings.size).toBe(sim.buildings.size);
  });

  it('a building an old save left outside the compact hall is dropped and refunded, not crashed on', () => {
    const sim = new Sim(11);
    const data = JSON.parse(JSON.stringify(sim.serialize()));
    const chute = data.buildings[0];
    data.buildings.push({ ...chute, id: 999, type: 'conveyor', cell: { x: WORLD.interior.maxX + 3, z: 0, level: 0 }, rot: 0, variant: undefined, paid: 10, state: {} });
    const m0 = data.progress.money;
    const b = Sim.fromSave(data);
    expect([...b.buildings.values()].some((x) => x.id === 999)).toBe(false);
    expect(b.progress.money).toBe(m0 + 10);
  });

  it('the pile is much closer to the SELL HAY drop point than in the old hall, and selling still works', () => {
    const sim = new Sim(1000);
    const h = sim.hay, drop = intakeDropPoint();
    let best = Infinity;
    for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
      if (h.heights[r * h.cols + c] < 0.3) continue;
      best = Math.min(best, Math.hypot(h.originX + (c + 0.5) * h.cellSize - drop.x, h.originZ + (r + 0.5) * h.cellSize - drop.z));
    }
    expect(best).toBeLessThan(17.5); // old hall: 22.0 m (seed 1000)
    sim.player.carry.add('hay', 20);
    expect(depositToIntake(sim)).toBe(true);
    run(sim, WORLD.intake.transitSeconds + 0.2);
    expect(sim.progress.money).toBeGreaterThan(0);
    expect(sim.progress.stats.haySold).toBeCloseTo(20, 6);
  });
});
