import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SaveManager, SETTINGS_KEY, type KeyValueStorage } from '../src/game/saveManager';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../src/game/settings';
import { PowerWires } from '../src/render/powerWires';
import {
  MIN_PIXEL_RATIO, QUALITIES, QUALITY_PROFILES, effectivePixelRatio, qualityProfile, type Quality,
} from '../src/render/quality';
import type { Building } from '../src/sim/building';

const [LOW, MEDIUM, HIGH] = [QUALITY_PROFILES.low, QUALITY_PROFILES.medium, QUALITY_PROFILES.high];

describe('Quality profiles', () => {
  it('high > medium > low on every budget that costs GPU time', () => {
    const budgets = ['pixelRatio', 'maxPixels', 'shadowMapSize', 'lamps', 'tufts', 'particles', 'wireSegments', 'anisotropy'] as const;
    for (const k of budgets) {
      expect(HIGH[k], k).toBeGreaterThan(MEDIUM[k]);
      expect(MEDIUM[k], k).toBeGreaterThan(LOW[k]);
    }
    expect(HIGH.motes).toBeGreaterThan(MEDIUM.motes);
    expect(LOW.motes).toBe(0);
    expect(HIGH.floorTexture).toBeGreaterThanOrEqual(MEDIUM.floorTexture);
    expect(MEDIUM.floorTexture).toBeGreaterThan(LOW.floorTexture);
  });

  it('shadows: soft 2048 on high, 1024 on medium, off on low; belt items only cast on high', () => {
    expect([HIGH.shadows, MEDIUM.shadows, LOW.shadows]).toEqual([true, true, false]);
    expect([HIGH.shadowMapSize, MEDIUM.shadowMapSize]).toEqual([2048, 1024]);
    expect([HIGH.itemShadows, MEDIUM.itemShadows, LOW.itemShadows]).toEqual([true, false, false]);
  });

  it('MSAA and effects only where they are affordable', () => {
    expect([HIGH.antialias, MEDIUM.antialias, LOW.antialias]).toEqual([true, false, false]);
    expect([HIGH.lightShafts, MEDIUM.lightShafts, LOW.lightShafts]).toEqual([true, true, false]);
  });

  it('tuft density never exceeds the per-cell slots', () => {
    for (const q of QUALITIES) {
      const p = qualityProfile(q);
      expect(p.tuftDensity).toBeLessThanOrEqual(p.tuftsPerCell);
    }
  });

  it('unknown quality falls back to medium', () => {
    expect(qualityProfile('ultra' as Quality)).toBe(MEDIUM);
  });
});

describe('effectivePixelRatio', () => {
  it('caps devicePixelRatio per preset (no unbounded Retina cost)', () => {
    for (const dpr of [2, 3, 4]) {
      expect(effectivePixelRatio(dpr, 1280, 720, HIGH)).toBe(2);
      expect(effectivePixelRatio(dpr, 1280, 720, MEDIUM)).toBe(1.5);
      expect(effectivePixelRatio(dpr, 1280, 720, LOW)).toBe(1);
    }
  });

  it('keeps low-DPR screens and odd scaling factors untouched', () => {
    expect(effectivePixelRatio(1, 1920, 1080, HIGH)).toBe(1);
    expect(effectivePixelRatio(1.25, 1536, 864, MEDIUM)).toBe(1.25);
    expect(effectivePixelRatio(0.9, 1280, 720, LOW)).toBe(0.9);
  });

  it('limits the drawing buffer of very large windows to the preset budget', () => {
    for (const q of QUALITIES) {
      const prof = qualityProfile(q);
      for (const [w, h, dpr] of [[3840, 2160, 1], [2560, 1440, 1.5], [1920, 1080, 2], [5120, 1440, 1], [1440, 900, 2]] as const) {
        const pr = effectivePixelRatio(dpr, w, h, prof);
        expect(pr).toBeLessThanOrEqual(Math.min(dpr, prof.pixelRatio));
        if (pr > MIN_PIXEL_RATIO) expect(w * pr * h * pr).toBeLessThanOrEqual(prof.maxPixels + 1);
      }
    }
    // 4K fullscreen: high renders native, medium ~1440p, low ~1080p.
    expect(effectivePixelRatio(1, 3840, 2160, HIGH)).toBe(1);
    expect(effectivePixelRatio(1, 3840, 2160, MEDIUM)).toBe(0.65);
    expect(effectivePixelRatio(1, 3840, 2160, LOW)).toBe(0.5);
    // 1080p CSS on a DPR 2 screen: medium drops below its 1.5 cap to stay within 2560×1440 worth of pixels.
    expect(effectivePixelRatio(2, 1920, 1080, MEDIUM)).toBe(1.3);
  });

  it('never goes below the floor and tolerates bad input', () => {
    expect(effectivePixelRatio(1, 7680, 4320, LOW)).toBe(MIN_PIXEL_RATIO);
    expect(effectivePixelRatio(Number.NaN, 800, 600, HIGH)).toBe(1);
    expect(effectivePixelRatio(0, 800, 600, HIGH)).toBe(1);
    expect(effectivePixelRatio(2, 0, 0, HIGH)).toBe(2);
    expect(effectivePixelRatio(2, Number.NaN, 600, MEDIUM)).toBe(1.5);
  });
});

describe('Quality setting', () => {
  class MemStore implements KeyValueStorage {
    readonly map = new Map<string, string>();
    getJSON<T>(k: string): T | null { const v = this.map.get(k); return v === undefined ? null : (JSON.parse(v) as T); }
    setJSON(k: string, v: unknown): boolean { this.map.set(k, JSON.stringify(v)); return true; }
    remove(k: string): void { this.map.delete(k); }
  }

  it("new players start on 'medium'", () => {
    expect(DEFAULT_SETTINGS.quality).toBe('medium');
    expect(sanitizeSettings(null).quality).toBe('medium');
    expect(new SaveManager(new MemStore()).loadSettings().quality).toBe('medium');
  });

  it('a stored choice is kept (including an old default of high)', () => {
    for (const q of QUALITIES) {
      const store = new MemStore();
      store.setJSON(SETTINGS_KEY, { ...DEFAULT_SETTINGS, quality: q, fov: 90 });
      const s = new SaveManager(store).loadSettings();
      expect(s.quality).toBe(q);
      expect(s.fov).toBe(90);
    }
    // Settings saved before the quality field existed get the default.
    expect(sanitizeSettings({ fov: 80 }).quality).toBe('medium');
  });

  it('invalid stored values fall back to the default', () => {
    expect(sanitizeSettings({ quality: 'ultra' as Settings['quality'] }).quality).toBe('medium');
  });
});

describe('PowerWires quality (live)', () => {
  const pole = (id: number, x: number, z: number) => ({
    id, type: 'powerPole', center: { x, y: 0, z }, def: { height: 6 }, cell: { x, z, level: 0 }, rot: 0,
  }) as unknown as Building;

  it('cable segments follow the preset and change without rebuilding the view', () => {
    const scene = new THREE.Scene();
    const buildings = new Map<number, Building>([[1, pole(1, 0, 0)], [2, pole(2, 10, 0)], [3, pole(3, 10, 12)]]);
    const wires = [{ a: 1, b: 2 }, { a: 2, b: 3 }];
    const w = new PowerWires(scene, 'high');
    const cables = () => scene.getObjectByName('powerCables') as THREE.LineSegments;
    w.sync(wires, [], buildings);
    expect(cables().geometry.drawRange.count).toBe(2 * HIGH.wireSegments * 2);
    for (const q of ['low', 'medium', 'high'] as const) {
      w.setQuality(q);
      w.sync(wires, [], buildings);
      expect(w.segmentsPerCable).toBe(QUALITY_PROFILES[q].wireSegments);
      expect(cables().geometry.drawRange.count).toBe(2 * QUALITY_PROFILES[q].wireSegments * 2);
    }
    w.dispose();
  });
});
