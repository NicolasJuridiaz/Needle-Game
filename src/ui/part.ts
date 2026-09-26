import type { GameEvents } from '../core/events';
import type { GameMode, UIActions, UIContext } from './context';
import { h } from './dom';
import { keyText, mouseKey } from './format';
import { icon } from './icons';

/** Every UI component: built once, updated each frame with the current mode, destroyed with the UI. */
export interface UIPart {
  update(dt: number, mode: GameMode): void;
  destroy(): void;
}

export type Listen = <K extends keyof GameEvents>(type: K, fn: (e: GameEvents[K]) => void) => void;
export type UiSound = Parameters<UIActions['playUiSound']>[0];

/** Shared environment handed to every component. */
export interface PartEnv {
  readonly ctx: UIContext;
  /** Subscribe to a sim event; automatically unsubscribed when the UI is destroyed. */
  readonly listen: Listen;
  /** UI sound (hover sounds are throttled). */
  sound(id: UiSound): void;
}

/** Modes in which the in-world HUD is shown. */
export const HUD_MODES: ReadonlySet<GameMode> = new Set<GameMode>(['play', 'build']);
/** Modes in which the simulation advances (live notifications may play). */
export const LIVE_MODES: ReadonlySet<GameMode> = new Set<GameMode>(['play', 'build', 'workTree', 'shop', 'orders']);

// ---------------------------------------------------------------------------------------
// Buttons & key caps
// ---------------------------------------------------------------------------------------

export interface ButtonOpts {
  /** Extra classes (e.g. 'pn-btn--primary'). */
  cls?: string;
  icon?: string;
  label?: string;
  /** Sound on click; null = silent (the action plays its own sound). Default 'uiClick'. */
  sound?: UiSound | null;
  title?: string;
}

/** Creates a button with hover/press feedback and UI sounds. */
export function button(env: PartEnv, parent: HTMLElement, opts: ButtonOpts, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = h('button', 'pn-btn' + (opts.cls ? ' ' + opts.cls : ''), parent);
  b.type = 'button';
  if (opts.title) b.title = opts.title;
  if (opts.icon) b.insertAdjacentHTML('beforeend', icon(opts.icon));
  if (opts.label !== undefined) h('span', 'pn-btn-label', b, opts.label);
  wireSounds(env, b, opts.sound === undefined ? 'uiClick' : opts.sound);
  b.addEventListener('click', (ev) => {
    if (b.disabled) return;
    onClick(ev);
  });
  return b;
}

/** Hover + click sounds for any interactive element. */
export function wireSounds(env: PartEnv, el: HTMLElement, click: UiSound | null = 'uiClick'): void {
  el.addEventListener('pointerenter', () => {
    if (!(el as HTMLButtonElement).disabled) env.sound('uiHover');
  });
  if (click) {
    el.addEventListener('click', () => {
      if (!(el as HTMLButtonElement).disabled) env.sound(click);
    });
  }
}

const MOUSE_SVG = (btn: 'L' | 'R' | 'M' | 'W') =>
  `<svg class="pn-mouse" viewBox="0 0 16 22" aria-hidden="true"><rect x="1.2" y="1.2" width="13.6" height="19.6" rx="6.8" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
  (btn === 'L' ? '<path d="M8 1.6A6.4 6.4 0 0 0 1.6 8v1.4H8z" fill="currentColor"/>' : '') +
  (btn === 'R' ? '<path d="M8 1.6A6.4 6.4 0 0 1 14.4 8v1.4H8z" fill="currentColor"/>' : '') +
  (btn === 'M' || btn === 'W' ? '<rect x="6.6" y="4" width="2.8" height="5" rx="1.4" fill="currentColor"/>' : '') +
  '<path d="M8 1.6v7.8M1.6 9.4h12.8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';

/** HTML for a key cap. `key` may be a KeyboardEvent.code (translated), a label ("E"), or LMB/RMB. */
export function keycapHTML(key: string, keyLabel: (code: string) => string): string {
  const m = mouseKey(key);
  if (m) {
    const b = m === 'LMB' ? 'L' : m === 'RMB' ? 'R' : m === 'MMB' ? 'M' : 'W';
    return `<kbd class="pn-key pn-key--mouse" title="${m}">${MOUSE_SVG(b)}</kbd>`;
  }
  const t = keyText(key, keyLabel);
  const wide = t.length > 1 ? ' pn-key--wide' : '';
  return `<kbd class="pn-key${wide}">${escapeHTML(t)}</kbd>`;
}

export function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'));
}

// ---------------------------------------------------------------------------------------
// Panels (full-screen / modal screens bound to a GameMode)
// ---------------------------------------------------------------------------------------

export abstract class Panel implements UIPart {
  /** Screen container (backdrop). */
  readonly el: HTMLElement;
  protected isOpen = false;

  constructor(protected readonly env: PartEnv, parent: HTMLElement, readonly mode: GameMode, cls: string) {
    this.el = h('div', `pn-screen ${cls}`, parent);
    this.el.setAttribute('role', 'dialog');
  }

  update(dt: number, mode: GameMode): void {
    const want = mode === this.mode;
    if (want !== this.isOpen) {
      this.isOpen = want;
      this.el.classList.toggle('is-open', want);
      if (want) this.onOpen(); else this.onClose();
    }
    if (this.isOpen) this.tick(dt);
  }

  destroy(): void { this.el.remove(); }

  protected onOpen(): void { /* override */ }
  protected onClose(): void { /* override */ }
  protected abstract tick(dt: number): void;

  /** Round close button that returns to gameplay. Shows the toggle key when given. */
  protected closeButton(parent: HTMLElement, keyCode?: string): HTMLButtonElement {
    const b = button(this.env, parent, { cls: 'pn-close', icon: 'close', title: 'Close', sound: null }, () => this.env.ctx.actions.setMode('play'));
    if (keyCode) b.insertAdjacentHTML('beforeend', keycapHTML(keyCode, (c) => this.env.ctx.keyLabel(c)));
    return b;
  }
}
