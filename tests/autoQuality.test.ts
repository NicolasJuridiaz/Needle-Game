import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY_MIN_FPS, AUTO_QUALITY_WINDOW, AutoQuality } from '../src/game/autoQuality';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/game/settings';
import type { Quality } from '../src/render/quality';

/** Feeds `seconds` of frames at `fps`; returns the first switch requested (or null). */
function play(a: AutoQuality, fps: number, seconds: number, quality: Quality, manual = false, active = true): Quality | null {
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    const r = a.frame(dt, active, quality, manual);
    if (r) return r;
  }
  return null;
}

describe('AutoQuality (low-FPS failsafe)', () => {
  it('steps down one preset after a window of gameplay below the threshold', () => {
    const a = new AutoQuality();
    expect(play(a, 15, AUTO_QUALITY_WINDOW + 5, 'high')).toBe('medium');
    a.restart();
    expect(play(a, 15, AUTO_QUALITY_WINDOW + 5, 'medium')).toBe('low');
    a.restart();
    expect(play(a, 15, 120, 'low')).toBeNull();
  });

  it('keeps the preset at a smooth frame rate, and just above the threshold', () => {
    expect(play(new AutoQuality(), 60, 120, 'medium')).toBeNull();
    expect(play(new AutoQuality(), AUTO_QUALITY_MIN_FPS + 2, 120, 'high')).toBeNull();
  });

  it('never overrides a quality the player picked', () => {
    expect(play(new AutoQuality(), 10, 120, 'high', true)).toBeNull();
  });

  it('ignores menus, hidden tabs and huge frame gaps', () => {
    const a = new AutoQuality();
    expect(play(a, 10, 120, 'medium', false, false)).toBeNull();
    // one 5 s hitch (alt-tab) followed by smooth play: no switch
    expect(a.frame(5, true, 'medium', false)).toBeNull();
    expect(play(a, 60, 60, 'medium')).toBeNull();
  });

  it('does not decide before a full window of gameplay', () => {
    expect(play(new AutoQuality(), 10, AUTO_QUALITY_WINDOW - 1, 'medium')).toBeNull();
  });

  it('settings: new players are not "manual"; the flag survives sanitising', () => {
    expect(DEFAULT_SETTINGS.qualityManual).toBe(false);
    expect(sanitizeSettings({ quality: 'high', qualityManual: true }).qualityManual).toBe(true);
    expect(sanitizeSettings({ quality: 'high' }).qualityManual).toBe(false);
    expect(sanitizeSettings({ qualityManual: 'yes' as unknown as boolean }).qualityManual).toBe(false);
  });
});
