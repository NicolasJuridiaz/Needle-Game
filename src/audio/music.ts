import { makeVoice, midiToHz, mulberry32, noise, tone, type Rnd } from './synth';

/**
 * Procedural background music: a light country / lo-fi loop. Plucked strings are Karplus–Strong
 * buffers rendered once per note, over a I–V–vi–IV style progression with 8-bar variations, a soft
 * upright-ish bass and brushed percussion. Scheduled ahead with a small look-ahead window.
 */

const BPM = 84;
const BEAT = 60 / BPM;
const EIGHTH = BEAT / 2;
const LOOKAHEAD = 0.35;

/** Chord = root midi + intervals (voicing for arpeggios). Key of G. */
interface Chord { root: number; tones: number[] }
const CHORDS: Record<string, Chord> = {
  G: { root: 43, tones: [55, 59, 62, 67, 71] },
  D: { root: 38, tones: [50, 57, 62, 66, 69] },
  Em: { root: 40, tones: [52, 59, 64, 67, 71] },
  C: { root: 36, tones: [48, 55, 60, 64, 67] },
  Am: { root: 45, tones: [57, 60, 64, 69, 72] },
  Bm: { root: 47, tones: [54, 59, 62, 66, 71] },
};
const PROGRESSIONS: string[][] = [
  ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C'],
  ['C', 'G', 'Am', 'D', 'C', 'G', 'D', 'D'],
  ['Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'D'],
  ['G', 'Bm', 'C', 'G', 'Am', 'D', 'G', 'G'],
];
/** Arpeggio patterns: indices into chord tones per eighth (-1 = rest). */
const PATTERNS: number[][] = [
  [0, 2, 1, 3, 0, 2, 1, 3],
  [0, 1, 2, 3, 4, 3, 2, 1],
  [0, -1, 2, 1, 0, -1, 3, 2],
  [0, 2, 4, 2, 1, 3, 4, 3],
];
/** Simple melody motifs (scale degrees over the chord tones, -1 = rest), one per bar. */
const MELODIES: number[][] = [
  [4, -1, -1, 3, -1, 2, -1, -1],
  [-1, -1, 3, -1, 4, -1, 3, 2],
  [2, -1, 3, -1, 4, -1, -1, -1],
  [-1, 4, -1, 3, -1, -1, 2, -1],
];

const pluckCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

/** Karplus–Strong plucked string buffer for a midi note (cached per context). */
function pluck(ctx: BaseAudioContext, midi: number, bright: number): AudioBuffer {
  let cache = pluckCache.get(ctx);
  if (!cache) { cache = new Map(); pluckCache.set(ctx, cache); }
  const key = midi * 10 + Math.round(bright * 9);
  const hit = cache.get(key);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const period = Math.max(2, Math.round(sr / midiToHz(midi)));
  const ring = new Float32Array(period);
  const rnd = mulberry32(midi * 7919 + 13);
  // Excitation: filtered noise burst (softer attack = darker pick).
  let prev = 0;
  for (let i = 0; i < period; i++) {
    const w = rnd() * 2 - 1;
    prev = prev + (w - prev) * (0.35 + 0.6 * bright);
    ring[i] = prev;
  }
  const decay = 0.996 - Math.max(0, midi - 60) * 0.0004;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const a = ring[idx];
    const b = ring[(idx + 1) % period];
    const v = (a + b) * 0.5 * decay;
    ring[idx] = v;
    d[i] = a;
    idx = (idx + 1) % period;
  }
  // Fade tail + normalise.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  const s = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.floor(sr * 0.2);
  for (let i = 0; i < len; i++) d[i] *= s * (i > len - fade ? (len - i) / fade : 1);
  cache.set(key, buf);
  return buf;
}

export class Music {
  private readonly out: GainNode;
  private enabled = true;
  private running = false;
  private nextTime = 0;
  private step = 0; // eighth-note counter
  private section = 0;
  private rnd: Rnd = mulberry32(0x6d757369);
  private sources = new Set<AudioScheduledSourceNode>();

  constructor(private readonly ctx: BaseAudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(on ? 1 : 0, t, on ? 1.2 : 0.3);
    if (on && !this.running) this.start();
  }

  start(): void {
    if (!this.enabled) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.2;
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
  }

  /** Schedule notes that fall inside the look-ahead window. */
  update(): void {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05; // resumed after a stall
    if (!this.enabled) {
      // Keep the clock but schedule nothing while faded out.
      if (this.out.gain.value < 0.01) { this.running = false; return; }
    }
    while (this.nextTime < now + LOOKAHEAD) {
      this.scheduleStep(this.nextTime);
      this.nextTime += EIGHTH;
      this.step++;
    }
  }

  private scheduleStep(t: number): void {
    const e = this.step % 8;             // eighth within bar
    const bar = Math.floor(this.step / 8);
    const barIn8 = bar % 8;
    if (e === 0 && barIn8 === 0) this.section = Math.floor(this.rnd() * PROGRESSIONS.length);
    const prog = PROGRESSIONS[this.section];
    const chord = CHORDS[prog[barIn8]];
    const pattern = PATTERNS[(this.section + (barIn8 >> 1)) % PATTERNS.length];
    const swing = e % 2 === 1 ? EIGHTH * 0.12 : 0;
    const tt = t + swing;

    // Guitar arpeggio.
    const pi = pattern[e];
    if (pi >= 0) this.playPluck(chord.tones[pi % chord.tones.length], tt, 0.16 + (e === 0 ? 0.05 : 0), 0.35, (e % 2 ? 0.25 : -0.2));

    // Melody on bars 4..7 of each 8-bar phrase (a sparse answer).
    if (barIn8 >= 4 && this.step >= 64) {
      const m = MELODIES[(barIn8 + this.section) % MELODIES.length][e];
      if (m >= 0 && this.rnd() < 0.85) this.playPluck(chord.tones[m % chord.tones.length] + 12, tt, 0.1, 0.7, 0.1);
    }

    // Bass on beats 1 and 3 (root, fifth).
    if (e === 0 || e === 4) {
      const n = e === 0 ? chord.root : chord.root + 7;
      const v = makeVoice(this.ctx, this.out, tt, 1, this.rnd);
      tone(v, { type: 'triangle', f: midiToHz(n), a: 0.01, h: 0.08, d: 0.7, peak: 0.13, filter: { type: 'lowpass', f: 420 } });
      this.track(v.sources);
    }
    // Brushed percussion: soft kick on 1, brush on 2 & 4, shaker on off-beats.
    const v = makeVoice(this.ctx, this.out, tt, 1, this.rnd);
    if (e === 0) tone(v, { f: 95, f1: 45, slide: 0.12, a: 0.003, d: 0.25, peak: 0.12 });
    if (e === 2 || e === 6) noise(v, { color: 'pink', a: 0.01, d: 0.18, peak: 0.035, filter: { type: 'bandpass', f: 2200, q: 0.7 } });
    if (e % 2 === 1) noise(v, { color: 'white', a: 0.004, d: 0.05, peak: 0.012, filter: { type: 'highpass', f: 6000 } });
    this.track(v.sources);
  }

  private playPluck(midi: number, t: number, gain: number, bright: number, pan: number): void {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = pluck(ctx, midi, bright);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    let node: AudioNode = g;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      node = p;
    }
    node.connect(this.out);
    src.start(t);
    this.track([src]);
  }

  private track(list: AudioScheduledSourceNode[]): void {
    for (const s of list) {
      this.sources.add(s);
      s.onended = () => { this.sources.delete(s); try { s.disconnect(); } catch { /* ignore */ } };
    }
  }

  stopAll(): void {
    const t = this.ctx.currentTime;
    for (const s of this.sources) { try { s.stop(t); } catch { /* ignore */ } }
    this.sources.clear();
  }
}
