import { ByteBrewAnalyticsAdapter, type ByteBrewLoader } from './bytebrewAdapter';
import { AnalyticsService, NoopAnalyticsAdapter, type AnalyticsAdapter } from './analyticsService';
import type { Analytics } from './analytics';

/**
 * Analytics configuration from Vite env (see .env.example and docs/ANALYTICS_SETUP.md).
 * These values end up in the client bundle: they are NOT secrets, env only keeps our concrete keys out of Git
 * and separates environments.
 *
 * Remote analytics (ByteBrew) is only ever *possible* when all of these hold; otherwise the adapter is a no-op and
 * the SDK chunk is never requested:
 *   - both ByteBrew keys are set and VITE_ANALYTICS_ENABLED is not 'false' / '0';
 *   - VITE_PRIVACY_POLICY_URL is an absolute https URL (relaxed only for the Vite dev server on localhost);
 *   - the page URL has no `?analytics=0` (kill switch, always wins).
 * Even then nothing starts before the player's explicit consent (src/game/analyticsConsent.ts).
 */
export interface AnalyticsEnv {
  VITE_BYTEBREW_WEB_APP_ID?: string;
  VITE_BYTEBREW_WEB_SDK_KEY?: string;
  VITE_APP_VERSION?: string;
  /** 'false' / '0' turns remote analytics off for a build. */
  VITE_ANALYTICS_ENABLED?: string;
  /** https URL of the privacy policy linked from the consent card and Settings. Required for remote analytics. */
  VITE_PRIVACY_POLICY_URL?: string;
}

/** Privacy policy link: only an absolute https URL, else null. */
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

/** `?analytics=0` (or false/off) in the page URL: remote analytics off for that page load. Always wins. */
export function urlOptOut(search: string | undefined): boolean {
  if (!search) return false;
  try {
    const v = new URLSearchParams(search).get('analytics');
    return v === '0' || v === 'false' || v === 'off';
  } catch {
    return false;
  }
}

/**
 * Vite dev server on this machine (`npm run dev` opened on localhost / 127.0.0.1). Only there may ByteBrew run without
 * a privacy policy URL, to test against the DEV ByteBrew game. Never true in a production build.
 */
export function isLocalDevelopment(dev: boolean = !!import.meta.env?.DEV, hostname: string | undefined = typeof location === 'undefined' ? undefined : location.hostname): boolean {
  return dev && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]');
}

export interface RemoteAdapterOptions {
  /** `?analytics=0` on this page load. */
  killSwitch?: boolean;
  /** isLocalDevelopment(): allows running without a privacy policy URL. */
  localDevelopment?: boolean;
  loader?: ByteBrewLoader;
}

/** Remote adapter for this build/page: ByteBrew when every precondition holds, else noop (with the reason). */
export function createRemoteAdapter(env: AnalyticsEnv, opts: RemoteAdapterOptions = {}): AnalyticsAdapter {
  if (opts.killSwitch) return new NoopAnalyticsAdapter('disabled by ?analytics=0');
  const off = (env.VITE_ANALYTICS_ENABLED ?? '').trim().toLowerCase();
  if (off === 'false' || off === '0') return new NoopAnalyticsAdapter('disabled by VITE_ANALYTICS_ENABLED');
  const appId = (env.VITE_BYTEBREW_WEB_APP_ID ?? '').trim();
  const sdkKey = (env.VITE_BYTEBREW_WEB_SDK_KEY ?? '').trim();
  if (!appId || !sdkKey) return new NoopAnalyticsAdapter('ByteBrew keys not set');
  if (!privacyPolicyUrl(env) && !opts.localDevelopment) return new NoopAnalyticsAdapter('VITE_PRIVACY_POLICY_URL missing or not https');
  return new ByteBrewAnalyticsAdapter({ appId, sdkKey, appVersion: appVersion(env) }, opts.loader);
}

/** The service starts disabled: only the consent controller enables it. */
export function createAnalyticsService(opts: { env?: AnalyticsEnv; local?: Analytics; search?: string } = {}): AnalyticsService {
  const env = opts.env ?? (import.meta.env as AnalyticsEnv);
  const search = opts.search ?? (typeof location === 'undefined' ? '' : location.search);
  const remote = createRemoteAdapter(env, { killSwitch: urlOptOut(search), localDevelopment: isLocalDevelopment() });
  if (import.meta.env?.DEV) console.info(`[analytics] remote: ${remote.status()}`);
  return new AnalyticsService({ remote, local: opts.local, enabled: false });
}
