import type { LoopId } from './api';
import { birdChirp } from './sfx';
import { crackle, drone, hiss, lfo, makeVoice, mulberry32, noise, noiseBank, partials, tone, type Voice } from './synth';

/**
 * Continuous loops. Machine / tool loops are rendered once through an OfflineAudioContext into a seamless
 * mono AudioBuffer (cheap to play many times: 1 buffer source per instance). The ambience is a small live
 * graph so its wind / birds never repeat audibly.
 */
export interface LoopVoice {
  setIntensity(i: number, t: number): void;
  stop(t: number): void;
  /** Called every engine update while the loop is active (scheduled events). */
  tick?(now: number): void;
}

export interface BufferLoopDef {
  kind: 'buffer';
  /** Loop length (s). Periodic events must divide it. */
  len: number;
  /** Gain at intensity 0 / 1. */
  gain: readonly [number, number];
  /** Playback rate at intensity 0 / 1 (pitch + speed). */
  rate: readonly [number, number];
  reverb: number;
  /** Schedules the loop content over [0, dur) (dur = len + crossfade tail). */
  render(v: Voice, dur: number): void;
}

export interface LiveLoopDef {
  kind: 'live';
  reverb: number;
  create(ctx: BaseAudioContext, dest: AudioNode, t: number): LoopVoice;
}

export type LoopDef = BufferLoopDef | LiveLoopDef;

/** Sample rate of the rendered loop buffers (memory vs. bandwidth; content is mostly < 12 kHz). */
export const LOOP_SAMPLE_RATE = 32000;
const LOOP_XFADE = 0.25;

/** Repeats `fn(t)` at t0, t0+period, ... while t < dur (periodic events inside a loop render). */
function every(period: number, t0: number, dur: number, fn: (t: number) => void): void {
  for (let t = t0; t < dur; t += period) fn(t);
}

const belt: BufferLoopDef = {
  kind: 'buffer', len: 2, gain: [0.45, 0.85], rate: [0.82, 1.12], reverb: 0.2,
  render(v, dur) {
    hiss(v, { dur, color: 'brown', peak: 0.2, filter: { type: 'lowpass', f: 260, q: 0 } });
    crackle(v, { dur, period: 2 / 28, peak: 0.11, f: 2200, spread: 0.25, q: 2, color: 'white', grain: 0.02, fade: false });
    drone(v, { dur, f: 100, peak: 0.028 });
    drone(v, { dur, f: 200, peak: 0.014 });
    every(0.5, 0.1, dur, (t) => tone(v, { t, f: 90, f1: 60, a: 0.004, d: 0.09, peak: 0.06 }));
  },
};

const generator: BufferLoopDef = {
  kind: 'buffer', len: 4, gain: [0.5, 0.9], rate: [0.9, 1.05], reverb: 0.3,
  render(v, dur) {
    const rumble = hiss(v, { dur, color: 'brown', peak: 0.2, filter: { type: 'lowpass', f: 110, q: 0 } });
    lfo(v, rumble.gain, 2.5, 0.07, 0, dur);
    const fire = hiss(v, { dur, color: 'pink', peak: 0.06, filter: { type: 'bandpass', f: 500, q: 0.7 } });
    lfo(v, fire.gain, 0.5, 0.025, 0, dur);
    crackle(v, { dur, count: Math.round(dur * 6.5), peak: 0.12, f: 3200, spread: 0.9, q: 0.8, color: 'white', grain: 0.018, fade: false });
    drone(v, { dur, f: 52, peak: 0.06 });
  },
};

const scanner: BufferLoopDef = {
  kind: 'buffer', len: 2, gain: [0.4, 0.75], rate: [0.95, 1.02], reverb: 0.2,
  render(v, dur) {
    drone(v, { dur, f: 120, peak: 0.045 });
    drone(v, { dur, f: 240, peak: 0.028 });
    drone(v, { dur, type: 'triangle', f: 360, peak: 0.012, filter: { type: 'lowpass', f: 800 } });
    const whirr = hiss(v, { dur, peak: 0.02, filter: { type: 'bandpass', f: 1800, q: 6 } });
    lfo(v, whirr.gain, 4, 0.015, 0, dur);
    crackle(v, { dur, period: 1 / 12, peak: 0.03, f: 2500, spread: 0.2, q: 2, color: 'white', fade: false });
    every(2, 0.2, dur, (t) => {
      tone(v, { t, f: 1760, a: 0.004, h: 0.05, d: 0.08, peak: 0.075 });
      tone(v, { t: t + 0.1, f: 2349, a: 0.004, h: 0.04, d: 0.08, peak: 0.05 });
    });
  },
};

const collector: BufferLoopDef = {
  kind: 'buffer', len: 3, gain: [0.5, 0.9], rate: [0.9, 1.08], reverb: 0.25,
  render(v, dur) {
    const air = hiss(v, { dur, color: 'pink', peak: 0.17, filter: { type: 'bandpass', f: 700, q: 0.8 } });
    lfo(v, air.gain, 6, 0.03, 0, dur);
    hiss(v, { dur, peak: 0.035, filter: { type: 'highpass', f: 4000 } });
    drone(v, { dur, type: 'sawtooth', f: 185, peak: 0.04, filter: { type: 'lowpass', f: 700 } });
    drone(v, { dur, f: 370, peak: 0.02 });
    every(0.75, 0.2, dur, (t) => noise(v, { t, color: 'pink', a: 0.05, d: 0.2, peak: 0.06, filter: { type: 'lowpass', f: 400 } }));
  },
};

const arm: BufferLoopDef = {
  kind: 'buffer', len: 3, gain: [0.45, 0.8], rate: [0.9, 1.05], reverb: 0.2,
  render(v, dur) {
    drone(v, { dur, f: 90, peak: 0.025 });
    every(3, 0.2, dur, (t) => {
      tone(v, { t, type: 'sawtooth', f: 480, f1: 760, slide: 0.35, a: 0.05, h: 0.3, d: 0.1, peak: 0.07, filter: { type: 'bandpass', f: 900, q: 3 } });
      tone(v, { t, type: 'square', f: 240, f1: 380, slide: 0.35, a: 0.05, h: 0.3, d: 0.1, peak: 0.025, filter: { type: 'lowpass', f: 700 } });
      noise(v, { t, a: 0.05, h: 0.3, d: 0.08, peak: 0.025, filter: { type: 'bandpass', f: 1500, q: 5 } });
      noise(v, { t: t + 1.0, a: 0.001, d: 0.015, peak: 0.05, filter: { type: 'bandpass', f: 3000, q: 3 } });
      tone(v, { t: t + 1.4, type: 'sawtooth', f: 760, f1: 520, slide: 0.35, a: 0.05, h: 0.3, d: 0.1, peak: 0.07, filter: { type: 'bandpass', f: 900, q: 3 } });
      tone(v, { t: t + 1.4, type: 'square', f: 380, f1: 260, slide: 0.35, a: 0.05, h: 0.3, d: 0.1, peak: 0.025, filter: { type: 'lowpass', f: 700 } });
      noise(v, { t: t + 1.4, a: 0.05, h: 0.3, d: 0.08, peak: 0.025, filter: { type: 'bandpass', f: 1500, q: 5 } });
      noise(v, { t: t + 2.4, a: 0.001, d: 0.015, peak: 0.05, filter: { type: 'bandpass', f: 3000, q: 3 } });
    });
  },
};

const rake: BufferLoopDef = {
  kind: 'buffer', len: 4, gain: [0.5, 0.85], rate: [0.9, 1.05], reverb: 0.25,
  render(v, dur) {
    drone(v, { dur, type: 'sawtooth', f: 55, peak: 0.08, filter: { type: 'lowpass', f: 220, q: 0 } });
    drone(v, { dur, f: 110, peak: 0.028 });
    every(2, 0.3, dur, (t) => noise(v, { t, a: 0.3, h: 0.4, d: 0.4, peak: 0.065, filter: { type: 'bandpass', f: 3500, q: 0.6 } }));
    every(4, 1.1, dur, (t) => tone(v, { t, type: 'sawtooth', f: 140, f1: 120, slide: 0.2, a: 0.05, h: 0.1, d: 0.15, peak: 0.025, filter: { type: 'bandpass', f: 700, q: 8 } }));
  },
};

const vacuumTool: BufferLoopDef = {
  kind: 'buffer', len: 2, gain: [0.5, 0.8], rate: [0.92, 1.04], reverb: 0.1,
  render(v, dur) {
    const whine = drone(v, { dur, type: 'sawtooth', f: 410, peak: 0.045, filter: { type: 'bandpass', f: 820, q: 2 } });
    lfo(v, whine.gain, 11, 0.008, 0, dur);
    drone(v, { dur, f: 820, peak: 0.018 });
    hiss(v, { dur, color: 'pink', peak: 0.17, filter: { type: 'bandpass', f: 1300, q: 0.7 } });
    hiss(v, { dur, peak: 0.035, filter: { type: 'highpass', f: 5000 } });
    crackle(v, { dur, count: Math.round(dur * 15), peak: 0.08, f: 2500, spread: 0.6, fade: false });
  },
};

const compressor: BufferLoopDef = {
  kind: 'buffer', len: 3, gain: [0.5, 0.85], rate: [0.9, 1.05], reverb: 0.25,
  render(v, dur) {
    drone(v, { dur, type: 'sawtooth', f: 70, peak: 0.075, filter: { type: 'lowpass', f: 260, q: 0 } });
    every(0.75, 0.05, dur, (t) => {
      noise(v, { t, color: 'brown', a: 0.03, d: 0.25, peak: 0.1, filter: { type: 'lowpass', f: 300 } });
      noise(v, { t: t + 0.2, a: 0.02, d: 0.15, peak: 0.03, filter: { type: 'highpass', f: 3000 } });
    });
    every(3, 1.4, dur, (t) => tone(v, { t, type: 'sawtooth', f: 130, f1: 118, slide: 0.2, a: 0.05, h: 0.08, d: 0.15, peak: 0.02, filter: { type: 'bandpass', f: 650, q: 8 } }));
  },
};

const wrapper: BufferLoopDef = {
  kind: 'buffer', len: 2, gain: [0.45, 0.8], rate: [0.9, 1.06], reverb: 0.2,
  render(v, dur) {
    drone(v, { dur, f: 150, peak: 0.04 });
    drone(v, { dur, type: 'sawtooth', f: 150, peak: 0.028, filter: { type: 'lowpass', f: 500 } });
    const whoosh = hiss(v, { dur, color: 'pink', peak: 0.08, filter: { type: 'bandpass', f: 1000, q: 1.2 } });
    lfo(v, whoosh.gain, 2, 0.07, 0, dur);
    every(2, 0.6, dur, (t) => {
      tone(v, { t, type: 'sawtooth', f: 900, f1: 1200, slide: 0.12, a: 0.03, h: 0.08, d: 0.08, peak: 0.022, filter: { type: 'bandpass', f: 1100, q: 6 } });
      tone(v, { t: t + 1, type: 'sawtooth', f: 1000, f1: 1300, slide: 0.12, a: 0.03, h: 0.08, d: 0.08, peak: 0.022, filter: { type: 'bandpass', f: 1200, q: 6 } });
    });
  },
};

const lift: BufferLoopDef = {
  kind: 'buffer', len: 2, gain: [0.45, 0.8], rate: [0.9, 1.08], reverb: 0.2,
  render(v, dur) {
    drone(v, { dur, type: 'sawtooth', f: 90, peak: 0.055, filter: { type: 'lowpass', f: 300, q: 0 } });
    drone(v, { dur, f: 180, peak: 0.02 });
    crackle(v, { dur, period: 0.1, peak: 0.05, f: 2800, spread: 0.2, q: 2, color: 'white', fade: false });
    every(2, 1, dur, (t) => {
      tone(v, { t, f: 100, f1: 60, a: 0.004, d: 0.1, peak: 0.07 });
      partials(v, { t, f: 500, ratios: [1, 1.47, 2.09], d: 0.12, peak: 0.03 });
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Ambience (live)
// ---------------------------------------------------------------------------------------------

const BIRD_MIN_GAP = 3.5;
const BIRD_MAX_GAP = 11;

/** Warehouse room tone + air handling + faint wind and birds from outside. */
class AmbienceVoice implements LoopVoice {
  private readonly out: GainNode;
  private readonly birds: GainNode;
  private readonly v: Voice;
  private readonly birdVoice: Voice;
  private nextBird: number;
  private stopped = false;

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode, t: number) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
    const rnd = Math.random;
    this.v = makeVoice(ctx, this.out, t, 1, rnd);
    const long = 1e6;
    const room = hiss(this.v, { dur: long, color: 'brown', peak: 0.075, filter: { type: 'lowpass', f: 200, q: 0 } });
    lfo(this.v, room.gain, 0.05, 0.01, 0, long);
    hiss(this.v, { dur: long, color: 'pink', peak: 0.018, filter: { type: 'bandpass', f: 260, q: 0.5 } });
    const wind = hiss(this.v, { dur: long, color: 'pink', peak: 0.02, filter: { type: 'bandpass', f: 600, q: 0.8 } });
    lfo(this.v, wind.gain, 0.11, 0.014, 0, long);
    drone(this.v, { dur: long, f: 120, peak: 0.004 });
    // Birds: a quiet, dull bus (heard through the big door / skylights).
    const birdLp = ctx.createBiquadFilter();
    birdLp.type = 'lowpass';
    birdLp.frequency.value = 5000;
    this.birds = ctx.createGain();
    this.birds.gain.value = 1;
    this.birds.connect(birdLp);
    birdLp.connect(this.out);
    this.birdVoice = makeVoice(ctx, this.birds, t, 1, rnd);
    this.nextBird = t + 2 + rnd() * 4;
  }

  setIntensity(i: number, t: number): void {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, i)), t, 0.2);
  }

  tick(now: number): void {
    if (this.stopped || now < this.nextBird) return;
    const bv = this.birdVoice;
    bv.t = now + 0.05;
    bv.end = bv.t;
    bv.sources.length = 0;
    birdChirp(bv, (bv.rnd() * 2 - 1) * 0.7);
    // Sometimes a second bird answers.
    if (bv.rnd() < 0.35) {
      bv.t = bv.end + 0.3 + bv.rnd() * 0.6;
      birdChirp(bv, (bv.rnd() * 2 - 1) * 0.7);
    }
    this.nextBird = now + BIRD_MIN_GAP + bv.rnd() * (BIRD_MAX_GAP - BIRD_MIN_GAP);
  }

  stop(t: number): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const s of this.v.sources) {
      try { s.stop(t); } catch { /* already stopped */ }
    }
    for (const s of this.birdVoice.sources) {
      try { s.stop(t); } catch { /* already stopped */ }
    }
    this.out.disconnect();
  }
}

const ambience: LiveLoopDef = {
  kind: 'live',
  reverb: 0.05,
  create: (ctx, dest, t) => new AmbienceVoice(ctx, dest, t),
};

export const LOOP_DEFS: Record<LoopId, LoopDef> = {
  belt, generator, scanner, collector, arm, rake, vacuumTool, ambience, compressor, wrapper, lift,
};

/** Render order: the loops heard earliest in a run first. */
export const LOOP_RENDER_ORDER: readonly LoopId[] = ['vacuumTool', 'rake', 'generator', 'belt', 'arm', 'scanner', 'compressor', 'collector', 'silo' as never, 'wrapper', 'lift']
  .filter((id): id is LoopId => id in LOOP_DEFS && LOOP_DEFS[id as LoopId].kind === 'buffer');

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

export function offlineContextCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/**
 * Renders a buffered loop definition offline and folds the crossfade tail into the head so the buffer
 * loops seamlessly. Deterministic for a given seed.
 */
export async function renderLoopBuffer(def: BufferLoopDef, sampleRate = LOOP_SAMPLE_RATE, seed = 7): Promise<AudioBuffer> {
  const Ctor = offlineContextCtor();
  if (!Ctor) throw new Error('OfflineAudioContext unavailable');
  const n = Math.round(def.len * sampleRate);
  const x = Math.round(LOOP_XFADE * sampleRate);
  const off = new Ctor(1, n + x, sampleRate);
  const v = makeVoice(off, off.destination, 0, 1, mulberry32(seed));
  v.bank = noiseBank(off);
  def.render(v, (n + x) / sampleRate);
  const rendered = await off.startRendering();
  const src = rendered.getChannelData(0);
  const out = off.createBuffer(1, n, sampleRate);
  const d = out.getChannelData(0);
  d.set(src.subarray(0, n));
  for (let i = 0; i < x; i++) {
    const k = (i / x) * Math.PI * 0.5;
    d[i] = src[i] * Math.sin(k) + src[n + i] * Math.cos(k);
  }
  return out;
}

/** Plays a rendered loop buffer; intensity drives gain and playback rate. */
export class BufferLoopVoice implements LoopVoice {
  private readonly src: AudioBufferSourceNode;
  private readonly gain: GainNode;
  private stopped = false;

  constructor(ctx: BaseAudioContext, buffer: AudioBuffer, private readonly def: BufferLoopDef, dest: AudioNode, t: number, intensity: number) {
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.gain = ctx.createGain();
    const i = Math.max(0, Math.min(1, intensity));
    this.gain.gain.value = def.gain[0] + (def.gain[1] - def.gain[0]) * i;
    this.src.playbackRate.value = def.rate[0] + (def.rate[1] - def.rate[0]) * i;
    this.src.connect(this.gain);
    this.gain.connect(dest);
    // Random phase so several instances of the same loop never comb-filter.
    this.src.start(t, Math.random() * buffer.duration);
  }

  setIntensity(intensity: number, t: number): void {
    const i = Math.max(0, Math.min(1, intensity));
    this.gain.gain.setTargetAtTime(this.def.gain[0] + (this.def.gain[1] - this.def.gain[0]) * i, t, 0.08);
    this.src.playbackRate.setTargetAtTime(this.def.rate[0] + (this.def.rate[1] - this.def.rate[0]) * i, t, 0.12);
  }

  stop(t: number): void {
    if (this.stopped) return;
    this.stopped = true;
    try { this.src.stop(t); } catch { /* already stopped */ }
    this.gain.disconnect();
  }
}
