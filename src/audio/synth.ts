/**
 * Synthesis primitives shared by the SFX recipes, loop renders and music. Everything works on any
 * BaseAudioContext (realtime or offline) so recipes can be rendered and measured headlessly.
 *
 * A recipe receives a `Voice` (context, destination, start time, pitch, random source) and schedules its
 * nodes with helpers below. Helpers track every started source in `v.sources` and extend `v.end`, which
 * lets the engine steal / recycle voices.
 */

export type Rnd = () => number;
export type NoiseColor = 'white' | 'pink' | 'brown';

export interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  /** Buffer duration in seconds. */
  dur: number;
}

export interface Voice {
  ctx: BaseAudioContext;
  /** Destination of this voice's nodes. */
  out: AudioNode;
  /** Absolute start time (context seconds). */
  t: number;
  /** Frequency multiplier applied to tones and filters. */
  pitch: number;
  /** Latest scheduled end time (updated by the helpers). */
  end: number;
  /** Every started source (stopped when a voice is stolen). */
  sources: AudioScheduledSourceNode[];
  rnd: Rnd;
  bank: NoiseBank;
}

/** Small, fast, seedable PRNG (deterministic noise buffers and offline checks). */
export function mulberry32(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Noise buffers (one set per context, generated once, seamlessly loopable)
// ---------------------------------------------------------------------------------------------

const NOISE_SECONDS = 2;
const NOISE_XFADE = 0.05;
const banks = new WeakMap<BaseAudioContext, NoiseBank>();

function fillNoise(color: NoiseColor, out: Float32Array, rnd: Rnd): void {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd() * 2 - 1;
    if (color === 'white') out[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      out[i] = brown;
    }
  }
}

function makeNoiseBuffer(ctx: BaseAudioContext, color: NoiseColor, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(NOISE_SECONDS * sr);
  const x = Math.floor(NOISE_XFADE * sr);
  const raw = new Float32Array(n + x);
  fillNoise(color, raw, mulberry32(seed));
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i];
  mean /= raw.length;
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = raw[i] - mean;
  // Blend the overflow into the head so the buffer loops without a seam (matters for brown noise).
  for (let i = 0; i < x; i++) {
    const k = i / x;
    d[i] = (raw[i] - mean) * Math.sin(k * Math.PI * 0.5) + (raw[n + i] - mean) * Math.cos(k * Math.PI * 0.5);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  const s = peak > 0 ? 1 / peak : 1;
  for (let i = 0; i < n; i++) d[i] *= s;
  return buf;
}

export function noiseBank(ctx: BaseAudioContext): NoiseBank {
  let b = banks.get(ctx);
  if (!b) {
    b = {
      white: makeNoiseBuffer(ctx, 'white', 0x1234),
      pink: makeNoiseBuffer(ctx, 'pink', 0x5678),
      brown: makeNoiseBuffer(ctx, 'brown', 0x9abc),
      dur: NOISE_SECONDS,
    };
    banks.set(ctx, b);
  }
  return b;
}

export function makeVoice(ctx: BaseAudioContext, out: AudioNode, t: number, pitch = 1, rnd: Rnd = Math.random): Voice {
  return { ctx, out, t, pitch, end: t, sources: [], rnd, bank: noiseBank(ctx) };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

export interface EnvSpec {
  /** Offset from the voice start (s). */
  t?: number;
  /** Attack (s). */
  a?: number;
  /** Hold at peak (s). */
  h?: number;
  /** Decay to -60 dB (s). */
  d: number;
  peak: number;
}

export interface FilterSpec {
  type: BiquadFilterType;
  f: number;
  /** Target frequency (exponential slide). */
  f1?: number;
  /** Slide duration (defaults to the envelope length). */
  slide?: number;
  q?: number;
  gain?: number;
}

export interface ToneSpec extends EnvSpec {
  type?: OscillatorType;
  f: number;
  f1?: number;
  slide?: number;
  filter?: FilterSpec;
  /** Vibrato [rate Hz, depth cents]. */
  vib?: [number, number];
  detune?: number;
  pan?: number;
  dest?: AudioNode;
}

export interface NoiseSpec extends EnvSpec {
  color?: NoiseColor;
  filter?: FilterSpec;
  filter2?: FilterSpec;
  rate?: number;
  pan?: number;
  dest?: AudioNode;
}

export function clampF(ctx: BaseAudioContext, f: number): number {
  return Math.max(10, Math.min(ctx.sampleRate * 0.45, f));
}

function track(v: Voice, s: AudioScheduledSourceNode, end: number): void {
  v.sources.push(s);
  if (end > v.end) v.end = end;
}

/** Linear attack, optional hold, exponential decay to -60 dB. Returns the end time. */
export function applyEnv(p: AudioParam, t0: number, a: number, h: number, d: number, peak: number): number {
  const at = Math.max(0.002, a);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + at);
  if (h > 0) p.setValueAtTime(peak, t0 + at + h);
  const end = t0 + at + h + Math.max(0.005, d);
  p.exponentialRampToValueAtTime(Math.max(1e-6, peak * 1e-3), end);
  p.setValueAtTime(0, end + 0.001);
  return end;
}

function envLength(e: EnvSpec): number {
  return Math.max(0.002, e.a ?? 0) + (e.h ?? 0) + e.d;
}

function makeFilter(v: Voice, spec: FilterSpec, t0: number, len: number, scale: number): BiquadFilterNode {
  const f = v.ctx.createBiquadFilter();
  f.type = spec.type;
  f.frequency.setValueAtTime(clampF(v.ctx, spec.f * scale), t0);
  if (spec.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(clampF(v.ctx, spec.f1 * scale), t0 + (spec.slide ?? len));
  if (spec.q !== undefined) f.Q.value = spec.q;
  if (spec.gain !== undefined) f.gain.value = spec.gain;
  return f;
}

function panNode(v: Voice, pan: number | undefined, dest: AudioNode): AudioNode {
  if (pan === undefined || pan === 0 || typeof v.ctx.createStereoPanner !== 'function') return dest;
  const p = v.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}

/** Oscillator with pitch slide, optional filter / vibrato, enveloped. */
export function tone(v: Voice, s: ToneSpec): GainNode {
  const { ctx } = v;
  const t0 = v.t + (s.t ?? 0);
  const len = envLength(s);
  const o = ctx.createOscillator();
  o.type = s.type ?? 'sine';
  o.frequency.setValueAtTime(clampF(ctx, s.f * v.pitch), t0);
  if (s.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(clampF(ctx, s.f1 * v.pitch), t0 + (s.slide ?? len));
  if (s.detune) o.detune.value = s.detune;
  const g = ctx.createGain();
  const end = applyEnv(g.gain, t0, s.a ?? 0, s.h ?? 0, s.d, s.peak);
  if (s.filter) {
    const f = makeFilter(v, s.filter, t0, len, v.pitch);
    o.connect(f);
    f.connect(g);
  } else o.connect(g);
  if (s.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = s.vib[0];
    const depth = ctx.createGain();
    depth.gain.value = s.vib[1];
    lfo.connect(depth);
    depth.connect(o.detune);
    lfo.start(t0);
    lfo.stop(end + 0.02);
    track(v, lfo, end + 0.02);
  }
  g.connect(panNode(v, s.pan, s.dest ?? v.out));
  o.start(t0);
  o.stop(end + 0.02);
  track(v, o, end + 0.02);
  return g;
}

/** Looping noise source starting at a random offset. */
export function noiseSource(v: Voice, color: NoiseColor, t0: number, dur: number, rate = 1): AudioBufferSourceNode {
  const src = v.ctx.createBufferSource();
  src.buffer = v.bank[color];
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t0, v.rnd() * (v.bank.dur - 0.05));
  src.stop(t0 + dur + 0.02);
  track(v, src, t0 + dur + 0.02);
  return src;
}

/** Filtered, enveloped noise burst. */
export function noise(v: Voice, s: NoiseSpec): GainNode {
  const t0 = v.t + (s.t ?? 0);
  const len = envLength(s);
  const src = noiseSource(v, s.color ?? 'white', t0, len, s.rate ?? 1);
  const g = v.ctx.createGain();
  applyEnv(g.gain, t0, s.a ?? 0, s.h ?? 0, s.d, s.peak);
  let node: AudioNode = src;
  if (s.filter) {
    const f = makeFilter(v, s.filter, t0, len, v.pitch);
    node.connect(f);
    node = f;
  }
  if (s.filter2) {
    const f = makeFilter(v, s.filter2, t0, len, v.pitch);
    node.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(panNode(v, s.pan, s.dest ?? v.out));
  return g;
}

export interface BellSpec extends EnvSpec {
  f: number;
  /** Modulator / carrier frequency ratio (non-integer = inharmonic, metallic). */
  ratio?: number;
  /** Modulation index at the strike (decays to 10%). */
  index?: number;
  pan?: number;
  dest?: AudioNode;
}

/** Two-operator FM bell / chime. */
export function bell(v: Voice, s: BellSpec): GainNode {
  const { ctx } = v;
  const t0 = v.t + (s.t ?? 0);
  const fc = clampF(ctx, s.f * v.pitch);
  const fm = clampF(ctx, fc * (s.ratio ?? 3.5));
  const car = ctx.createOscillator();
  car.frequency.value = fc;
  const mod = ctx.createOscillator();
  mod.frequency.value = fm;
  const modGain = ctx.createGain();
  const dev = (s.index ?? 2) * fm;
  modGain.gain.setValueAtTime(dev, t0);
  modGain.gain.exponentialRampToValueAtTime(Math.max(1, dev * 0.1), t0 + Math.max(0.05, s.d * 0.6));
  mod.connect(modGain);
  modGain.connect(car.frequency);
  const g = ctx.createGain();
  const end = applyEnv(g.gain, t0, s.a ?? 0.002, s.h ?? 0, s.d, s.peak);
  car.connect(g);
  g.connect(panNode(v, s.pan, s.dest ?? v.out));
  car.start(t0);
  mod.start(t0);
  car.stop(end + 0.02);
  mod.stop(end + 0.02);
  track(v, car, end + 0.02);
  track(v, mod, end + 0.02);
  return g;
}

export interface PartialsSpec {
  t?: number;
  f: number;
  /** Frequency ratios of the partials (inharmonic for metal). */
  ratios: readonly number[];
  /** Relative amplitudes (default 1/(i+1)). */
  amps?: readonly number[];
  d: number;
  peak: number;
  dest?: AudioNode;
}

/** Sum of decaying sine partials: clanks, knocks, tines. Higher partials decay faster. */
export function partials(v: Voice, s: PartialsSpec): void {
  const { ctx } = v;
  const t0 = v.t + (s.t ?? 0);
  let norm = 0;
  for (let i = 0; i < s.ratios.length; i++) norm += s.amps ? s.amps[i] : 1 / (i + 1);
  const g = ctx.createGain();
  g.gain.value = s.peak / Math.max(1e-6, norm);
  g.connect(s.dest ?? v.out);
  for (let i = 0; i < s.ratios.length; i++) {
    const o = ctx.createOscillator();
    o.frequency.value = clampF(ctx, s.f * s.ratios[i] * v.pitch * (1 + (v.rnd() - 0.5) * 0.01));
    const pg = ctx.createGain();
    const amp = s.amps ? s.amps[i] : 1 / (i + 1);
    const end = applyEnv(pg.gain, t0, 0.001, 0, s.d / (1 + i * 0.35), amp);
    o.connect(pg);
    pg.connect(g);
    o.start(t0);
    o.stop(end + 0.02);
    track(v, o, end + 0.02);
  }
}

export interface CrackleSpec {
  t?: number;
  dur: number;
  /** Number of grains (random spacing) — ignored when `period` is set. */
  count?: number;
  /** Regular grain spacing (s), e.g. belt rollers. */
  period?: number;
  peak: number;
  /** Band centre (Hz); each grain varies by ±`spread` octaves. */
  f: number;
  spread?: number;
  q?: number;
  color?: NoiseColor;
  /** Grain length (s). */
  grain?: number;
  /** Amplitude fades out over the burst (rustles) instead of staying flat (loops). */
  fade?: boolean;
  dest?: AudioNode;
}

/**
 * Granular noise crackle using a single source / filter / gain: hay rustles, crackling fire, rattles.
 * Grains are scheduled as automation bumps, so it costs three nodes regardless of grain count.
 */
export function crackle(v: Voice, s: CrackleSpec): void {
  const { ctx } = v;
  const t0 = v.t + (s.t ?? 0);
  const src = noiseSource(v, s.color ?? 'pink', t0, s.dur + 0.05);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = s.q ?? 1.2;
  bp.frequency.value = clampF(ctx, s.f * v.pitch);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  const spread = s.spread ?? 0.5;
  const grainLen = s.grain ?? 0.025;
  const floor = 1e-4;
  const count = s.period ? Math.max(1, Math.floor(s.dur / s.period)) : Math.max(1, s.count ?? 8);
  const avgGap = s.period ?? s.dur / count;
  let t = t0 + (s.period ? 0 : v.rnd() * avgGap * 0.5);
  for (let i = 0; i < count; i++) {
    const fade = s.fade === false ? 1 : 1 - 0.7 * (i / count);
    const amp = s.peak * (0.35 + 0.65 * v.rnd()) * fade;
    const gl = Math.min(grainLen * (0.6 + 0.8 * v.rnd()), avgGap * 0.9);
    bp.frequency.setValueAtTime(clampF(ctx, s.f * v.pitch * Math.pow(2, (v.rnd() * 2 - 1) * spread)), t);
    g.gain.setValueAtTime(floor, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.min(0.003, gl * 0.3));
    g.gain.exponentialRampToValueAtTime(floor, t + gl);
    const gap = s.period ? s.period : avgGap * (0.4 + 1.2 * v.rnd());
    t += Math.max(gl, gap);
    if (t > t0 + s.dur) break;
  }
  g.gain.setValueAtTime(0, Math.max(t, t0 + s.dur) + 0.01);
  src.connect(bp);
  bp.connect(g);
  g.connect(s.dest ?? v.out);
}

/** Sine/triangle LFO added onto an AudioParam for [t0, t0+dur]. */
export function lfo(v: Voice, target: AudioParam, rate: number, depth: number, t0: number, dur: number, type: OscillatorType = 'sine'): void {
  const o = v.ctx.createOscillator();
  o.type = type;
  o.frequency.value = rate;
  const g = v.ctx.createGain();
  g.gain.value = depth;
  o.connect(g);
  g.connect(target);
  o.start(v.t + t0);
  o.stop(v.t + t0 + dur + 0.02);
  track(v, o, v.t + t0 + dur + 0.02);
}

/** Constant-level sustained layer for loop renders: tone held for `dur`. */
export function drone(v: Voice, s: Omit<ToneSpec, 'd' | 'h' | 'a'> & { dur: number }): GainNode {
  return tone(v, { ...s, a: 0.02, h: s.dur, d: 0.05 });
}

/** Constant-level noise layer for loop renders. */
export function hiss(v: Voice, s: Omit<NoiseSpec, 'd' | 'h' | 'a'> & { dur: number }): GainNode {
  return noise(v, { ...s, a: 0.02, h: s.dur, d: 0.05 });
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
