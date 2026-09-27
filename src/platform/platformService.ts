import type { ProgressSink } from './progress';
import type { Storage } from './storage';

/**
 * What the game needs from a web portal. Implemented today by `Platform` (src/platform/crazygames.ts), which is
 * the CrazyGames SDK v3 adapter AND the local/standalone platform: without the SDK (dev server, blocked script,
 * other hosts) every call is a no-op and storage falls back to localStorage / memory.
 * A future portal (e.g. Poki) would be another implementation of this interface; none exists yet on purpose.
 */
export interface PlatformService extends ProgressSink {
  readonly storage: Storage;
  /** 'crazygames' | 'local' (SDK local mode) | 'disabled' (no SDK: standalone). */
  readonly env: string;
  readonly isMuted: boolean;
  /** 'desktop' | 'tablet' | 'mobile' from the portal when it tells us, else 'unknown'. No fingerprinting. */
  readonly deviceClass: string;
  init(): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  onMuteChange(cb: (muted: boolean) => void): () => void;
  setContext(obj: Record<string, unknown>): void;
  isTouchOnlyDevice(): boolean;
}

/** Analytics `platform` value: where the build is running. */
export function analyticsPlatform(p: Pick<PlatformService, 'env'>): string {
  return p.env === 'crazygames' ? 'crazygames' : p.env === 'local' ? 'crazygames_local' : 'web';
}
