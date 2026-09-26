import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { BUILDABLES, LOGISTICS_TYPES } from '../config/buildables';
import { NEEDLE_COUNT } from '../config/needles';
import { ORDER_BY_ID } from '../config/orders';
import { TOOLS } from '../config/tools';
import { WORLD } from '../config/world';
import { AudioEngine } from '../audio/audioEngine';
import type { LoopId, SfxId } from '../audio/api';
import type { Analytics } from '../platform/analytics';
import type { Platform } from '../platform/crazygames';
import { trackRunProgress } from '../platform/progress';
import { Renderer } from '../render/renderer';
import { Environment } from '../render/environment';
import { HayView } from '../render/hayView';
import { NeedleView } from '../render/needleView';
import { BeltView } from '../render/beltView';
import { BuildingViews } from '../render/buildingViews';
import { Ghost } from '../render/ghost';
import { PowerWires } from '../render/powerWires';
import { Particles } from '../render/particles';
import { Fx } from '../render/fx';
import { createModel, createToolViewModel } from '../render/models/index';
import type { ModelInstance, ToolViewKind, ToolViewModel } from '../render/models/api';
import type { Building, BuildingInfo } from '../sim/building';
import type { DetectorReading } from '../sim/interfaces';
import {
  carryCapacity, detectorReading, pickupNeedle, playerDig, playerVacuum, spawnWheelbarrow, toggleWheelbarrow,
} from '../sim/playerActions';
import { Sim } from '../sim/sim';
import type { BuildingType, SplitterMode, ToolId } from '../sim/types';
import { TOOL_ORDER } from '../sim/types';
import { UI } from '../ui/ui';
import type { AimState, BuildHudState, GameMode, UIActions, UIContext } from '../ui/context';
import { BuildMode } from './buildMode';
import { AutoQuality } from './autoQuality';
import { advanceFixed, type FixedStepState } from './fixedStep';
import { Hints, type Hint } from './hints';
import { Input } from './input';
import { Interaction, type Aim } from './interaction';
import { PlayerController } from './playerController';
import { SaveManager, type GameMeta } from './saveManager';
import type { Settings } from './settings';
import { Waypoint } from './waypoint';

const PANEL_KEYS: Record<string, GameMode> = { KeyT: 'workTree', KeyB: 'shop', KeyO: 'orders' };
const SIM_RUNNING_MODES = new Set<GameMode>(['play', 'build', 'workTree', 'shop', 'orders']);
const GAMEPLAY_MODES = new Set<GameMode>(['play', 'build']);
/** Simulation catch-up limit per rendered frame. */
const MAX_SIM_STEPS_PER_FRAME = 5;

const LOOP_FOR: Partial<Record<BuildingType, LoopId>> = {
  hayGenerator: 'generator', scannerMk1: 'scanner', scannerMk2: 'scanner', vacuumCollector: 'collector',
  roboticArm: 'arm', pistonRake: 'rake', compressor: 'compressor', wrapper: 'wrapper', beltLift: 'lift',
};

const CYCLE_SFX: Partial<Record<BuildingType, SfxId>> = {
  pistonRake: 'rakeThunk', roboticArm: 'armDrop', compressor: 'compressorPress', wrapper: 'wrapperDone', scannerMk1: 'scannerBeep', scannerMk2: 'scannerBeep',
  splitter: 'splitterClick',
};

const DIG_SFX: Record<ToolId, SfxId> = { hands: 'grabHay', shovel: 'shovel', bucket: 'bucket', pitchfork: 'pitchfork', vacuum: 'dig', detector: 'dig' };

/**
 * The game: owns the Sim and every presentation system, runs the loop, maps input to actions,
 * implements the UI contract and the platform lifecycle (CrazyGames gameplay start/stop, saves).
 */
export class Game implements UIContext {
  sim!: Sim;
  settings: Settings;
  readonly actions: UIActions;

  private renderer: Renderer;
  private env: Environment;
  private hayView!: HayView;
  private needleView!: NeedleView;
  private beltView!: BeltView;
  private buildingViews!: BuildingViews;
  private ghost!: Ghost;
  private wires!: PowerWires;
  private particles: Particles;
  private fx: Fx | null = null;
  private waypoint: Waypoint;
  private barrowModel: ModelInstance | null = null;

  private input: Input;
  private controller!: PlayerController;
  private interaction!: Interaction;
  private build!: BuildMode;
  private hints!: Hints;
  private ui: UI | null = null;
  private audio: AudioEngine;
  private saves: SaveManager;
  private meta: GameMeta = { hintsDone: [], continuedAfterCompletion: false };

  private mode: GameMode = 'loading';
  private readonly fixed: FixedStepState = { accumulator: 0 };
  private readonly simTick = (step: number) => this.sim.tick(step);
  private alpha = 0;
  private lastFrame = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private fps = 60;
  private readonly autoQuality = new AutoQuality();
  private sessionTime = 0;
  private autosaveTimer = 0;
  private contextTimer = 0;
  private expectUnlock = false;
  private topologyVersion = 0;
  private lastTopology = -1;
  private unsub: (() => void)[] = [];

  // aim / tools
  private aimed: Aim | null = null;
  private aimState: AimState = { prompt: null, info: null, hay: false };
  private detector: DetectorReading | null = null;
  private detectorBeepAt = 0;
  private vmodels = new Map<ToolViewKind, ToolViewModel>();
  private currentVM: ToolViewModel | null = null;
  private currentVMKind: ToolViewKind | null = null;
  private actionT = 1;
  private actionDur = 0.3;
  private vacuuming = false;
  private hint: Hint | null = null;
  private flags = new Set<string>();
  private summaryTimer = -1;
  private raycastO = new THREE.Vector3();
  private raycastD = new THREE.Vector3();

  constructor(
    private readonly container: HTMLElement,
    private readonly uiRoot: HTMLElement,
    private readonly platform: Platform,
    private readonly analytics: Analytics,
  ) {
    this.saves = new SaveManager(platform.storage);
    this.settings = this.saves.loadSettings();
    this.renderer = new Renderer(container, this.settings.quality);
    this.renderer.camera.rotation.order = 'YXZ';
    this.renderer.setFov(this.settings.fov);
    this.env = new Environment(this.renderer.scene, this.settings.quality);
    this.particles = new Particles(this.renderer.scene, this.settings.quality);
    this.waypoint = new Waypoint(this.renderer.scene);
    this.renderer.scene.add(this.renderer.camera);
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.audio = new AudioEngine();
    this.audio.setVolumes({ master: this.settings.masterVolume, sfx: this.settings.sfxVolume, music: this.settings.musicVolume });
    this.audio.setMusicEnabled(this.settings.music);
    this.audio.setPlatformMuted(platform.isMuted);
    platform.onMuteChange((m) => this.audio.setPlatformMuted(m));
    this.actions = this.makeActions();

    const loaded = this.saves.load();
    if (loaded) { this.meta = loaded.meta; this.bindSim(loaded.sim); }
    else this.bindSim(new Sim(this.newSeed()));

    this.renderer.domElement.addEventListener('click', () => {
      if (this.mode === 'clickToPlay') this.startPlaying();
    });
    window.addEventListener('resize', () => this.renderer.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.saveGame(true); this.audio.setPaused(true); } else this.audio.setPaused(this.mode === 'paused');
    });
    window.addEventListener('pagehide', () => {
      this.saveGame(true);
      this.analytics.track('quit_state', this.quitState());
      this.analytics.trackSessionEnd();
    });
    this.analytics.track('game_loaded', { hasSave: !!loaded });
  }

  private newSeed(): number { return (Math.random() * 0xffffffff) >>> 0; }

  // =====================================================================================
  // Sim binding
  // =====================================================================================

  private bindSim(sim: Sim): void {
    this.unbindSim();
    this.sim = sim;
    const scene = this.renderer.scene;
    const q = this.settings.quality;
    this.hayView = new HayView(scene, sim.hay, q);
    this.needleView = new NeedleView(scene);
    this.beltView = new BeltView(scene, q);
    this.buildingViews = new BuildingViews(scene);
    this.ghost = new Ghost(scene);
    this.wires = new PowerWires(scene, q);
    this.fx = new Fx(sim.events, this.particles);
    this.controller = new PlayerController(sim);
    this.controller.onFootstep = () => this.audio.play('footstep', { volume: 0.5 });
    this.controller.onJump = () => this.audio.play('jump', { volume: 0.6 });
    this.controller.onLand = (v) => this.audio.play('land', { volume: Math.min(1, v / 10) });
    this.interaction = new Interaction(sim);
    this.build = new BuildMode(sim, this.interaction, {
      setGridVisible: (on) => this.env.setGridVisible(on),
      showGhost: (type, cell, rot, variant, valid, ports, connected) => this.ghost.show(type, cell, rot, variant, valid, ports, connected),
      showBeltPath: (steps, valid) => this.ghost.showBeltPath(steps, valid),
      hideGhost: () => this.ghost.hide(),
      setHighlight: (id, mode) => this.buildingViews.setHighlight(id, mode),
    }, { play: (id) => this.audio.play(id) }, (c) => this.input.label(c));
    this.hints = new Hints(this.meta.hintsDone);
    this.flags = new Set();
    this.env.setAnnexOpen(sim.stat('global.warehouseExpansion') >= 1);
    this.env.setNeedleSlots(sim.progress.needlesFound.length);
    this.refreshOrderBoard();
    this.topologyVersion++;
    if (sim.player.wheelbarrow) this.ensureBarrowModel();
    this.subscribeSimEvents();
    this.ui = new UI(this.uiRoot, this);
    // CrazyGames completion: reported now (new game 0 / loaded save), on each needle and on completion.
    this.unsub.push(trackRunProgress(this.platform, sim, NEEDLE_COUNT));
    this.setMode(this.mode === 'loading' ? 'clickToPlay' : 'clickToPlay');
  }

  private unbindSim(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.ui?.destroy(); this.ui = null;
    this.fx?.dispose?.(); this.fx = null;
    this.hayView?.dispose(); this.needleView?.dispose(); this.beltView?.dispose(); this.buildingViews?.dispose();
    this.ghost?.dispose(); this.wires?.dispose();
    this.barrowModel?.root.removeFromParent(); this.barrowModel?.dispose(); this.barrowModel = null;
  }

  private subscribeSimEvents(): void {
    const ev = this.sim.events;
    const on: typeof ev.on = (t, fn) => { const u = ev.on(t, fn); this.unsub.push(u); return u; };
    const near = (p: { x: number; z: number }, r = 30) => Math.hypot(p.x - this.controller.x, p.z - this.controller.z) < r;
    const topo = () => { this.topologyVersion++; };
    on('building:placed', (e) => {
      topo();
      if (e.type !== 'sellStation') {
        if (!LOGISTICS_TYPES.has(e.type) && e.type !== 'platform' && e.type !== 'stairs' && e.type !== 'powerPole') this.analytics.once('first_machine', { type: e.type });
        if (e.type === 'conveyor') this.analytics.once('first_conveyor');
        if (e.type === 'roboticArm') this.analytics.once('first_arm');
        if (e.type === 'scannerMk1' || e.type === 'scannerMk2') this.analytics.once('first_scanner');
        const machines = this.sim.progress.stats.machinesBuilt;
        if (machines === 10 || machines === 25) this.analytics.once(`factory_${machines}_machines`);
      }
    });
    on('building:removed', topo);
    on('building:moved', topo);
    on('node:unlocked', (e) => {
      topo();
      this.analytics.track('work_node_unlocked', { id: e.id, level: e.level });
      this.analytics.once('first_upgrade', { id: e.id });
      if (e.id === 'f_expansion') { this.env.setAnnexOpen(true); this.audio.play('complete', { volume: 0.5 }); }
    });
    on('sale', (e) => {
      this.analytics.once('first_sale');
      if (!e.viaBelt || near(e.pos, 25)) this.audio.play(e.value >= 500 ? 'sellBig' : 'sell', { pos: e.pos, volume: e.viaBelt ? 0.35 : 1 });
    });
    on('hay:extracted', (e) => {
      if (e.source === 'manual' || e.source === 'vacuumTool') this.analytics.once('first_hay');
      else this.analytics.once('first_automation', { source: e.source });
    });
    on('tool:bought', (e) => {
      this.audio.play('buy');
      if (e.tool === 'wheelbarrow') { spawnWheelbarrow(this.sim); this.ensureBarrowModel(); }
      else this.equip(e.tool);
    });
    on('order:completed', (e) => {
      this.audio.play('orderComplete');
      this.analytics.track('order_completed', { id: e.id, t: Math.round(this.sim.time) });
      this.refreshOrderBoard();
    });
    on('order:available', () => this.refreshOrderBoard());
    on('milestone', () => this.audio.play('milestone'));
    on('needle:found', (e) => {
      this.audio.play('needleFound');
      this.env.setNeedleSlots(this.sim.progress.needlesFound.length);
      this.analytics.once('first_needle', { by: e.by, t: Math.round(this.sim.time) });
      this.analytics.track('needle_found', { index: e.index + 1, by: e.by, t: Math.round(this.sim.time), progress: +this.sim.hay.progress().toFixed(3) });
      this.platform.happytime();
      this.saveGame(true);
    });
    on('needle:returned', (e) => this.audio.play('needleReturn', { pos: e.pos }));
    on('needle:exposed', (e) => { if (near(e.pos, 20)) this.audio.play('needleGlint', { pos: e.pos }); });
    on('scanner:alarm', (e) => this.audio.play('needleAlarm', { pos: e.pos }));
    on('machine:cycle', (e) => { const id = CYCLE_SFX[e.type]; if (id && near(e.pos, 22)) this.audio.play(id, { pos: e.pos, volume: 0.7 }); });
    on('generator:fed', (e) => this.audio.play('generatorFeed', { pos: e.pos }));
    on('player:deposit', (e) => this.audio.play('deposit', { pos: e.pos }));
    on('player:take', (e) => this.audio.play('take', { pos: e.pos }));
    on('player:full', () => this.audio.play('full', { volume: 0.7 }));
    on('player:denied', () => this.audio.play('deny', { volume: 0.7 }));
    on('power:changed', (e) => { if (e.satisfaction < 0.999 && e.demand > 0) this.flags.add('overloaded'); });
    on('game:completed', (e) => {
      this.audio.play('complete');
      this.platform.happytime();
      this.analytics.track('game_completed', { minutes: +(e.time / 60).toFixed(1) });
      this.saveGame(true);
      if (!this.meta.continuedAfterCompletion) this.summaryTimer = 4;
    });
  }

  private refreshOrderBoard(): void {
    const lines = this.sim.progress.activeOrders().map((o) => ORDER_BY_ID[o.id]?.title ?? o.id);
    this.env.setOrderBoard(lines);
  }

  private ensureBarrowModel(): void {
    if (this.barrowModel) return;
    this.barrowModel = createModel('wheelbarrow');
    this.renderer.scene.add(this.barrowModel.root);
  }

  // =====================================================================================
  // Modes / platform lifecycle
  // =====================================================================================

  private setMode(m: GameMode): void {
    if (this.mode === m) return;
    const wasGameplay = GAMEPLAY_MODES.has(this.mode);
    const prev = this.mode;
    this.mode = m;
    if (GAMEPLAY_MODES.has(m) && !wasGameplay) this.platform.gameplayStart();
    if (!GAMEPLAY_MODES.has(m) && wasGameplay) this.platform.gameplayStop();
    if (m !== 'build' && this.build?.active) this.build.exit();
    if (m === 'workTree') this.flags.add('workTreeOpened');
    if (m === 'workTree') this.analytics.once('work_tree_opened');
    if (m === 'orders') this.flags.add('ordersOpened');
    if (m === 'paused') { this.saveGame(true); this.audio.setPaused(true); }
    else if (prev === 'paused') this.audio.setPaused(false);
    if (['workTree', 'shop', 'orders'].includes(m)) this.audio.play('uiOpen');
    if (['workTree', 'shop', 'orders'].includes(prev) && GAMEPLAY_MODES.has(m)) this.audio.play('uiClose');
  }

  private startPlaying(): void {
    this.audio.unlock();
    this.input.requestLock();
    if (!this.flags.has('started')) { this.flags.add('started'); this.analytics.once('game_start'); }
    this.setMode('play');
  }

  private onLockChange(locked: boolean): void {
    if (locked) return;
    if (this.expectUnlock) { this.expectUnlock = false; return; }
    if (GAMEPLAY_MODES.has(this.mode)) this.setMode('paused');
  }

  /** Open a pointer-free panel. */
  private openPanel(m: GameMode): void {
    this.expectUnlock = this.input.locked;
    this.input.exitLock();
    this.setMode(m);
  }

  /** Back to FPS gameplay (requires a user gesture for pointer lock - key presses and clicks qualify). */
  private backToPlay(build = false): void {
    this.input.requestLock();
    this.setMode(build ? 'build' : 'play');
  }

  // =====================================================================================
  // Loop
  // =====================================================================================

  start(): void {
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private frame(now: number): void {
    const rawDt = Math.max(0, (now - this.lastFrame) / 1000);
    const dt = Math.min(0.1, rawDt);
    this.lastFrame = now;
    const time = now / 1000;
    this.sessionTime += dt;
    this.frameCount++;
    this.fpsTime += rawDt; // real frame time: the clamped dt would report >= 10 FPS on a 2 FPS machine
    if (this.fpsTime >= 0.5) { this.fps = this.frameCount / this.fpsTime; this.frameCount = 0; this.fpsTime = 0; }
    this.checkFrameRate(rawDt);

    this.handleGlobalKeys();

    // ----- simulation (fixed step)
    if (SIM_RUNNING_MODES.has(this.mode)) {
      this.alpha = advanceFixed(this.fixed, dt, BALANCE.tickDt, MAX_SIM_STEPS_PER_FRAME, this.simTick);
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= BALANCE.autosaveInterval) { this.autosaveTimer = 0; this.saveGame(true); }
      this.contextTimer += dt;
      if (this.contextTimer > 60) { this.contextTimer = 0; this.platform.setContext(this.quitState()); }
    }

    // ----- player
    const gameplay = GAMEPLAY_MODES.has(this.mode);
    if (gameplay && this.input.locked) this.controller.look(this.input.mouseDX, this.input.mouseDY, this.settings.sensitivity, this.settings.invertY);
    const barrow = this.sim.player.wheelbarrow;
    const speedMul = barrow?.held ? this.sim.stat('wheelbarrow.speedMul') : 1;
    this.controller.update(dt, gameplay ? this.input : null, speedMul);
    const cam = this.renderer.camera;
    cam.position.set(this.controller.x, this.controller.eyeY, this.controller.z);
    cam.rotation.set(this.controller.pitch, this.controller.yaw - Math.PI / 2, 0, 'YXZ');
    cam.getWorldDirection(this.raycastD);
    this.raycastO.copy(cam.position);
    const o = { x: this.raycastO.x, y: this.raycastO.y, z: this.raycastO.z };
    const d = { x: this.raycastD.x, y: this.raycastD.y, z: this.raycastD.z };

    // ----- wheelbarrow follows the player when held
    if (barrow?.held) {
      const f = this.controller.forward();
      barrow.pos.x = this.controller.x + f.x * 1.25;
      barrow.pos.z = this.controller.z + f.z * 1.25;
      barrow.pos.y = this.controller.groundAt(barrow.pos.x, barrow.pos.z, this.controller.y + 0.3);
      barrow.yaw = this.controller.yaw;
    }

    // ----- interaction / build
    if (this.mode === 'play') this.updatePlay(dt, o, d);
    else { this.aimState = { prompt: null, info: null, hay: false }; this.vacuuming = false; }
    if (this.mode === 'build') {
      if (this.build.update(o, d, this.input, time)) this.backToPlay(false);
      const aim = this.interaction.aim(o, d, 12, { hay: false, needles: false, barrow: false });
      this.aimState = { prompt: null, info: aim.building ? aim.building.info(this.sim) : null, hay: false };
    }

    // ----- views
    this.syncViews(dt, time);
    this.updateViewmodel(dt, time);
    this.updateAudio(dt);

    // ----- hints
    this.hint = this.hints.update({ sim: this.sim, mode: this.mode, label: (c) => this.input.label(c), time: this.sessionTime, flags: this.flags });
    this.waypoint.set(this.mode === 'play' ? this.hint?.target : null);
    this.waypoint.update(dt, time);

    // ----- summary after completion
    if (this.summaryTimer > 0) {
      this.summaryTimer -= dt;
      if (this.summaryTimer <= 0) { this.summaryTimer = -1; this.openPanel('summary'); }
    }

    this.ui?.update(dt);
    this.renderer.render();
    this.input.endFrame();
  }

  private handleGlobalKeys(): void {
    const inp = this.input;
    const m = this.mode;
    if (m === 'loading') return;
    for (const code of Object.keys(PANEL_KEYS)) {
      if (!inp.wasPressed(code)) continue;
      const target = PANEL_KEYS[code];
      if (m === target) this.backToPlay(false);
      else if (GAMEPLAY_MODES.has(m) || m === 'workTree' || m === 'shop' || m === 'orders') this.openPanel(target);
      return;
    }
    if (inp.wasPressed('Escape') && (m === 'workTree' || m === 'shop' || m === 'orders')) { this.backToPlay(false); return; }
    if (m === 'play' && inp.wasPressed('KeyQ')) { this.setMode('build'); this.build.enter(); return; }
    if (m === 'build' && inp.wasPressed('KeyQ')) { this.setMode('play'); return; }
    if (m === 'play') {
      for (let i = 0; i < TOOL_ORDER.length; i++) {
        if (inp.wasPressed(`Digit${i + 1}`)) this.equip(TOOL_ORDER[i]);
      }
    }
  }

  private equip(tool: ToolId): void {
    if (!this.sim.progress.ownedTools.has(tool)) { this.audio.play('deny', { volume: 0.5 }); return; }
    if (this.sim.player.equipped !== tool) {
      this.sim.player.equipped = tool;
      this.flags.add('equippedTool');
      this.audio.play('uiClick', { volume: 0.6 });
    }
  }

  // =====================================================================================
  // Play mode: aiming, tools, interaction
  // =====================================================================================

  private updatePlay(dt: number, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }): void {
    const sim = this.sim;
    const tool = sim.player.equipped;
    const barrow = sim.player.wheelbarrow;
    const holding = !!barrow?.held;
    const reach = tool === 'vacuum' ? sim.stat('tool.vacuum.reach') : tool === 'detector' ? 3 : sim.stat(`tool.${tool}.reach`);
    const quickDump = sim.stat('tool.bucket.quickDump') >= 1 && sim.progress.ownedTools.has('bucket');
    const interactRange = sim.stat('player.interactRange');
    const maxAim = Math.max(reach, quickDump ? sim.stat('tool.bucket.dumpRange') : interactRange, 10);
    const aim = this.interaction.aim(o, d, maxAim);
    this.aimed = aim;

    // ----- prompt + tooltip
    let prompt: AimState['prompt'] = null;
    let info: BuildingInfo | null = null;
    if (aim.kind === 'building' && aim.building) {
      const b = aim.building;
      if (aim.distance <= 10) info = b.info(sim);
      const opt = b.interaction(sim);
      const range = opt?.kind === 'deposit' && quickDump ? sim.stat('tool.bucket.dumpRange') : interactRange;
      if (opt && aim.distance <= range) prompt = { key: 'E', text: opt.label, enabled: opt.enabled, reason: opt.reason };
    } else if (aim.kind === 'needle' && aim.distance <= interactRange) {
      prompt = { key: 'E', text: 'Pick up the needle!', enabled: true };
    } else if (aim.kind === 'wheelbarrow' && aim.distance <= interactRange) {
      prompt = { key: 'E', text: `Push wheelbarrow (${Math.round(barrow?.inv.weight() ?? 0)} hay)`, enabled: true };
    }
    if (!prompt && holding) prompt = { key: 'E', text: 'Park the wheelbarrow', enabled: true };
    this.aimState = { prompt, info, hay: aim.kind === 'hay' && aim.distance <= reach };

    // ----- E interact
    if (this.input.wasPressed('KeyE')) {
      if (aim.kind === 'building' && aim.building && prompt && prompt.text !== 'Park the wheelbarrow') {
        if (prompt.enabled) aim.building.interact(sim); else { this.audio.play('deny', { volume: 0.6 }); if (prompt.reason) sim.events.emit('player:denied', { reason: prompt.reason }); }
      } else if (aim.kind === 'needle' && aim.needleId !== undefined && aim.distance <= interactRange) {
        pickupNeedle(sim, aim.needleId);
      } else if (holding || (aim.kind === 'wheelbarrow' && aim.distance <= interactRange)) {
        if (toggleWheelbarrow(sim)) this.audio.play('wheelbarrowGrab');
      }
    }

    // ----- F: switch a powered machine on/off (GDD "Disabled" state)
    if (this.input.wasPressed('KeyF') && aim.kind === 'building' && aim.building && aim.building.def.power > 0 && aim.distance <= 10) {
      const b = aim.building;
      b.enabled = !b.enabled;
      this.audio.play(b.enabled ? 'uiClick' : 'powerDown', { pos: b.center, volume: 0.7 });
      sim.events.emit('toast', { text: `${b.def.name} switched ${b.enabled ? 'ON' : 'OFF'}`, kind: 'info' });
    }
    if (info && aim.building && aim.building.def.power > 0) {
      info = { ...info, lines: [...info.lines, { label: this.input.label('KeyF'), value: aim.building.enabled ? 'Switch off' : 'Switch on' }] };
      this.aimState.info = info;
    }

    // ----- tool use
    this.vacuuming = false;
    if (holding) return;
    const lmb = this.input.mouse(0);
    if (!lmb) return;
    if (aim.kind !== 'hay' || aim.distance > reach) {
      if (this.input.mouseWasPressed(0) && tool !== 'detector' && aim.kind === 'none') this.audio.play('dig', { volume: 0.2 });
      return;
    }
    const p = aim.point;
    if (tool === 'vacuum') {
      const r = playerVacuum(sim, dt, p.x, p.y, p.z);
      this.vacuuming = r.amount > 0;
    } else if (tool !== 'detector') {
      const r = playerDig(sim, tool, p.x, p.y, p.z);
      if (r.amount > 0) {
        this.actionT = 0;
        this.actionDur = Math.max(0.12, sim.stat(`tool.${tool}.interval`));
        this.audio.play(DIG_SFX[tool], { pos: p });
      }
    }
  }

  // =====================================================================================
  // Views
  // =====================================================================================

  private syncViews(dt: number, time: number): void {
    const sim = this.sim;
    if (this.lastTopology !== this.topologyVersion) {
      this.lastTopology = this.topologyVersion;
      this.beltView.sync(sim.buildings);
      this.buildingViews.sync(sim.buildings);
    }
    this.wires.sync(sim.power.wires, sim.power.feeds, sim.buildings);
    this.hayView.update();
    this.needleView.sync(sim.hay.needles);
    this.needleView.update?.(dt, time);
    this.beltView.update(sim.logistics, this.alpha, time, sim.stat('belt.speed'));
    this.buildingViews.update(dt, time);
    this.particles.update(dt, this.renderer.camera);
    const wb = sim.player.wheelbarrow;
    if (wb && this.barrowModel) {
      this.barrowModel.root.position.set(wb.pos.x, wb.pos.y, wb.pos.z);
      this.barrowModel.root.rotation.y = wb.yaw;
      this.barrowModel.update({ fill: Math.min(1, wb.inv.weight() / Math.max(1, sim.stat('wheelbarrow.capacity'))), held: wb.held ? 1 : 0 }, dt, time);
    }
  }

  private updateViewmodel(dt: number, time: number): void {
    const sim = this.sim;
    const holding = !!sim.player.wheelbarrow?.held;
    const kind: ToolViewKind = holding ? 'wheelbarrow' : sim.player.equipped;
    if (kind !== this.currentVMKind) {
      if (this.currentVM) this.currentVM.root.visible = false;
      let vm = this.vmodels.get(kind);
      if (!vm) { vm = createToolViewModel(kind); this.vmodels.set(kind, vm); this.renderer.camera.add(vm.root); }
      vm.root.visible = true;
      this.currentVM = vm;
      this.currentVMKind = kind;
    }
    const vm = this.currentVM;
    if (!vm) return;
    vm.root.visible = this.mode === 'play' || this.mode === 'build';
    this.actionT = Math.min(1, this.actionT + dt / this.actionDur);
    const cap = carryCapacity(sim);
    let det: { strength: number; dirAngle: number; distance: number; tooDeep: boolean; directional: boolean; precise: boolean } | undefined;
    this.detector = null;
    if (kind === 'detector' && this.mode === 'play') {
      const r = detectorReading(sim);
      this.detector = r;
      // direction relative to where the player looks (radians, 0 = straight ahead, + = left)
      const f = this.controller.forward();
      const rel = Math.atan2(f.x * r.dirZ - f.z * r.dirX, f.x * r.dirX + f.z * r.dirZ);
      det = { strength: r.strength, dirAngle: -rel, distance: r.distance, tooDeep: r.tooDeep, directional: sim.stat('tool.detector.directional') >= 1, precise: sim.stat('tool.detector.precision') >= 1 };
      // beeps: faster when closer
      if (r.strength > 0.01) {
        const interval = 1.1 - r.strength * 1.0;
        if (time - this.detectorBeepAt > Math.max(0.07, interval)) { this.detectorBeepAt = time; this.audio.play('detectorBeep', { pitch: 0.8 + r.strength * 0.8, volume: 0.35 + r.strength * 0.5 }); }
      } else if (r.tooDeep && time - this.detectorBeepAt > 1.6) { this.detectorBeepAt = time; this.audio.play('detectorTooDeep', { volume: 0.4 }); }
    }
    vm.update(dt, time, {
      action: this.actionT < 1 ? this.actionT : 0,
      walking: this.controller.walk,
      load: cap > 0 ? Math.min(1, sim.player.carry.weight() / cap) : 0,
      suck: this.vacuuming ? 1 : 0,
      detector: det,
    });
  }

  private updateAudio(dt: number): void {
    const sim = this.sim;
    this.audio.setListener({ x: this.controller.x, y: this.controller.eyeY, z: this.controller.z }, this.controller.yaw);
    this.audio.loop('ambience', 'ambience', null, 1);
    if (this.vacuuming) this.audio.loop('vacuumTool', 'vacuumTool', null, 1);
    if (SIM_RUNNING_MODES.has(this.mode)) {
      const px = this.controller.x, pz = this.controller.z;
      for (const b of sim.buildings.values()) {
        const c = b.center;
        const dist = Math.hypot(c.x - px, c.z - pz);
        if (dist > 32) continue;
        if (b.type === 'conveyor') {
          if (b.rateOut.value > 0.5) this.audio.loop(`b${b.id}`, 'belt', c, Math.min(1, b.rateOut.value / 50));
          continue;
        }
        const loop = LOOP_FOR[b.type];
        if (!loop) continue;
        const working = b.status === 'running' || b.status === 'processing' || b.status === 'lowPower';
        if (working) this.audio.loop(`b${b.id}`, loop, c, b.status === 'lowPower' ? 0.6 : 1);
      }
    }
    this.audio.update(dt);
  }

  // =====================================================================================
  // Saving
  // =====================================================================================

  saveGame(auto: boolean): void {
    if (!this.sim || this.mode === 'loading') return;
    this.meta.hintsDone = this.hints?.doneIds() ?? this.meta.hintsDone;
    if (this.saves.save(this.sim, this.meta)) this.sim.events.emit('game:saved', { auto });
  }

  private quitState(): Record<string, unknown> {
    const s = this.sim;
    return {
      minutes: +(s.time / 60).toFixed(1), needles: s.progress.needlesFound.length, pile: +(s.hay.progress() * 100).toFixed(1),
      money: Math.round(s.progress.money), nodes: s.progress.nodes.size, machines: s.progress.stats.machinesBuilt, mode: this.mode,
    };
  }

  // =====================================================================================
  // UIContext
  // =====================================================================================

  getMode(): GameMode { return this.mode; }
  getBuildHud(): BuildHudState {
    if (this.mode === 'build' && this.build.active) return this.build.hud();
    return { active: false, tool: 'place', item: null, rot: 0, cost: 0, valid: false, hints: [] };
  }
  getAim(): AimState { return this.aimState; }
  getDetector(): DetectorReading | null { return this.detector; }
  getFps(): number { return this.fps; }
  keyLabel(code: string): string { return this.input.label(code); }
  getHint(): { text: string; key?: string } | null { return this.hint ? { text: this.hint.text, key: this.hint.key } : null; }
  isTouchOnly(): boolean { return this.platform.isTouchOnlyDevice(); }
  /** Settings panel: the selected quality only fully applies after a reload (anti-aliasing). */
  graphicsReloadRequired(): boolean { return this.renderer.needsReloadFor(this.settings.quality); }
  get lastSavedAt(): number { return this.saves.lastSavedAt; }

  private makeActions(): UIActions {
    return {
      setMode: (m) => {
        if (m === 'play') this.backToPlay(false);
        else if (m === 'build') this.backToPlay(true);
        else if (m === 'workTree' || m === 'shop' || m === 'orders' || m === 'paused' || m === 'summary') this.openPanel(m);
        else this.setMode(m);
      },
      unlockNode: (id) => {
        if (this.sim.progress.unlock(id)) this.audio.play('unlock');
        else this.audio.play('deny');
      },
      buyTool: (id) => {
        if (!this.sim.progress.buyTool(id)) this.audio.play('deny');
      },
      selectBuildable: (type, variant) => {
        if (!this.sim.progress.buildingUnlocked(type)) { this.audio.play('deny'); return; }
        this.input.requestLock();
        this.setMode('build');
        this.build.enter(type, variant);
      },
      setSettings: (patch) => this.applySettings(patch),
      newGame: () => {
        this.saves.clear();
        this.meta = { hintsDone: this.hints?.doneIds() ?? [], continuedAfterCompletion: false };
        this.bindSim(new Sim(this.newSeed()));
        this.setMode('clickToPlay');
      },
      continueAfterCompletion: () => { this.meta.continuedAfterCompletion = true; this.backToPlay(false); },
      resume: () => this.backToPlay(false),
      saveNow: () => this.saveGame(false),
      toggleBuildingEnabled: (id) => { const b = this.sim.buildings.get(id); if (b) { b.enabled = !b.enabled; this.audio.play('uiClick'); } },
      setSplitterMode: (id, mode: SplitterMode, filter?: number) => {
        const b = this.sim.buildings.get(id) as (Building & { setMode?: (m: SplitterMode, f?: number) => void }) | undefined;
        b?.setMode?.(mode, filter);
      },
      playUiSound: (id) => this.audio.play(id),
    };
  }

  /** GPU failsafe (see AutoQuality): lowers the preset one step when gameplay stays below ~24 FPS. */
  private checkFrameRate(frameSeconds: number): void {
    const active = GAMEPLAY_MODES.has(this.mode) && !document.hidden;
    const next = this.autoQuality.frame(frameSeconds, active, this.settings.quality, this.settings.qualityManual);
    if (!next) return;
    this.applySettings({ quality: next });
    this.autoQuality.restart();
    this.sim.events.emit('toast', {
      text: `Graphics set to ${next === 'low' ? 'Low' : 'Medium'} to keep the game smooth. Change it in Settings (Esc).`, kind: 'info',
    });
  }

  private applySettings(patch: Partial<Settings>): void {
    const prevQuality = this.settings.quality;
    this.settings = { ...this.settings, ...patch };
    this.audio.setVolumes({ master: this.settings.masterVolume, sfx: this.settings.sfxVolume, music: this.settings.musicVolume });
    this.audio.setMusicEnabled(this.settings.music);
    this.renderer.setFov(this.settings.fov);
    if (this.settings.quality !== prevQuality) {
      // Everything but MSAA applies live (see graphicsReloadRequired).
      const q = this.settings.quality;
      this.renderer.setQuality(q);
      this.env.setQuality(q);
      this.hayView.setQuality(q);
      this.beltView.setQuality(q);
      this.particles.setQuality(q);
      this.wires.setQuality(q);
    }
    this.saves.saveSettings(this.settings);
  }

  /** Called by main.ts once everything is loaded. */
  ready(): void {
    this.setMode('clickToPlay');
    void BUILDABLES; void TOOLS; void WORLD;
  }
}
