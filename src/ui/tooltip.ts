import { BUILDABLES } from '../config/buildables';
import type { BuildingInfo } from '../sim/building';
import type { MachineStatus } from '../sim/types';
import type { GameMode } from './context';
import { ClassSlot, h, TextSlot } from './dom';
import { setIcon, statusIcon } from './icons';
import { HUD_MODES, keycapHTML, type PartEnv, type UIPart } from './part';

export type StatusTone = 'good' | 'idle' | 'warn' | 'bad' | 'alarm' | 'off';

/** Player-facing label and colour tone for every machine status. */
export const STATUS_META: Record<MachineStatus, { label: string; tone: StatusTone }> = {
  running: { label: 'Running', tone: 'good' },
  processing: { label: 'Working', tone: 'good' },
  idle: { label: 'Idle', tone: 'idle' },
  noInput: { label: 'Waiting', tone: 'warn' },
  noHay: { label: 'No hay', tone: 'warn' },
  outputBlocked: { label: 'Blocked', tone: 'warn' },
  full: { label: 'Full', tone: 'warn' },
  noPower: { label: 'No power', tone: 'bad' },
  lowPower: { label: 'Low power', tone: 'warn' },
  noFuel: { label: 'No fuel', tone: 'bad' },
  disabled: { label: 'Switched off', tone: 'off' },
  needleAlarm: { label: 'Needle found!', tone: 'alarm' },
};

/** Buildable lookup by display name (BuildingInfo only carries the title). */
const DEF_BY_NAME = new Map(Object.values(BUILDABLES).map((d) => [d.name, d]));

const MAX_LINES = 8;

interface LineEl { row: HTMLElement; label: TextSlot; value: TextSlot; tone: string }

/** Tooltip for the aimed building: title, coloured status pill + explanation, info lines. */
export class MachineTooltip implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private readonly ic: HTMLElement;
  private readonly title: TextSlot;
  private readonly pill: HTMLElement;
  private readonly pillIc: HTMLElement;
  private readonly pillText: TextSlot;
  private readonly statusText: TextSlot;
  private readonly lines: LineEl[] = [];
  private readonly foot: HTMLElement;
  private readonly footVisible: ClassSlot;
  private status: MachineStatus | null = null;
  private lastTitle = '';
  private slow = 0;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    const el = (this.el = h('div', 'pn-tip', parent));
    this.visible = new ClassSlot(el, 'is-on');
    const head = h('div', 'pn-tip-head', el);
    this.ic = h('span', 'pn-tip-ic', head);
    this.title = new TextSlot(h('span', 'pn-tip-title', head));
    this.pill = h('div', 'pn-pill', el);
    this.pillIc = h('span', 'pn-pill-ic', this.pill);
    this.pillText = new TextSlot(h('span', 'pn-pill-text', this.pill));
    this.statusText = new TextSlot(h('div', 'pn-tip-status', el));
    const list = h('div', 'pn-tip-lines', el);
    for (let i = 0; i < MAX_LINES; i++) {
      const row = h('div', 'pn-tip-line', list);
      this.lines.push({ row, label: new TextSlot(h('span', 'pn-tip-label', row)), value: new TextSlot(h('span', 'pn-tip-value', row)), tone: '' });
    }
    this.foot = h('div', 'pn-tip-foot', el);
    this.footVisible = new ClassSlot(this.foot, 'is-on');
    this.foot.innerHTML = `${keycapHTML('KeyF', (c) => env.ctx.keyLabel(c))}<span>Switch on / off</span>`;
  }

  update(dt: number, mode: GameMode): void {
    const info = HUD_MODES.has(mode) ? this.env.ctx.getAim().info : null;
    this.visible.set(!!info);
    if (!info) { this.lastTitle = ''; return; }
    this.slow += dt;
    if (info.title === this.lastTitle && this.slow < 0.08) return;
    this.slow = 0;
    this.render(info, mode);
  }

  private render(info: BuildingInfo, mode: GameMode): void {
    if (info.title !== this.lastTitle) {
      this.lastTitle = info.title;
      const def = DEF_BY_NAME.get(info.title);
      setIcon(this.ic, def?.icon ?? 'gear');
      this.el.style.setProperty('--tip-accent', def ? `var(--cat-${def.category})` : 'var(--hay)');
      this.footVisible.set(false);
    }
    this.title.set(info.title);
    if (info.status !== this.status) {
      this.status = info.status;
      const meta = STATUS_META[info.status] ?? { label: info.status, tone: 'idle' as StatusTone };
      this.pill.className = `pn-pill pn-pill--${meta.tone}`;
      setIcon(this.pillIc, statusIcon(info.status));
      this.pillText.set(meta.label);
    }
    this.statusText.set(info.statusText);
    const n = Math.min(MAX_LINES, info.lines.length);
    for (let i = 0; i < MAX_LINES; i++) {
      const l = this.lines[i];
      if (i >= n) { l.row.style.display = 'none'; continue; }
      const src = info.lines[i];
      l.row.style.display = '';
      l.label.set(src.label);
      l.value.set(src.value);
      const tone = src.tone ?? '';
      if (tone !== l.tone) { l.tone = tone; l.row.className = tone ? `pn-tip-line pn-tone--${tone}` : 'pn-tip-line'; }
    }
    const def = DEF_BY_NAME.get(info.title);
    this.footVisible.set(mode === 'play' && !!def && def.power > 0);
  }

  destroy(): void { this.el.remove(); }
}

