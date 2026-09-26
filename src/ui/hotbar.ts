import { TOOLS } from '../config/tools';
import { TOOL_ORDER, type ToolId } from '../sim/types';
import type { GameMode } from './context';
import { ClassSlot, h, replayClass } from './dom';
import { fmtPrice } from './format';
import { icon } from './icons';
import { keycapHTML, type PartEnv, type UIPart } from './part';

type SlotState = 'equipped' | 'owned' | 'buyable' | 'locked';

interface Slot {
  tool: ToolId;
  el: HTMLElement;
  state: SlotState | null;
  price: HTMLElement;
}

/** Tool hotbar 1-6: owned tools highlighted, equipped one lifted, unbought/locked slots dimmed. */
export class Hotbar implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private readonly slots: Slot[] = [];
  private readonly name: HTMLElement;
  private equipped: ToolId | null = null;
  private sig = '';
  private slow = 0;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    this.el = h('div', 'pn-hotbar', parent);
    this.visible = new ClassSlot(this.el, 'is-on');
    this.name = h('div', 'pn-hotbar-name', this.el);
    const row = h('div', 'pn-hotbar-row', this.el);
    for (let i = 0; i < TOOL_ORDER.length; i++) {
      const tool = TOOL_ORDER[i];
      const def = TOOLS[tool];
      const el = h('div', 'pn-slot', row);
      el.innerHTML = `${keycapHTML(`Digit${def.slot}`, (c) => env.ctx.keyLabel(c))}<span class="pn-slot-ic">${icon(def.icon)}</span><span class="pn-slot-lock">${icon('lock')}</span>`;
      const price = h('span', 'pn-slot-price', el);
      this.slots.push({ tool, el, state: null, price });
    }
  }

  update(dt: number, mode: GameMode): void {
    const show = mode === 'play';
    this.visible.set(show);
    if (!show) return;
    this.slow += dt;
    const sim = this.env.ctx.sim;
    const eq = sim.player.equipped;
    if (eq !== this.equipped) {
      const first = this.equipped === null;
      this.equipped = eq;
      this.name.textContent = TOOLS[eq]?.name ?? '';
      if (!first) replayClass(this.name, 'is-flash');
      this.refresh(true);
      return;
    }
    if (this.slow < 0.2) return;
    this.slow = 0;
    this.refresh(false);
  }

  private refresh(force: boolean): void {
    const p = this.env.ctx.sim.progress;
    const sig = `${p.ownedTools.size}|${p.nodes.size}|${Math.floor(p.money)}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    for (const s of this.slots) {
      const def = TOOLS[s.tool];
      let state: SlotState;
      if (p.ownedTools.has(s.tool)) state = s.tool === this.equipped ? 'equipped' : 'owned';
      else if (def.requiresNode === null || p.isUnlocked(def.requiresNode)) state = 'buyable';
      else state = 'locked';
      if (state !== s.state) {
        const pop = s.state !== null && state === 'equipped';
        s.state = state;
        s.el.className = `pn-slot is-${state}`;
        if (pop) replayClass(s.el, 'is-pop');
        s.el.title = state === 'locked' ? `${def.name} - unlock its plans in the Work Tree` : state === 'buyable' ? `${def.name} - buy it in the Shop` : def.name;
      }
      if (state === 'buyable') {
        s.price.textContent = fmtPrice(def.cost);
        s.price.classList.toggle('is-afford', p.money >= def.cost);
      }
    }
  }

  destroy(): void { this.el.remove(); }
}
