import { NEEDLE_COUNT } from '../config/needles';
import type { UIContext } from './context';
import { ClassSlot, h, TextSlot } from './dom';
import { fmtAgo, fmtClock } from './format';
import { icon } from './icons';
import { button, keycapHTML, Panel, type PartEnv } from './part';
import { SettingsPanel } from './settingsPanel';

interface ControlRow { keys: string[]; label: string; joiner?: string }

/** Controls reference (codes are translated with ctx.keyLabel for the player's layout). */
export const CONTROLS: { title: string; rows: ControlRow[] }[] = [
  {
    title: 'On foot',
    rows: [
      { keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'], label: 'Move', joiner: '' },
      { keys: ['Mouse'], label: 'Look around' },
      { keys: ['LMB'], label: 'Use tool / dig' },
      { keys: ['KeyE'], label: 'Interact: sell, deposit, take' },
      { keys: ['KeyF'], label: 'Switch machine on / off' },
      { keys: ['Digit1', 'Digit6'], label: 'Select tool', joiner: '-' },
      { keys: ['ShiftLeft'], label: 'Sprint' },
      { keys: ['Space'], label: 'Jump' },
    ],
  },
  {
    title: 'Building',
    rows: [
      { keys: ['KeyQ'], label: 'Build mode on / off' },
      { keys: ['LMB'], label: 'Place / confirm' },
      { keys: ['RMB'], label: 'Cancel' },
      { keys: ['KeyR'], label: 'Rotate' },
      { keys: ['KeyX'], label: 'Remove mode' },
      { keys: ['KeyM'], label: 'Move mode' },
      { keys: ['KeyC'], label: 'Upper / ground level' },
      { keys: ['KeyV'], label: 'Variant (lift / ramp)' },
    ],
  },
  {
    title: 'Menus',
    rows: [
      { keys: ['KeyT'], label: 'Work Tree' },
      { keys: ['KeyB'], label: 'SUPPLY CO.' },
      { keys: ['KeyO'], label: 'Order Board' },
      { keys: ['Escape'], label: 'Pause' },
    ],
  },
];

function keysHTML(row: ControlRow, ctx: UIContext): string {
  const label = (c: string) => ctx.keyLabel(c);
  const caps = row.keys.map((k) => (k === 'Mouse' ? `<kbd class="pn-key pn-key--wide">Mouse</kbd>` : keycapHTML(k, label)));
  const j = row.joiner ?? ' ';
  return caps.join(j === '' ? '' : `<span class="pn-keys-sep">${j}</span>`);
}

/** Pause menu: resume, settings, controls reference, save status and New Run (with confirmation). */
export class Pause extends Panel {
  private readonly saved: TextSlot;
  private readonly runInfo: TextSlot;
  private readonly settings: SettingsPanel;
  private readonly tabSettings: HTMLButtonElement;
  private readonly tabControls: HTMLButtonElement;
  private readonly pageSettings: HTMLElement;
  private readonly pageControls: HTMLElement;
  private readonly confirm: ClassSlot;
  private slow = 0;

  constructor(env: PartEnv, parent: HTMLElement) {
    super(env, parent, 'paused', 'pn-pause-screen');
    const ctx = env.ctx;
    const panel = h('div', 'pn-panel pn-pause', this.el);

    // ----- left column
    const side = h('div', 'pn-pause-side', panel);
    h('div', 'pn-pause-title', side, 'Paused');
    this.runInfo = new TextSlot(h('div', 'pn-pause-run', side));
    const savedEl = h('div', 'pn-pause-saved', side);
    savedEl.innerHTML = icon('save');
    this.saved = new TextSlot(h('span', '', savedEl));
    const actions = h('div', 'pn-pause-actions', side);
    button(env, actions, { cls: 'pn-btn--primary pn-btn--big', icon: 'play', label: 'Resume' }, () => ctx.actions.resume());
    button(env, actions, { cls: 'pn-btn--ghost pn-btn--danger', icon: 'restart', label: 'New Run' }, () => this.confirm.set(true));
    h('div', 'pn-pause-tip', side).innerHTML = `Press ${keycapHTML('Escape', (c) => ctx.keyLabel(c))} or click Resume to get back in`;

    // ----- right column: tabs
    const main = h('div', 'pn-pause-main', panel);
    const tabs = h('div', 'pn-tabs pn-tabs--small', main);
    this.tabSettings = button(env, tabs, { cls: 'pn-tab is-active', icon: 'settings', label: 'Settings' }, () => this.showTab('settings'));
    this.tabControls = button(env, tabs, { cls: 'pn-tab', icon: 'keyboard', label: 'Controls' }, () => this.showTab('controls'));
    this.pageSettings = h('div', 'pn-pause-page', main);
    this.settings = new SettingsPanel(env, this.pageSettings);
    this.pageControls = h('div', 'pn-pause-page pn-controls is-hidden', main);
    for (const g of CONTROLS) {
      const col = h('div', 'pn-controls-group', this.pageControls);
      h('div', 'pn-set-title', col, g.title);
      for (const r of g.rows) {
        const row = h('div', 'pn-controls-row', col);
        h('span', 'pn-controls-keys', row).innerHTML = keysHTML(r, ctx);
        h('span', 'pn-controls-label', row, r.label);
      }
    }

    // ----- confirm dialog
    const dlg = h('div', 'pn-confirm', this.el);
    this.confirm = new ClassSlot(dlg, 'is-on');
    const box = h('div', 'pn-panel pn-confirm-box', dlg);
    box.innerHTML = `<div class="pn-confirm-ic">${icon('warn')}</div><div class="pn-confirm-title">Start a new run?</div><p>Your factory, money, Work Points and found needles will be lost. A brand-new haystack is waiting.</p>`;
    const row = h('div', 'pn-confirm-actions', box);
    button(env, row, { cls: 'pn-btn--ghost', label: 'Keep this run' }, () => this.confirm.set(false));
    button(env, row, { cls: 'pn-btn--danger', icon: 'restart', label: 'Start over' }, () => { this.confirm.set(false); ctx.actions.newGame(); });
  }

  private showTab(t: 'settings' | 'controls'): void {
    this.tabSettings.classList.toggle('is-active', t === 'settings');
    this.tabControls.classList.toggle('is-active', t === 'controls');
    this.pageSettings.classList.toggle('is-hidden', t !== 'settings');
    this.pageControls.classList.toggle('is-hidden', t !== 'controls');
  }

  protected override onOpen(): void {
    this.confirm.set(false);
    this.settings.sync();
    this.slow = 1;
  }

  protected override onClose(): void { this.confirm.set(false); }

  protected tick(dt: number): void {
    this.slow += dt;
    if (this.slow < 0.5) return;
    this.slow = 0;
    const ctx = this.env.ctx;
    const at = (ctx as unknown as { lastSavedAt?: number }).lastSavedAt;
    this.saved.set(at && at > 0 ? `Saved ${fmtAgo(Date.now() - at)}` : 'Not saved yet');
    const p = ctx.sim.progress;
    this.runInfo.set(`${fmtClock(ctx.sim.time)} played  -  ${p.needlesFound.length}/${NEEDLE_COUNT} needles`);
  }
}
