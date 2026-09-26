import { Analytics } from './platform/analytics';
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

  const analytics = new Analytics();
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

  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.transition = 'opacity .35s';
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 400);
  }
}

boot().catch((err) => {
  console.error('[boot] failed', err);
  const boot = document.getElementById('boot');
  if (boot) boot.innerHTML = '<div style="color:#f2c14e;font:600 16px system-ui;text-align:center;padding:24px">Something went wrong while loading.<br/>Please reload the page.</div>';
});
