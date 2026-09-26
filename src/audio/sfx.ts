import type { SfxId } from './api';
import { bell, crackle, noise, partials, tone, type Voice } from './synth';

/**
 * One-shot sound recipes. Each schedules its nodes into `v.out` starting at `v.t` and must peak below
 * -3 dBFS on its own (UI sounds well below). Verified by `window.__audioCheck()` on src/audio/dev.html.
 */
export type Recipe = (v: Voice) => void;

export interface SfxMeta {
  /** Routed to the dry UI bus (not positional, not ducked by pause). */
  ui: boolean;
  /** Base gain multiplier. */
  gain: number;
  /** Random pitch variation (±fraction) per play. */
  jitter: number;
  /** Minimum seconds between two plays of this id. */
  minGap: number;
  /** Maximum simultaneous voices of this id. */
  maxVoices: number;
  /** Reverb send amount (world sounds). */
  reverb: number;
}

const WORLD: SfxMeta = { ui: false, gain: 1, jitter: 0.04, minGap: 0.03, maxVoices: 4, reverb: 0.25 };
const UI: SfxMeta = { ui: true, gain: 1, jitter: 0, minGap: 0.03, maxVoices: 2, reverb: 0 };
const STINGER: SfxMeta = { ui: false, gain: 1, jitter: 0, minGap: 0.25, maxVoices: 1, reverb: 0.3 };

function meta(base: SfxMeta, over: Partial<SfxMeta> = {}): SfxMeta {
  return { ...base, ...over };
}

export const SFX_META: Record<SfxId, SfxMeta> = {
  grabHay: meta(WORLD, { jitter: 0.08, minGap: 0.06, maxVoices: 3, reverb: 0.15 }),
  shovel: meta(WORLD, { jitter: 0.07, minGap: 0.08, maxVoices: 3 }),
  bucket: meta(WORLD, { jitter: 0.06, minGap: 0.08, maxVoices: 3 }),
  pitchfork: meta(WORLD, { jitter: 0.07, minGap: 0.08, maxVoices: 3 }),
  dig: meta(WORLD, { jitter: 0.1, minGap: 0.06, maxVoices: 3, reverb: 0.15 }),
  full: meta(UI, { minGap: 0.5, maxVoices: 1 }),
  deposit: meta(WORLD, { jitter: 0.06, minGap: 0.1, maxVoices: 2 }),
  take: meta(WORLD, { jitter: 0.06, minGap: 0.1, maxVoices: 2 }),
  footstep: meta(WORLD, { jitter: 0.12, minGap: 0.12, maxVoices: 2, reverb: 0.12 }),
  jump: meta(WORLD, { jitter: 0.08, minGap: 0.2, maxVoices: 1, reverb: 0.1 }),
  land: meta(WORLD, { jitter: 0.08, minGap: 0.2, maxVoices: 1, reverb: 0.2 }),
  wheelbarrowGrab: meta(WORLD, { jitter: 0.05, minGap: 0.2, maxVoices: 1 }),
  wheelbarrowDump: meta(WORLD, { jitter: 0.05, minGap: 0.3, maxVoices: 1 }),

  sell: meta(WORLD, { jitter: 0.015, minGap: 0.12, maxVoices: 3 }),
  sellBig: meta(STINGER, { minGap: 0.3, maxVoices: 2 }),
  buy: meta(UI, { minGap: 0.1 }),
  unlock: meta(UI, { minGap: 0.15 }),
  deny: meta(UI, { minGap: 0.15, maxVoices: 1 }),
  orderComplete: meta(STINGER),
  milestone: meta(STINGER),
  wp: meta(STINGER, { minGap: 0.15, maxVoices: 2 }),

  place: meta(WORLD, { jitter: 0.05, minGap: 0.06, maxVoices: 3 }),
  placeBelt: meta(WORLD, { jitter: 0.08, minGap: 0.04, maxVoices: 4 }),
  remove: meta(WORLD, { jitter: 0.05, minGap: 0.08, maxVoices: 2 }),
  rotate: meta(UI, { minGap: 0.05 }),
  invalid: meta(UI, { minGap: 0.25, maxVoices: 1 }),
  modeCycle: meta(UI, { minGap: 0.08 }),

  rakeThunk: meta(WORLD, { jitter: 0.06, minGap: 0.1, maxVoices: 3, reverb: 0.3 }),
  armServo: meta(WORLD, { jitter: 0.05, minGap: 0.1, maxVoices: 3 }),
  armDrop: meta(WORLD, { jitter: 0.06, minGap: 0.1, maxVoices: 3 }),
  compressorPress: meta(WORLD, { jitter: 0.04, minGap: 0.15, maxVoices: 2, reverb: 0.3 }),
  wrapperDone: meta(WORLD, { jitter: 0.03, minGap: 0.15, maxVoices: 2 }),
  generatorFeed: meta(WORLD, { jitter: 0.05, minGap: 0.2, maxVoices: 2 }),
  splitterClick: meta(WORLD, { jitter: 0.08, minGap: 0.05, maxVoices: 3, reverb: 0.15 }),
  scannerBeep: meta(WORLD, { jitter: 0, minGap: 0.1, maxVoices: 2, reverb: 0.2 }),

  needleFound: meta(STINGER, { minGap: 1, reverb: 0.35 }),
  needleAlarm: meta(WORLD, { jitter: 0, minGap: 1, maxVoices: 1, reverb: 0.3 }),
  needleReturn: meta(WORLD, { jitter: 0, minGap: 0.5, maxVoices: 1, reverb: 0.3 }),
  needleGlint: meta(WORLD, { jitter: 0.03, minGap: 0.4, maxVoices: 2, reverb: 0.3 }),
  detectorBeep: meta(WORLD, { jitter: 0, minGap: 0.05, maxVoices: 2, reverb: 0.08 }),
  detectorTooDeep: meta(WORLD, { jitter: 0, minGap: 0.5, maxVoices: 1, reverb: 0.1 }),

  uiClick: meta(UI),
  uiHover: meta(UI, { minGap: 0.04 }),
  uiOpen: meta(UI, { minGap: 0.1, maxVoices: 1 }),
  uiClose: meta(UI, { minGap: 0.1, maxVoices: 1 }),
  toast: meta(UI, { minGap: 0.15 }),
  complete: meta(STINGER, { minGap: 2, reverb: 0.35 }),
  powerDown: meta(WORLD, { jitter: 0.03, minGap: 0.15, maxVoices: 2 }),
};

// ---------------------------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------------------------

/** Dry straw rustle: granular crackle plus a soft noise bed. */
function rustle(v: Voice, t: number, dur: number, peak: number, f = 2600): void {
  crackle(v, { t, dur, count: Math.max(4, Math.round(dur * 55)), peak, f, spread: 0.6, q: 0.9, grain: 0.028 });
  noise(v, { t, a: 0.012, d: dur, peak: peak * 0.3, color: 'pink', filter: { type: 'bandpass', f: f * 0.7, q: 0.6 } });
}

function thump(v: Voice, t: number, f: number, peak: number, d = 0.18): void {
  tone(v, { t, f, f1: f * 0.45, slide: d * 0.6, a: 0.003, d, peak });
}

function click(v: Voice, t: number, f: number, peak: number, d = 0.018, q = 3): void {
  noise(v, { t, a: 0.001, d, peak, filter: { type: 'bandpass', f, q } });
}

const METAL = [1, 1.47, 2.09, 2.76, 3.63] as const;

function clank(v: Voice, t: number, f: number, peak: number, d = 0.28): void {
  partials(v, { t, f, ratios: METAL, d, peak });
}

/** Ascending FM chime arpeggio. */
function arpeggio(v: Voice, t: number, freqs: readonly number[], step: number, peak: number, d: number, ratio = 2, index = 0.8): void {
  for (let i = 0; i < freqs.length; i++) bell(v, { t: t + i * step, f: freqs[i], ratio, index, d, peak });
}

/** Soft brass-like chord stab for the fanfares (two detuned saws through an opening filter). */
function brass(v: Voice, t: number, freqs: readonly number[], len: number, peak: number): void {
  for (const f of freqs) {
    for (const det of [-6, 6]) {
      tone(v, {
        t, type: 'sawtooth', f, detune: det, a: 0.03, h: len, d: 0.28, peak,
        filter: { type: 'lowpass', f: 700, f1: 2600, slide: 0.08, q: 0 },
      });
    }
  }
}

/** Tinkling high sparkle (narrow resonant noise grains). */
function shimmer(v: Voice, t: number, dur: number, peak: number, f = 6000): void {
  crackle(v, { t, dur, count: Math.round(dur * 22), peak, f, spread: 0.45, q: 12, color: 'white', grain: 0.09 });
}

// ---------------------------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------------------------

export const SFX: Record<SfxId, Recipe> = {
  // ----- player / tools
  grabHay: (v) => {
    rustle(v, 0, 0.2, 0.42, 2400);
    noise(v, { a: 0.01, d: 0.12, peak: 0.12, color: 'pink', filter: { type: 'lowpass', f: 450 } });
  },
  shovel: (v) => {
    noise(v, { a: 0.01, h: 0.04, d: 0.14, peak: 0.2, color: 'pink', filter: { type: 'bandpass', f: 1800, f1: 650, q: 2 } });
    rustle(v, 0.04, 0.26, 0.36, 2100);
    thump(v, 0.02, 140, 0.32, 0.16);
  },
  bucket: (v) => {
    rustle(v, 0, 0.18, 0.3, 2800);
    partials(v, { t: 0.05, f: 410, ratios: [1, 2.03, 3.1], amps: [1, 0.5, 0.3], d: 0.35, peak: 0.2 });
    click(v, 0.05, 900, 0.18, 0.08, 6);
  },
  pitchfork: (v) => {
    noise(v, { a: 0.05, d: 0.16, peak: 0.2, filter: { type: 'bandpass', f: 900, f1: 3200, q: 1.2 } });
    partials(v, { t: 0.08, f: 2350, ratios: [1, 1.58, 2.3], d: 0.25, peak: 0.07 });
    rustle(v, 0.06, 0.22, 0.38, 3000);
  },
  dig: (v) => {
    rustle(v, 0, 0.16, 0.3, 2200);
  },
  full: (v) => {
    tone(v, { type: 'triangle', f: 392, a: 0.005, d: 0.12, peak: 0.16, filter: { type: 'lowpass', f: 1500 } });
    tone(v, { type: 'triangle', t: 0.11, f: 294, a: 0.005, d: 0.2, peak: 0.16, filter: { type: 'lowpass', f: 1200 } });
  },
  deposit: (v) => {
    rustle(v, 0, 0.35, 0.36, 1900);
    thump(v, 0.05, 110, 0.28, 0.2);
    noise(v, { a: 0.02, d: 0.3, peak: 0.16, color: 'pink', filter: { type: 'lowpass', f: 500 } });
  },
  take: (v) => {
    rustle(v, 0, 0.25, 0.32, 2600);
    noise(v, { a: 0.06, d: 0.15, peak: 0.13, color: 'pink', filter: { type: 'bandpass', f: 700, f1: 2200, q: 1 } });
  },
  footstep: (v) => {
    noise(v, { a: 0.002, d: 0.07, peak: 0.26, color: 'pink', filter: { type: 'lowpass', f: 700 + v.rnd() * 500 } });
    tone(v, { f: 85, f1: 55, a: 0.002, d: 0.08, peak: 0.18 });
    crackle(v, { dur: 0.06, count: 3, peak: 0.1, f: 3000, spread: 0.4 });
  },
  jump: (v) => {
    noise(v, { a: 0.04, d: 0.12, peak: 0.15, color: 'pink', filter: { type: 'bandpass', f: 500, f1: 1400, q: 0.8 } });
    crackle(v, { dur: 0.1, count: 4, peak: 0.07, f: 1500 });
  },
  land: (v) => {
    thump(v, 0, 95, 0.42, 0.2);
    noise(v, { a: 0.003, d: 0.12, peak: 0.24, color: 'pink', filter: { type: 'lowpass', f: 600 } });
    crackle(v, { dur: 0.12, count: 6, peak: 0.13, f: 2500 });
  },
  wheelbarrowGrab: (v) => {
    clank(v, 0, 620, 0.2, 0.3);
    tone(v, { t: 0.06, type: 'sawtooth', f: 950, f1: 1400, slide: 0.12, a: 0.02, h: 0.04, d: 0.1, peak: 0.09, filter: { type: 'bandpass', f: 1200, q: 4 } });
    click(v, 0, 1500, 0.14, 0.05);
  },
  wheelbarrowDump: (v) => {
    clank(v, 0, 560, 0.17, 0.3);
    tone(v, { t: 0.05, type: 'sawtooth', f: 1300, f1: 900, slide: 0.15, a: 0.02, h: 0.05, d: 0.1, peak: 0.08, filter: { type: 'bandpass', f: 1100, q: 4 } });
    rustle(v, 0.12, 0.55, 0.38, 1800);
    thump(v, 0.35, 90, 0.28, 0.25);
    noise(v, { t: 0.15, a: 0.1, d: 0.5, peak: 0.16, color: 'pink', filter: { type: 'lowpass', f: 400 } });
  },

  // ----- economy / progression
  sell: (v) => {
    click(v, 0, 5500, 0.18, 0.06, 1.5);
    click(v, 0.045, 4200, 0.13, 0.08, 1.5);
    bell(v, { t: 0.07, f: 1568, ratio: 3.01, index: 1.6, d: 0.9, peak: 0.2 });
    bell(v, { t: 0.09, f: 2637, ratio: 2.4, index: 0.9, d: 0.7, peak: 0.12 });
    partials(v, { t: 0.07, f: 3520, ratios: [1, 1.33], d: 0.12, peak: 0.05 });
  },
  sellBig: (v) => {
    click(v, 0, 5200, 0.18, 0.06, 1.5);
    click(v, 0.05, 4000, 0.14, 0.08, 1.5);
    thump(v, 0.02, 160, 0.16, 0.12);
    bell(v, { t: 0.06, f: 1568, ratio: 3.01, index: 1.6, d: 1.0, peak: 0.16 });
    bell(v, { t: 0.14, f: 2093, ratio: 3.01, index: 1.4, d: 1.0, peak: 0.14 });
    bell(v, { t: 0.22, f: 2637, ratio: 2.4, index: 1.0, d: 1.1, peak: 0.13 });
    shimmer(v, 0.25, 0.55, 0.1, 4200);
    noise(v, { t: 0.2, a: 0.1, d: 0.6, peak: 0.035, filter: { type: 'highpass', f: 7000 } });
  },
  buy: (v) => {
    click(v, 0, 2500, 0.13, 0.03, 2);
    thump(v, 0, 180, 0.15, 0.09);
    tone(v, { t: 0.05, type: 'triangle', f: 659, a: 0.004, d: 0.25, peak: 0.11 });
    tone(v, { t: 0.12, type: 'triangle', f: 988, a: 0.004, d: 0.4, peak: 0.11 });
  },
  unlock: (v) => {
    tone(v, { f: 400, f1: 1200, slide: 0.3, a: 0.05, d: 0.35, peak: 0.05 });
    arpeggio(v, 0, [523, 659, 784, 1047], 0.06, 0.09, 0.65);
    shimmer(v, 0.15, 0.5, 0.05);
  },
  deny: (v) => {
    tone(v, { type: 'square', f: 233, f1: 207, slide: 0.1, a: 0.005, h: 0.05, d: 0.08, peak: 0.1, filter: { type: 'lowpass', f: 900 } });
    tone(v, { t: 0.11, type: 'square', f: 175, a: 0.005, h: 0.06, d: 0.12, peak: 0.1, filter: { type: 'lowpass', f: 700 } });
  },
  orderComplete: (v) => {
    const notes = [392, 494, 587] as const;
    for (let i = 0; i < notes.length; i++) tone(v, { t: i * 0.08, type: 'triangle', f: notes[i], a: 0.005, d: 0.3, peak: 0.13 });
    bell(v, { t: 0.26, f: 784, ratio: 2, index: 0.6, d: 0.9, peak: 0.15 });
    for (const f of notes) tone(v, { t: 0.26, type: 'triangle', f, a: 0.05, h: 0.2, d: 0.5, peak: 0.045 });
    bell(v, { t: 0.3, f: 2637, ratio: 2.4, index: 0.8, d: 0.6, peak: 0.07 });
  },
  milestone: (v) => {
    arpeggio(v, 0, [523, 659, 784, 1047, 1319], 0.07, 0.1, 0.5);
    for (const f of [262, 330, 392, 523]) {
      tone(v, { t: 0.3, type: 'sawtooth', f, a: 0.15, h: 0.3, d: 0.8, peak: 0.04, filter: { type: 'lowpass', f: 1800 } });
    }
    thump(v, 0.3, 98, 0.24, 0.6);
    shimmer(v, 0.35, 0.8, 0.06);
  },
  wp: (v) => {
    bell(v, { f: 1760, ratio: 2, index: 0.6, d: 0.5, peak: 0.11 });
    bell(v, { t: 0.07, f: 2637, ratio: 2, index: 0.5, d: 0.6, peak: 0.09 });
    noise(v, { a: 0.02, d: 0.25, peak: 0.025, filter: { type: 'highpass', f: 8000 } });
  },

  // ----- build
  place: (v) => {
    thump(v, 0, 130, 0.38, 0.22);
    clank(v, 0.01, 480, 0.15, 0.25);
    click(v, 0.08, 3200, 0.16, 0.02);
    click(v, 0.13, 3000, 0.14, 0.02);
    noise(v, { a: 0.01, d: 0.25, peak: 0.08, color: 'pink', filter: { type: 'lowpass', f: 900 } });
  },
  placeBelt: (v) => {
    click(v, 0, 2800, 0.2, 0.025, 2.5);
    click(v, 0.07, 2600, 0.17, 0.025, 2.5);
    thump(v, 0, 180, 0.16, 0.08);
    partials(v, { t: 0.02, f: 900, ratios: [1, 1.6, 2.4], d: 0.12, peak: 0.06 });
  },
  remove: (v) => {
    tone(v, { f: 520, f1: 140, slide: 0.25, a: 0.01, d: 0.3, peak: 0.12, filter: { type: 'lowpass', f: 2000 } });
    for (let i = 0; i < 3; i++) click(v, i * 0.05, 3400, 0.13, 0.018);
    clank(v, 0.15, 700, 0.11, 0.2);
    thump(v, 0.2, 110, 0.22, 0.15);
  },
  rotate: (v) => {
    for (let i = 0; i < 3; i++) click(v, i * 0.03, 3800, 0.1, 0.012, 4);
    tone(v, { type: 'triangle', f: 1200, a: 0.002, d: 0.05, peak: 0.03 });
  },
  invalid: (v) => {
    tone(v, { type: 'sawtooth', f: 110, a: 0.01, h: 0.12, d: 0.08, peak: 0.09, filter: { type: 'lowpass', f: 600 } });
    tone(v, { type: 'sawtooth', f: 116.5, a: 0.01, h: 0.12, d: 0.08, peak: 0.09, filter: { type: 'lowpass', f: 600 } });
  },
  modeCycle: (v) => {
    tone(v, { type: 'triangle', f: 880, a: 0.002, d: 0.06, peak: 0.1 });
    tone(v, { t: 0.06, type: 'triangle', f: 1175, a: 0.002, d: 0.08, peak: 0.1 });
    click(v, 0, 4000, 0.05, 0.01);
  },

  // ----- machines
  rakeThunk: (v) => {
    noise(v, { a: 0.02, h: 0.1, d: 0.25, peak: 0.14, filter: { type: 'bandpass', f: 4000, q: 0.6 } });
    thump(v, 0.08, 85, 0.4, 0.25);
    clank(v, 0.08, 300, 0.13, 0.3);
    crackle(v, { t: 0.1, dur: 0.2, count: 10, peak: 0.14, f: 2000 });
  },
  armServo: (v) => {
    tone(v, { type: 'sawtooth', f: 520, f1: 860, slide: 0.2, a: 0.03, h: 0.15, d: 0.1, peak: 0.09, filter: { type: 'bandpass', f: 1100, q: 3 } });
    tone(v, { type: 'square', f: 260, f1: 430, slide: 0.2, a: 0.03, h: 0.15, d: 0.1, peak: 0.035, filter: { type: 'lowpass', f: 800 } });
    noise(v, { a: 0.03, h: 0.15, d: 0.08, peak: 0.05, filter: { type: 'bandpass', f: 1600, q: 4 } });
  },
  armDrop: (v) => {
    noise(v, { a: 0.005, d: 0.15, peak: 0.12, filter: { type: 'highpass', f: 3000 } });
    partials(v, { f: 750, ratios: [1, 1.5, 2.3], d: 0.15, peak: 0.11 });
    noise(v, { t: 0.08, a: 0.01, d: 0.2, peak: 0.2, color: 'pink', filter: { type: 'lowpass', f: 700 } });
    crackle(v, { t: 0.08, dur: 0.2, count: 10, peak: 0.2, f: 1800 });
  },
  compressorPress: (v) => {
    tone(v, { type: 'sawtooth', f: 70, f1: 150, slide: 0.4, a: 0.05, h: 0.3, d: 0.05, peak: 0.13, filter: { type: 'lowpass', f: 400, f1: 900, slide: 0.4 } });
    thump(v, 0.38, 70, 0.42, 0.35);
    clank(v, 0.38, 220, 0.13, 0.4);
    noise(v, { t: 0.45, a: 0.01, d: 0.35, peak: 0.1, filter: { type: 'highpass', f: 3000 } });
    crackle(v, { t: 0.4, dur: 0.15, count: 7, peak: 0.09, f: 1200 });
  },
  wrapperDone: (v) => {
    noise(v, { a: 0.01, h: 0.12, d: 0.05, peak: 0.14, filter: { type: 'bandpass', f: 1200, f1: 3500, slide: 0.17, q: 4 } });
    crackle(v, { t: 0.15, dur: 0.08, count: 8, peak: 0.16, f: 4500, color: 'white' });
    bell(v, { t: 0.22, f: 1319, ratio: 2, index: 0.6, d: 0.6, peak: 0.13 });
  },
  generatorFeed: (v) => {
    clank(v, 0, 360, 0.15, 0.35);
    noise(v, { t: 0.05, a: 0.15, h: 0.1, d: 0.5, peak: 0.2, color: 'pink', filter: { type: 'lowpass', f: 900, f1: 2200, slide: 0.25 } });
    crackle(v, { t: 0.1, dur: 0.6, count: 14, peak: 0.15, f: 3500, spread: 0.8, q: 0.7, color: 'white' });
    tone(v, { t: 0.05, f: 55, a: 0.1, d: 0.5, peak: 0.14 });
  },
  splitterClick: (v) => {
    click(v, 0, 2500, 0.18, 0.012);
    click(v, 0.035, 2300, 0.15, 0.012);
    partials(v, { f: 1400, ratios: [1, 2.1], d: 0.06, peak: 0.05 });
  },
  scannerBeep: (v) => {
    tone(v, { f: 1568, a: 0.004, h: 0.04, d: 0.06, peak: 0.15 });
    tone(v, { t: 0.075, f: 2093, a: 0.004, h: 0.03, d: 0.06, peak: 0.11 });
  },

  // ----- needles
  needleFound: (v) => {
    tone(v, { f: 60, f1: 90, slide: 0.4, a: 0.2, h: 0.1, d: 0.8, peak: 0.16 });
    arpeggio(v, 0, [523, 659, 784, 1047, 1319, 1568], 0.075, 0.1, 1.2, 2, 0.7);
    bell(v, { t: 0.45, f: 2093, ratio: 2, index: 0.5, d: 1.5, peak: 0.09 });
    for (const f of [523, 659, 784, 1047]) {
      tone(v, { t: 0.4, type: 'triangle', f, a: 0.25, h: 0.5, d: 1.2, peak: 0.035, vib: [5, 6], filter: { type: 'lowpass', f: 3000 } });
    }
    shimmer(v, 0.3, 1.6, 0.07);
    noise(v, { a: 0.4, d: 0.5, peak: 0.035, filter: { type: 'bandpass', f: 2000, f1: 8000, slide: 0.6, q: 1 } });
  },
  needleAlarm: (v) => {
    for (let i = 0; i < 8; i++) {
      const f = i % 2 === 0 ? 659 : 880;
      tone(v, { t: i * 0.15, type: 'triangle', f, a: 0.015, h: 0.09, d: 0.05, peak: 0.19, filter: { type: 'lowpass', f: 2200 } });
      tone(v, { t: i * 0.15, f: f / 2, a: 0.015, h: 0.09, d: 0.05, peak: 0.06 });
    }
  },
  needleReturn: (v) => {
    noise(v, { a: 0.15, d: 0.2, peak: 0.11, color: 'pink', filter: { type: 'bandpass', f: 600, f1: 2500, slide: 0.3, q: 1 } });
    const notes = [1568, 1175, 880] as const;
    for (let i = 0; i < notes.length; i++) bell(v, { t: 0.15 + i * 0.12, f: notes[i], ratio: 2, index: 0.6, d: 0.5, peak: 0.1 });
    crackle(v, { t: 0.5, dur: 0.2, count: 9, peak: 0.18, f: 1800 });
    thump(v, 0.5, 120, 0.14, 0.12);
  },
  needleGlint: (v) => {
    bell(v, { f: 3136, ratio: 2.5, index: 0.5, d: 0.35, peak: 0.085 });
    bell(v, { t: 0.05, f: 4699, ratio: 2, index: 0.4, d: 0.25, peak: 0.05 });
    noise(v, { a: 0.01, d: 0.12, peak: 0.015, filter: { type: 'highpass', f: 9000 } });
  },
  detectorBeep: (v) => {
    tone(v, { f: 900, a: 0.003, h: 0.035, d: 0.05, peak: 0.21 });
    tone(v, { f: 1800, a: 0.003, h: 0.035, d: 0.04, peak: 0.035 });
  },
  detectorTooDeep: (v) => {
    tone(v, { f: 330, f1: 262, slide: 0.25, vib: [7, 30], a: 0.02, h: 0.1, d: 0.15, peak: 0.13, filter: { type: 'lowpass', f: 1200 } });
    tone(v, { type: 'triangle', f: 165, f1: 131, slide: 0.25, a: 0.02, h: 0.1, d: 0.15, peak: 0.05 });
  },

  // ----- UI / flow
  uiClick: (v) => {
    tone(v, { f: 1300, f1: 900, slide: 0.03, a: 0.001, d: 0.04, peak: 0.11 });
    click(v, 0, 5000, 0.045, 0.008, 2);
  },
  uiHover: (v) => {
    tone(v, { f: 2200, a: 0.002, d: 0.025, peak: 0.04 });
  },
  uiOpen: (v) => {
    noise(v, { a: 0.05, d: 0.1, peak: 0.05, color: 'pink', filter: { type: 'bandpass', f: 800, f1: 2400, q: 1 } });
    tone(v, { t: 0.02, type: 'triangle', f: 784, a: 0.004, d: 0.12, peak: 0.08 });
    tone(v, { t: 0.07, type: 'triangle', f: 1175, a: 0.004, d: 0.18, peak: 0.08 });
  },
  uiClose: (v) => {
    noise(v, { a: 0.03, d: 0.1, peak: 0.045, color: 'pink', filter: { type: 'bandpass', f: 2400, f1: 800, q: 1 } });
    tone(v, { type: 'triangle', f: 1175, a: 0.004, d: 0.1, peak: 0.07 });
    tone(v, { t: 0.05, type: 'triangle', f: 784, a: 0.004, d: 0.15, peak: 0.07 });
  },
  toast: (v) => {
    tone(v, { f: 1047, a: 0.003, d: 0.15, peak: 0.09 });
    tone(v, { t: 0.07, f: 1568, a: 0.003, d: 0.3, peak: 0.08 });
  },
  complete: (v) => {
    const d = [294, 370, 440] as const;
    for (let i = 0; i < 3; i++) {
      brass(v, i * 0.14, d, 0.07, 0.022);
      tone(v, { t: i * 0.14, f: 73, a: 0.003, d: 0.2, peak: 0.08 });
    }
    brass(v, 0.42, [392, 494, 587, 784], 0.75, 0.024);
    tone(v, { t: 0.42, f: 98, f1: 90, slide: 0.5, a: 0.003, d: 0.8, peak: 0.18 });
    noise(v, { t: 0.42, a: 0.02, d: 1.2, peak: 0.05, filter: { type: 'highpass', f: 5000 } });
    bell(v, { t: 0.5, f: 1568, ratio: 2, index: 0.6, d: 1.0, peak: 0.07 });
    bell(v, { t: 0.62, f: 2349, ratio: 2, index: 0.5, d: 1.0, peak: 0.055 });
    shimmer(v, 0.6, 1.1, 0.05);
  },
  powerDown: (v) => {
    tone(v, { type: 'sawtooth', f: 320, f1: 55, slide: 0.5, a: 0.01, h: 0.05, d: 0.5, peak: 0.13, filter: { type: 'lowpass', f: 1500, f1: 300, slide: 0.5 } });
    click(v, 0, 2000, 0.14, 0.02);
    partials(v, { f: 400, ratios: [1, 1.6], d: 0.1, peak: 0.07 });
  },
};

export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** Distant outdoor bird call (ambience), 2-5 quick syllables. */
export function birdChirp(v: Voice, pan: number): void {
  const syll = 2 + Math.floor(v.rnd() * 4);
  const base = 2600 + v.rnd() * 1400;
  const up = v.rnd() < 0.5;
  let t = 0;
  for (let i = 0; i < syll; i++) {
    const f = base * (1 + (v.rnd() - 0.5) * 0.15);
    tone(v, { t, f: up ? f : f * 1.35, f1: up ? f * 1.35 : f, slide: 0.05, a: 0.004, h: 0.02, d: 0.05, peak: 0.028 * (0.6 + 0.4 * v.rnd()), pan });
    t += 0.07 + v.rnd() * 0.06;
  }
}
