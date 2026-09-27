import type { BuildingInfo } from '../sim/building';
import type { DetectorReading } from '../sim/interfaces';
import type { Sim } from '../sim/sim';
import type { BuildingType, SplitterMode, ToolId } from '../sim/types';
import type { Settings } from '../game/settings';
import type { WelcomeBackInfo } from '../game/welcomeBack';

/**
 * UI CONTRACT. The game (src/game/game.ts) implements UIContext; the UI (src/ui/*) renders DOM from it.
 * The UI never mutates the sim directly - it calls `actions`.
 */
export type GameMode =
  | 'loading'      // assets / SDK init
  | 'clickToPlay'  // waiting for the first click (pointer lock + audio unlock). Also shown after focus loss.
  | 'play'         // FPS gameplay (pointer locked)
  | 'build'        // build mode (pointer locked, ghost preview)
  | 'workTree'     // Work Tree panel (pointer free)
  | 'shop'         // Build Shop / catalog (pointer free)
  | 'orders'       // Order board (pointer free)
  | 'paused'       // pause + settings (pointer free)
  | 'summary';     // final run summary (pointer free)

export type BuildTool = 'place' | 'belt' | 'remove' | 'move';

export interface BuildHudState {
  active: boolean;
  tool: BuildTool;
  item: BuildingType | null;
  variant?: string;
  rot: number;
  cost: number;
  valid: boolean;
  reason?: string;
  /** Belt routing mode (F cycles). */
  routeMode?: 'auto' | 'xFirst' | 'zFirst';
  /** Belt placement: number of tiles in the current plan (0 when choosing the start). */
  beltTiles?: number;
  /** Belt placement: waiting for end click. */
  beltStarted?: boolean;
  /** Remove/move target info. */
  targetName?: string;
  refund?: number;
  /** Predicted power network for powered machines (-1 = would be unpowered). */
  network?: number;
  /** Key hints, already layout-aware. */
  hints: { key: string; label: string }[];
}

export interface AimState {
  /** Interaction prompt near the crosshair, e.g. { key: 'E', text: 'Sell 35 hay' }. */
  prompt: { key: string; text: string; enabled: boolean; reason?: string } | null;
  /** Tooltip for the aimed building. */
  info: BuildingInfo | null;
  /** Aiming at diggable hay within reach. */
  hay: boolean;
}

export interface UIActions {
  setMode(mode: GameMode): void;
  unlockNode(id: string): void;
  buyTool(id: ToolId | 'wheelbarrow'): void;
  /** Pick a buildable in the shop -> closes the shop and enters build mode with it selected. */
  selectBuildable(type: BuildingType, variant?: string): void;
  setSettings(patch: Partial<Settings>): void;
  newGame(): void;
  continueAfterCompletion(): void;
  resume(): void;
  saveNow(): void;
  toggleBuildingEnabled(id: number): void;
  setSplitterMode(id: number, mode: SplitterMode, filter?: number): void;
  playUiSound(id: 'uiClick' | 'uiHover' | 'uiOpen' | 'uiClose' | 'deny' | 'buy' | 'unlock'): void;
}

export interface UIContext {
  readonly sim: Sim;
  readonly settings: Settings;
  readonly actions: UIActions;
  getMode(): GameMode;
  getBuildHud(): BuildHudState;
  getAim(): AimState;
  /** Metal detector reading while the detector is equipped (null otherwise). */
  getDetector(): DetectorReading | null;
  getFps(): number;
  /** Layout-aware key label for a KeyboardEvent.code ("KeyW" -> "W" on QWERTY, "Z" on AZERTY). */
  keyLabel(code: string): string;
  /** First-time contextual hint to show (onboarding), or null. */
  getHint(): { text: string; key?: string } | null;
  /** Is the game running on a touch-only device (unsupported notice). */
  isTouchOnly(): boolean;
  /** Welcome Back card after a real absence (read-only), null otherwise. Optional for test doubles. */
  getWelcomeBack?(): WelcomeBackInfo | null;
  /** Analytics notice on the title screen (CrazyGames "User Consent"), null when nothing is sent remotely. */
  getPrivacyNotice?(): { policyUrl: string | null } | null;
}
