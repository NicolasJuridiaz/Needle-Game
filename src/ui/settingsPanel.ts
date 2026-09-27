import type { Settings } from '../game/settings';
import { h } from './dom';
import { fmtPct } from './format';
import { wireSounds, type PartEnv } from './part';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

interface SliderDef { key: NumKey; label: string; min: number; max: number; step: number; fmt: (v: number) => string }
interface ToggleDef { key: BoolKey; label: string; desc?: string }

const QUALITY: Settings['quality'][] = ['low', 'medium', 'high'];
const QUALITY_LABEL: Record<Settings['quality'], string> = { low: 'Low', medium: 'Medium', high: 'High' };
const QUALITY_DESC: Record<Settings['quality'], string> = {
  low: 'Fastest: no shadows, fewer effects',
  medium: 'Balanced (recommended)',
  high: 'Sharpest: anti-aliasing, finer shadows',
};
const RELOAD_NOTE = 'Anti-aliasing changes after a page reload';

/**
 * Optional capability of the context (implemented by Game): the chosen quality needs a page reload to
 * fully apply (MSAA is fixed when the WebGL context is created). Everything else applies live.
 */
interface GraphicsReloadInfo { graphicsReloadRequired?(): boolean }
type UIContextLike = PartEnv['ctx'] & GraphicsReloadInfo;
/** Minimum interval (ms) between live updates while a slider is dragged (settings are persisted on each). */
const LIVE_INTERVAL = 120;

/**
 * Settings form. Every Settings field has a control; changes go through ctx.actions.setSettings.
 * Values are always read from ctx.settings (the game replaces the object on every change).
 */
export class SettingsPanel {
  readonly el: HTMLElement;
  private readonly sliders: { def: SliderDef; input: HTMLInputElement; out: HTMLElement; wrap: HTMLElement; last: number }[] = [];
  private readonly toggles: { def: ToggleDef; btn: HTMLButtonElement }[] = [];
  private readonly quality: HTMLButtonElement[] = [];
  private qualityDesc!: HTMLElement;
  private privacy: { btn: HTMLButtonElement; desc: HTMLElement; link: HTMLAnchorElement } | null = null;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    this.el = h('div', 'pn-settings', parent);
    const audio = this.group('Audio');
    this.slider(audio, { key: 'masterVolume', label: 'Master volume', min: 0, max: 1, step: 0.01, fmt: fmtPct });
    this.slider(audio, { key: 'sfxVolume', label: 'Effects volume', min: 0, max: 1, step: 0.01, fmt: fmtPct });
    this.slider(audio, { key: 'musicVolume', label: 'Music volume', min: 0, max: 1, step: 0.01, fmt: fmtPct });
    this.toggle(audio, { key: 'music', label: 'Music' });

    const controls = this.group('Controls');
    this.slider(controls, { key: 'sensitivity', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}x` });
    this.toggle(controls, { key: 'invertY', label: 'Invert mouse Y' });
    this.toggle(controls, { key: 'holdToDig', label: 'Hold to dig', desc: 'Off: click once to keep digging' });

    const display = this.group('Display');
    this.slider(display, { key: 'fov', label: 'Field of view', min: 60, max: 100, step: 1, fmt: (v) => `${Math.round(v)}°` });
    const row = h('div', 'pn-set-row', display);
    const qLabel = h('span', 'pn-set-label', row, 'Graphics quality');
    this.qualityDesc = h('small', 'pn-set-desc', qLabel);
    const seg = h('div', 'pn-seg', row);
    for (const q of QUALITY) {
      const b = h('button', 'pn-seg-btn', seg, QUALITY_LABEL[q]);
      b.type = 'button';
      wireSounds(env, b);
      b.addEventListener('click', () => { env.ctx.actions.setSettings({ quality: q, qualityManual: true }); this.sync(); });
      this.quality.push(b);
    }
    this.toggle(display, { key: 'showFps', label: 'Show FPS counter' });

    this.privacyRow(this.group('Privacy'));
  }

  /**
   * Analytics consent row: shows the REAL state (unknown shows as off, "not allowed yet"). Switching it on is an
   * explicit consent (grant); switching it off withdraws it. Disabled when the build cannot send analytics.
   */
  private privacyRow(parent: HTMLElement): void {
    const row = h('div', 'pn-set-row', parent);
    const lab = h('span', 'pn-set-label', row, 'Share anonymous gameplay statistics');
    const desc = h('small', 'pn-set-desc', lab);
    const btn = h('button', 'pn-toggle', row);
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.innerHTML = '<i></i>';
    wireSounds(this.env, btn);
    const link = document.createElement('a');
    link.className = 'pn-set-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Privacy policy';
    parent.appendChild(link);
    btn.addEventListener('click', () => {
      const c = this.env.ctx.getAnalyticsConsent?.();
      if (!c?.available) return;
      this.env.ctx.actions.setAnalyticsConsent?.(!c.on, 'settings');
      this.sync();
    });
    this.privacy = { btn, desc, link };
  }

  private syncPrivacy(): void {
    if (!this.privacy) return;
    const { btn, desc, link } = this.privacy;
    const c = this.env.ctx.getAnalyticsConsent?.();
    const available = !!c?.available;
    const on = !!c?.on;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.disabled = !available;
    desc.textContent = !available ? 'Not available in this version'
      : on ? 'On - helps us improve the game. Turn off any time.'
      : c?.state === 'denied' ? 'Off - nothing is sent'
      : 'Not allowed yet - nothing is sent until you turn this on';
    const url = c?.policyUrl ?? null;
    link.style.display = available && url ? '' : 'none';
    if (url) link.href = url;
  }

  private group(title: string): HTMLElement {
    const g = h('div', 'pn-set-group', this.el);
    h('div', 'pn-set-title', g, title);
    return g;
  }

  private slider(parent: HTMLElement, def: SliderDef): void {
    const row = h('label', 'pn-set-row', parent);
    h('span', 'pn-set-label', row, def.label);
    const wrap = h('span', 'pn-range', row);
    const input = h('input', '', wrap);
    input.type = 'range';
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    const out = h('span', 'pn-set-val', row);
    const entry = { def, input, out, wrap, last: 0 };
    const apply = (final: boolean) => {
      const v = Number(input.value);
      this.paint(entry, v);
      const now = performance.now();
      if (!final && now - entry.last < LIVE_INTERVAL) return;
      entry.last = now;
      if (this.env.ctx.settings[def.key] !== v) this.env.ctx.actions.setSettings({ [def.key]: v } as Partial<Settings>);
    };
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => { apply(true); this.env.sound('uiClick'); });
    this.sliders.push(entry);
  }

  private toggle(parent: HTMLElement, def: ToggleDef): void {
    const row = h('div', 'pn-set-row', parent);
    const lab = h('span', 'pn-set-label', row, def.label);
    if (def.desc) h('small', 'pn-set-desc', lab, def.desc);
    const btn = h('button', 'pn-toggle', row);
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.innerHTML = '<i></i>';
    wireSounds(this.env, btn);
    btn.addEventListener('click', () => {
      this.env.ctx.actions.setSettings({ [def.key]: !this.env.ctx.settings[def.key] } as Partial<Settings>);
      this.sync();
    });
    this.toggles.push({ def, btn });
  }

  private paint(entry: { def: SliderDef; out: HTMLElement; wrap: HTMLElement }, v: number): void {
    const d = entry.def;
    entry.out.textContent = d.fmt(v);
    entry.wrap.style.setProperty('--p', `${((v - d.min) / (d.max - d.min)) * 100}%`);
  }

  /** Pull current values from ctx.settings into the controls. */
  sync(): void {
    const s = this.env.ctx.settings;
    for (const e of this.sliders) {
      const v = s[e.def.key];
      e.input.value = String(v);
      this.paint(e, v);
    }
    for (const t of this.toggles) {
      const on = s[t.def.key];
      t.btn.classList.toggle('is-on', on);
      t.btn.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    QUALITY.forEach((q, i) => this.quality[i].classList.toggle('is-active', s.quality === q));
    this.syncPrivacy();
    const reload = (this.env.ctx as UIContextLike).graphicsReloadRequired?.() === true;
    this.qualityDesc.textContent = reload ? RELOAD_NOTE : QUALITY_DESC[s.quality] ?? '';
    // Highlighted (hay accent) while a reload is pending; styles.css has no dedicated class for it.
    this.qualityDesc.style.color = reload ? 'var(--hay)' : '';
  }
}
