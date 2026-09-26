import './styles.css';
import type { GameEvents } from '../core/events';
import { Banners } from './banners';
import { BuildHud } from './buildHud';
import { ClickToPlay } from './clickToPlay';
import type { GameMode, UIContext } from './context';
import { DetectorHud } from './detectorHud';
import { h } from './dom';
import { Hotbar } from './hotbar';
import { Hud } from './hud';
import { Orders } from './orders';
import type { Listen, PartEnv, UiSound, UIPart } from './part';
import { Pause } from './pause';
import { Shop } from './shop';
import { Summary } from './summary';
import { Toasts } from './toasts';
import { MachineTooltip } from './tooltip';
import { WorkTree } from './workTree';

/** Minimum spacing (ms) between hover sounds. */
const HOVER_GAP = 70;

/**
 * DOM/CSS user interface. Built once per run (the Game recreates it for a new run), updated every
 * frame; components only touch the DOM when a value actually changes.
 */
export class UI {
  private readonly el: HTMLElement;
  private readonly parts: UIPart[] = [];
  private readonly unsub: (() => void)[] = [];
  private mode: GameMode | null = null;
  private lastHover = 0;
  private destroyed = false;

  constructor(root: HTMLElement, private readonly ctx: UIContext) {
    this.el = h('div', 'pn-ui', root);
    const listen: Listen = (type, fn) => { this.unsub.push(ctx.sim.events.on(type, fn as (e: GameEvents[typeof type]) => void)); };
    const env: PartEnv = { ctx, listen, sound: (id) => this.sound(id) };

    const hud = h('div', 'pn-layer pn-layer-hud', this.el);
    const panels = h('div', 'pn-layer pn-layer-panels', this.el);
    const fx = h('div', 'pn-layer pn-layer-fx', this.el);
    const top = h('div', 'pn-layer pn-layer-top', this.el);

    this.parts.push(
      new Hud(env, hud),
      new Hotbar(env, hud),
      new MachineTooltip(env, hud),
      new DetectorHud(env, hud),
      new BuildHud(env, hud),
      new WorkTree(env, panels),
      new Shop(env, panels),
      new Orders(env, panels),
      new Pause(env, panels),
      new Summary(env, panels),
      new Banners(env, fx),
      new Toasts(env, fx),
      new ClickToPlay(env, top),
    );
  }

  private sound(id: UiSound): void {
    if (id === 'uiHover') {
      const now = performance.now();
      if (now - this.lastHover < HOVER_GAP) return;
      this.lastHover = now;
    }
    this.ctx.actions.playUiSound(id);
  }

  update(dt: number): void {
    if (this.destroyed) return;
    const mode = this.ctx.getMode();
    if (mode !== this.mode) {
      this.mode = mode;
      this.el.dataset.mode = mode;
    }
    for (const p of this.parts) p.update(dt, mode);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const u of this.unsub) u();
    this.unsub.length = 0;
    for (const p of this.parts) p.destroy();
    this.parts.length = 0;
    this.el.remove();
  }
}
