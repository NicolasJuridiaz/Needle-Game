import { ORDER_BY_ID } from '../config/orders';
import { TECH_NODES } from '../config/techTree';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { GameMode } from './context';
import { h } from './dom';
import { icon } from './icons';
import type { PartEnv, UIPart } from './part';

export type ToastKind = 'info' | 'good' | 'warn' | 'bad';

const MAX_VISIBLE = 4;
const LIFE: Record<ToastKind, number> = { info: 4.2, good: 4.2, warn: 5.5, bad: 5.5 };
const LEAVE_TIME = 0.28;
const DEFAULT_ICON: Record<ToastKind, string> = { info: 'info', good: 'good', warn: 'warn', bad: 'bad' };

interface Toast { el: HTMLElement; t: number; life: number; leaving: boolean }

const NODE_BY_ID = new Map(TECH_NODES.map((n) => [n.id, n]));

/** Notification stack on the right edge (max 4, newest on top). */
export class Toasts implements UIPart {
  private readonly el: HTMLElement;
  private readonly items: Toast[] = [];

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    this.el = h('div', 'pn-toasts', parent);
    this.el.setAttribute('aria-live', 'polite');
    const ctx = env.ctx;
    env.listen('toast', (e) => this.push(e.text, e.kind, e.icon));
    env.listen('order:available', (e) => {
      const def = ORDER_BY_ID[e.id];
      if (def) this.push(`New order: ${def.title}`, 'info', 'order');
    });
    env.listen('node:unlocked', (e) => {
      const node = NODE_BY_ID.get(e.id);
      if (!node || node.kind !== 'plan') return;
      const shop = ctx.keyLabel('KeyB');
      this.push(`${node.name} unlocked - buy it at SUPPLY CO. (${shop})`, 'good', node.icon);
    });
    env.listen('tool:bought', (e) => {
      if (e.tool === 'wheelbarrow') {
        this.push(`${WHEELBARROW.name} bought - it is parked right next to you`, 'good', WHEELBARROW.icon);
        return;
      }
      const def = TOOLS[e.tool];
      this.push(`${def.name} bought - it lives on key ${ctx.keyLabel(`Digit${def.slot}`)}`, 'good', def.icon);
    });
  }

  push(text: string, kind: ToastKind = 'info', iconKey?: string): void {
    const el = h('div', `pn-toast pn-toast--${kind}`);
    el.innerHTML = `<span class="pn-toast-ic">${icon(iconKey ?? DEFAULT_ICON[kind])}</span>`;
    h('span', 'pn-toast-text', el, text);
    this.el.prepend(el);
    this.items.unshift({ el, t: 0, life: LIFE[kind], leaving: false });
    let visible = 0;
    for (const it of this.items) {
      if (it.leaving) continue;
      visible++;
      if (visible > MAX_VISIBLE) this.leave(it);
    }
  }

  private leave(it: Toast): void {
    if (it.leaving) return;
    it.leaving = true;
    it.t = 0;
    it.el.classList.add('is-leaving');
  }

  update(dt: number, mode: GameMode): void {
    this.el.classList.toggle('is-hidden', mode === 'clickToPlay' || mode === 'loading' || mode === 'summary');
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (!it.leaving && it.t >= it.life) this.leave(it);
      else if (it.leaving && it.t >= LEAVE_TIME) {
        it.el.remove();
        this.items.splice(i, 1);
      }
    }
  }

  destroy(): void { this.el.remove(); this.items.length = 0; }
}
