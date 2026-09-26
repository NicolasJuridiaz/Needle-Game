/**
 * Master mix: world SFX bus (+ warehouse reverb return), dry UI bus, music bus -> master gain ->
 * DynamicsCompressor limiter -> output trim -> destination. Works on any BaseAudioContext so the offline
 * check can render the full chain.
 */
export interface Mix {
  ctx: BaseAudioContext;
  /** Master volume × platform mute. */
  master: GainNode;
  limiter: DynamicsCompressorNode;
  /** World sounds (positional one-shots, loops, stingers) and the reverb return. */
  sfx: GainNode;
  /** Dry UI sounds (not ducked by pause). */
  ui: GainNode;
  music: GainNode;
  /** Reverb send target (per-voice send gains connect here). */
  reverbIn: GainNode;
}

/** Output trim after the limiter (Web Audio's compressor applies automatic make-up gain). */
const OUTPUT_TRIM = 0.84;
/** Reverb return level into the SFX bus. */
const REVERB_RETURN = 0.55;
/** Feedback-delay-network line lengths (s): mutually prime-ish, a large steel shed. */
const FDN_DELAYS = [0.0531, 0.0677, 0.0793, 0.0971] as const;
const FDN_RT60 = 1.6;
const FDN_DAMPING_HZ = 3800;
const PREDELAY = 0.019;

export function createMix(ctx: BaseAudioContext, destination: AudioNode): Mix {
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 4;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  const trim = ctx.createGain();
  trim.gain.value = OUTPUT_TRIM;
  master.connect(limiter);
  limiter.connect(trim);
  trim.connect(destination);

  const sfx = ctx.createGain();
  const ui = ctx.createGain();
  const music = ctx.createGain();
  sfx.connect(master);
  ui.connect(master);
  music.connect(master);

  const reverbIn = ctx.createGain();
  const ret = ctx.createGain();
  ret.gain.value = REVERB_RETURN;
  buildReverb(ctx, reverbIn, ret);
  ret.connect(sfx);

  return { ctx, master, limiter, sfx, ui, music, reverbIn };
}

/**
 * 4-line feedback delay network with a Householder mixing matrix and per-line damping
 * (input_i = x + a_i - (2/N)·Σa_j, a_j = g_j · lowpass(delay_j)). Convolver-free, fixed node count,
 * stable (orthogonal matrix, loop gains < 1). Lines 0/2 feed the left channel, 1/3 the right.
 */
function buildReverb(ctx: BaseAudioContext, input: AudioNode, output: AudioNode): void {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  const pre = ctx.createDelay(0.1);
  pre.delayTime.value = PREDELAY;
  input.connect(hp);
  hp.connect(lp);
  lp.connect(pre);

  const n = FDN_DELAYS.length;
  const mixSum = ctx.createGain();
  mixSum.gain.value = -2 / n;
  const merger = ctx.createChannelMerger(2);
  const lineIns: GainNode[] = [];
  for (let i = 0; i < n; i++) {
    const lineIn = ctx.createGain();
    const delay = ctx.createDelay(0.2);
    delay.delayTime.value = FDN_DELAYS[i];
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = FDN_DAMPING_HZ;
    damp.Q.value = 0;
    const fb = ctx.createGain();
    fb.gain.value = Math.pow(10, (-3 * FDN_DELAYS[i]) / FDN_RT60);
    pre.connect(lineIn);
    lineIn.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(lineIn);
    fb.connect(mixSum);
    fb.connect(merger, 0, i % 2);
    lineIns.push(lineIn);
  }
  for (const lineIn of lineIns) mixSum.connect(lineIn);
  merger.connect(output);
}

/** Perceptual volume curve for 0..1 sliders. */
export function sliderGain(v: number): number {
  const c = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  return c * c;
}
