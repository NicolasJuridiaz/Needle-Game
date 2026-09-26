import { BUILDABLES } from '../config/buildables';
import type { BuildHudState, BuildTool, GameMode } from './context';
import { ClassSlot, h, TextSlot } from './dom';
import { DIR_DX, DIR_DZ } from '../sim/types';
import { fmtPrice, relativeBearing } from './format';
import { icon, setIcon } from './icons';
import { escapeHTML, keycapHTML, type PartEnv, type UIPart } from './part';

const TOOLS: { id: BuildTool; label: string; icon: string }[] = [
  { id: 'place', label: 'Place', icon: 'place' },
  { id: 'belt', label: 'Belt', icon: 'conveyor' },
  { id: 'remove', label: 'Remove', icon: 'remove' },
  { id: 'move', label: 'Move', icon: 'move' },
];

const ROUTE_LABEL: Record<NonNullable<BuildHudState['routeMode']>, string> = { auto: 'Auto route', xFirst: 'X first', zFirst: 'Z first' };

/** Build mode panel: tool, selected item, rotation, cost, validity, power prediction and key hints. */
export class BuildHud implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private readonly tabs = new Map<BuildTool, ClassSlot>();
  private readonly itemIc: HTMLElement;
  private readonly itemName: TextSlot;
  private readonly itemSub: TextSlot;
  private readonly rotBox: HTMLElement;
  private readonly rotVisible: ClassSlot;
  private readonly rotArrow: HTMLElement;
  private readonly cost: HTMLElement;
  private readonly costText: TextSlot;
  private readonly costVisible: ClassSlot;
  private readonly costBad: ClassSlot;
  private readonly status: HTMLElement;
  private readonly statusText: TextSlot;
  private readonly power: HTMLElement;
  private readonly powerText: TextSlot;
  private readonly hints: HTMLElement;
  private hintSig = '';
  private rot = NaN;
  private statusTone = '';
  private powerTone = '';
  private slow = 0;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    const el = (this.el = h('div', 'pn-build', parent));
    this.visible = new ClassSlot(el, 'is-on');
    const tabs = h('div', 'pn-build-tabs', el);
    for (const t of TOOLS) {
      const tab = h('span', 'pn-build-tab', tabs);
      tab.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`;
      this.tabs.set(t.id, new ClassSlot(tab, 'is-active'));
    }
    const main = h('div', 'pn-build-main', el);
    this.itemIc = h('span', 'pn-build-ic', main);
    const txt = h('div', 'pn-build-item', main);
    this.itemName = new TextSlot(h('div', 'pn-build-name', txt));
    this.itemSub = new TextSlot(h('div', 'pn-build-sub', txt));
    this.rotBox = h('div', 'pn-build-rot', main);
    this.rotVisible = new ClassSlot(this.rotBox, 'is-on');
    this.rotArrow = h('span', 'pn-build-rot-arrow', this.rotBox);
    this.rotArrow.innerHTML = icon('arrow');
    this.cost = h('div', 'pn-build-cost', main);
    this.costVisible = new ClassSlot(this.cost, 'is-on');
    this.costBad = new ClassSlot(this.cost, 'is-bad');
    this.cost.innerHTML = `<span class="pn-build-cost-ic">${icon('money')}</span>`;
    this.costText = new TextSlot(h('span', 'pn-build-cost-val', this.cost));
    const side = h('div', 'pn-build-side', el);
    this.status = h('div', 'pn-build-status', side);
    this.statusText = new TextSlot(this.status);
    this.power = h('div', 'pn-build-power', side);
    this.power.innerHTML = icon('power');
    this.powerText = new TextSlot(h('span', 'pn-build-power-text', this.power));
    this.hints = h('div', 'pn-build-hints', el);
  }

  update(dt: number, mode: GameMode): void {
    const show = mode === 'build';
    const hud = show ? this.env.ctx.getBuildHud() : null;
    this.visible.set(!!hud?.active);
    if (!hud || !hud.active) return;
    this.slow += dt;
    if (this.slow < 1 / 15) return;
    this.slow = 0;
    this.render(hud);
  }

  private render(s: BuildHudState): void {
    const ctx = this.env.ctx;
    for (const [id, slot] of this.tabs) slot.set(id === s.tool);
    const def = s.item ? BUILDABLES[s.item] : null;

    // item
    if (s.tool === 'remove' || (s.tool === 'move' && !def)) {
      const remove = s.tool === 'remove';
      setIcon(this.itemIc, remove ? 'remove' : 'move');
      this.itemIc.style.setProperty('--cat', remove ? 'var(--bad)' : 'var(--info)');
      this.itemName.set(s.targetName ?? (remove ? 'Remove' : 'Move'));
      if (!s.targetName) this.itemSub.set(remove ? 'Aim at a building to remove it' : 'Aim at a building to pick it up');
      else if (remove) this.itemSub.set(s.refund !== undefined && s.refund > 0 ? `Refund ${fmtPrice(s.refund)}` : 'No refund');
      else this.itemSub.set('Click to pick it up');
    } else if (def) {
      setIcon(this.itemIc, def.icon);
      this.itemIc.style.setProperty('--cat', `var(--cat-${def.category})`);
      const variantLabel = s.variant && def.variants?.[s.variant] ? ` - ${def.variants[s.variant].label}` : '';
      this.itemName.set(def.name + variantLabel);
      if (s.tool === 'belt') {
        const route = s.routeMode ? ROUTE_LABEL[s.routeMode] : '';
        this.itemSub.set(s.beltStarted ? `${s.beltTiles ?? 0} tiles${route ? ' - ' + route : ''}` : `Click the start cell${route ? ' - ' + route : ''}`);
      } else if (s.tool === 'move') {
        this.itemSub.set(s.targetName ? `Moving ${s.targetName}` : 'Pick a building');
      } else {
        this.itemSub.set(`${def.footprint[0]}x${def.footprint[1]}${def.power > 0 ? ` - ${def.power} P` : ''}`);
      }
    } else {
      setIcon(this.itemIc, 'place');
      this.itemIc.style.setProperty('--cat', 'var(--hay)');
      this.itemName.set('Nothing selected');
      this.itemSub.set(`Open the Shop (${ctx.keyLabel('KeyB')}) to pick a building`);
    }

    // rotation (place / move with an item)
    const showRot = !!def && (s.tool === 'place' || s.tool === 'move');
    this.rotVisible.set(showRot);
    if (showRot) {
      // Arrow = the building's forward (output) direction relative to where the player looks.
      const r = s.rot & 3;
      const a = Math.round((relativeBearing(DIR_DX[r], DIR_DZ[r], ctx.sim.player.yaw) * 180) / Math.PI);
      if (a !== this.rot) { this.rot = a; this.rotArrow.style.transform = `rotate(${a}deg)`; }
    }

    // cost
    const showCost = (s.tool === 'place' || s.tool === 'belt') && s.cost > 0;
    this.costVisible.set(showCost);
    if (showCost) {
      this.costText.set(fmtPrice(s.cost));
      this.costBad.set(ctx.sim.progress.money < s.cost);
    }

    // validity
    let text: string;
    let tone: string;
    if (s.valid) {
      tone = 'good';
      text = s.tool === 'remove' ? 'Click to remove' : s.tool === 'move' ? (s.targetName ? 'Click to drop here' : 'Click to pick up') : s.tool === 'belt' ? (s.beltStarted ? 'Click to build the belt' : 'Click to start') : 'Click to place';
    } else {
      tone = s.reason ? 'bad' : 'idle';
      text = s.reason ?? (s.tool === 'remove' ? 'Aim at a building' : 'Aim at the floor');
    }
    if (tone !== this.statusTone) { this.statusTone = tone; this.status.className = `pn-build-status pn-tone--${tone}`; }
    this.statusText.set(text);

    // power prediction
    const powered = !!def && def.power > 0 && (s.tool === 'place' || s.tool === 'move') && s.network !== undefined;
    const ptone = !powered ? 'none' : (s.network ?? -1) >= 0 ? 'good' : 'warn';
    if (ptone !== this.powerTone) {
      this.powerTone = ptone;
      this.power.className = `pn-build-power pn-tone--${ptone}${powered ? ' is-on' : ''}`;
    }
    if (powered) this.powerText.set((s.network ?? -1) >= 0 ? 'Powered here' : 'No power here - build a Power Pole nearby');

    // key hints (rebuilt only when they change)
    let sig = '';
    for (const hh of s.hints) sig += hh.key + ':' + hh.label + '|';
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      let html = '';
      for (const hh of s.hints) html += `<span class="pn-build-hint">${keycapHTML(hh.key, (c) => ctx.keyLabel(c))}<span>${escapeHTML(hh.label)}</span></span>`;
      this.hints.innerHTML = html;
    }
  }

  destroy(): void { this.el.remove(); }
}

