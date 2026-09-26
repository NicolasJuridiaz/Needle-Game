import { describe, expect, it } from 'vitest';
import { WORLD } from '../src/config/world';
import { HayField } from '../src/sim/hayfield';

function fresh(seed = 1): HayField {
  const h = new HayField();
  h.generate(seed);
  return h;
}

function relaxAll(h: HayField, maxTicks = 4000): void {
  for (let i = 0; i < maxTicks; i++) h.tick(0.05);
}

function maxSlope(h: HayField): number {
  let m = 0;
  for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols - 1; c++) {
    const i = r * h.cols + c;
    if (h.blocked[i] || h.blocked[i + 1]) continue;
    m = Math.max(m, Math.abs(h.heights[i] - h.heights[i + 1]));
  }
  return m / h.cellSize;
}

describe('HayField', () => {
  it('generates the configured amount of hay in an organic, stable mound', () => {
    const h = fresh(3);
    expect(h.totalUnits()).toBeCloseTo(WORLD.pile.totalUnits, -1);
    expect(h.initialUnits).toBe(WORLD.pile.totalUnits);
    expect(h.progress()).toBeCloseTo(0, 5);
    expect(h.heightAt(WORLD.pile.cx, WORLD.pile.cz)).toBeGreaterThan(WORLD.pile.height * 0.7);
    expect(h.heightAt(WORLD.interior.minX + 2, WORLD.pile.cz)).toBe(0);
    const tan = Math.tan((WORLD.pile.reposeDeg * Math.PI) / 180);
    expect(maxSlope(h)).toBeLessThanOrEqual(tan + 1e-3);
    // relaxation should barely change a stable pile
    const before = h.totalUnits();
    relaxAll(h, 50);
    expect(h.totalUnits()).toBeCloseTo(before, 3);
  });

  it('is deterministic for a seed', () => {
    const a = fresh(99), b = fresh(99), c = fresh(100);
    expect(Array.from(a.heights.slice(0, 5000))).toEqual(Array.from(b.heights.slice(0, 5000)));
    expect(a.needles).toEqual(b.needles);
    expect(a.needles).not.toEqual(c.needles);
  });

  it('extraction conserves units and digs a crater', () => {
    const h = fresh(5);
    const before = h.totalUnits();
    const x = WORLD.pile.cx - 6, z = WORLD.pile.cz;
    const h0 = h.heightAt(x, z);
    const e = h.extractRadius(x, z, 0.6, 40);
    expect(e.units).toBeGreaterThan(39.9);
    expect(e.units).toBeLessThanOrEqual(40.0001);
    expect(h.totalUnits() + e.units).toBeCloseTo(before, 4);
    expect(h.heightAt(x, z)).toBeLessThan(h0);
  });

  it('extraction returns what exists when asking for too much, never negative', () => {
    const h = fresh(5);
    const x = WORLD.pile.cx - WORLD.pile.rx + 0.3, z = WORLD.pile.cz;
    const e = h.extractRadius(x, z, 0.3, 1e9);
    expect(e.units).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < h.heights.length; i++) expect(h.heights[i]).toBeGreaterThanOrEqual(0);
    expect(h.extractRadius(0, 0, 0, 0).units).toBe(0);
    expect(h.extractRadius(-500, -500, 2, 50).units).toBe(0);
  });

  it('relaxation conserves units and slumps a deep hole', () => {
    const h = fresh(8);
    const x = WORLD.pile.cx - 5, z = WORLD.pile.cz + 1;
    for (let i = 0; i < 60; i++) h.extractRadius(x, z, 0.5, 60);
    const mid = h.totalUnits();
    relaxAll(h, 2000);
    expect(h.totalUnits()).toBeCloseTo(mid, 2);
    const tan = Math.tan((WORLD.pile.reposeDeg * Math.PI) / 180);
    expect(maxSlope(h)).toBeLessThan(tan + 0.05);
  });

  it('rake strip pulls from the nearest face and reports reach', () => {
    const h = fresh(2);
    const x = WORLD.pile.cx - WORLD.pile.rx - 3, z = WORLD.pile.cz;
    const before = h.totalUnits();
    const e = h.extractStrip(x, z, 1, 0, 1.5, 7, 30);
    expect(e.units).toBeGreaterThan(29.9);
    expect(e.reach).toBeGreaterThan(0);
    expect(e.reach).toBeLessThanOrEqual(7);
    expect(h.totalUnits() + e.units).toBeCloseTo(before, 4);
    const none = h.extractStrip(WORLD.interior.minX + 1, WORLD.interior.minZ + 1, -1, 0, 1.5, 3, 30);
    expect(none.units).toBe(0);
  });

  it('deposit conserves units and never fills blocked cells', () => {
    const h = fresh(4);
    h.setBlocked(-20, -2, -17, 2, true);
    const before = h.totalUnits();
    h.deposit(-18.5, 0, 200);
    expect(h.totalUnits()).toBeCloseTo(before + 200, 3);
    expect(h.maxHeightInRect(-20, -2, -17, 2)).toBe(0);
    relaxAll(h, 500);
    expect(h.maxHeightInRect(-20, -2, -17, 2)).toBe(0);
    expect(h.totalUnits()).toBeCloseTo(before + 200, 3);
  });

  it('blocking a rect displaces its hay (conserved) and needles inside move with it', () => {
    const h = fresh(6);
    const n = h.needles[0];
    const before = h.totalUnits();
    const cx = Math.floor(n.pos.x), cz = Math.floor(n.pos.z);
    h.setBlocked(cx - 1, cz - 1, cx + 2, cz + 2, true);
    expect(h.totalUnits()).toBeCloseTo(before, 3);
    expect(h.maxHeightInRect(cx - 1, cz - 1, cx + 2, cz + 2)).toBe(0);
    expect(['buried', 'exposed']).toContain(n.status);
    const inside = n.pos.x >= cx - 1 && n.pos.x < cx + 2 && n.pos.z >= cz - 1 && n.pos.z < cz + 2;
    expect(inside).toBe(false);
  });

  it('places one needle per band, deeper bands deeper in the stack', () => {
    const h = fresh(11);
    expect(h.needles.length).toBe(6);
    const depths = h.needles.map((n) => h.heightAt(n.pos.x, n.pos.z) - n.pos.y);
    for (const n of h.needles) {
      expect(n.status).toBe('buried');
      expect(n.pos.y).toBeGreaterThan(0);
      expect(n.pos.z).toBeLessThan(WORLD.interior.maxZ);
    }
    expect(depths[0]).toBeLessThan(0.8);
    expect(depths[5]).toBeGreaterThan(depths[0]);
    expect(depths[5]).toBeGreaterThan(depths[2]);
  });

  it('digging a needle column extracts the needle', () => {
    const h = fresh(12);
    const n = h.needles[0];
    let got: number[] = [];
    for (let i = 0; i < 200 && !got.length; i++) got = h.extractRadius(n.pos.x, n.pos.z, 0.3, 10).needles;
    expect(got).toEqual([n.id]);
    expect(n.status).toBe('inTransit');
  });

  it('detector finds the shallow needle from above and reports too-deep ones', () => {
    const h = fresh(13);
    const n0 = h.needles[0];
    const r = h.detectorReading(n0.pos.x + 1, n0.pos.z, 7, 0.8, 0);
    expect(r.needleId).toBe(n0.id);
    expect(r.strength).toBeGreaterThan(0.3);
    expect(r.dirX).toBeLessThan(-0.9);
    const n5 = h.needles[5];
    const deep = h.detectorReading(n5.pos.x, n5.pos.z, 3, 0.8, 0);
    if (deep.needleId !== n5.id) expect(deep.tooDeep || deep.needleId >= 0).toBe(true);
    const far = h.detectorReading(WORLD.interior.minX + 1, WORLD.interior.minZ + 1, 7, 0.8, 0);
    expect(far.strength).toBe(0);
    for (const n of h.needles) h.markFound(n.id);
    expect(h.detectorReading(n0.pos.x, n0.pos.z, 7, 5, 0).needleId).toBe(-1);
  });

  it('needles become exposed when the surface drops to them, buried again when covered', () => {
    const h = fresh(14);
    const n = h.needles[0];
    let exposed = -1;
    h.onExposed = (id) => { exposed = id; };
    // lower the column gently until the surface reaches the needle
    const ci = Math.floor((n.pos.z - h.originZ) / h.cellSize) * h.cols + Math.floor((n.pos.x - h.originX) / h.cellSize);
    h.heights[ci] = n.pos.y + 0.01;
    h.tick(0.05);
    expect(n.status).toBe('exposed');
    expect(exposed).toBe(n.id);
    expect(h.exposedNeedleNear(n.pos.x, n.pos.y, n.pos.z, 0.5)).toBe(n.id);
    h.deposit(n.pos.x, n.pos.z, 300);
    h.tick(0.05);
    expect(n.status).toBe('buried');
  });

  it('tossBack puts the needle back, shallowly buried near the top', () => {
    const h = fresh(15);
    const n = h.needles[3];
    n.status = 'inTransit';
    const p = h.tossBack(n.id);
    expect(n.status).toBe('buried');
    expect(n.returns).toBe(1);
    expect(h.heightAt(p.x, p.z)).toBeGreaterThan(p.y);
  });

  it('serializes and restores', () => {
    const h = fresh(16);
    for (let i = 0; i < 30; i++) h.extractRadius(WORLD.pile.cx - 4, WORLD.pile.cz, 0.8, 50);
    h.deposit(-20, 5, 120);
    h.setBlocked(-25, -5, -22, -2, true);
    const s = JSON.parse(JSON.stringify(h.serialize()));
    const g = new HayField();
    g.deserialize(s);
    expect(g.totalUnits()).toBeCloseTo(h.totalUnits(), -1);
    expect(g.unitsPerMeter).toBeCloseTo(h.unitsPerMeter, 9);
    expect(g.heightAt(WORLD.pile.cx, WORLD.pile.cz)).toBeCloseTo(h.heightAt(WORLD.pile.cx, WORLD.pile.cz), 2);
    expect(g.blocked[Math.floor((-4 - h.originZ) / h.cellSize) * h.cols + Math.floor((-24 - h.originX) / h.cellSize)]).toBe(1);
    expect(g.needles).toEqual(h.needles);
    expect(g.progress()).toBeCloseTo(h.progress(), 3);
  });

  it('keeps conservation over many operations', () => {
    const h = fresh(17);
    let out = 0, inn = 0;
    for (let i = 0; i < 3000; i++) {
      const a = (i * 0.37) % (Math.PI * 2);
      const x = WORLD.pile.cx + Math.cos(a) * 8, z = WORLD.pile.cz + Math.sin(a) * 6;
      out += h.extractRadius(x, z, 0.5 + (i % 5) * 0.2, 20).units;
      if (i % 7 === 0) { h.deposit(x - 3, z, 15); inn += 15; }
      h.tick(0.05);
    }
    expect(h.totalUnits()).toBeCloseTo(WORLD.pile.totalUnits - out + inn, 0);
  });

  it('performs within budget', () => {
    const t0 = performance.now();
    const h = fresh(18);
    const tGen = performance.now() - t0;
    expect(tGen).toBeLessThan(250);
    let tExt = 0, tTick = 0;
    for (let i = 0; i < 400; i++) {
      const a = performance.now();
      h.extractRadius(WORLD.pile.cx - 7 + (i % 10) * 0.3, WORLD.pile.cz + (i % 7) * 0.4, 0.6, 30);
      const b = performance.now();
      h.tick(0.05);
      const c = performance.now();
      tExt += b - a; tTick += c - b;
    }
    expect(tExt / 400).toBeLessThan(0.3);
    expect(tTick / 400).toBeLessThan(3);
  });
});
