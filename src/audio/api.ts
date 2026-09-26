import type { Vec3 } from '../sim/types';

/**
 * AUDIO CONTRACT. Implemented by src/audio/audioEngine.ts (class AudioEngine).
 * All sounds are ORIGINAL, synthesised at runtime with WebAudio (no sample files needed).
 */
export type SfxId =
  // player / tools
  | 'grabHay' | 'shovel' | 'bucket' | 'pitchfork' | 'dig' | 'full' | 'deposit' | 'take' | 'footstep' | 'jump' | 'land'
  | 'wheelbarrowGrab' | 'wheelbarrowDump'
  // economy / progression
  | 'sell' | 'sellBig' | 'buy' | 'unlock' | 'deny' | 'orderComplete' | 'milestone' | 'wp'
  // build
  | 'place' | 'placeBelt' | 'remove' | 'rotate' | 'invalid' | 'modeCycle'
  // machines (one-shots)
  | 'rakeThunk' | 'armServo' | 'armDrop' | 'compressorPress' | 'wrapperDone' | 'generatorFeed' | 'splitterClick' | 'scannerBeep'
  // needles
  | 'needleFound' | 'needleAlarm' | 'needleReturn' | 'needleGlint' | 'detectorBeep' | 'detectorTooDeep'
  // UI / flow
  | 'uiClick' | 'uiHover' | 'uiOpen' | 'uiClose' | 'toast' | 'complete' | 'powerDown';

/** Continuous positional loops (machines, tools, ambience). */
export type LoopId = 'belt' | 'generator' | 'scanner' | 'collector' | 'arm' | 'rake' | 'vacuumTool' | 'ambience' | 'compressor' | 'wrapper' | 'lift';

export interface PlayOptions {
  /** World position for 3D attenuation/panning. Omit for UI (non-positional) sounds. */
  pos?: Vec3;
  volume?: number; // 0..1 multiplier (default 1)
  pitch?: number;  // playback-rate style multiplier (default 1, randomised slightly by the engine)
}

export interface IAudio {
  /** Must be called from a user gesture (click) to start the AudioContext. Safe to call repeatedly. */
  unlock(): void;
  play(id: SfxId, opts?: PlayOptions): void;
  /**
   * Keep a keyed loop alive this frame. Call every frame for each audible source (engine culls to the N
   * nearest per LoopId and fades out loops not refreshed for ~0.2 s). intensity 0..1 modulates volume/pitch.
   */
  loop(key: string, id: LoopId, pos: Vec3 | null, intensity: number): void;
  setListener(pos: Vec3, yaw: number): void;
  setVolumes(v: { master: number; sfx: number; music: number }): void;
  setMusicEnabled(on: boolean): void;
  /** Platform mute (CrazyGames muteAudio) - overrides everything. */
  setPlatformMuted(muted: boolean): void;
  /** Pause everything (game paused / tab hidden). */
  setPaused(paused: boolean): void;
  update(dt: number): void;
}
