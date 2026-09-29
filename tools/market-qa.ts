import { WORLD } from '../src/config/world';
import { TOOLS } from '../src/config/tools';
import { Game } from '../src/game/game';
import type { Input } from '../src/game/input';
import type { PlayerController } from '../src/game/playerController';
import { DEFAULT_SETTINGS } from '../src/game/settings';
import { AnalyticsService, NoopAnalyticsAdapter } from '../src/platform/analyticsService';
import type { PlatformService } from '../src/platform/platformService';
import type { Storage } from '../src/platform/storage';
import type { Renderer } from '../src/render/renderer';
import type { IntakeLoad } from '../src/sim/machines/sellStation';
import { carryCapacity, depositToIntake, intakeDropPoint } from '../src/sim/playerActions';
import { Sim } from '../src/sim/sim';
import type { GameMode } from '../src/ui/context';

// This entry is served by Vite development only; it is not an input to the production build.
if (!import.meta.env.DEV) throw new Error('Market QA is available only on the development server.');

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  getString(key: string): string | null { return this.values.get(key) ?? null; }
  setString(key: string, value: string): boolean { this.values.set(key, value); return true; }
  getJSON<T>(key: string): T | null {
    const raw = this.getString(key);
    return raw === null ? null : JSON.parse(raw) as T;
  }
  setJSON(key: string, value: unknown): boolean {
    const raw = JSON.stringify(value);
    return raw === undefined ? false : this.setString(key, raw);
  }
  remove(key: string): void { this.values.delete(key); }
}

const storage = new MemoryStorage();
storage.setJSON('pn_settings', { ...DEFAULT_SETTINGS, masterVolume: 0, music: false, qualityManual: true });
const noop = () => {};
const platform: PlatformService = {
  storage, env: 'local', isMuted: true, deviceClass: 'desktop',
  init: async () => {}, loadingStart: noop, loadingStop: noop,
  gameplayStart: noop, gameplayStop: noop, happytime: noop,
  startRun: noop, reportProgress: noop, setContext: noop,
  onMuteChange: () => noop, isTouchOnlyDevice: () => false,
};
const analytics = new AnalyticsService({ remote: new NoopAnalyticsAdapter('Market QA'), enabled: false });
const game = new Game(document.getElementById('game')!, document.getElementById('ui')!, platform, analytics);

/** The only private Game members accessed by this development harness. */
interface QaGameAccess {
  controller: PlayerController;
  renderer: Renderer;
  input: Input;
  setMode(mode: GameMode): void;
  bindSim(sim: Sim, isNewGame: boolean): void;
}
const qa = game as unknown as QaGameAccess;
const toolbar = document.getElementById('qa-toolbar')!;
const metrics = document.getElementById('qa-metrics')!;
const status = document.getElementById('qa-status')!;

function report(message: string): void { status.textContent = message; }
function play(): void {
  qa.input.releaseAll();
  qa.input.endFrame();
  // Retain a free pointer for QA buttons. Real keyboard input still goes through Game/Input.
  qa.setMode('play');
}

function lookAt(x: number, z: number, targetX: number, targetY: number, targetZ: number): void {
  const c = qa.controller;
  c.setPosition(x, 0, z);
  c.yaw = Math.atan2(-(targetZ - z), targetX - x);
  c.pitch = Math.atan2(targetY - c.eyeY, Math.hypot(targetX - x, targetZ - z));
  play();
}

function sellerView(): void {
  const s = WORLD.fixed.sellStation;
  lookAt(s.x + 7, s.z - 3, s.x + 1.5, 1.65, s.z + 1.6);
}
function supplyView(): void {
  const s = WORLD.store, mid = -1; // fixed comparison camera across revisions
  lookAt(s.x + 6, mid + 4, s.x + 0.55, 1.65, mid);
}
function overview(): void {
  const mid = 3; // fixed comparison camera across revisions
  lookAt(WORLD.fixed.sellStation.x + 13, mid + 1, WORLD.fixed.sellStation.x + 1, 1.7, mid);
}
function spawnView(): void {
  const s = WORLD.spawn;
  qa.controller.setPosition(s.x, 0, s.z);
  qa.controller.yaw = s.yaw;
  qa.controller.pitch = 0;
  play();
}

function prepareHay(): void {
  const sim = game.sim;
  sim.player.carry.clear();
  sim.player.carry.add('hay', carryCapacity(sim));
  if (sim.player.wheelbarrow) sim.player.wheelbarrow.held = false;
  const p = intakeDropPoint();
  lookAt(p.x, p.z, WORLD.intake.x + 0.5, WORLD.intake.beltY + 0.1, p.z);
  report(`Ready: carrying ${sim.player.carry.hay} hay. Press E to deposit through the real interaction; payment follows after ${WORLD.intake.transitSeconds}s.`);
}

function prepareShovel(): void {
  const sim = game.sim, p = sim.progress;
  p.wp = Math.max(p.wp, 10);
  p.money = Math.max(p.money, 1000);
  for (let n = 0; n < 4 && !p.isUnlocked('p_hands@2'); n++) p.unlock('p_hands');
  if (!p.isUnlocked('p_shovel')) p.unlock('p_shovel');
  p.ownedTools.delete('shovel');
  sim.player.equipped = 'hands';
  p.money = 100;
  const s = WORLD.store, mid = (s.z0 + s.z1) / 2;
  lookAt(s.x + 3, mid, s.x + 0.6, 1.35, mid);
  report(`Ready: Shovel unlocked, unowned, $100 available. Press E to open the actual SUPPLY CO., then buy the $${TOOLS.shovel.cost} Shovel.`);
}

function intakeLoads(): readonly IntakeLoad[] {
  return (game.sim.sellStation as unknown as { intakeLoads(): readonly IntakeLoad[] }).intakeLoads();
}

let stressNeedleSweep = 0;
function floodIntake(): void {
  const sim = game.sim;
  if (sim.player.wheelbarrow) sim.player.wheelbarrow.held = false;
  sim.player.carry.clear();
  let accepted = 0;
  for (let i = 0; i < 96; i++) {
    sim.player.carry.add('hay', 5);
    if (depositToIntake(sim)) accepted++;
  }
  const loads = intakeLoads();
  // Spread this stress fixture over the belt so the render cap can be inspected in one frame.
  loads.forEach((load, index) => { load.t = index / loads.length * WORLD.intake.transitSeconds * 0.8; });
  sellerView();
  stressNeedleSweep = 0;
  const start = performance.now();
  const observeScale = () => {
    const angle = qa.renderer.scene.getObjectByName('seller-scale-needle')?.rotation.x;
    if (angle !== undefined) stressNeedleSweep = Math.max(stressNeedleSweep, Math.abs(angle - Math.PI * .73));
    if (performance.now() - start < 3500) requestAnimationFrame(observeScale);
  };
  requestAnimationFrame(observeScale);
  report(`Stress fixture: ${accepted}/96 deposits accepted; ${loads.length} intake loads, 480 hay added. Live metrics show rendering and sale totals.`);
}

async function loadLate(): Promise<void> {
  report('Loading the repository late-game fixture into memory…');
  const response = await fetch(new URL('../tests/fixtures/rc1-late-save.json', import.meta.url));
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  const fixture = await response.json() as { sim: unknown };
  qa.bindSim(Sim.fromSave(fixture.sim), false);
  overview();
  report(`Loaded late fixture: ${game.sim.buildings.size} buildings; seed ${game.sim.seed}. Use the view buttons to inspect coexistence with the factory.`);
}

function updateMetrics(): void {
  const r = qa.renderer.stats(), p = game.sim.progress;
  const values = {
    mode: game.getMode(), drawCalls: r.drawCalls, triangles: r.triangles,
    carry: Math.round(game.sim.player.carry.weight() * 100) / 100,
    money: Math.round(p.money * 100) / 100, haySold: Math.round(p.stats.haySold * 100) / 100,
    shovelOwned: p.ownedTools.has('shovel'), intakeCount: intakeLoads().length,
    fps: Math.round(game.getFps()), quality: game.settings.quality,
    stressNeedleSweep: Number(stressNeedleSweep.toFixed(3)),
    scaleAngle: Number((qa.renderer.scene.getObjectByName('seller-scale-needle')?.rotation.x ?? 0).toFixed(3)),
    width: qa.renderer.resolution().cssWidth, height: qa.renderer.resolution().cssHeight,
  };
  metrics.textContent = Object.entries(values).map(([key, value]) => `${key}: ${value}`).join(' · ');
  for (const [key, value] of Object.entries(values)) metrics.dataset[key] = String(value);
}

function button(id: string, action: () => void | Promise<void>): void {
  document.getElementById(id)!.addEventListener('click', async event => {
    (event.currentTarget as HTMLButtonElement).blur();
    try { await action(); updateMetrics(); }
    catch (error) { console.error('[market-qa]', error); report(`FAILED: ${String(error)}`); }
  });
}

button('qa-seller', sellerView);
button('qa-seller-photo', () => { const s = WORLD.fixed.sellStation; lookAt(s.x + 5, s.z - 2, s.x + .5, 1.6, s.z - .5); });
button('qa-supply-close', () => { const s = WORLD.store; lookAt(s.x + 3.9, -1, s.x + .5, 1.35, -1); });
button('qa-supply', supplyView);
button('qa-overview', overview);
button('qa-spawn', spawnView);
button('qa-carry', prepareHay);
button('qa-shovel', prepareShovel);
button('qa-flood', floodIntake);
button('qa-late', loadLate);
button('qa-fresh', () => { qa.bindSim(new Sim(1000), true); spawnView(); report('Fresh deterministic QA run (seed 1000).'); });
button('qa-play', play);
button('qa-pause', () => { game.actions.setMode('paused'); });
button('qa-hide', () => { toolbar.hidden = true; });
window.addEventListener('keydown', event => {
  if (event.code === 'F8') { event.preventDefault(); toolbar.hidden = !toolbar.hidden; }
});

game.ready();
game.start();
spawnView();
updateMetrics();
setInterval(updateMetrics, 500);
report('Ready. Select a view or interaction fixture. F8 toggles the QA toolbar.');
