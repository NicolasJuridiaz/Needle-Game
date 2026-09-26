import { BALANCE } from '../config/balance';
import { BUILDABLES, type BuildableDef } from '../config/buildables';
import { TECH_NODES } from '../config/techTree';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { BuildCategory, BuildingType, ToolId } from '../sim/types';
import { ClassSlot, h, TextSlot } from './dom';
import { fmtCompact, fmtInt, fmtMoney, fmtPrice, fmtRate } from './format';
import { icon } from './icons';
import { button, keycapHTML, Panel, type PartEnv } from './part';

export const SHOP_TABS: { id: BuildCategory; label: string; icon: string }[] = [
  { id: 'tools', label: 'Tools', icon: 'shovel' },
  { id: 'extraction', label: 'Extraction', icon: 'rake' },
  { id: 'logistics', label: 'Logistics', icon: 'conveyor' },
  { id: 'detection', label: 'Detection', icon: 'scanner' },
  { id: 'processing', label: 'Processing', icon: 'compressor' },
  { id: 'storage', label: 'Storage', icon: 'silo' },
  { id: 'power', label: 'Power', icon: 'generator' },
  { id: 'factory', label: 'Factory', icon: 'platform' },
];

const NODE_NAME = new Map(TECH_NODES.map((n) => [n.id, n.name]));

/**
 * Live throughput label for a buildable, computed from current stats (upgrades included).
 * Falls back to the static config label when there is no simple formula.
 */
export function liveThroughput(type: BuildingType, stat: (k: string) => number, fallback: string): string {
  const speed = stat('global.machineSpeed');
  const belt = (stat('belt.speed') / Math.max(1e-6, stat('belt.spacing'))) * BALANCE.hayPacketSize;
  switch (type) {
    case 'hopper': return `${fmtRate(stat('hopper.outputRate') * (stat('hopper.dualOutput') >= 1 ? 2 : 1))} hay/s out`;
    case 'pistonRake': return `${fmtRate((stat('rake.push') / Math.max(1e-6, stat('rake.cycleTime'))) * speed)} hay/s`;
    case 'vacuumCollector': return `${fmtRate(stat('collector.rate') * speed)} hay/s`;
    case 'conveyor': return `${fmtRate(belt)} hay/s`;
    case 'conveyorRamp': case 'splitter': case 'merger': case 'uSplitter': case 'uMerger': case 'beltLift':
      return `${fmtRate(belt)} hay/s`;
    case 'scannerMk1': return `${fmtRate((stat('scanner.batch') / Math.max(1e-6, stat('scanner.cycle'))) * speed)} hay/s`;
    case 'scannerMk2': {
      const lanes = stat('scanner2.dualLane') >= 1 ? 2 : 1;
      const perLane = stat('scanner2.batch') / Math.max(1e-6, stat('scanner2.cycle') / Math.max(1e-6, stat('scanner2.speedMul')));
      return `${fmtRate(perLane * lanes * speed)} hay/s`;
    }
    case 'compressor': return `${fmtRate((stat('compressor.hayPerBale') * stat('compressor.chambers') / Math.max(1e-6, stat('compressor.cycle'))) * speed)} hay/s`;
    case 'wrapper': return `${fmtRate(speed / Math.max(1e-6, stat('wrapper.cycle')))} bale/s`;
    case 'silo': return `${fmtCompact(stat('silo.capacity'))} buffer`;
    case 'hayGenerator': return `${fmtRate(stat('generator.output'))} P`;
    case 'powerPole': return `${fmtRate(stat('pole.range'))} m radius`;
    default: return fallback;
  }
}

type Item =
  | { kind: 'tool'; id: ToolId | 'wheelbarrow' }
  | { kind: 'building'; def: BuildableDef };

interface Card {
  item: Item;
  tab: BuildCategory;
  el: HTMLElement;
  price: TextSlot;
  priceBad: ClassSlot;
  owned: TextSlot;
  thr: TextSlot | null;
  lockText: TextSlot;
  btn: HTMLButtonElement;
  btnLabel: TextSlot;
  state: string;
}

/** Build Shop: category tabs and cards (tools are bought here, buildings are selected for build mode). */
export class Shop extends Panel {
  private readonly moneyText: TextSlot;
  private readonly grid: HTMLElement;
  private readonly tabEls = new Map<BuildCategory, { el: HTMLButtonElement; dot: ClassSlot }>();
  private readonly cards: Card[] = [];
  private tab: BuildCategory = 'tools';
  private sig = '';
  private slow = 0;

  constructor(env: PartEnv, parent: HTMLElement) {
    super(env, parent, 'shop', 'pn-shop-screen');
    const ctx = env.ctx;
    const panel = h('div', 'pn-panel pn-shop', this.el);
    const head = h('div', 'pn-panel-head', panel);
    head.innerHTML = `<span class="pn-panel-title-ic">${icon('shop')}</span><span class="pn-panel-title">Shop</span>`;
    const money = h('div', 'pn-balance', head);
    money.innerHTML = `<span class="pn-balance-ic">${icon('money')}</span>`;
    this.moneyText = new TextSlot(h('span', 'pn-balance-val', money));
    h('div', 'pn-panel-spacer', head);
    this.closeButton(head, 'KeyB');

    const tabs = h('div', 'pn-tabs', panel);
    for (const t of SHOP_TABS) {
      const b = button(env, tabs, { cls: 'pn-tab', icon: t.icon, label: t.label }, () => this.setTab(t.id));
      const dot = h('span', 'pn-tab-dot', b);
      this.tabEls.set(t.id, { el: b, dot: new ClassSlot(dot, 'is-on') });
    }
    this.grid = h('div', 'pn-shop-grid', panel);
    const foot = h('div', 'pn-panel-foot', panel);
    foot.innerHTML = `<span>Plans come from the Work Tree ${keycapHTML('KeyT', (c) => ctx.keyLabel(c))}</span><span>Placed buildings: ${keycapHTML('KeyQ', (c) => ctx.keyLabel(c))} build mode, ${keycapHTML('KeyX', (c) => ctx.keyLabel(c))} remove, ${keycapHTML('KeyM', (c) => ctx.keyLabel(c))} move</span>`;

    // tools (hands are always owned)
    for (const id of Object.keys(TOOLS) as ToolId[]) if (id !== 'hands') this.buildCard({ kind: 'tool', id }, 'tools');
    this.buildCard({ kind: 'tool', id: 'wheelbarrow' }, 'tools');
    const defs = Object.values(BUILDABLES).filter((d) => d.id !== 'sellStation').sort((a, b) => a.order - b.order);
    for (const d of defs) this.buildCard({ kind: 'building', def: d }, d.category);
    this.setTab('tools');
  }

  private buildCard(item: Item, tab: BuildCategory): void {
    const env = this.env;
    const el = h('div', 'pn-card', this.grid);
    let name: string, desc: string, ic: string, cat: string;
    if (item.kind === 'tool') {
      const t = item.id === 'wheelbarrow' ? WHEELBARROW : TOOLS[item.id];
      name = t.name; desc = t.desc; ic = t.icon; cat = 'tools';
    } else {
      name = item.def.name; desc = item.def.desc; ic = item.def.icon; cat = item.def.category;
    }
    el.style.setProperty('--cat', `var(--cat-${cat})`);
    const top = h('div', 'pn-card-top', el);
    h('div', 'pn-card-ic', top).innerHTML = icon(ic);
    const owned = new TextSlot(h('span', 'pn-card-owned', top));
    const body = h('div', 'pn-card-body', el);
    h('div', 'pn-card-name', body, name);
    const priceEl = h('div', 'pn-card-price', body);
    priceEl.innerHTML = `<span class="pn-card-price-ic">${icon('money')}</span>`;
    const price = new TextSlot(h('span', 'pn-card-price-val', priceEl));
    const chips = h('div', 'pn-card-chips', body);
    let thr: TextSlot | null = null;
    if (item.kind === 'building') {
      const d = item.def;
      if (d.power > 0) h('span', 'pn-stat pn-stat--power', chips).innerHTML = `${icon('power')}<span>${d.power} P</span>`;
      if (d.throughputLabel || d.id === 'hayGenerator') {
        const s = h('span', 'pn-stat', chips);
        s.innerHTML = icon(d.id === 'hayGenerator' ? 'bolt' : 'speed');
        thr = new TextSlot(h('span', '', s));
      }
      h('span', 'pn-stat', chips).innerHTML = `${icon('grid')}<span>${d.footprint[0]}x${d.footprint[1]}</span>`;
      if (d.levels.includes(1)) h('span', 'pn-stat', chips).innerHTML = `${icon('platform')}<span>Upper level</span>`;
    }
    h('div', 'pn-card-desc', body, desc);
    const lock = h('div', 'pn-card-lock', el);
    lock.innerHTML = icon('lock');
    const lockText = new TextSlot(h('span', '', lock));
    const btn = button(env, el, { cls: 'pn-btn--primary pn-card-btn', sound: item.kind === 'tool' ? null : 'uiClick' }, () => this.onBuy(item));
    const btnLabel = new TextSlot(h('span', 'pn-btn-label', btn));
    this.cards.push({ item, tab, el, price, priceBad: new ClassSlot(priceEl, 'is-bad'), owned, thr, lockText, btn, btnLabel, state: '' });
  }

  private setTab(t: BuildCategory): void {
    this.tab = t;
    for (const [id, v] of this.tabEls) v.el.classList.toggle('is-active', id === t);
    for (const c of this.cards) c.el.classList.toggle('is-hidden', c.tab !== t);
    this.grid.scrollTop = 0;
    this.sig = '';
  }

  private onBuy(item: Item): void {
    const a = this.env.ctx.actions;
    if (item.kind === 'tool') a.buyTool(item.id);
    else a.selectBuildable(item.def.id);
    this.sig = '';
  }

  protected override onOpen(): void { this.sig = ''; this.refresh(); }

  protected tick(dt: number): void {
    this.slow += dt;
    if (this.slow < 0.15) return;
    this.slow = 0;
    this.refresh();
  }

  private refresh(): void {
    const sim = this.env.ctx.sim;
    const p = sim.progress;
    const sig = `${Math.floor(p.money)}|${p.nodes.size}|${p.ownedTools.size}|${p.hasWheelbarrow}|${sim.buildings.size}|${this.tab}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.moneyText.set(fmtMoney(p.money));
    const stat = (k: string) => sim.stat(k);
    const dots = new Map<BuildCategory, boolean>();

    for (const c of this.cards) {
      let state: string;
      let lockName = '';
      if (c.item.kind === 'tool') {
        const id = c.item.id;
        const def = id === 'wheelbarrow' ? WHEELBARROW : TOOLS[id];
        const isOwned = id === 'wheelbarrow' ? p.hasWheelbarrow : p.ownedTools.has(id);
        const unlocked = def.requiresNode === null || p.isUnlocked(def.requiresNode);
        const afford = p.money >= def.cost;
        state = isOwned ? 'owned' : !unlocked ? 'locked' : afford ? 'buy' : 'poor';
        lockName = def.requiresNode ? NODE_NAME.get(def.requiresNode) ?? def.requiresNode : '';
        c.price.set(isOwned ? 'Owned' : fmtPrice(def.cost));
        c.priceBad.set(!isOwned && !afford);
        if (state === 'buy') dots.set('tools', true);
        if (state !== c.state) {
          c.btn.disabled = state !== 'buy';
          c.btnLabel.set(state === 'owned' ? 'Owned' : state === 'locked' ? 'Locked' : `Buy ${fmtPrice(def.cost)}`);
        }
      } else {
        const d = c.item.def;
        const unlocked = p.buildingUnlocked(d.id);
        const count = sim.ownedCount(d.id);
        const cost = sim.nextCost(d.id);
        const afford = p.money >= cost;
        state = !unlocked ? 'locked' : afford ? 'buy' : 'poor';
        lockName = d.requiresNode ? NODE_NAME.get(d.requiresNode) ?? d.requiresNode : '';
        c.price.set(cost > 0 ? fmtPrice(cost) : 'Free');
        c.priceBad.set(!afford);
        c.owned.set(count > 0 ? `x${fmtInt(count)}` : unlocked ? 'New' : '');
        c.owned.el.classList.toggle('is-new', count === 0 && unlocked);
        if (unlocked && count === 0) dots.set(d.category, true);
        if (c.thr) c.thr.set(liveThroughput(d.id, stat, d.throughputLabel));
        if (state !== c.state) {
          c.btn.disabled = state === 'locked';
          c.btnLabel.set(state === 'locked' ? 'Locked' : 'Select');
        }
      }
      if (state !== c.state) {
        c.state = state;
        c.el.classList.toggle('is-locked', state === 'locked');
        c.el.classList.toggle('is-owned', state === 'owned');
        c.el.classList.toggle('is-poor', state === 'poor');
        c.lockText.set(state === 'locked' ? `Unlock ${lockName} in the Work Tree` : '');
      }
    }
    for (const [id, v] of this.tabEls) v.dot.set(!!dots.get(id) && id !== this.tab);
  }
}

