import { ByteBrewAnalyticsAdapter, type ByteBrewLoader } from './bytebrewAdapter';
import { AnalyticsService, NoopAnalyticsAdapter, type AnalyticsAdapter } from './analyticsService';
import type { Analytics } from './analytics';

/**
 * Analytics configuration from Vite env (see .env.example and docs/ANALYTICS_SETUP.md).
 * These values end up in the client bundle: they are NOT secrets, env only keeps our concrete keys out of Git
 * and separates environments.
 */
export interface AnalyticsEnv {
  VITE_BYTEBREW_WEB_APP_ID?: string;
  VITE_BYTEBREW_WEB_SDK_KEY?: string;
  VITE_APP_VERSION?: string;
  /** 'false' / '0' turns remote analytics off for a build. */
  VITE_ANALYTICS_ENABLED?: string;
  /** https URL of the privacy policy shown in the in-game analytics notice (CrazyGames "User Consent"). */
  VITE_PRIVACY_POLICY_URL?: string;
}

/** Privacy policy link for the in-game notice: only an absolute https URL, else null. */
export function privacyPolicyUrl(env: AnalyticsEnv = import.meta.env as AnalyticsEnv): string | null {
  const v = (env.VITE_PRIVACY_POLICY_URL ?? '').trim();
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Fallback version when VITE_APP_VERSION is not set (package.json version, injected by vite.config.ts). */
declare const __APP_VERSION__: string | undefined;

export function appVersion(env: AnalyticsEnv = import.meta.env as AnalyticsEnv): string {
  const v = (env.VITE_APP_VERSION ?? '').trim();
  if (v) return v;
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
}

/** Remote adapter for this build: ByteBrew when both keys are set and the build allows it, else noop. */
export function createRemoteAdapter(env: AnalyticsEnv, loader?: ByteBrewLoader): AnalyticsAdapter {
  const off = (env.VITE_ANALYTICS_ENABLED ?? '').trim().toLowerCase();
  if (off === 'false' || off === '0') return new NoopAnalyticsAdapter('disabled by VITE_ANALYTICS_ENABLED');
  const appId = (env.VITE_BYTEBREW_WEB_APP_ID ?? '').trim();
  const sdkKey = (env.VITE_BYTEBREW_WEB_SDK_KEY ?? '').trim();
  if (!appId || !sdkKey) return new NoopAnalyticsAdapter('ByteBrew keys not set');
  return new ByteBrewAnalyticsAdapter({ appId, sdkKey, appVersion: appVersion(env) }, loader);
}

/** `?analytics=0` in the page URL turns remote analytics off for that page load (QA, privacy checks). */
export function urlOptOut(search: string | undefined): boolean {
  if (!search) return false;
  try {
    const v = new URLSearchParams(search).get('analytics');
    return v === '0' || v === 'false' || v === 'off';
  } catch {
    return false;
  }
}

export function createAnalyticsService(opts: { env?: AnalyticsEnv; local?: Analytics; enabled: boolean }): AnalyticsService {
  const env = opts.env ?? (import.meta.env as AnalyticsEnv);
  const remote = createRemoteAdapter(env);
  if (remote.id === 'noop' && import.meta.env?.DEV) console.info(`[analytics] remote analytics off: ${remote.status()}`);
  if (remote.id === 'bytebrew' && !privacyPolicyUrl(env) && import.meta.env?.DEV) console.warn('[analytics] ByteBrew is configured but VITE_PRIVACY_POLICY_URL is not: the in-game notice has no policy link');
  return new AnalyticsService({ remote, local: opts.local, enabled: opts.enabled });
}
