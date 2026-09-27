import { createAnalyticsService } from './platform/analyticsConfig';
import { Platform } from './platform/crazygames';
import { Game } from './game/game';

/**
 * Boot: SDK init (never blocks for long) -> loading events -> Game -> "click to play".
 * CrazyGames: land in gameplay with at most one click; gameplayStart fires on that click.
 */
async function boot(): Promise<void> {
  const bar = document.getElementById('bootbar');
  const setBar = (p: number) => { if (bar) bar.style.width = `${Math.round(p * 100)}%`; };
  setBar(0.1);

  const platform = new Platform();
  await platform.init();
  platform.loadingStart();
  setBar(0.4);

  // Analytics: remote adapter (ByteBrew) only when configured; the Game applies the player's opt-out and that
  // starts the adapter in the background (it never blocks the boot).
  const analytics = createAnalyticsService({ enabled: false });
  const container = document.getElementById('game')!;
  const uiRoot = document.getElementById('ui')!;

  // Yield a frame so the loading bar paints before heavy construction.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const game = new Game(container, uiRoot, platform, analytics);
  setBar(1);
  platform.loadingStop();
  game.ready();
  game.start();
  (window as unknown as { __game?: Game }).__game = game;
  installAnalyticsDebug(analytics);

  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.transition = 'opacity .35s';
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 400);
  }
}

/**
 * QA handle for analytics (dev builds, or any build with ?debug=1): `__pnAnalyticsQA.status()` shows the active
 * adapter, init state and last events sent; `test()` sends one `qa_test_event`. Nothing visible on screen.
 */
function installAnalyticsDebug(analytics: ReturnType<typeof createAnalyticsService>): void {
  let debug = import.meta.env.DEV;
  try { debug ||= new URLSearchParams(location.search).get('debug') === '1'; } catch { /* ignore */ }
  if (!debug) return;
  (window as unknown as { __pnAnalyticsQA?: unknown }).__pnAnalyticsQA = {
    status: () => analytics.diagnostics(),
    test: () => { analytics.track('qa_test_event', { source: 'console' }); return analytics.diagnostics(); },
    setEnabled: (on: boolean) => analytics.setEnabled(on),
  };
  console.info('[analytics] QA handle: __pnAnalyticsQA.status() / .test() / .setEnabled(bool); buffer: __pnAnalytics.events()');
}

/** True when the browser can create a WebGL context (hardware acceleration may be off or blocklisted). */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  const boot = document.getElementById('boot');
  const text = hasWebGL()
    ? 'Something went wrong while loading.<br/>Please reload the page.'
    : 'Your browser could not start 3D graphics (WebGL).<br/>Turn on hardware acceleration in the browser settings, update your graphics driver, or try Chrome / Edge.';
  if (boot) boot.innerHTML = `<div style="color:#f2c14e;font:600 16px system-ui;text-align:center;padding:24px">${text}</div>`;
});
