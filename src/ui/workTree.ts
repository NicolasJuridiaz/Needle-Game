import { BUILDABLES } from '../config/buildables';
import { BRANCHES, displayLevel, maxDisplayLevel, parseRequirement, requirementLabel, TECH_NODES, type BranchDef, type TechNode } from '../config/techTree';
import { TOOLS, WHEELBARROW } from '../config/tools';
import type { BranchId } from '../sim/types';
import { clamp, h, replayClass, TextSlot } from './dom';
import { fmtInt, fmtPrice } from './format';
import { STAT_LABELS } from './statLabels';
import { icon } from './icons';
import { button, escapeHTML, keycapHTML, Panel, type PartEnv } from './part';

/** SVG units per grid cell inside a branch (lines are drawn in this space, stretched to CSS size). */
const U = 100;
/** Card height as a fraction of the row height (must match `.pn-tn-card` in styles.css). */
const CARD_H = 0.72;

export type NodeState = 'locked' | 'ready' | 'short' | 'owned' | 'maxed';

/** Layout of one branch: grid size + nodes. */
export interface BranchLayout { def: BranchDef; cols: number; rows: number; nodes: TechNode[] }

/** Group nodes per branch and compute each branch's grid size (pure; unit-tested). */
export function layoutBranches(nodes: readonly TechNode[], branches: readonly BranchDef[]): BranchLayout[] {
  return branches.map((def) => {
    const ns = nodes.filter((n) => n.branch === def.id);
    let cols = 1;
    let rows = 1;
    for (const n of ns) { cols = Math.max(cols, n.pos[0] + 1); rows = Math.max(rows, n.pos[1] + 1); }
    return { def, cols, rows, nodes: ns };
  });
}

/** SVG path between two nodes of the same branch (grid coordinates -> branch SVG units). */
export function edgePath(from: [number, number], to: [number, number]): string {
  const half = (CARD_H * U) / 2;
  const fx = (from[0] + 0.5) * U;
  const fy = (from[1] + 0.5) * U;
  const tx = (to[0] + 0.5) * U;
  const ty = (to[1] + 0.5) * U;
  if (to[1] > from[1]) {
    const y0 = fy + half;
    const y1 = ty - half;
    const my = (y0 + y1) / 2;
    return `M${fx} ${y0}C${fx} ${my} ${tx} ${my} ${tx} ${y1}`;
  }
  // Same row or upwards: connect the facing sides.
  const dir = tx >= fx ? 1 : -1;
  const x0 = fx + dir * U * 0.42;
  const x1 = tx - dir * U * 0.42;
  const mx = (x0 + x1) / 2;
  return `M${x0} ${fy}C${mx} ${fy} ${mx} ${ty} ${x1} ${ty}`;
}

/** State of a node for the tree (pure). Ready = requirements met and both WP and Money affordable. */
export function nodeState(level: number, maxLevel: number, requiresMet: boolean, wp: number, nextCost: number, money = 0, nextMoney = 0): NodeState {
  if (level >= maxLevel) return 'maxed';
  if (!requiresMet) return level > 0 ? 'owned' : 'locked';
  if (wp >= nextCost && money >= nextMoney) return 'ready';
  return level > 0 ? 'owned' : 'short';
}

/** Requirements of the NEXT purchase of a node ("id" / "id@N"): the plans' requirements, then per level. */
function nextRequirements(n: TechNode, owned: number): string[] {
  const lv = n.levels[owned];
  return owned === 0 ? [...n.requires, ...(lv?.req ?? [])] : lv?.req ?? [];
}

interface NodeView {
  node: TechNode;
  el: HTMLElement;
  cost: TextSlot;
  money: TextSlot;
  lv: TextSlot | null;
  pips: HTMLElement[];
  state: NodeState | null;
  level: number;
}

interface EdgeView { from: string; to: string; el: SVGPathElement; state: string }

interface BranchView { layout: BranchLayout; el: HTMLElement; progress: TextSlot; chip: HTMLElement; chipCount: TextSlot }

const BRANCH_COLOR = new Map<BranchId, string>(BRANCHES.map((b) => [b.id, b.color]));
const NODE_BY_ID = new Map(TECH_NODES.map((n) => [n.id, n]));
const KIND_LABEL: Record<TechNode['kind'], string> = { plan: 'Plans', upgrade: 'Upgrade', feature: 'Feature' };

/** Full-screen Work Tree: six branch columns, dependency lines, hover details, click to unlock. */
export class WorkTree extends Panel {
  private readonly viewport: HTMLElement;
  private readonly board: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly wpText: TextSlot;
  private readonly unlockedText: TextSlot;
  private readonly availText: TextSlot;
  private readonly availBadge: HTMLElement;
  private readonly chipAll: HTMLButtonElement;
  private readonly chipAvail: HTMLButtonElement;
  private readonly views = new Map<string, NodeView>();
  private readonly edges: EdgeView[] = [];
  private readonly branches: BranchView[] = [];
  private filter: 'all' | 'available' = 'all';
  private dirty = true;
  private sig = '';
  private hoverId: string | null = null;

  // pan
  private panX = 0;
  private panY = 0;
  private positioned = false;
  private boardW = 0;
  private boardH = 0;
  private viewW = 0;
  private viewH = 0;
  private drag: { id: number; x: number; y: number; px: number; py: number; moved: boolean } | null = null;
  private suppressClick = false;
  private readonly onResize = () => { if (this.isOpen) this.measure(); };

  constructor(env: PartEnv, parent: HTMLElement) {
    super(env, parent, 'workTree', 'pn-tree-screen');
    const ctx = env.ctx;
    const panel = h('div', 'pn-tree', this.el);

    // ----- header
    const head = h('div', 'pn-tree-head', panel);
    const title = h('div', 'pn-tree-title', head);
    title.innerHTML = `<span class="pn-tree-title-ic">${icon('tree')}</span><span>Work Tree</span>`;
    const wp = h('div', 'pn-tree-wp', head);
    wp.innerHTML = `<span class="pn-tree-wp-ic">${icon('wp')}</span>`;
    this.wpText = new TextSlot(h('span', 'pn-tree-wp-val', wp));
    h('span', 'pn-tree-wp-unit', wp, 'WP');
    const stats = h('div', 'pn-tree-stats', head);
    this.unlockedText = new TextSlot(h('span', 'pn-tree-unlocked', stats));
    this.availBadge = h('span', 'pn-tree-avail', stats);
    this.availText = new TextSlot(this.availBadge);
    const chips = h('div', 'pn-chips', head);
    this.chipAll = button(env, chips, { cls: 'pn-chip is-active', label: 'All' }, () => this.setFilter('all'));
    this.chipAvail = button(env, chips, { cls: 'pn-chip', label: 'Available' }, () => this.setFilter('available'));
    this.closeButton(head, 'KeyT');

    // ----- branch jump bar
    const jump = h('div', 'pn-tree-jump', panel);

    // ----- board
    this.viewport = h('div', 'pn-tree-view', panel);
    this.board = h('div', 'pn-tree-board', this.viewport);
    for (const layout of layoutBranches(TECH_NODES, BRANCHES)) {
      const bv = this.buildBranch(layout, jump);
      this.branches.push(bv);
    }
    h('div', 'pn-tree-foot', panel).innerHTML =
      `<span>${keycapHTML('LMB', (c) => ctx.keyLabel(c))} Drag to pan</span><span>${keycapHTML('Wheel', (c) => ctx.keyLabel(c))} Scroll</span><span class="pn-tree-foot-glow">Click a glowing plan to unlock it</span>`;

    // ----- hover detail
    this.detail = h('div', 'pn-tree-detail', this.el);

    this.bindPan();
    env.listen('wp:changed', () => { this.dirty = true; });
    env.listen('node:unlocked', () => { this.dirty = true; });
    window.addEventListener('resize', this.onResize);
  }

  private buildBranch(layout: BranchLayout, jump: HTMLElement): BranchView {
    const { def, cols, rows, nodes } = layout;
    const sec = h('section', 'pn-branch', this.board);
    sec.style.setProperty('--bc', def.color);
    sec.style.setProperty('--cols', String(cols));
    sec.style.setProperty('--rows', String(rows));
    const head = h('div', 'pn-branch-head', sec);
    head.innerHTML = `<span class="pn-branch-ic">${icon(def.icon)}</span><span class="pn-branch-name">${escapeHTML(def.name)}</span>`;
    const progress = new TextSlot(h('span', 'pn-branch-prog', head));
    const body = h('div', 'pn-branch-body', sec);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'pn-branch-lines');
    svg.setAttribute('viewBox', `0 0 ${cols * U} ${rows * U}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    body.appendChild(svg);
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      for (const r0 of n.requires) {
        const r = parseRequirement(r0)[0];
        if (!ids.has(r)) continue;
        const from = NODE_BY_ID.get(r);
        if (!from) continue;
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', edgePath(from.pos, n.pos));
        p.setAttribute('class', 'pn-edge');
        p.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(p);
        this.edges.push({ from: r, to: n.id, el: p, state: '' });
      }
    }
    for (const n of nodes) this.buildNode(n, body);

    const chip = button(this.env, jump, { cls: 'pn-jump', icon: def.icon, label: def.name }, () => this.jumpTo(sec));
    chip.style.setProperty('--bc', def.color);
    const chipCount = new TextSlot(h('span', 'pn-jump-count', chip));
    return { layout, el: sec, progress, chip, chipCount };
  }

  private buildNode(n: TechNode, body: HTMLElement): void {
    const el = h('div', 'pn-tn', body);
    el.style.setProperty('--c', String(n.pos[0]));
    el.style.setProperty('--r', String(n.pos[1]));
    el.dataset.id = n.id;
    const card = h('div', 'pn-tn-card', el);
    card.innerHTML = `<span class="pn-tn-ic">${icon(n.icon)}</span><span class="pn-tn-name">${escapeHTML(n.name)}</span>`;
    const pips: HTMLElement[] = [];
    if (n.levels.length > 1 && !n.leveled) {
      const pr = h('span', 'pn-tn-pips', card);
      for (let i = 0; i < n.levels.length; i++) pips.push(h('i', '', pr));
    }
    const lv = n.leveled ? new TextSlot(h('span', 'pn-tn-lv', card)) : null;
    const costEl = h('span', 'pn-tn-cost', el);
    const cost = new TextSlot(costEl);
    const money = new TextSlot(h('span', 'pn-tn-money', el));
    h('span', 'pn-tn-lock', el).innerHTML = icon('lock');
    h('span', 'pn-tn-check', el).innerHTML = icon('check');
    const ext = n.requires.map((r) => parseRequirement(r)[0]).filter((r) => NODE_BY_ID.get(r)?.branch !== n.branch);
    if (ext.length) {
      const ex = h('span', 'pn-tn-ext', el);
      ex.innerHTML = icon('links');
      for (const r of ext) {
        const dot = h('i', '', ex);
        dot.style.background = BRANCH_COLOR.get(NODE_BY_ID.get(r)?.branch as BranchId) ?? '#888';
      }
    }
    el.addEventListener('pointerenter', () => { this.hoverId = n.id; this.showDetail(n.id); this.env.sound('uiHover'); });
    el.addEventListener('pointerleave', () => { if (this.hoverId === n.id) { this.hoverId = null; this.detail.classList.remove('is-on'); } });
    el.addEventListener('click', () => this.onNodeClick(n.id));
    this.views.set(n.id, { node: n, el, cost, money, lv, pips, state: null, level: -1 });
  }

  // =====================================================================================
  // State
  // =====================================================================================

  protected override onOpen(): void {
    this.dirty = true;
    this.measure();
    if (!this.positioned) {
      this.positioned = true;
      this.panX = 0;
      this.panY = 0;
      this.applyPan();
    }
    this.refresh();
  }

  protected override onClose(): void {
    this.detail.classList.remove('is-on');
    this.hoverId = null;
    this.drag = null;
    this.viewport.classList.remove('is-dragging');
  }

  protected tick(): void {
    const p = this.env.ctx.sim.progress;
    let lv = 0;
    for (const v of p.nodes.values()) lv += v;
    const sig = `${p.wp}|${lv}|${Math.floor(p.money / 50)}`;
    if (sig !== this.sig) this.dirty = true;
    if (this.dirty) this.refresh();
  }

  private refresh(): void {
    this.dirty = false;
    const p = this.env.ctx.sim.progress;
    let lv = 0;
    for (const v of p.nodes.values()) lv += v;
    this.sig = `${p.wp}|${lv}|${Math.floor(p.money / 50)}`;
    let unlocked = 0;
    let available = 0;
    const perBranch = new Map<BranchId, { owned: number; ready: number }>();
    for (const b of BRANCHES) perBranch.set(b.id, { owned: 0, ready: 0 });

    for (const v of this.views.values()) {
      const n = v.node;
      const level = p.nodeLevel(n.id);
      const reqMet = nextRequirements(n, level).every((r) => p.isUnlocked(r));
      const nextCost = level < n.levels.length ? n.levels[level].cost : 0;
      const nextMoney = level < n.levels.length ? n.levels[level].money : 0;
      const st = nodeState(level, n.levels.length, reqMet, p.wp, nextCost, p.money, nextMoney);
      const ready = st === 'ready';
      if (level > 0) unlocked++;
      if (ready) available++;
      const pb = perBranch.get(n.branch);
      if (pb) { if (level > 0) pb.owned++; if (ready) pb.ready++; }
      if (st !== v.state || level !== v.level) {
        v.state = st;
        v.level = level;
        v.el.classList.remove('is-locked', 'is-ready', 'is-short', 'is-owned', 'is-maxed');
        v.el.classList.add(`is-${st}`);
        v.el.classList.toggle('has-level', level > 0);
        for (let i = 0; i < v.pips.length; i++) v.pips[i].classList.toggle('is-on', i < level);
      }
      v.cost.set(level < n.levels.length ? fmtInt(nextCost) : '');
      v.money.set(level < n.levels.length && nextMoney > 0 ? fmtPrice(nextMoney) : '');
      v.el.classList.toggle('is-poor', level < n.levels.length && p.money < nextMoney);
      v.lv?.set(`Lv ${Math.max(1, displayLevel(n, level))}/${maxDisplayLevel(n)}`);
      v.el.classList.toggle('has-lv', !!v.lv && (level > 0 || (n.levelBase ?? 0) > 0));
    }
    for (const e of this.edges) {
      const st = p.isUnlocked(e.to) ? 'done' : p.isUnlocked(e.from) ? 'open' : 'dim';
      if (st !== e.state) { e.state = st; e.el.setAttribute('class', `pn-edge is-${st}`); }
    }
    for (const b of this.branches) {
      const pb = perBranch.get(b.layout.def.id);
      if (!pb) continue;
      b.progress.set(`${pb.owned}/${b.layout.nodes.length}`);
      b.chipCount.set(pb.ready > 0 ? String(pb.ready) : '');
      b.chip.classList.toggle('has-ready', pb.ready > 0);
    }
    this.wpText.set(fmtInt(Math.floor(p.wp)));
    this.unlockedText.set(`Unlocked ${unlocked} / ${this.views.size}`);
    this.availText.set(available > 0 ? `${available} available` : 'Nothing affordable yet');
    this.availBadge.classList.toggle('is-on', available > 0);
    this.board.classList.toggle('is-filter', this.filter === 'available');
    if (this.hoverId) this.showDetail(this.hoverId);
  }

  private setFilter(f: 'all' | 'available'): void {
    this.filter = f;
    this.chipAll.classList.toggle('is-active', f === 'all');
    this.chipAvail.classList.toggle('is-active', f === 'available');
    this.board.classList.toggle('is-filter', f === 'available');
  }

  // =====================================================================================
  // Interaction
  // =====================================================================================

  private onNodeClick(id: string): void {
    if (this.suppressClick) return;
    const v = this.views.get(id);
    if (!v) return;
    const ctx = this.env.ctx;
    const chk = ctx.sim.progress.canUnlock(id);
    if (!chk.ok) {
      ctx.actions.playUiSound('deny');
      replayClass(v.el, 'is-shake');
      return;
    }
    ctx.actions.unlockNode(id);
    replayClass(v.el, 'is-pop');
    const burst = h('span', 'pn-tn-burst', v.el);
    burst.addEventListener('animationend', () => burst.remove(), { once: true });
    this.dirty = true;
    this.refresh();
  }

  private showDetail(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    const n = v.node;
    const p = this.env.ctx.sim.progress;
    const level = p.nodeLevel(id);
    const base = n.levelBase ?? 0;
    const shown = Math.max(1, displayLevel(n, level));
    const max = maxDisplayLevel(n);
    const color = BRANCH_COLOR.get(n.branch) ?? '#f2c14e';
    const branchName = BRANCHES.find((b) => b.id === n.branch)?.name ?? '';
    let html = `<div class="pn-td-branch" style="--bc:${color}">${escapeHTML(branchName)}</div>`;
    html += `<div class="pn-td-head"><span class="pn-td-ic" style="--bc:${color}">${icon(n.icon)}</span><div><div class="pn-td-name">${escapeHTML(n.name)}</div>`;
    const levelText = n.leveled ? (level === 0 && !base ? `Not researched · max Lv. ${max}` : `Lv. ${shown} / ${max}`) : `Level ${level} / ${n.levels.length}`;
    html += `<div class="pn-td-meta"><span class="pn-td-kind">${n.leveled ? 'Technology' : KIND_LABEL[n.kind]}</span><span class="pn-td-lvl">${levelText}</span></div></div></div>`;
    if (n.leveled && n.unlocks) html += '<div class="pn-td-note">Upgrades every unit you own and every unit you build later.</div>';

    // Current -> next values of what the next level changes.
    const next = level < n.levels.length ? n.levels[level] : null;
    if (next && next.effects.length) {
      const get = (k: string) => p.stat(k);
      const rows: string[] = [];
      const seen = new Set<string>();
      for (const e of next.effects) {
        const lab = STAT_LABELS[e.stat];
        if (!lab || seen.has(lab.label)) continue;
        seen.add(lab.label);
        const cur = p.stat(e.stat);
        let nv = cur;
        for (const x of next.effects) if (x.stat === e.stat) nv = x.op === 'set' ? x.value : x.op === 'mul' ? nv * x.value : nv + x.value;
        const nextGet = (k: string) => (k === e.stat ? nv : get(k));
        rows.push(`<tr><td>${escapeHTML(lab.label)}</td><td>${escapeHTML(lab.fmt(cur, get))}</td><td class="pn-td-arrow">→</td><td class="pn-td-new">${escapeHTML(lab.fmt(nv, nextGet))}</td></tr>`);
      }
      if (rows.length) html += `<table class="pn-td-stats"><tr><th></th><th>Now</th><th></th><th>Lv. ${displayLevel(n, level + 1)}</th></tr>${rows.join('')}</table>`;
    }

    html += '<ul class="pn-td-levels">';
    // Long ladders (Hay Sell Value): owned levels collapse into one line, at most 4 upcoming levels are listed.
    const long = n.levels.length > 5;
    if (long && level + base > 0) html += `<li class="is-done">${icon('check')}<span><b>Lv 1${level + base > 1 ? `-${level + base}` : ''}</b> owned.</span></li>`;
    else if (base) html += `<li class="is-done">${icon('check')}<span><b>Lv 1</b> Starting level.</span></li>`;
    n.levels.forEach((lvDef, i) => {
      if (long && (i < level || i >= level + 4)) return;
      const cls = i < level ? 'is-done' : i === level ? 'is-next' : 'is-later';
      const costs = `<span class="pn-td-cost">${icon('wp')}${fmtInt(lvDef.cost)}${lvDef.money > 0 ? ` <span class="pn-td-money">${fmtPrice(lvDef.money)}</span>` : ''}</span>`;
      const tag = i < level ? icon('check') : costs;
      html += `<li class="${cls}">${tag}<span>${n.levels.length > 1 || base ? `<b>Lv ${i + 1 + base}</b> ` : ''}${escapeHTML(lvDef.desc)}</span></li>`;
    });
    html += '</ul>';
    const unlocks = unlocksText(n);
    if (unlocks) html += `<div class="pn-td-unlocks">${icon('shop')}<span>${escapeHTML(unlocks)}</span></div>`;
    const reqs = nextRequirements(n, level);
    if (reqs.length) {
      html += `<div class="pn-td-reqs"><div class="pn-td-sub">${level === 0 ? 'Requires' : `Lv. ${displayLevel(n, level + 1)} requires`}</div>`;
      for (const r of reqs) {
        const rn = NODE_BY_ID.get(parseRequirement(r)[0]);
        const ok = p.isUnlocked(r);
        const rc = rn ? BRANCH_COLOR.get(rn.branch) ?? '#888' : '#888';
        html += `<div class="pn-td-req ${ok ? 'is-ok' : 'is-missing'}">${icon(ok ? 'check' : 'lock')}<i style="background:${rc}"></i><span>${escapeHTML(requirementLabel(r))}</span></div>`;
      }
      html += '</div>';
    }
    const chk = p.canUnlock(id);
    const verb = level === 0 && !base ? 'unlock' : `upgrade to Lv. ${displayLevel(n, level + 1)}`;
    const status = chk.ok ? `Click to ${verb}` : chk.reason === 'Maxed' ? 'Fully upgraded' : chk.reason ?? '';
    html += `<div class="pn-td-status ${chk.ok ? 'is-ok' : chk.reason === 'Maxed' ? 'is-max' : 'is-no'}">${escapeHTML(status)}</div>`;
    this.detail.innerHTML = html;
    this.detail.style.setProperty('--bc', color);
    this.detail.classList.add('is-on');
    this.placeDetail(v.el);
  }

  private placeDetail(target: HTMLElement): void {
    const r = target.getBoundingClientRect();
    const host = this.el.getBoundingClientRect();
    const d = this.detail;
    const w = d.offsetWidth;
    const hgt = d.offsetHeight;
    const gap = 12;
    let x = r.right - host.left + gap;
    if (x + w > host.width - 8) x = r.left - host.left - gap - w;
    x = clamp(x, 8, Math.max(8, host.width - w - 8));
    const y = clamp(r.top - host.top + r.height / 2 - hgt / 2, 8, Math.max(8, host.height - hgt - 8));
    d.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // =====================================================================================
  // Pan (drag + wheel)
  // =====================================================================================

  private bindPan(): void {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, px: this.panX, py: this.panY, moved: false };
      this.suppressClick = false;
    });
    vp.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && dx * dx + dy * dy > 36) {
        d.moved = true;
        vp.setPointerCapture(e.pointerId);
        vp.classList.add('is-dragging');
        this.detail.classList.remove('is-on');
      }
      if (d.moved) {
        this.panX = d.px + dx;
        this.panY = d.py + dy;
        this.applyPan();
      }
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.drag = null;
      if (d.moved) {
        this.suppressClick = true;
        vp.classList.remove('is-dragging');
        if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId);
        // The click (if any) fires right after pointerup; re-enable afterwards.
        requestAnimationFrame(() => { this.suppressClick = false; });
      }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? this.viewH : 1;
      let dx = e.deltaX * k;
      let dy = e.deltaY * k;
      if (e.shiftKey || this.boardH <= this.viewH + 1) { dx += dy; dy = 0; }
      this.panX -= dx;
      this.panY -= dy;
      this.applyPan();
      this.detail.classList.remove('is-on');
    }, { passive: false });
  }

  private measure(): void {
    this.viewW = this.viewport.clientWidth;
    this.viewH = this.viewport.clientHeight;
    this.boardW = this.board.offsetWidth;
    this.boardH = this.board.offsetHeight;
    this.applyPan();
  }

  private applyPan(): void {
    const mx = this.boardW <= this.viewW ? (this.viewW - this.boardW) / 2 : NaN;
    const my = this.boardH <= this.viewH ? (this.viewH - this.boardH) / 2 : NaN;
    this.panX = Number.isNaN(mx) ? clamp(this.panX, this.viewW - this.boardW, 0) : mx;
    this.panY = Number.isNaN(my) ? clamp(this.panY, this.viewH - this.boardH, 0) : my;
    this.board.style.transform = `translate3d(${Math.round(this.panX)}px, ${Math.round(this.panY)}px, 0)`;
  }

  private jumpTo(sec: HTMLElement): void {
    this.panX = -sec.offsetLeft + 12;
    this.panY = 0;
    this.board.classList.add('is-gliding');
    this.board.addEventListener('transitionend', () => this.board.classList.remove('is-gliding'), { once: true });
    this.applyPan();
  }

  override destroy(): void {
    window.removeEventListener('resize', this.onResize);
    super.destroy();
  }
}

/** "Unlocks the Hay Hopper and Conveyor in the Shop" style text for plan nodes. */
function unlocksText(n: TechNode): string {
  const u = n.unlocks;
  if (!u) return '';
  const names: string[] = [];
  for (const b of u.building ?? []) names.push(BUILDABLES[b].name);
  if (u.tool) names.push(TOOLS[u.tool].name);
  if (u.wheelbarrow) names.push(WHEELBARROW.name);
  if (!names.length) return '';
  return `Adds ${names.join(', ')} to the Shop`;
}
