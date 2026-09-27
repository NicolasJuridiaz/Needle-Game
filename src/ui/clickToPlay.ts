import { NEEDLE_COUNT } from '../config/needles';
import type { GameMode } from './context';
import { ClassSlot, h, TextSlot } from './dom';
import type { WelcomeBackInfo } from '../game/welcomeBack';
import type { AnalyticsConsentView } from './context';
import { fmtClock, fmtDuration, fmtMoney, fmtRate } from './format';
import { icon } from './icons';
import { keycapHTML, type PartEnv, type UIPart } from './part';

/**
 * Title overlay shown before the first click (and after focus loss). It is click-through
 * (pointer-events: none) so the click lands on the canvas, which starts the game with pointer lock
 * and audio unlocked. Touch-only devices get a friendly "desktop only" notice instead.
 */
export class ClickToPlay implements UIPart {
  private readonly el: HTMLElement;
  private readonly visible: ClassSlot;
  private readonly resume: TextSlot;
  private readonly touch: boolean;
  private cta: HTMLElement | null = null;
  private welcomeEl: HTMLElement | null = null;
  private welcomeShown: WelcomeBackInfo | null = null;
  private consentEl: HTMLElement | null = null;
  private consentShown: string | null = null;

  constructor(private readonly env: PartEnv, parent: HTMLElement) {
    const ctx = env.ctx;
    this.touch = ctx.isTouchOnly();
    const el = (this.el = h('div', 'pn-ctp', parent));
    this.visible = new ClassSlot(el, 'is-on');
    el.classList.toggle('is-touch', this.touch);
    const logo = h('div', 'pn-logo', el);
    logo.innerHTML =
      `<div class="pn-logo-top">Project</div>` +
      `<div class="pn-logo-main"><span>Needle</span><svg class="pn-logo-needle" viewBox="0 0 200 24" aria-hidden="true">` +
      `<path d="M4 12 L170 9.2 L170 14.8 Z" fill="currentColor"/>` +
      `<rect x="168" y="6.6" width="26" height="10.8" rx="5.4" fill="none" stroke="currentColor" stroke-width="3"/>` +
      `<path d="M196 12c14 0 6 10 -4 9" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".7"/></svg></div>`;
    h('div', 'pn-ctp-tag', el, 'Dig a mountain of hay. Build an absurd hay factory. Find the 6 hidden needles.');
    if (this.touch) {
      const n = h('div', 'pn-ctp-touch', el);
      n.innerHTML = `${icon('keyboard')}<div><b>Keyboard and mouse needed</b><span>Project Needle is a first-person game for desktop and laptop computers. Open this page on a computer to play!</span></div>`;
      this.resume = new TextSlot(h('div', 'pn-ctp-resume', el));
      return;
    }
    this.welcomeEl = h('div', 'pn-wb', el);
    const cta = (this.cta = h('div', 'pn-ctp-cta', el));
    cta.innerHTML = `${keycapHTML('LMB', (c) => ctx.keyLabel(c))}<span>Click to play</span>`;
    this.resume = new TextSlot(h('div', 'pn-ctp-resume', el));
    const keys = h('div', 'pn-ctp-keys', el);
    const L = (c: string) => ctx.keyLabel(c);
    keys.innerHTML = [
      `<span>${keycapHTML('KeyW', L)}${keycapHTML('KeyA', L)}${keycapHTML('KeyS', L)}${keycapHTML('KeyD', L)} Move</span>`,
      `<span>${keycapHTML('LMB', L)} Dig</span>`,
      `<span>${keycapHTML('KeyE', L)} Sell / use</span>`,
      `<span>${keycapHTML('KeyT', L)} Work Tree</span>`,
      `<span>${keycapHTML('KeyB', L)} Shop</span>`,
      `<span>${keycapHTML('KeyQ', L)} Build</span>`,
      `<span>${keycapHTML('Escape', L)} Pause</span>`,
    ].join('');
    this.consentEl = h('div', 'pn-consent', el);
  }

  update(_dt: number, mode: GameMode): void {
    const on = mode === 'clickToPlay';
    this.visible.set(on);
    const wb = this.env.ctx.getWelcomeBack?.() ?? null;
    this.renderWelcome(wb);
    if (!on) return;
    this.renderConsent(this.env.ctx.getAnalyticsConsent?.() ?? null);
    const sim = this.env.ctx.sim;
    const found = sim.progress.needlesFound.length;
    this.resume.set(!wb && sim.time > 1 ? `Welcome back!  ${fmtClock(sim.time)} played  -  ${found}/${NEEDLE_COUNT} needles found` : '');
  }

  /**
   * Opt-in analytics card (CrazyGames "User Consent"): compact, top-right, two equally prominent choices, never
   * blocks playing (clicking the game starts it with analytics off). Shown only while no choice has been made.
   */
  private renderConsent(c: AnalyticsConsentView | null): void {
    const show = !!c?.prompt;
    const key = show ? `on:${c!.policyUrl ?? ''}` : 'off';
    if (key === this.consentShown || !this.consentEl) return;
    this.consentShown = key;
    this.consentEl.classList.toggle('is-on', show);
    this.consentEl.replaceChildren();
    if (!show) return;
    h('div', 'pn-consent-title', this.consentEl, 'Help improve Project Needle?');
    const p = h('div', 'pn-consent-text', this.consentEl,
      'With your permission we record anonymous gameplay statistics (progress, purchases, performance) with ByteBrew to see how the game is played. Nothing is sent unless you allow it. ');
    if (c!.policyUrl) {
      const a = document.createElement('a');
      a.href = c!.policyUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Privacy policy';
      p.appendChild(a);
    }
    const row = h('div', 'pn-consent-actions', this.consentEl);
    const choose = (allow: boolean) => {
      this.env.sound('uiClick');
      this.env.ctx.actions.setAnalyticsConsent?.(allow, 'prompt');
    };
    for (const [label, allow] of [['Allow analytics', true], ['Continue without analytics', false]] as const) {
      const b = h('button', 'pn-consent-btn', row, label);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.stopPropagation(); choose(allow); });
    }
  }

  /** Welcome Back card (only after a real absence; the click that dismisses it is the normal click to play). */
  private renderWelcome(wb: WelcomeBackInfo | null): void {
    if (wb === this.welcomeShown || !this.welcomeEl) return;
    this.welcomeShown = wb;
    this.welcomeEl.classList.toggle('is-on', !!wb);
    this.cta?.lastElementChild?.replaceChildren(wb ? 'Click to continue' : 'Click to play');
    if (!wb) { this.welcomeEl.replaceChildren(); return; }
    const row = (label: string, value: string) => `<div class="pn-wb-row"><span>${label}</span><b>${value}</b></div>`;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    this.welcomeEl.innerHTML =
      `<div class="pn-wb-title">Welcome back</div>` +
      `<div class="pn-wb-sub">Away for ${fmtDuration(wb.secondsAway)} - ${fmtClock(wb.playedSeconds)} played</div>` +
      row('Objective', esc(wb.objective)) +
      row('Needles', `${wb.needlesFound} / ${wb.needlesTotal}`) +
      row('Haystack removed', `${wb.pilePercent}%`) +
      row('Production', wb.hayPerSecond > 0 ? `${fmtRate(wb.hayPerSecond)} hay/s` : 'Nothing automated yet') +
      row('Money', fmtMoney(wb.money)) +
      (wb.orders.length ? row('Orders', wb.orders.map(esc).join('<br/>')) : '');
  }

  destroy(): void { this.el.remove(); }
}
