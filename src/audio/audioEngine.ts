import type { IAudio, LoopId, PlayOptions, SfxId } from './api';
import { BufferLoopVoice, LOOP_DEFS, LOOP_RENDER_ORDER, renderLoopBuffer, type LoopVoice } from './loops';
import { createMix, sliderGain, type Mix } from './mix';
import { Music } from './music';
import { SFX, SFX_META } from './sfx';
import { makeVoice, type Voice } from './synth';
import type { Vec3 } from '../sim/types';

/** Positional sounds beyond this distance (m) are not played. */
const MAX_DIST = 40;
/** Distance (m) at which a positional sound is at half volume. */
const REF_DIST = 7;
/** Maximum simultaneous instances per loop type. */
const MAX_LOOPS_PER_TYPE = 3;
/** A loop not refreshed for this long fades out. */
const LOOP_TIMEOUT = 0.2;
const LOOP_FADE = 0.15;

interface ActiveVoice { id: SfxId; voice: Voice; out: GainNode; end: number }

interface LoopRequest {
  key: string;
  id: LoopId;
  pos: Vec3 | null;
  intensity: number;
  seen: number;
  /** Chosen this frame (within the per-type voice cap). */
  audible: boolean;
  voice: LoopVoice | null;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  send: GainNode | null;
}

type Ctor = new () => AudioContext;

/**
 * WebAudio engine: synthesised one-shots (sfx.ts), rendered/live loops (loops.ts), procedural music
 * (music.ts), all through the master mix (mix.ts). Everything is created lazily on the first user
 * gesture (`unlock`), so constructing the engine never touches the audio hardware.
 */
export class AudioEngine implements IAudio {
  private ctx: AudioContext | null = null;
  private mix: Mix | null = null;
  private music: Music | null = null;
  private volumes = { master: 0.8, sfx: 0.8, music: 0.5 };
  private musicEnabled = true;
  private platformMuted = false;
  private paused = false;
  private listener: Vec3 = { x: 0, y: 1.6, z: 0 };
  private yaw = 0;
  private clock = 0;

  private active: ActiveVoice[] = [];
  private lastPlayed = new Map<SfxId, number>();
  private loops = new Map<string, LoopRequest>();
  private buffers = new Map<LoopId, AudioBuffer>();
  private rendering = false;
  private byType = new Map<LoopId, LoopRequest[]>();

  unlock(): void {
    if (!this.ctx) {
      const g = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
      const C = g.AudioContext ?? g.webkitAudioContext;
      if (!C) return;
      try {
        this.ctx = new C();
      } catch {
        return;
      }
      this.mix = createMix(this.ctx, this.ctx.destination);
      this.music = new Music(this.ctx, this.mix.music);
      this.applyVolumes();
      this.music.setEnabled(this.musicEnabled);
      void this.renderLoops();
    }
    if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume().catch(() => undefined);
  }

  private async renderLoops(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    for (const id of LOOP_RENDER_ORDER) {
      const def = LOOP_DEFS[id];
      if (def.kind !== 'buffer') continue;
      try {
        this.buffers.set(id, await renderLoopBuffer(def));
      } catch {
        // OfflineAudioContext unavailable: that loop stays silent.
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------------------------------

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    this.music?.setEnabled(on && !this.paused);
  }

  setPlatformMuted(muted: boolean): void {
    this.platformMuted = muted;
    this.applyVolumes();
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.applyVolumes();
    if (paused) {
      for (const l of this.loops.values()) this.stopLoop(l);
      this.loops.clear();
    }
    this.music?.setEnabled(this.musicEnabled && !paused);
  }

  private applyVolumes(): void {
    const m = this.mix;
    if (!m || !this.ctx) return;
    const t = this.ctx.currentTime;
    const master = this.platformMuted ? 0 : sliderGain(this.volumes.master);
    m.master.gain.setTargetAtTime(master, t, 0.05);
    m.sfx.gain.setTargetAtTime(this.paused ? 0 : sliderGain(this.volumes.sfx), t, 0.08);
    m.ui.gain.setTargetAtTime(sliderGain(this.volumes.sfx), t, 0.05);
    m.music.gain.setTargetAtTime(sliderGain(this.volumes.music) * 0.55, t, 0.1);
  }

  setListener(pos: Vec3, yaw: number): void {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.yaw = yaw;
  }

  // ------------------------------------------------------------------------------------------
  // Spatialisation
  // ------------------------------------------------------------------------------------------

  private distance(p: Vec3): number {
    const dx = p.x - this.listener.x, dy = p.y - this.listener.y, dz = p.z - this.listener.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private attenuation(d: number): number {
    if (d >= MAX_DIST) return 0;
    const g = REF_DIST / (REF_DIST + Math.max(0, d - 1));
    const edge = d > MAX_DIST * 0.75 ? (MAX_DIST - d) / (MAX_DIST * 0.25) : 1;
    return Math.min(1, g) * edge;
  }

  /** Stereo pan from the listener's yaw (three.js camera: yaw 0 looks along -Z, right = +X). */
  private panFor(p: Vec3): number {
    const dx = p.x - this.listener.x, dz = p.z - this.listener.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.3) return 0;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    return Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / len) * 0.85));
  }

  // ------------------------------------------------------------------------------------------
  // One-shots
  // ------------------------------------------------------------------------------------------

  play(id: SfxId, opts: PlayOptions = {}): void {
    const ctx = this.ctx, mix = this.mix;
    if (!ctx || !mix || ctx.state !== 'running') return;
    const meta = SFX_META[id];
    const recipe = SFX[id];
    if (!meta || !recipe) return;
    if (this.paused && !meta.ui) return;
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id) ?? -1;
    if (now - last < meta.minGap) return;

    let gain = meta.gain * (opts.volume ?? 1);
    let pan = 0;
    if (opts.pos && !meta.ui) {
      const d = this.distance(opts.pos);
      const a = this.attenuation(d);
      if (a <= 0.005) return;
      gain *= a;
      pan = this.panFor(opts.pos);
    }
    if (gain <= 0.001) return;
    this.lastPlayed.set(id, now);

    // Voice cap per id: steal the oldest.
    let count = 0;
    let oldest = -1;
    for (let i = 0; i < this.active.length; i++) {
      if (this.active[i].id !== id) continue;
      count++;
      if (oldest < 0) oldest = i;
    }
    if (count >= meta.maxVoices && oldest >= 0) this.killVoice(oldest, now);

    const out = ctx.createGain();
    out.gain.value = gain;
    let node: AudioNode = out;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(meta.ui ? mix.ui : mix.sfx);
    if (meta.reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = meta.reverb;
      out.connect(send);
      send.connect(mix.reverbIn);
    }
    const jitter = meta.jitter > 0 ? 1 + (Math.random() * 2 - 1) * meta.jitter : 1;
    const voice = makeVoice(ctx, out, now + 0.005, (opts.pitch ?? 1) * jitter);
    try {
      recipe(voice);
    } catch {
      out.disconnect();
      return;
    }
    this.active.push({ id, voice, out, end: voice.end + 0.1 });
  }

  private killVoice(i: number, t: number): void {
    const v = this.active[i];
    v.out.gain.setTargetAtTime(0, t, 0.01);
    for (const s of v.voice.sources) { try { s.stop(t + 0.05); } catch { /* ignore */ } }
    v.end = Math.min(v.end, t + 0.1);
  }

  // ------------------------------------------------------------------------------------------
  // Loops
  // ------------------------------------------------------------------------------------------

  loop(key: string, id: LoopId, pos: Vec3 | null, intensity: number): void {
    if (!this.ctx || this.paused) return;
    let l = this.loops.get(key);
    if (!l) {
      l = { key, id, pos: null, intensity: 0, seen: 0, audible: false, voice: null, gain: null, pan: null, send: null };
      this.loops.set(key, l);
    }
    if (l.id !== id) { this.stopLoop(l); l.id = id; }
    if (pos) {
      if (!l.pos) l.pos = { x: pos.x, y: pos.y, z: pos.z };
      else { l.pos.x = pos.x; l.pos.y = pos.y; l.pos.z = pos.z; }
    } else l.pos = null;
    l.intensity = intensity;
    l.seen = this.clock;
  }

  private startLoop(l: LoopRequest, t: number): void {
    const ctx = this.ctx!, mix = this.mix!;
    const def = LOOP_DEFS[l.id];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let node: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      l.pan = ctx.createStereoPanner();
      gain.connect(l.pan);
      node = l.pan;
    }
    node.connect(mix.sfx);
    if (def.reverb > 0) {
      l.send = ctx.createGain();
      l.send.gain.value = def.reverb;
      gain.connect(l.send);
      l.send.connect(mix.reverbIn);
    }
    const inner = ctx.createGain();
    inner.connect(gain);
    if (def.kind === 'buffer') {
      const buf = this.buffers.get(l.id);
      if (!buf) { gain.disconnect(); inner.disconnect(); l.pan = null; l.send = null; return; }
      l.voice = new BufferLoopVoice(ctx, buf, def, inner, t, l.intensity);
    } else {
      l.voice = def.create(ctx, inner, t);
      l.voice.setIntensity(l.intensity, t);
    }
    l.gain = gain;
  }

  private stopLoop(l: LoopRequest): void {
    if (!this.ctx || !l.gain) { l.voice = null; return; }
    const t = this.ctx.currentTime;
    const g = l.gain, pan = l.pan, send = l.send, voice = l.voice;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, LOOP_FADE / 3);
    voice?.stop(t + LOOP_FADE + 0.05);
    setTimeout(() => {
      try { g.disconnect(); pan?.disconnect(); send?.disconnect(); } catch { /* ignore */ }
    }, (LOOP_FADE + 0.15) * 1000);
    l.voice = null; l.gain = null; l.pan = null; l.send = null;
  }

  private updateLoops(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Group live requests per type and pick the nearest N.
    for (const arr of this.byType.values()) arr.length = 0;
    for (const l of this.loops.values()) {
      if (this.clock - l.seen > LOOP_TIMEOUT) {
        this.stopLoop(l);
        this.loops.delete(l.key);
        continue;
      }
      let arr = this.byType.get(l.id);
      if (!arr) { arr = []; this.byType.set(l.id, arr); }
      arr.push(l);
    }
    for (const arr of this.byType.values()) {
      if (arr.length > MAX_LOOPS_PER_TYPE) {
        arr.sort((a, b) => (a.pos ? this.distance(a.pos) : 0) - (b.pos ? this.distance(b.pos) : 0));
      }
      for (let i = 0; i < arr.length; i++) {
        const l = arr[i];
        let level = 1;
        let pan = 0;
        if (l.pos) {
          const d = this.distance(l.pos);
          level = this.attenuation(d);
          pan = this.panFor(l.pos);
        }
        const audible = i < MAX_LOOPS_PER_TYPE && level > 0.01 && l.intensity > 0.001;
        if (!audible) {
          if (l.voice) this.stopLoop(l);
          continue;
        }
        if (!l.voice) this.startLoop(l, t);
        if (!l.voice || !l.gain) continue;
        l.gain.gain.setTargetAtTime(level, t, 0.06);
        l.pan?.pan.setTargetAtTime(pan, t, 0.06);
        l.voice.setIntensity(l.intensity, t);
        l.voice.tick?.(t);
      }
    }
  }

  // ------------------------------------------------------------------------------------------
  // Frame update
  // ------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.clock += dt;
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Release finished one-shots.
    let w = 0;
    for (let i = 0; i < this.active.length; i++) {
      const v = this.active[i];
      if (now > v.end) { try { v.out.disconnect(); } catch { /* ignore */ } } else this.active[w++] = v;
    }
    this.active.length = w;
    if (!this.paused) this.updateLoops();
    this.music?.update();
  }
}
