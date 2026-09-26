/** Player settings (persisted separately from the run save). */
export interface Settings {
  masterVolume: number; // 0..1
  sfxVolume: number;    // 0..1
  musicVolume: number;  // 0..1
  music: boolean;
  sensitivity: number;  // 0.2..3 (1 = default)
  invertY: boolean;
  fov: number;          // 60..100
  /** Render preset (src/render/quality.ts). New players start on 'medium'; a stored choice is kept. */
  quality: 'low' | 'medium' | 'high';
  /** The player picked the quality in Settings: the low-FPS failsafe never changes it then. */
  qualityManual: boolean;
  showFps: boolean;
  /** Toggle vs hold for continuous digging. */
  holdToDig: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  music: true,
  sensitivity: 1,
  invertY: false,
  fov: 75,
  quality: 'medium',
  qualityManual: false,
  showFps: false,
  holdToDig: true,
};

export function sanitizeSettings(s: Partial<Settings> | null | undefined): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
  out.masterVolume = clamp(out.masterVolume, 0, 1);
  out.sfxVolume = clamp(out.sfxVolume, 0, 1);
  out.musicVolume = clamp(out.musicVolume, 0, 1);
  out.sensitivity = clamp(out.sensitivity, 0.2, 3);
  out.fov = clamp(out.fov, 60, 100);
  if (!['low', 'medium', 'high'].includes(out.quality)) out.quality = DEFAULT_SETTINGS.quality;
  out.qualityManual = out.qualityManual === true;
  return out;
}
