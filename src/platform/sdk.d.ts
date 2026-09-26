/**
 * Typings for the documented subset of the CrazyGames HTML5 SDK v3 used by Project Needle.
 * The SDK script (`https://sdk.crazygames.com/crazygames-sdk-v3.js`) is included by index.html and exposes
 * `window.CrazyGames.SDK`. Only documented APIs are declared here; everything is optional at runtime
 * because the script can be missing or blocked (ad blockers, offline, self-hosting).
 */

export type CrazyEnvironment = 'local' | 'crazygames' | 'disabled';

export interface CrazyGameSettings {
  muteAudio: boolean;
  disableChat: boolean;
}

export type CrazySettingsListener = (settings: CrazyGameSettings) => void;

export interface CrazyGameModule {
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  happytime(): void;
  reportGameCompletedPercentage(percentage: number): void;
  readonly settings: CrazyGameSettings;
  addSettingsChangeListener(listener: CrazySettingsListener): void;
  removeSettingsChangeListener(listener: CrazySettingsListener): void;
  setGameContext(context: Record<string, unknown>): void;
  clearGameContext(): void;
}

/** Error shape thrown by the data module. `dataLimitExcedeed` is the SDK's own spelling. */
export interface CrazyDataError {
  code: 'dataLimitExcedeed' | 'dataModuleDisabled' | 'other';
  message: string;
}

/** localStorage-like, synchronous, 1 MB total limit, synced to the player's CrazyGames account. */
export interface CrazyDataModule {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface CrazySystemInfo {
  countryCode?: string;
  locale?: string;
  device?: { type: 'desktop' | 'tablet' | 'mobile' };
  os?: { name: string; version: string };
  browser?: { name: string; version: string };
  applicationType?: string;
}

export interface CrazyUserModule {
  readonly systemInfo?: CrazySystemInfo;
}

export interface CrazyGamesSDK {
  init(): Promise<void>;
  readonly environment: CrazyEnvironment;
  readonly game: CrazyGameModule;
  readonly data: CrazyDataModule;
  readonly user?: CrazyUserModule;
}

declare global {
  interface Window {
    CrazyGames?: { SDK?: CrazyGamesSDK };
  }
}
