/**
 * VISUAL pile mapping (src/render/hayShape.ts): the rendered pile may differ from the sim heightfield, but only within
 * bounds, never showing hay where there is none (or hiding hay that exists), and always shrinking when hay is removed.
 * The simulation itself must not change at all.
 */
import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config/world';
import { HAY_HIDE_EPS } from '../src/render/hayGrid';
import { HaySurface, VISUAL_MAX_LOWER, VISUAL_MAX_RAISE, visualHeight } from '../src/render/hayShape';
import { Interaction } from '../src/game/interaction';
import { playerDig } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';

const H = WORLD.pile.height;

describe('visual hay surface (render mapping of the sim heightfield)', () => {
  it('shows hay exactly where the sim has hay, within the offset bounds', () => {
    const sim = new Sim(4401);
    const s = new HaySurface(sim.hay);
    const h = sim.hay.heights;
    let raised = 0, lowered = 0;
    for (let i = 0; i < h.length; i++) {
      const v = s.visual[i];
      if (h[i] <= HAY_HIDE_EPS) { expect(v).toBe(h[i]); continue; }
      expect(v).toBeGreaterThan(HAY_HIDE_EPS);
      expect(v - h[i]).toBeLessThanOrEqual(VISUAL_MAX_RAISE + 1e-6);
      expect(h[i] - v).toBeLessThanOrEqual(VISUAL_MAX_LOWER + 1e-6);
      raised = Math.max(raised, v - h[i]);
      lowered = Math.max(lowered, h[i] - v);
    }
    // it really reshapes: flanks go up, the crown comes down
    expect(raised).toBeGreaterThan(0.8);
    expect(lowered).toBeGreaterThan(0.8);
  });

  it('is monotonic in the local hay height (removing hay always lowers the visual surface)', () => {
    let prev = 0;
    for (let k = 1; k <= 120; k++) {
      const h = (k / 100) * H;
      const v = visualHeight(h, h, 0.1, H);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('broad shoulders, flatter crown: the shape is less peaked than the logical pile', () => {
    const sim = new Sim(4402);
    const s = new HaySurface(sim.hay);
    const h = sim.hay.heights;
    let maxH = 0, maxV = 0;
    for (let i = 0; i < h.length; i++) { maxH = Math.max(maxH, h[i]); maxV = Math.max(maxV, s.visual[i]); }
    // fraction of the covered area above 60 % of the top: a cone has little, a heap much more
    const frac = (arr: Float32Array, top: number) => {
      let covered = 0, high = 0;
      for (let i = 0; i < h.length; i++) if (h[i] > HAY_HIDE_EPS) { covered++; if (arr[i] > 0.6 * top) high++; }
      return high / covered;
    };
    expect(frac(s.visual, maxV)).toBeGreaterThan(frac(h, maxH) * 1.4);
    expect(maxV).toBeLessThan(maxH);
  });

  it('follows depletion: digging lowers the visual pile there, and the whole pile shrinks with the sim', () => {
    const sim = new Sim(4403);
    const s = new HaySurface(sim.hay);
    const x = WORLD.pile.cx - 6, z = WORLD.pile.cz;
    const before = s.heightAt(x, z), logicalBefore = sim.hay.heightAt(x, z);
    const sumBefore = s.visual.reduce((a, b) => a + b, 0);
    sim.progress.ownedTools.add('shovel');
    for (let k = 0; k < 60; k++) {
      sim.player.carry.clear();
      sim.player.cooldown = 0;
      playerDig(sim, 'shovel', x, 0, z);
      const r = sim.hay.consumeDirtyRect();
      if (r) s.update(r.c0, r.r0, r.c1 + 1, r.r1 + 1);
    }
    const dropLogical = logicalBefore - sim.hay.heightAt(x, z), dropVisual = before - s.heightAt(x, z);
    expect(dropLogical).toBeGreaterThan(0.1);
    expect(dropVisual).toBeGreaterThan(0.5 * dropLogical);
    expect(s.visual.reduce((a, b) => a + b, 0)).toBeLessThan(sumBefore);
    // incremental updates match a full rebuild
    const full = new HaySurface(sim.hay);
    for (let i = 0; i < full.visual.length; i++) expect(s.visual[i]).toBeCloseTo(full.visual[i], 5);
  });

  it('is render-only: building the surface never touches the sim heightfield or its units', () => {
    const sim = new Sim(4404);
    const copy = Float32Array.from(sim.hay.heights);
    const units = sim.hay.totalUnits();
    const s = new HaySurface(sim.hay);
    s.update(0, 0, sim.hay.cols - 1, sim.hay.rows - 1);
    expect(sim.hay.heights).toEqual(copy);
    expect(sim.hay.totalUnits()).toBe(units);
    expect(Math.round(units)).toBe(WORLD.pile.totalUnits);
  });

  it('aiming hits the visual surface, and every hay hit maps to a cell that really has hay to dig', () => {
    const sim = new Sim(4405);
    const s = new HaySurface(sim.hay);
    const aim = new Interaction(sim);
    aim.setHaySurface(s);
    const P = WORLD.pile;
    let hits = 0, dug = 0;
    for (let k = 0; k < 400; k++) {
      const a = (k / 400) * Math.PI * 2, R = Math.max(P.rx, P.rz) + 3 + (k % 5);
      const o = { x: P.cx + Math.cos(a) * R, y: 1.6 + (k % 7) * 0.8, z: P.cz + Math.sin(a) * R };
      const tx = P.cx + ((k * 37) % 11) - 5, tz = P.cz + ((k * 53) % 9) - 4, ty = (k % 4) * 1.5;
      const l = Math.hypot(tx - o.x, ty - o.y, tz - o.z);
      const d = { x: (tx - o.x) / l, y: (ty - o.y) / l, z: (tz - o.z) / l };
      const hit = aim.aim(o, d, 40, { buildings: false, needles: false, barrow: false });
      if (hit.kind !== 'hay') continue;
      hits++;
      // the hit lies on the visual surface ...
      expect(Math.abs(hit.point!.y - s.heightAt(hit.point!.x, hit.point!.z))).toBeLessThan(0.15);
      // ... and the sim has hay at that X/Z, so the existing extraction can take it
      expect(sim.hay.heightAt(hit.point!.x, hit.point!.z)).toBeGreaterThan(0);
      sim.progress.ownedTools.add('shovel');
      sim.player.carry.clear(); sim.player.cooldown = 0;
      if (playerDig(sim, 'shovel', hit.point!.x, hit.point!.y, hit.point!.z).amount > 0) dug++;
      const r = sim.hay.consumeDirtyRect();
      if (r) s.update(r.c0, r.r0, r.c1 + 1, r.r1 + 1);
    }
    expect(hits).toBeGreaterThan(200);
    expect(dug).toBe(hits);
  });
});
